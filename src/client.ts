import { HttpClient } from "./http.js";
import { ChipsApi } from "./chips.js";
import { QueriesApi, type GenerateReportResult } from "./queries.js";
import { ConnectionsApi } from "./connections.js";
import { AiApi } from "./ai.js";
import { ProfilerApi } from "./profiler.js";
import type {
  SourceRequest,
  Partition,
  S3StorageConfig,
  ConnectionRequest,
  ConnectionResponse,
  ConnectionInfo,
  CreateAiCredentialRequest,
  AiCredential,
  CreateAiContextRequest,
  AiContext,
  UpdateAiContextRequest,
  AiQueryRequest,
  AiQueryResponse,
  DatalatheClientOptions,
  DuckDBDatabase,
  DatabaseTable,
  ChipsResponse,
  LicenseStatus,
  SourceFileDetails,
  Job,
  DatalatheConfig,
  ProfilerTable,
  SchemaMapping,
} from "./types.js";
import { SourceType } from "./types.js";

export class DatalatheClient {
  readonly chips: ChipsApi;
  readonly queries: QueriesApi;
  readonly connections: ConnectionsApi;
  readonly ai: AiApi;
  readonly profiler: ProfilerApi;
  private readonly http: HttpClient;

  constructor(baseUrl: string, options?: DatalatheClientOptions) {
    this.http = new HttpClient(baseUrl, options);
    this.chips = new ChipsApi(this.http);
    this.queries = new QueriesApi(this.http);
    this.connections = new ConnectionsApi(this.http);
    this.ai = new AiApi(this.http);
    this.profiler = new ProfilerApi(this.http);
  }

  // --- Database inspection ---

  async getDatabases(): Promise<DuckDBDatabase[]> {
    return this.http.get<DuckDBDatabase[]>("/lathe/stage/databases");
  }

  async getDatabaseSchema(databaseName: string): Promise<DatabaseTable[]> {
    return this.http.get<DatabaseTable[]>(
      `/lathe/stage/schema/${encodeURIComponent(databaseName)}`,
    );
  }

  // --- License management ---

  async getLicense(): Promise<LicenseStatus> {
    return this.http.get<LicenseStatus>("/lathe/license");
  }

  async putLicense(licenseKey: string): Promise<LicenseStatus> {
    return this.http.postRaw<LicenseStatus>("/lathe/license", { license_key: licenseKey }, "PUT");
  }

  // --- Source methods ---

  async getSourceFile(fileId: string): Promise<SourceFileDetails> {
    return this.http.get<SourceFileDetails>(
      `/lathe/source/file/${encodeURIComponent(fileId)}`,
    );
  }

  // --- Job methods ---

  async getAllJobs(): Promise<Record<string, Job>> {
    return this.http.get<Record<string, Job>>("/lathe/jobs/all");
  }

  // --- Deprecated delegation methods ---
  // These forward to sub-modules for backward compatibility.
  // Use client.chips.*, client.queries.*, client.connections.*,
  // client.ai.*, client.profiler.* instead.

  /** @deprecated Use client.chips.create() */
  async createChip(
    sourceName: string,
    query: string,
    tableName: string,
    partition?: Partition,
    chipName?: string,
    columnReplace?: Record<string, string>,
    storageConfig?: S3StorageConfig,
    streaming?: boolean,
    partitionColumn?: string,
  ): Promise<string> {
    return this.chips.create(sourceName, query, tableName, partition, chipName, columnReplace, storageConfig, streaming, partitionColumn);
  }

  /** @deprecated Use client.chips.createFromFile() */
  async createChipFromFile(
    filePath: string,
    tableName?: string,
    partition?: Partition,
    chipName?: string,
    columnReplace?: Record<string, string>,
    storageConfig?: S3StorageConfig,
  ): Promise<string> {
    return this.chips.createFromFile(filePath, tableName, partition, chipName, columnReplace, storageConfig);
  }

  /** @deprecated Use client.chips.createFromS3() */
  async createChipFromS3(
    s3Path: string,
    tableName?: string,
    chipName?: string,
    columnReplace?: Record<string, string>,
    storageConfig?: S3StorageConfig,
  ): Promise<string> {
    return this.chips.createFromS3(s3Path, tableName, chipName, columnReplace, storageConfig);
  }

  /** @deprecated Use client.chips.createFromChip() */
  async createChipFromChip(
    sourceChipIds: string[],
    query?: string,
    tableName?: string,
    chipName?: string,
    storageConfig?: S3StorageConfig,
  ): Promise<string> {
    return this.chips.createFromChip(sourceChipIds, query, tableName, chipName, storageConfig);
  }

  /** @deprecated Use client.chips.createMultiple() */
  async createChips(
    sources: SourceRequest[],
    chipId?: string,
    sourceType: SourceType = SourceType.MYSQL,
    chipName?: string,
    storageConfig?: S3StorageConfig,
    tags?: Record<string, string>,
  ): Promise<string[]> {
    return this.chips.createMultiple(sources, chipId, sourceType, chipName, storageConfig, tags);
  }

  /** @deprecated Use client.chips.list() */
  async listChips(): Promise<ChipsResponse> {
    return this.chips.list();
  }

  /** @deprecated Use client.chips.search() */
  async searchChips(tableName?: string, partitionValue?: string, tag?: string): Promise<ChipsResponse> {
    return this.chips.search(tableName, partitionValue, tag);
  }

  /** @deprecated Use client.chips.addTags() */
  async addChipTags(chipId: string, tags: Record<string, string>): Promise<void> {
    return this.chips.addTags(chipId, tags);
  }

  /** @deprecated Use client.chips.deleteTag() */
  async deleteChipTag(chipId: string, key: string): Promise<void> {
    return this.chips.deleteTag(chipId, key);
  }

