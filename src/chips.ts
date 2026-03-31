import type { HttpClient } from "./http.js";
import type {
  SourceRequest,
  Partition,
  S3StorageConfig,
  StageDataResponse,
  ChipsResponse,
} from "./types.js";
import { SourceType } from "./types.js";
import { DatalatheStageError } from "./errors.js";

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
  ): Promise<string> {
    const chips = await this.createMultiple(
      [{ databaseName: sourceName, tableName, query, partition, columnReplace }],
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
  ): Promise<string> {
    const chips = await this.createMultiple(
      [{ databaseName: "", query: "", s3Path, tableName, columnReplace }],
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

  /**
   * Stages data from multiple source requests and returns chip IDs.
   */
  async createMultiple(
    sources: SourceRequest[],
    chipId?: string,
    sourceType: SourceType = SourceType.MYSQL,
    chipName?: string,
    storageConfig?: S3StorageConfig,
    tags?: Record<string, string>,
  ): Promise<string[]> {
    const chipIds: string[] = [];
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
      chipIds.push(response.chipId);
    }
    return chipIds;
  }

  async list(): Promise<ChipsResponse> {
    return this.http.get<ChipsResponse>("/lathe/chips");
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
