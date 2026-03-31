export enum SourceType {
  MYSQL = "MYSQL",
  FILE = "FILE",
  S3 = "S3",
  CHIP = "CHIP",
  /** @deprecated Use CHIP instead */
  LOCAL = "CHIP",
  /** @deprecated Use CHIP instead */
  CACHE = "CHIP",
}

export enum ReportType {
  GENERIC = "Generic",
  TABLE = "Table",
}

export interface SchemaField {
  name: string;
  dataType: string;
}

export interface Partition {
  partitionBy: string;
  partitionValues?: string[];
  partitionQuery?: string;
  combinePartitions?: boolean;
}

export interface SourceRequest {
  databaseName: string;
  tableName?: string;
  query: string;
  filePath?: string;
  s3Path?: string;
  sourceChipIds?: string[];
  partition?: Partition;
  columnReplace?: Record<string, string>;
}

export interface S3StorageConfig {
  bucket?: string;
  keyPrefix?: string;
  ttlDays?: number;
}

export interface StageDataResponse {
  chipId: string;
  error: string | null;
}

export interface ReportResultEntry {
  idx: string;
  result: (string | null)[][] | null;
  data?: (string | null)[][] | null;
  error: string | null;
  schema: SchemaField[] | null;
  transformedQuery?: string | null;
}

export interface ReportTiming {
  totalMs: number;
  chipAttachMs: number;
  queryExecutionMs: number;
}

export interface ReportResponse {
  result: Record<string, ReportResultEntry> | null;
  error?: string | null;
  timing?: ReportTiming | null;
}

export interface DuckDBDatabase {
  databaseName: string;
  databaseOid: number;
  path?: string;
  comment?: string;
  tags?: string;
  internal: boolean;
  type: string;
  readonly: boolean;
}

export interface DatabaseTable {
  tableName: string;
  schemaName: string;
  columnName: string;
  dataType: string;
  isNullable: string;
  columnDefault?: string;
  ordinalPosition: number;
}

export interface Chip {
  chipId: string;
  subChipId: string;
  tableName: string;
  partitionValue: string;
  createdAt?: number;
}

export interface ChipMetadata {
  chipId: string;
  query?: string;
  createdAt: number;
  description: string;
  name: string;
  tables?: string;
  storageBucket?: string;
  storageKeyPrefix?: string;
  ttlDays?: number;
}

export interface ChipTag {
  chipId: string;
  key: string;
  value: string;
}

export interface ChipsResponse {
  chips: Chip[];
  metadata: ChipMetadata[];
  tags?: ChipTag[];
}

export interface ConnectionInfo {
  alias: string;
  host: string;
  port: string;
  database: string;
  user: string;
}

export interface ConnectionRequest {
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
}

export interface ConnectionResponse {
  alias: string;
  status?: string;
  error?: string;
}

export interface LicenseStatus {
  installed: boolean;
  error?: string | null;
}

export interface DatalatheClientOptions {
  /** Custom fetch implementation (for testing or Node 16 polyfill) */
  fetch?: typeof globalThis.fetch;
  /** Default request headers to include on every call */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
}

// Profiler types

export interface ProfilerTable {
  tableName: string;
  estimatedSize: number;
  columnCount: number;
  friendlyName: string;
  filter: string;
  schema: string;
  databaseName: string;
}

export interface ModelerConfig {
  pctSingleGroup: number;
  pctOfGroups: number;
  majorityCount: number;
  majorityThreshold: number;
}

export interface TyperConfig {
  dateSamplePct: number;
  nonZeroTimePct: number;
}

export interface ProfilerConfig {
  modeler: ModelerConfig;
  typer: TyperConfig;
  mappingPct: number;
}

export interface DatalatheConfig {
  dataPath: string;
  persistPath: string;
  profiler: ProfilerConfig;
}

// Source file types

export interface SourceColumn {
  id: number | null;
  columnName: string;
  columnNameLowercase: string;
  sourceHeaderId: number | null;
  dataType: string | null;
  possibleKey: boolean | null;
  isPrimaryKey: boolean | null;
  sourceFileOffset: number | null;
  foundType: string | null;
  isPopulated: boolean | null;
  isPossibleCharacteristic: boolean | null;
}

export interface SourceHeader {
  id: number | null;
  headerHash: string;
  possibleMappingFile: boolean | null;
}

export interface FoundFile {
  path: string;
  foundTime: number;
}

export interface LoadScan {
  scanId: number;
  fileId: number;
  filePath: string;
}

export interface LoadError {
  scanId: number;
  fileId: number;
  line: number;
  lineBytePosition: number;
  bytePosition: number;
  columnIdx: number;
  columnName: string;
  errorType: string;
  csvLine: string;
  errorMessage: string;
  filePath: string;
  delimiter: string;
  quote: string;
  escape: string;
  newlineDelimiter: string;
  skipRows: number;
  hasHeader: boolean;
}

export interface DataModelColumn {
  columnId: number;
  isPrimaryKey: boolean | null;
  isPopulated: boolean | null;
  isCharacteristic: boolean | null;
  foundType: string | null;
  isDataDate: boolean | null;
}

export interface SourceFileDetails {
  fileName: string;
  sourceFileId: number;
  sourceColumns: SourceColumn[];
  sourceHeader: SourceHeader;
  foundFiles: FoundFile[];
  loadScans: LoadScan[];
  loadErrors: LoadError[];
  dataModelColumns: DataModelColumn[];
}

// Job types

export interface Job {
  id: string;
  name: string;
  status: string;
  createdAt: number;
  message: string;
}

// Schema mapping types

export interface SchemaMapping {
  id: number;
  columnName: string;
}

// AI Query types

export interface AiCredential {
  credentialId: string;
  name: string;
  provider: string;
  defaultModel: string;
  createdAt: number;
}

export interface CreateAiCredentialRequest {
  name: string;
  provider: string;
  apiKey: string;
  defaultModel?: string;
}

export interface AiContext {
  contextId: string;
  name: string;
  chipIds: string;
  columnDescriptions: string;
  dataRelationshipPrompt: string;
  createdAt: number;
}

export interface CreateAiContextRequest {
  name: string;
  chipIds: string[];
  columnDescriptions: Record<string, Record<string, string>>;
  dataRelationshipPrompt: string;
}

export interface UpdateAiContextRequest {
  name?: string;
  chipIds?: string[];
  columnDescriptions?: Record<string, Record<string, string>>;
  dataRelationshipPrompt?: string;
}

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AiQueryRequest {
  contextId: string;
  credentialId: string;
  userQuestion: string;
  conversationHistory?: ConversationTurn[];
  model?: string;
}

export interface AiColumnInfo {
  name: string;
  dataType: string;
}

export interface AiQueryResultData {
  columns: AiColumnInfo[];
  rows: (string | null)[][];
}

export interface AiVisualizationConfig {
  type: string;
  title?: string;
  xAxis?: string;
  yAxis?: string;
  series?: string[];
}

export interface AiLlmUsage {
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface AiQueryResponse {
  requestId: string;
  data?: AiQueryResultData;
  visualization?: AiVisualizationConfig;
  explanation?: string;
  generatedSql?: string;
  usage?: AiLlmUsage;
  error?: string;
}
