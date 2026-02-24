export { DatalatheClient } from "./client.js";
export type { GenerateReportResult } from "./client.js";
export { DatalatheResultSet } from "./results/result-set.js";
export { CreateChipCommand } from "./commands/create-chip.js";
export { GenerateReportCommand } from "./commands/generate-report.js";
export type { DatalatheCommand } from "./commands/command.js";
export {
  DatalatheError,
  DatalatheApiError,
  DatalatheStageError,
} from "./errors.js";
export {
  SourceType,
  ReportType,
  type SchemaField,
  type SourceRequest,
  type Partition,
  type StageDataRequest,
  type StageDataResponse,
  type QueryRequest,
  type ReportRequest,
  type ReportResultEntry,
  type ReportResponse,
  type ReportTiming,
  type DatalatheClientOptions,
  type DuckDBDatabase,
  type DatabaseTable,
  type Chip,
  type ChipMetadata,
  type ChipsResponse,
  type ProfilerTable,
  type ModelerConfig,
  type TyperConfig,
  type ProfilerConfig,
  type DatalatheConfig,
  type SourceColumn,
  type SourceHeader,
  type FoundFile,
  type LoadScan,
  type LoadError,
  type DataModelColumn,
  type SourceFileDetails,
  type Job,
  type SchemaMapping,
} from "./types.js";