  /** @deprecated Use client.chips.delete() */
  async deleteChip(chipId: string): Promise<void> {
    return this.chips.delete(chipId);
  }

  /** @deprecated Use client.queries.generateReport() */
  async generateReport(
    chipIds: string[],
    queries: string[],
    sourceType: SourceType = SourceType.LOCAL,
    transformQuery?: boolean,
    returnTransformedQuery?: boolean,
  ): Promise<GenerateReportResult> {
    return this.queries.generateReport(chipIds, queries, sourceType, transformQuery, returnTransformedQuery);
  }

  /** @deprecated Use client.queries.extractTables() */
  async extractTables(query: string): Promise<string[]> {
    return this.queries.extractTables(query);
  }

  /** @deprecated Use client.queries.extractTablesWithTransform() */
  async extractTablesWithTransform(
    query: string,
    transform?: boolean,
  ): Promise<{ tables: string[]; transformedQuery: string | null }> {
    return this.queries.extractTablesWithTransform(query, transform);
  }

  /** @deprecated Use client.queries.stageData() */
  async stageData(request: unknown): Promise<unknown> {
    return this.queries.stageData(request);
  }

  /** @deprecated Use client.queries.postReport() */
  async postReport(request: unknown): Promise<unknown> {
    return this.queries.postReport(request);
  }

  /** @deprecated Use client.connections.list() */
  async listConnections(): Promise<ConnectionInfo[]> {
    return this.connections.list();
  }

  /** @deprecated Use client.connections.get() */
  async getConnection(alias: string): Promise<ConnectionInfo> {
    return this.connections.get(alias);
  }

  /** @deprecated Use client.connections.upsert() */
  async upsertConnection(alias: string, connection: ConnectionRequest): Promise<ConnectionResponse> {
    return this.connections.upsert(alias, connection);
  }

  /** @deprecated Use client.connections.delete() */
  async deleteConnection(alias: string): Promise<void> {
    return this.connections.delete(alias);
  }

  /** @deprecated Use client.connections.test() */
  async testConnection(alias: string): Promise<ConnectionResponse> {
    return this.connections.test(alias);
  }

  /** @deprecated Use client.ai.registerCredential() */
  async registerAiCredential(request: CreateAiCredentialRequest): Promise<AiCredential> {
    return this.ai.registerCredential(request);
  }

  /** @deprecated Use client.ai.listCredentials() */
  async listAiCredentials(): Promise<AiCredential[]> {
    return this.ai.listCredentials();
  }

  /** @deprecated Use client.ai.deleteCredential() */
  async deleteAiCredential(credentialId: string): Promise<void> {
    return this.ai.deleteCredential(credentialId);
  }

  /** @deprecated Use client.ai.registerContext() */
  async registerAiContext(request: CreateAiContextRequest): Promise<AiContext> {
    return this.ai.registerContext(request);
  }

  /** @deprecated Use client.ai.listContexts() */
  async listAiContexts(): Promise<AiContext[]> {
    return this.ai.listContexts();
  }

  /** @deprecated Use client.ai.getContext() */
  async getAiContext(contextId: string): Promise<AiContext> {
    return this.ai.getContext(contextId);
  }

  /** @deprecated Use client.ai.updateContext() */
  async updateAiContext(contextId: string, request: UpdateAiContextRequest): Promise<AiContext> {
    return this.ai.updateContext(contextId, request);
  }

  /** @deprecated Use client.ai.deleteContext() */
  async deleteAiContext(contextId: string): Promise<void> {
    return this.ai.deleteContext(contextId);
  }

  /** @deprecated Use client.ai.query() */
  async aiQuery(request: AiQueryRequest): Promise<AiQueryResponse> {
    return this.ai.query(request);
  }

  /** @deprecated Use client.profiler.getTables() */
  async getProfilerTables(): Promise<ProfilerTable[]> {
    return this.profiler.getTables();
  }

  /** @deprecated Use client.profiler.start() */
  async startProfiler(skipFiles: boolean): Promise<unknown> {
    return this.profiler.start(skipFiles);
  }

  /** @deprecated Use client.profiler.getTableDescription() */
  async getTableDescription(tableId: string): Promise<unknown[]> {
    return this.profiler.getTableDescription(tableId);
  }

  /** @deprecated Use client.profiler.getTableData() */
  async getTableData(tableId: string): Promise<unknown[]> {
    return this.profiler.getTableData(tableId);
  }

  /** @deprecated Use client.profiler.getTableSourceFiles() */
  async getTableSourceFiles(tableId: string): Promise<unknown[]> {
    return this.profiler.getTableSourceFiles(tableId);
  }

  /** @deprecated Use client.profiler.getTableSummary() */
  async getTableSummary(tableId: string): Promise<unknown> {
    return this.profiler.getTableSummary(tableId);
  }

  /** @deprecated Use client.profiler.getConfig() */
  async getProfilerConfig(): Promise<DatalatheConfig> {
    return this.profiler.getConfig();
  }

  /** @deprecated Use client.profiler.updateConfig() */
  async updateProfilerConfig(config: DatalatheConfig): Promise<unknown> {
    return this.profiler.updateConfig(config);
  }

  /** @deprecated Use client.profiler.getSchemaMappings() */
  async getSchemaMappings(): Promise<SchemaMapping[]> {
    return this.profiler.getSchemaMappings();
  }

  /** @deprecated Use client.profiler.getSchema() */
  async getProfilerSchema(request: {
    show_unpopulated_fields: boolean;
    mapping_file_source: number | null;
    mapping_file_target: number | null;
  }): Promise<unknown> {
    return this.profiler.getSchema(request);
  }
}
