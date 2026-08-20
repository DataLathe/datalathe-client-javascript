import type { DatalatheClient } from "./client.js";
import type { Chip, SourceRequest, SourceType } from "./types.js";
import { ChipNotFoundError, DatalatheApiError } from "./errors.js";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_EMPTY_RECHECK_MINUTES = 30;
const LEGACY_EMPTY_MESSAGE = "No partitions to register";

/** Source request plus the source type it should be staged as. */
export interface ChipSourceRequest extends SourceRequest {
  sourceType: SourceType;
}

/**
 * Strategy for classifying tables and building chip creation requests.
 */
export interface ChipFactory {
  /**
   * Whether this table needs a chip per partition value (partitioned) or a
   * single chip regardless of partition context (unpartitioned).
   */
  isPartitioned(table: string): boolean;

  /**
   * Builds the source request for creating a chip for the given table,
   * including the source type, SQL query, and any partition configuration.
   * partitionValue is null for unpartitioned tables.
   */
  buildSource(table: string, partitionValue: string | null): ChipSourceRequest;

  /**
   * Expected freshness tags for the table's chips, or null/undefined/empty
   * when its chips never go stale.
   *
   * When non-empty, the resolver stamps these tags on every chip it creates
   * for the table (atomically with creation, alongside the tenant tag) and,
   * on each resolve, deletes any existing chip whose tags are missing an
   * entry or carry a different value — the replacement is created in the
   * same pass. Because new chips are stamped with the current values, a
   * freshly created chip can never be immediately stale.
   *
   * Semantics are equality-only by design: encode each staleness dimension
   * as its own entry (e.g. a schema version, a load-generation date) and
   * change the value when chips staged under the old value must be rebuilt.
   *
   * Called once per table on every resolve, so return precomputed values —
   * don't query a database or compute anything expensive here. Dynamic
   * values (e.g. the current load generation's max date) belong in the
   * factory's constructor, computed once per request.
   *
   * Caveats: a chip for the table created by any other writer without these
   * tags is treated as stale and deleted; on a partitioned table a value
   * change evicts every partition's chip at once, so the next resolve
   * re-stages all of them; and eviction is at-least-once — a concurrent
   * resolver may briefly see a chip disappear mid-report and self-heal on
   * its next resolve.
   */
  freshnessTags?(table: string): Record<string, string> | null | undefined;
}

export interface ChipResolverOptions {
  /** Per-chip creation timeout in milliseconds (default: 10 minutes). */
  timeoutMs?: number;
  /**
   * How long a create that failed because the source was empty is remembered
   * before the resolver retries it (default: 30). 0 disables the cache.
   */
  emptyRecheckMinutes?: number;
}

/** Chip IDs a resolve produced, split by how their tables are classified. */
export class ResolvedChips {
  constructor(
    readonly unpartitionedIds: string[],
    readonly partitionedIds: string[],
  ) {}

  allChipIds(): string[] {
    return [...this.unpartitionedIds, ...this.partitionedIds];
  }
}

/**
 * Resolves the set of chips needed for a report, creating any that are missing.
 *
 * Given a set of table names (or SQL queries to parse), partition values, and
 * a tag for tenant isolation, the resolver:
 * 1. Searches the engine for existing chips matching the tag
 * 2. Diffs against what's needed, splitting tables into partitioned (one chip
 *    per partition value) and unpartitioned (one chip total) via the ChipFactory
 * 3. Creates missing chips in parallel, deduplicating concurrent requests for
 *    the same chip
 * 4. Tags new chips for future lookups
 *
 * Create one resolver per application and share it. If two concurrent resolves
 * both need the same chip, only one API call is made — the other joins the
 * same promise.
 *
 * Chips are snapshots of their source; by default the resolver serves a found
 * chip forever. A factory can opt a table into staleness tracking by returning
 * expected tag entries from freshnessTags — see its contract for semantics
 * and caveats.
 *
 * @example
 * const resolver = new ChipResolver(client);
 * const chips = await resolver.resolveForTables(
 *   ["loan_summary", "loan_delinquency"],
 *   ["2025-03", "2025-04"],
 *   "tenant", "42",
 *   myFactory,
 * );
 * await client.queries.generateReport(chips.allChipIds(), queries);
 */
export class ChipResolver {
  private readonly client: DatalatheClient;
  private readonly timeoutMs: number;
  private readonly emptyRecheckMinutes: number;
  private readonly inflight = new Map<string, Promise<string | null>>();
  private readonly emptySince = new Map<string, number>();

  /** @internal Overridable time source for tests. */
  clock: () => number = Date.now;

  constructor(client: DatalatheClient, options: ChipResolverOptions = {}) {
    this.client = client;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.emptyRecheckMinutes =
      options.emptyRecheckMinutes ?? DEFAULT_EMPTY_RECHECK_MINUTES;
  }

