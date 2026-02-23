import { JSONParser } from "@streamparser/json";
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
  ProfilerTable,
  DatalatheConfig,
  SourceFileDetails,
  Job,
  SchemaMapping,
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
   * @param chipName Optional name for the chip
   * @returns The chip ID
   */
  async createChip(
    sourceName: string,
    query: string,
    tableName: string,
    partition?: Partition,
    chipName?: string,
  ): Promise<string> {
    const chips = await this.createChips(
      [{ database_name: sourceName, table_name: tableName, query, partition }],
      undefined,
      SourceType.MYSQL,
      chipName,
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
  ): Promise<string> {
    const chips = await this.createChips(
      [{ database_name: "", query: "", file_path: filePath, table_name: tableName, partition }],
      undefined,
      SourceType.FILE,
      chipName,
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
  ): Promise<string[]> {
    const chipIds: string[] = [];
    for (const source of sources) {
      const command = new CreateChipCommand(sourceType, source, chipId, chipName);
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
  ): Promise<Map<number, ReportResultEntry>> {
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
