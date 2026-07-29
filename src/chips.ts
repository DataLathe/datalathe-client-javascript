import type { HttpClient } from "./http.js";
import type {
  SourceRequest,
  Partition,
  S3StorageConfig,
  StageDataResponse,
  ChipsResponse,
  ChipListOptions,
  AsyncIngestSubmission,
  ChipQueryResult,
  IngestJob,
  IngestJobStatus,
} from "./types.js";
import { SourceType } from "./types.js";
import {
  DatalatheStageError,
  DatalatheIngestJobError,
  DatalatheIngestTimeoutError,
} from "./errors.js";

function partitionToWire(p?: Partition) {
  if (!p) return undefined;
  return {
    partition_by: p.partitionBy,
    partition_values: p.partitionValues,
    partition_query: p.partitionQuery,
    combine_partitions: p.combinePartitions,
  };
}

function sourceToWire(s: SourceRequest) {
  return {
    database_name: s.databaseName,
    table_name: s.tableName,
    query: s.query,
    file_path: s.filePath,
    s3_path: s.s3Path,
    source_chip_ids: s.sourceChipIds,
    partition: partitionToWire(s.partition),
    column_replace: s.columnReplace,
    ...(s.streaming !== undefined ? { streaming: s.streaming } : {}),
    ...(s.keysetColumn !== undefined ? { keyset_column: s.keysetColumn } : {}),
  };
}

function storageConfigToWire(c?: S3StorageConfig) {
  if (!c) return undefined;
  return {
    bucket: c.bucket,
    key_prefix: c.keyPrefix,
    ttl_days: c.ttlDays,
  };
}

export class ChipsApi {
  constructor(private readonly http: HttpClient) {}

  /**
   * Creates a single chip from a MySQL source.
   */
  async create(
    sourceName: string,
    query: string,
    tableName: string,
    partition?: Partition,
    chipName?: string,
    columnReplace?: Record<string, string>,
    storageConfig?: S3StorageConfig,
    streaming?: boolean,
    keysetColumn?: string,
  ): Promise<string> {
    const chips = await this.createMultiple(
      [{ databaseName: sourceName, tableName, query, partition, columnReplace, streaming, keysetColumn }],
      undefined,
      SourceType.MYSQL,
      chipName,
      storageConfig,
    );
    return chips[0];
  }

  /**
   * Creates a single chip from a file source (CSV, Parquet, etc.).
   */
  async createFromFile(
    filePath: string,
    tableName?: string,
    partition?: Partition,
    chipName?: string,
    columnReplace?: Record<string, string>,
    storageConfig?: S3StorageConfig,
  ): Promise<string> {
    const chips = await this.createMultiple(
      [{ databaseName: "", query: "", filePath, tableName, partition, columnReplace }],
      undefined,
      SourceType.FILE,
      chipName,
      storageConfig,
    );
    return chips[0];
  }

  /**
   * Creates a single chip from an S3 object (CSV, Parquet, etc.).
   */
  async createFromS3(
    s3Path: string,
    tableName?: string,
    chipName?: string,
    columnReplace?: Record<string, string>,
    storageConfig?: S3StorageConfig,
    partition?: Partition,
  ): Promise<string> {
    const chips = await this.createMultiple(
      [{ databaseName: "", query: "", s3Path, tableName, partition, columnReplace }],
      undefined,
      SourceType.S3,
      chipName,
      storageConfig,
    );
    return chips[0];
  }

  /**
   * Creates a new chip from existing chip(s) as the data source.
   */
  async createFromChip(
    sourceChipIds: string[],
    query?: string,
    tableName?: string,
    chipName?: string,
    storageConfig?: S3StorageConfig,
  ): Promise<string> {
    const chips = await this.createMultiple(
      [{
        databaseName: "",
        query: query ?? "",
        sourceChipIds,
        tableName,
      }],
      undefined,
      SourceType.CHIP,
      chipName,
      storageConfig,
    );
    return chips[0];
  }

  async createMultiple(
    sources: SourceRequest[],
    chipId?: string,
    sourceType: SourceType = SourceType.MYSQL,
    chipName?: string,
    storageConfig?: S3StorageConfig,
    tags?: Record<string, string>,
  ): Promise<string[]> {
    const responses = await this.createMultipleWithDetails(
      sources,
      chipId,
      sourceType,
      chipName,
      storageConfig,
      tags,
    );
    return responses.map((r) => r.chipId);
  }

  async createWithDetails(
    source: SourceRequest,
    chipId?: string,
    sourceType: SourceType = SourceType.MYSQL,
    chipName?: string,
    storageConfig?: S3StorageConfig,
    tags?: Record<string, string>,
  ): Promise<StageDataResponse> {
    const responses = await this.createMultipleWithDetails(
      [source],
      chipId,
      sourceType,
      chipName,
      storageConfig,
      tags,
    );
    return responses[0];
  }

  async createMultipleWithDetails(
    sources: SourceRequest[],
    chipId?: string,
    sourceType: SourceType = SourceType.MYSQL,
    chipName?: string,
    storageConfig?: S3StorageConfig,
    tags?: Record<string, string>,
  ): Promise<StageDataResponse[]> {
    const responses: StageDataResponse[] = [];
    for (const source of sources) {
      const wireBody = {
        source_type: sourceType,
        source_request: sourceToWire(source),
        ...(chipId !== undefined ? { chip_id: chipId } : {}),
        ...(chipName !== undefined ? { chip_name: chipName } : {}),
        ...(storageConfig !== undefined ? { storage_config: storageConfigToWire(storageConfig) } : {}),
        ...(tags !== undefined ? { tags } : {}),
      };
      const response = await this.http.postRaw<StageDataResponse>("/lathe/stage/data", wireBody);
      if (response.error) {
        throw new DatalatheStageError(
          `Failed to stage data: ${response.error}`,
        );
      }
      responses.push(response);
    }
    return responses;
  }