  /**
   * Resolves chips from SQL queries. Extracts table names via
   * extractTables(), then resolves. When transform is true, MySQL/MariaDB
   * syntax is transformed before extracting tables.
   */
  async resolve(
    reportQueries: string[],
    partitionValues: string[],
    tagKey: string,
    tagValue: string,
    factory: ChipFactory,
    transform = false,
  ): Promise<ResolvedChips> {
    const tables = new Set<string>();
    for (const query of reportQueries) {
      const extracted = transform
        ? (await this.client.queries.extractTablesWithTransform(query, true)).tables
        : await this.client.queries.extractTables(query);
      for (const table of extracted) {
        tables.add(table);
      }
    }
    return this.resolveForTables(tables, partitionValues, tagKey, tagValue, factory);
  }

  /**
   * Resolves chips for known table names.
   */
  async resolveForTables(
    tables: Iterable<string>,
    partitionValues: string[],
    tagKey: string,
    tagValue: string,
    factory: ChipFactory,
  ): Promise<ResolvedChips> {
    const partitionedTables = new Set<string>();
    const unpartitionedTables = new Set<string>();
    const freshnessByTable = new Map<string, Record<string, string>>();
    for (const table of tables) {
      (factory.isPartitioned(table) ? partitionedTables : unpartitionedTables).add(table);
      const freshness = factory.freshnessTags?.(table);
      if (freshness && Object.keys(freshness).length > 0) {
        if (tagKey in freshness) {
          throw new Error(
            `Freshness tag key '${tagKey}' for table '${table}' collides with the tenant tag key`,
          );
        }
        freshnessByTable.set(table, { ...freshness });
      }
    }

    const existing = await this.client.chips.search(
      undefined,
      undefined,
      `${tagKey}=${tagValue}`,
    );

    const existingUnpartitionedTables = new Set<string>();
    const existingPartitionedKeys = new Set<string>();
    const existingUnpartitionedIds: string[] = [];
    const existingPartitionedIds: string[] = [];
    const pvSet = new Set(partitionValues.map(String));
    const keyPrefix = `${tagKey}:${tagValue}|`;

    const tagsByChip = new Map<string, Record<string, string>>();
    for (const tag of existing.tags ?? []) {
      const entry = tagsByChip.get(tag.chipId) ?? {};
      entry[tag.key] = tag.value;
      tagsByChip.set(tag.chipId, entry);
    }
    const evictedChipIds = new Set<string>();

    for (const chip of existing.chips ?? []) {
      const table = chip.tableName;

      if (unpartitionedTables.has(table) && chip.chipId === chip.subChipId) {
        if (await this.evictIfStale(chip, freshnessByTable.get(table), tagsByChip, evictedChipIds)) {
          continue;
        }
        if (!existingUnpartitionedTables.has(table)) {
          existingUnpartitionedTables.add(table);
          existingUnpartitionedIds.push(chip.chipId);
          // Chip is now searchable — evict from inflight and empty caches
          const key = `${keyPrefix}${table}|null`;
          this.inflight.delete(key);
          this.emptySince.delete(key);
        }
      } else if (partitionedTables.has(table) && pvSet.has(chip.partitionValue)) {
        if (await this.evictIfStale(chip, freshnessByTable.get(table), tagsByChip, evictedChipIds)) {
          continue;
        }
        const pvKey = `${table}|${chip.partitionValue}`;
        if (!existingPartitionedKeys.has(pvKey)) {
          existingPartitionedKeys.add(pvKey);
          existingPartitionedIds.push(chip.chipId);
          const key = `${keyPrefix}${pvKey}`;
          this.inflight.delete(key);
          this.emptySince.delete(key);
        }
      }
    }

    const missingUnpartitioned = [...unpartitionedTables].filter(
      (table) => !existingUnpartitionedTables.has(table),
    );

    const missingPartitioned: Array<{ table: string; partitionValue: string }> = [];
    for (const pv of pvSet) {
      for (const table of partitionedTables) {
        if (!existingPartitionedKeys.has(`${table}|${pv}`)) {
          missingPartitioned.push({ table, partitionValue: pv });
        }
      }
    }

    if (missingUnpartitioned.length === 0 && missingPartitioned.length === 0) {
      return new ResolvedChips(existingUnpartitionedIds, existingPartitionedIds);
    }

    const unpartitionedPromises = missingUnpartitioned.map((table) =>
      this.getOrCreate(table, null, tagKey, tagValue, factory, freshnessByTable.get(table)),
    );
    const partitionedPromises = missingPartitioned.map((gap) =>
      this.getOrCreate(gap.table, gap.partitionValue, tagKey, tagValue, factory, freshnessByTable.get(gap.table)),
    );

    const unpartitionedIds = [...existingUnpartitionedIds];
    for (const id of await Promise.all(unpartitionedPromises)) {
      if (id !== null) unpartitionedIds.push(id);
    }

    const partitionedIds = [...existingPartitionedIds];
    for (const id of await Promise.all(partitionedPromises)) {
      if (id !== null) partitionedIds.push(id);
    }

    return new ResolvedChips(unpartitionedIds, partitionedIds);
  }

  /** Returns the number of currently in-flight chip creations. */
  inflightCount(): number {
    return this.inflight.size;
  }

