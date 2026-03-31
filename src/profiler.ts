import type { HttpClient } from "./http.js";
import type {
  ProfilerTable,
  DatalatheConfig,
  SchemaMapping,
} from "./types.js";

export class ProfilerApi {
  constructor(private readonly http: HttpClient) {}

  async getTables(): Promise<ProfilerTable[]> {
    return this.http.get<ProfilerTable[]>("/lathe/profiler/tables");
  }

  async start(skipFiles: boolean): Promise<unknown> {
    return this.http.get<unknown>(`/lathe/profiler/start/${skipFiles}`);
  }

  async getTableDescription(tableId: string): Promise<unknown[]> {
    return this.http.get<unknown[]>(
      `/lathe/profiler/table/${encodeURIComponent(tableId)}/describe`,
    );
  }

  async getTableData(tableId: string): Promise<unknown[]> {
    return this.http.get<unknown[]>(
      `/lathe/profiler/table/${encodeURIComponent(tableId)}`,
    );
  }

  async getTableSourceFiles(tableId: string): Promise<unknown[]> {
    return this.http.get<unknown[]>(
      `/lathe/profiler/table/${encodeURIComponent(tableId)}/source_file`,
    );
  }

  async getTableSummary(tableId: string): Promise<unknown> {
    return this.http.get<unknown>(
      `/lathe/profiler/table/${encodeURIComponent(tableId)}/summary`,
    );
  }

  async getConfig(): Promise<DatalatheConfig> {
    return this.http.get<DatalatheConfig>("/lathe/profiler/config");
  }

  async updateConfig(config: DatalatheConfig): Promise<unknown> {
    return this.http.postRaw<unknown>("/lathe/profiler/config/update", config);
  }

  async getSchemaMappings(): Promise<SchemaMapping[]> {
    return this.http.get<SchemaMapping[]>("/lathe/profiler/schema/mappings");
  }

  async getSchema(request: {
    show_unpopulated_fields: boolean;
    mapping_file_source: number | null;
    mapping_file_target: number | null;
  }): Promise<unknown> {
    return this.http.postRaw<unknown>("/lathe/profiler/schema", request);
  }
}
