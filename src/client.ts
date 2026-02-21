import { CreateChipCommand } from "./commands/create-chip.js";
import { GenerateReportCommand } from "./commands/generate-report.js";
import type { DatalatheCommand } from "./commands/command.js";
import type {
  SourceRequest,
  Partition,
  ReportResultEntry,
  DatalatheClientOptions,
  DuckDBDatabase,
  DatabaseTable,
  ChipsResponse,
} from "./types.js";
import { SourceType, ReportType } from "./types.js";
import { DatalatheApiError, DatalatheStageError } from "./errors.js";

export class DatalatheClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly defaultHeaders: Record<string, string>;
  private readonly timeout: number;

  constructor(baseUrl: string, options?: DatalatheClientOptions) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetchFn = options?.fetch ?? globalThis.fetch.bind(globalThis);
    this.defaultHeaders = options?.headers ?? {};
    this.timeout = options?.timeout ?? 30_000;
  }

  /**
   * Creates a single chip from a MySQL source.
   * @param sourceName The name of the source database
   * @param query The SQL query to execute
   * @param tableName The name of the table
   * @param partition Optional partition configuration
   * @returns The chip ID
   */
  async createChip(
    sourceName: string,
    query: string,
    tableName: string,
    partition?: Partition,
  ): Promise<string> {
    const chips = await this.createChips([
      { database_name: sourceName, table_name: tableName, query, partition },
    ]);
    return chips[0];
  }

  /**
   * Creates a single chip from a file source (CSV, Parquet, etc.).
   * @param filePath Path to the file on the server
   * @param tableName Optional table name for the chip
   * @param partition Optional partition configuration
   * @returns The chip ID
   */
  async createChipFromFile(
    filePath: string,
    tableName?: string,
    partition?: Partition,
  ): Promise<string> {
    const chips = await this.createChips(
      [{ database_name: "", query: "", file_path: filePath, table_name: tableName, partition }],
      undefined,
      SourceType.FILE,
    );
    return chips[0];
  }

  /**
   * Stages data from multiple source requests and returns chip IDs.
   * @param sources List of source requests to process
   * @param chipId Optional chip ID to use
   * @param sourceType Source type (defaults to MYSQL)
   * @returns List of chip IDs
   */
  async createChips(
    sources: SourceRequest[],
    chipId?: string,
    sourceType: SourceType = SourceType.MYSQL,
  ): Promise<string[]> {
    const chipIds: string[] = [];
    for (const source of sources) {
      const command = new CreateChipCommand(sourceType, source, chipId);
      const response = await this.sendCommand(command);
      if (response.error) {
        throw new DatalatheStageError(
          `Failed to stage data: ${response.error}`,
        );
      }
      chipIds.push(response.chip_id);
    }
    return chipIds;
  }

  /**
   * Executes queries against chip IDs.
   * @param chipIds List of chip IDs to query
   * @param queries List of SQL queries to execute
   * @returns Map of query index to result entry
   */
  async generateReport(
    chipIds: string[],
    queries: string[],
  ): Promise<Map<number, ReportResultEntry>> {
    const command = new GenerateReportCommand(
      chipIds,
      SourceType.LOCAL,
      queries,
    );
    const response = await this.sendCommand(command);
    const results = new Map<number, ReportResultEntry>();

    if (response.result) {
      for (const [key, entry] of Object.entries(response.result)) {
        results.set(parseInt(key, 10), entry);
      }
    }

    return results;
  }

  /**
   * Returns the list of databases available in the DuckDB instance.
   */
  async getDatabases(): Promise<DuckDBDatabase[]> {
    return this.get<DuckDBDatabase[]>("/lathe/stage/databases");
  }

  /**
   * Returns the schema (tables and columns) for a given database.
   * @param databaseName The name of the database to inspect
   */
  async getDatabaseSchema(databaseName: string): Promise<DatabaseTable[]> {
    return this.get<DatabaseTable[]>(
      `/lathe/stage/schema/${encodeURIComponent(databaseName)}`,
    );
  }

  /**
   * Returns all chips and their metadata.
   */
  async listChips(): Promise<ChipsResponse> {
    return this.get<ChipsResponse>("/lathe/chips");
  }

  /**
   * Sends a GET request to the Datalathe API.
   * @param path The API path to request
   * @returns The parsed JSON response
   */
  private async get<T>(path: string): Promise<T> {
    const url = this.baseUrl + path;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await this.fetchFn(url, {
        method: "GET",
        headers: { ...this.defaultHeaders },
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new DatalatheApiError(
          `GET ${path} failed: ${response.status} ${body}`,
          response.status,
          body,
        );
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Sends a command to the Datalathe API.
   * @param command The command to send
   * @returns The parsed response
   */
  async sendCommand<TReq, TRes>(
    command: DatalatheCommand<TReq, TRes>,
  ): Promise<TRes> {
    const url = this.baseUrl + command.endpoint;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await this.fetchFn(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.defaultHeaders,
        },
        body: JSON.stringify(command.request),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new DatalatheApiError(
          `Failed to execute command: ${response.status} ${body}`,
          response.status,
          body,
        );
      }

      const json = await response.json();
      return command.parseResponse(json);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
