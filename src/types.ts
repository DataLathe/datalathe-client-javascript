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
  /** Opt-in streaming ingest (MySQL only). Default behavior preserved when omitted. */
  streaming?: boolean;
  /** Numeric PK column name; enables 8-way keyset-parallel chunking when combined with streaming. */
  keysetColumn?: string;
}

export interface S3StorageConfig {
  bucket?: string;
  keyPrefix?: string;
  ttlDays?: number;
}

export interface StageDataResponse {
  chipId: string;
  error: string | null;
  /** Total rows loaded. Only present on streaming-path responses. */
  totalRows?: number;
  /** Wall-clock load time in ms. Only present on streaming-path responses. */
  elapsedMs?: number;
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
  /**
   * Chip IDs whose metadata could not be read back from the chip-manager.
   * Always populated by v1.7.1+ engines (empty array when none); absent on
   * older engines.
   */
  unreadableChipIds?: string[];
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
  region?: string;
}

export interface CreateAiCredentialRequest {
  name: string;
  provider: string;
  apiKey: string;
  defaultModel: string;
  /** Required when provider is "bedrock". */
  region?: string;
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
  credentialId?: string;
  userQuestion: string;
  conversationHistory?: ConversationTurn[];
  sessionId?: string;
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
  assistantTurn?: ConversationTurn;
  sessionId?: string;
  usage?: AiLlmUsage;
  error?: string;
  errorCode?: string;
  chipId?: string;
}

// AI Agent-mode types

/** Override per-request budget caps for agent-mode tool loop. */
export interface AgentOptions {
  /** Force-final after N tool-using iterations (soft cap). */
  maxIterations?: number;
  /** Force-final after N total tool calls (soft cap). */
  maxToolCalls?: number;
  /** Abort after N seconds of wall-clock time (hard cap). */
  maxWallClockSecs?: number;
  /** Force-final once N attachments have been emitted (soft cap). */
  maxAttachments?: number;
  /** Truncate run_sql results to this many rows. */
  runSqlRowCap?: number;
  /** Abort once cumulative input token usage exceeds this (hard cap). */
  maxTotalInputTokens?: number;
}

export interface AgentRequest {
  contextId: string;
  userQuestion: string;
  credentialId?: string;
  sessionId?: string;
  conversationHistory?: ConversationTurn[];
  model?: string;
  tenantId?: string;
  agentOptions?: AgentOptions;
}

export interface Attachment {
  caption: string;
  sql: string;
  data: AiQueryResultData;
  visualization?: AiVisualizationConfig;
}

export interface ToolCallTrace {
  iteration: number;
  tool: string;
  args: unknown;
  resultSummary: string;
  durationMs: number;
  isError: boolean;
}

/**
 * Natural-language reasoning emitted between tool calls. Pair with
 * `toolCalls` (which carries iteration + ordering) to render the full
 * chain of thought.
 */
export type NarrationEntry = {
  kind: "assistant_text";
  iteration: number;
  text: string;
};

export type StopReason =
  | "end_turn"
  | "max_iterations"
  | "max_tool_calls"
  | "max_attachments"
  | "agent_budget_exhausted";

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  model: string;
  iterations: number;
  toolCalls: number;
}

export interface AgentResponse {
  requestId: string;
  answer?: string;
  attachments: Attachment[];
  toolCalls: ToolCallTrace[];
  narration: NarrationEntry[];
  sessionId?: string;
  stopReason?: StopReason;
  usage?: AgentUsage;
  error?: string;
  errorCode?: string;
  chipId?: string;
}