  /**
   * Submits a chip-creation request for background processing (v1.7.12+
   * engines). Returns immediately with the job and chip IDs; poll with
   * getIngestJob or block with waitForIngest.
   */
  async createAsync(
    source: SourceRequest,
    chipId?: string,
    sourceType: SourceType = SourceType.MYSQL,
    chipName?: string,
    storageConfig?: S3StorageConfig,
    tags?: Record<string, string>,
  ): Promise<AsyncIngestSubmission> {
    const wireBody = {
      source_type: sourceType,
      source_request: sourceToWire(source),
      async: true,
      ...(chipId !== undefined ? { chip_id: chipId } : {}),
      ...(chipName !== undefined ? { chip_name: chipName } : {}),
      ...(storageConfig !== undefined ? { storage_config: storageConfigToWire(storageConfig) } : {}),
      ...(tags !== undefined ? { tags } : {}),
    };
    return this.http.postRaw<AsyncIngestSubmission>("/lathe/stage/data", wireBody);
  }

  async getIngestJob(jobId: string): Promise<IngestJob> {
    return this.http.get<IngestJob>(`/lathe/jobs/${encodeURIComponent(jobId)}`);
  }

  async listIngestJobs(
    options: { status?: IngestJobStatus } = {},
  ): Promise<IngestJob[]> {
    const params = new URLSearchParams();
    if (options.status !== undefined) params.set("status", options.status);
    const query = params.toString();
    return this.http.get<IngestJob[]>(`/lathe/jobs${query ? `?${query}` : ""}`);
  }

  async resumeIngestJob(jobId: string): Promise<AsyncIngestSubmission> {
    return this.http.postRaw<AsyncIngestSubmission>(
      `/lathe/jobs/${encodeURIComponent(jobId)}/resume`,
      {},
    );
  }

  /**
   * Polls an ingest job until it reaches a terminal state. Resolves with the
   * job record on success; throws DatalatheIngestJobError on failed/cancelled
   * and DatalatheIngestTimeoutError when timeoutMs elapses first.
   */
  async waitForIngest(
    jobId: string,
    options: { pollIntervalMs?: number; timeoutMs?: number } = {},
  ): Promise<IngestJob> {
    const pollIntervalMs = options.pollIntervalMs ?? 2000;
    const timeoutMs = options.timeoutMs ?? 600000;
    const deadline = Date.now() + timeoutMs;

    while (true) {
      const job = await this.getIngestJob(jobId);
      if (job.status === "succeeded") return job;
      if (job.status === "failed" || job.status === "cancelled") {
        throw new DatalatheIngestJobError(job);
      }
      if (Date.now() >= deadline) {
        throw new DatalatheIngestTimeoutError(jobId, timeoutMs, job);
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }

  async list(options: ChipListOptions = {}): Promise<ChipsResponse> {
    const params = new URLSearchParams();
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    if (options.offset !== undefined) params.set("offset", String(options.offset));
    const query = params.toString();
    return this.http.get<ChipsResponse>(`/lathe/chips${query ? `?${query}` : ""}`);
  }

  /**
   * Fetches a single chip (with sub-chips, metadata, and tags) by ID.
   * Throws ChipNotFoundError if the chip does not exist.
   */
  async get(chipId: string): Promise<ChipsResponse> {
    return this.http.get<ChipsResponse>(
      `/lathe/chips/${encodeURIComponent(chipId)}`,
    );
  }

  async search(
    tableName?: string,
    partitionValue?: string,
    tag?: string,
  ): Promise<ChipsResponse> {
    const params = new URLSearchParams();
    if (tableName !== undefined) params.set("table_name", tableName);
    if (partitionValue !== undefined) params.set("partition_value", partitionValue);
    if (tag !== undefined) params.set("tag", tag);
    const query = params.toString();
    const path = `/lathe/chips/search${query ? `?${query}` : ""}`;
    return this.http.get<ChipsResponse>(path);
  }

  /**
   * Runs a single read-only SQL statement against the chips' raw catalogs
   * (engine 1.11+). Unlike report queries there is no view layer: the
   * statement sees every table inside the attached chips via
   * `s_<sub_chip_id>.main.<table>`, including staging leftovers. Results are
   * truncated at the engine's max_result_rows cap (`truncated` flag).
   */
  async query(chipIds: string[], query: string): Promise<ChipQueryResult> {
    return this.http.postRaw<ChipQueryResult>("/lathe/chips/query", {
      chip_ids: chipIds,
      query,
    });
  }

  async addTags(
    chipId: string,
    tags: Record<string, string>,
  ): Promise<void> {
    await this.http.postRaw(`/lathe/chips/${encodeURIComponent(chipId)}/tags`, { tags });
  }

  async deleteTag(chipId: string, key: string): Promise<void> {
    return this.http.del(
      `/lathe/chips/${encodeURIComponent(chipId)}/tags/${encodeURIComponent(key)}`,
    );
  }

  async delete(chipId: string): Promise<void> {
    return this.http.del(`/lathe/chips/${encodeURIComponent(chipId)}`);
  }
}
