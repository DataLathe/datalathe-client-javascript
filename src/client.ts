import { JSONParser } from "@streamparser/json";
import { CreateChipCommand } from "./commands/create-chip.js";
import { ExtractTablesCommand } from "./commands/extract-tables.js";
import { GenerateReportCommand } from "./commands/generate-report.js";
import type { DatalatheCommand } from "./commands/command.js";
import type {
  SourceRequest,
  Partition,
  S3StorageConfig,
  ReportResultEntry,
  ReportTiming,
  DatalatheClientOptions,
  DuckDBDatabase,
  DatabaseTable,
  ChipsResponse,
  ProfilerTable,
  DatalatheConfig,
  SourceFileDetails,
  Job,
  SchemaMapping,
  ConnectionInfo,
  ConnectionRequest,
  ConnectionResponse,
} from "./types.js";

export interface GenerateReportResult {
  results: Map<number, ReportResultEntry>;
  timing: ReportTiming | null;
}
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
   * @param chipName Optional name for the chip
   * @returns The chip ID
   */
  async createChip(
    sourceName: string,
    query: string,
    tableName: string,
    partition?: Partition,
    chipName?: string,
    columnReplace?: Record<string, string>,
    storageConfig?: S3StorageConfig,
  ): Promise<string> {
    const chips = await this.createChips(
      [{ database_name: sourceName, table_name: tableName, query, partition, column_replace: columnReplace }],
      undefined,
      SourceType.MYSQL,
      chipName,
      storageConfig,
    );
    return chips[0];
  }

  /**
   * Creates a single chip from a file source (CSV, Parquet, etc.).
   * @param filePath Path to the file on the server
   * @param tableName Optional table name for the chip
   * @param partition Optional partition configuration
   * @param chipName Optional name for the chip
   * @returns The chip ID
   */
  async createChipFromFile(
    filePath: string,
    tableName?: string,
    partition?: Partition,
    chipName?: string,
    columnReplace?: Record<string, string>,
    storageConfig?: S3StorageConfig,
  ): Promise<string> {
    const chips = await this.createChips(
      [{ database_name: "", query: "", file_path: filePath, table_name: tableName, partition, column_replace: columnReplace }],
      undefined,
      SourceType.FILE,
      chipName,
      storageConfig,
    );
    return chips[0];
  }

  /**
   * Creates a single chip from an S3 object (CSV, Parquet, etc.).
   * @param s3Path S3 URI (e.g. s3://bucket/path/file.csv)
   * @param tableName Optional table name for the chip
   * @param chipName Optional name for the chip
   * @param columnReplace Optional column renaming map
   * @param storageConfig Optional S3 storage configuration for the created chip
   * @returns The chip ID
   */
  async createChipFromS3(
    s3Path: string,
    tableName?: string,
    chipName?: string,
    columnReplace?: Record<string, string>,
    storageConfig?: S3StorageConfig,
  ): Promise<string> {
    const chips = await this.createChips(
      [{ database_name: "", query: "", s3_path: s3Path, table_name: tableName, column_replace: columnReplace }],
      undefined,
      SourceType.S3,
      chipName,
      storageConfig,
    );
    return chips[0];
  }

  /**
   * Creates a new chip from existing chip(s) as the data source.
   * Optionally transforms the data with a SQL query run against the source chips.
   * @param sourceChipIds The chip ID(s) to use as source data
   * @param query Optional SQL query to transform the data (runs against source chip tables)
   * @param tableName Optional table name for the new chip (defaults to "data")
   * @param chipName Optional name for the chip
   * @param storageConfig Optional S3 storage configuration
   * @returns The new chip ID
   */
  async createChipFromChip(
    sourceChipIds: string[],
    query?: string,
    tableName?: string,
    chipName?: string,
    storageConfig?: S3StorageConfig,
  ): Promise<string> {
    const chips = await this.createChips(
      [{
        database_name: "",
        query: query ?? "",
        source_chip_ids: sourceChipIds,
        table_name: tableName,
      }],
      undefined,
      SourceType.CACHE,
      chipName,
      storageConfig,
    );
    return chips[0];
  }

  /**
   * Stages data from multiple source requests and returns chip IDs.
   * @param sources List of source requests to process
   * @param chipId Optional chip ID to use
   * @param sourceType Source type (defaults to MYSQL)
   * @param chipName Optional name for the chip
   * @returns List of chip IDs
   */
  async createChips(
    sources: SourceRequest[],
    chipId?: string,
    sourceType: SourceType = SourceType.MYSQL,
    chipName?: string,
    storageConfig?: S3StorageConfig,
    tags?: Record<string, string>,
  ): Promise<string[]> {
    const chipIds: string[] = [];
    for (const source of sources) {
      const command = new CreateChipCommand(sourceType, source, chipId, chipName, storageConfig, tags);
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
    sourceType: SourceType = SourceType.LOCAL,
    transformQuery?: boolean,
    returnTransformedQuery?: boolean,
  ): Promise<GenerateReportResult> {
    const command = new GenerateReportCommand(
      chipIds,
      sourceType,
      queries,
      undefined,
      transformQuery,
      returnTransformedQuery,
    );
    const response = await this.sendCommand(command);
    const results = new Map<number, ReportResultEntry>();

    if (response.result) {
      for (const [key, entry] of Object.entries(response.result)) {
        results.set(parseInt(key, 10), entry);
      }
    }

    return { results, timing: response.timing ?? null };
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
   * Searches for chips by table name, partition value, and/or tag.
   * @param tableName Optional table name filter
   * @param partitionValue Optional partition value filter
   * @param tag Optional tag filter in "key:value" format
   * @returns Matching chips and their metadata
   */
  async searchChips(
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
    return this.get<ChipsResponse>(path);
  }

  /**
   * Adds or updates tags on a chip. Existing keys have their values replaced.
   * @param chipId The chip ID to tag
   * @param tags Key-value pairs to set
   */
  async addChipTags(
    chipId: string,
    tags: Record<string, string>,
  ): Promise<void> {
    await this.post(`/lathe/chips/${encodeURIComponent(chipId)}/tags`, { tags });
  }

  /**
   * Removes a tag from a chip by key.
   * @param chipId The chip ID
   * @param key The tag key to remove
   */
  async deleteChipTag(chipId: string, key: string): Promise<void> {
    return this.delete(
      `/lathe/chips/${encodeURIComponent(chipId)}/tags/${encodeURIComponent(key)}`,
    );
  }

  /**
   * Deletes a chip and its associated data (local files and S3 objects).
   * @param chipId The ID of the chip to delete
   */
  async deleteChip(chipId: string): Promise<void> {
    return this.delete(`/lathe/chips/${encodeURIComponent(chipId)}`);
  }

  // --- Connection management ---

  /**
   * Lists all database connections (passwords excluded).
   */
  async listConnections(): Promise<ConnectionInfo[]> {
    return this.get<ConnectionInfo[]>("/lathe/connections");
  }

  /**
   * Gets a database connection by alias (password excluded).
   */
  async getConnection(alias: string): Promise<ConnectionInfo> {
    return this.get<ConnectionInfo>(`/lathe/connections/${encodeURIComponent(alias)}`);
  }

  /**
   * Creates or updates a database connection.
   */
  async upsertConnection(alias: string, connection: ConnectionRequest): Promise<ConnectionResponse> {
    return this.put<ConnectionResponse>(`/lathe/connections/${encodeURIComponent(alias)}`, connection);
  }

  /**
   * Deletes a database connection.
   */
  async deleteConnection(alias: string): Promise<void> {
    return this.delete(`/lathe/connections/${encodeURIComponent(alias)}`);
  }

  /**
   * Tests a database connection by attempting a MySQL attach in DuckDB.
   */
  async testConnection(alias: string): Promise<ConnectionResponse> {
    return this.post<ConnectionResponse>(`/lathe/connections/${encodeURIComponent(alias)}/test`, {});
  }

  // --- Profiler methods ---

  async getProfilerTables(): Promise<ProfilerTable[]> {
    return this.get<ProfilerTable[]>("/lathe/profiler/tables");
  }

  async startProfiler(skipFiles: boolean): Promise<unknown> {
    return this.get<unknown>(`/lathe/profiler/start/${skipFiles}`);
  }

  async getTableDescription(tableId: string): Promise<unknown[]> {
    return this.get<unknown[]>(
      `/lathe/profiler/table/${encodeURIComponent(tableId)}/describe`,
    );
  }

  async getTableData(tableId: string): Promise<unknown[]> {
    return this.get<unknown[]>(
      `/lathe/profiler/table/${encodeURIComponent(tableId)}`,
    );
  }

  async getTableSourceFiles(tableId: string): Promise<unknown[]> {
    return this.get<unknown[]>(
      `/lathe/profiler/table/${encodeURIComponent(tableId)}/source_file`,
    );
  }

  async getTableSummary(tableId: string): Promise<unknown> {
    return this.get<unknown>(
      `/lathe/profiler/table/${encodeURIComponent(tableId)}/summary`,
    );
  }

  async getProfilerConfig(): Promise<DatalatheConfig> {
    return this.get<DatalatheConfig>("/lathe/profiler/config");
  }

  async updateProfilerConfig(config: DatalatheConfig): Promise<unknown> {
    return this.post<unknown>("/lathe/profiler/config/update", config);
  }

  async getSchemaMappings(): Promise<SchemaMapping[]> {
    return this.get<SchemaMapping[]>("/lathe/profiler/schema/mappings");
  }

  async getProfilerSchema(request: {
    show_unpopulated_fields: boolean;
    mapping_file_source: number | null;
    mapping_file_target: number | null;
  }): Promise<unknown> {
    return this.post<unknown>("/lathe/profiler/schema", request);
  }

  // --- Source methods ---

  async getSourceFile(fileId: string): Promise<SourceFileDetails> {
    return this.get<SourceFileDetails>(
      `/lathe/source/file/${encodeURIComponent(fileId)}`,
    );
  }

  // --- Job methods ---

  async getAllJobs(): Promise<Record<string, Job>> {
    return this.get<Record<string, Job>>("/lathe/jobs/all");
  }

  // --- Query analysis ---

  /**
   * Extracts the list of table names referenced in a SQL query.
   * @param query The SQL query to analyze
   * @returns List of table names
   */
  async extractTables(query: string): Promise<string[]> {
    const response = await this.extractTablesWithTransform(query);
    return response.tables;
  }

  /**
   * Extracts the list of table names referenced in a SQL query.
   * Optionally transforms the query from MySQL/MariaDB syntax to DuckDB.
   * @param query The SQL query to analyze
   * @param transform When true, also returns the query transformed to DuckDB syntax
   * @returns Tables and optionally the transformed query
   */
  async extractTablesWithTransform(
    query: string,
    transform?: boolean,
  ): Promise<{ tables: string[]; transformed_query: string | null }> {
    const command = new ExtractTablesCommand(query, transform);
    const response = await this.sendCommand(command);
    if (response.error) {
      throw new DatalatheApiError(
        `Failed to extract tables: ${response.error}`,
        400,
        response.error,
      );
    }
    return { tables: response.tables, transformed_query: response.transformed_query };
  }

  // --- Stage data (raw) ---

  async stageData(request: unknown): Promise<unknown> {
    return this.post<unknown>("/lathe/stage/data", request);
  }

  // --- Report (raw) ---

  async postReport(request: unknown): Promise<unknown> {
    return this.post<unknown>("/lathe/report", request);
  }

  /**
   * Parses a JSON response body using streaming to avoid V8's string length limit.
   * Falls back to response.json() if the body stream is not available.
   */
  private async parseJsonStream<T>(response: Response): Promise<T> {
    const body = response.body;
    if (!body) {
      return (await response.json()) as T;
    }

    return new Promise<T>((resolve, reject) => {
      const parser = new JSONParser();
      let result: unknown;

      parser.onValue = ({ value, stack }) => {
        if (stack.length === 0) {
          result = value;
        }
      };
      parser.onEnd = () => resolve(result as T);
      parser.onError = (err: Error) => reject(err);

      const reader = body.getReader();
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            parser.end();
            break;
          }
          parser.write(value);
        }
      };
      pump().catch(reject);
    });
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

      return this.parseJsonStream<T>(response);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Sends a DELETE request to the Datalathe API.
   * @param path The API path to request
   */
  private async delete(path: string): Promise<void> {
    const url = this.baseUrl + path;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await this.fetchFn(url, {
        method: "DELETE",
        headers: { ...this.defaultHeaders },
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new DatalatheApiError(
          `DELETE ${path} failed: ${response.status} ${body}`,
          response.status,
          body,
        );
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Sends a POST request to the Datalathe API.
   * @param path The API path to request
   * @param body The request body
   * @returns The parsed JSON response
   */
  private async post<T>(path: string, body: unknown): Promise<T> {
    const url = this.baseUrl + path;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await this.fetchFn(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.defaultHeaders,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const responseBody = await response.text();
        throw new DatalatheApiError(
          `POST ${path} failed: ${response.status} ${responseBody}`,
          response.status,
          responseBody,
        );
      }

      return this.parseJsonStream<T>(response);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async put<T>(path: string, body: unknown): Promise<T> {
    const url = this.baseUrl + path;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await this.fetchFn(url, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...this.defaultHeaders,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const responseBody = await response.text();
        throw new DatalatheApiError(
          `PUT ${path} failed: ${response.status} ${responseBody}`,
          response.status,
          responseBody,
        );
      }

      return this.parseJsonStream<T>(response);
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

      const json = await this.parseJsonStream(response);
      return command.parseResponse(json);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