  /**
   * Returns a promise for the requested chip. If creation is already
   * in-flight for the same key, returns the existing promise instead of
   * starting a second.
   */
  private getOrCreate(
    table: string,
    partitionValue: string | null,
    tagKey: string,
    tagValue: string,
    factory: ChipFactory,
    freshnessTags: Record<string, string> | undefined,
  ): Promise<string | null> {
    const key = `${tagKey}:${tagValue}|${table}|${partitionValue}`;

    if (this.emptySuppressed(key)) {
      return Promise.resolve(null);
    }

    const existing = this.inflight.get(key);
    if (existing) {
      return existing;
    }

    console.info(`Creating chip for table=${table} partition=${partitionValue}`);

    const tags: Record<string, string> = { [tagKey]: tagValue, ...freshnessTags };

    const create = (async (): Promise<string | null> => {
      try {
        const { sourceType, ...source } = factory.buildSource(table, partitionValue);
        const response = await this.client.chips.createWithDetails(
          source,
          undefined,
          sourceType,
          undefined,
          undefined,
          tags,
        );
        this.emptySince.delete(key);
        return response.chipId;
      } catch (e) {
        this.handleCreateFailure(key, table, partitionValue, e);
        return null;
      }
    })();

    const gated = this.withTimeout(create).then(
      (id) => {
        if (id === null) this.inflight.delete(key);
        return id;
      },
      (e) => {
        this.inflight.delete(key);
        throw e;
      },
    );
    this.inflight.set(key, gated);
    return gated;
  }

  /**
   * Deletes the chip when its tags don't carry every expected freshness
   * entry. Returns true when the chip should be treated as missing (deleted
   * here, already deleted concurrently, or evicted earlier in this pass).
   * A failed delete keeps the stale chip in play — serving stale data beats
   * creating a duplicate alongside a chip that wouldn't die.
   */
  private async evictIfStale(
    chip: Chip,
    expected: Record<string, string> | undefined,
    tagsByChip: Map<string, Record<string, string>>,
    evictedChipIds: Set<string>,
  ): Promise<boolean> {
    if (!expected) {
      return false;
    }
    const chipId = chip.chipId;
    if (evictedChipIds.has(chipId)) {
      return true;
    }
    const chipTags = tagsByChip.get(chipId) ?? {};
    const stale = Object.entries(expected).some(([k, v]) => chipTags[k] !== v);
    if (!stale) {
      return false;
    }
    try {
      await this.client.chips.delete(chipId);
      console.info(
        `Evicted stale chip ${chipId} for table=${chip.tableName} partition=${chip.partitionValue} (freshness tags changed)`,
      );
    } catch (e) {
      if (e instanceof ChipNotFoundError) {
        console.info(
          `Stale chip ${chipId} for table=${chip.tableName} already deleted concurrently`,
        );
      } else {
        console.warn(
          `Failed to evict stale chip ${chipId} for table=${chip.tableName}; keeping it this resolve`,
          e,
        );
        return false;
      }
    }
    evictedChipIds.add(chipId);
    return true;
  }

  private handleCreateFailure(
    key: string,
    table: string,
    partitionValue: string | null,
    e: unknown,
  ): void {
    const { errorCode, message } = parseErrorBody(e);
    if (isEmptySource(e, errorCode)) {
      if (this.emptyRecheckMinutes > 0) {
        this.emptySince.set(key, this.clock());
      }
      const detail = message ?? (e instanceof Error ? e.message : String(e));
      console.info(
        `Chip source empty for table=${table} partition=${partitionValue} message=${detail}`,
      );
    } else if (errorCode !== undefined) {
      console.warn(
        `Chip creation failed for table=${table} partition=${partitionValue} errorCode=${errorCode} message=${message}`,
      );
    } else {
      console.error(
        `Chip creation failed for table=${table} partition=${partitionValue}`,
        e,
      );
    }
  }

  private emptySuppressed(key: string): boolean {
    if (this.emptyRecheckMinutes <= 0) {
      return false;
    }
    const since = this.emptySince.get(key);
    if (since === undefined) {
      return false;
    }
    if (this.clock() - since >= this.emptyRecheckMinutes * 60_000) {
      this.emptySince.delete(key);
      return false;
    }
    return true;
  }

  private withTimeout(promise: Promise<string | null>): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Chip creation timed out after ${this.timeoutMs}ms`)),
        this.timeoutMs,
      );
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        },
      );
    });
  }
}

function parseErrorBody(e: unknown): { errorCode?: string; message?: string } {
  if (!(e instanceof DatalatheApiError) || !e.responseBody) {
    return {};
  }
  try {
    const parsed = JSON.parse(e.responseBody) as {
      error_code?: unknown;
      message?: unknown;
    };
    return {
      errorCode: typeof parsed?.error_code === "string" ? parsed.error_code : undefined,
      message: typeof parsed?.message === "string" ? parsed.message : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * The message match covers engines that predate the EMPTY_SOURCE error code.
 */
function isEmptySource(e: unknown, errorCode: string | undefined): boolean {
  if (errorCode === "EMPTY_SOURCE") {
    return true;
  }
  return e instanceof Error && e.message.includes(LEGACY_EMPTY_MESSAGE);
}
