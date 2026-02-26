export enum SourceType {
  MYSQL = "MYSQL",
  FILE = "FILE",
  S3 = "S3",
  LOCAL = "LOCAL",
  CACHE = "CACHE",
}

export enum ReportType {
  GENERIC = "Generic",
  TABLE = "Table",
}

export interface SchemaField {
  name: string;
  data_type: string;
}

export interface Partition {
  partition_by: string;
  partition_values?: string[];
  partition_query?: string;
  combine_partitions?: boolean;
}

export interface SourceRequest {
  database_name: string;
  table_name?: string;
  query: string;
  file_path?: string;
  s3_path?: string;
  partition?: Partition;
  column_replace?: Record<string, string>;
}

export interface StageDataRequest {
  source_type: SourceType;
  source_request: SourceRequest;
  chip_id?: string;
  chip_name?: string;
}

export interface StageDataResponse {
  chip_id: string;
  error: string | null;
}

export interface QueryRequest {
  query: string[];
  file_path?: string;
}

export interface ReportRequest {
  chip_id: string[];
  source_type: SourceType;
  type: ReportType;
  query_request: QueryRequest;
  transform_query?: boolean;
  return_transformed_query?: boolean;
}

export interface ReportResultEntry {
  idx: string;
  result: (string | null)[][] | null;
  data?: (string | null)[][] | null;
  error: string | null;
  schema: SchemaField[] | null;
  transformed_query?: string | null;
}

export interface ReportTiming {
  total_ms: number;
  chip_attach_ms: number;
  query_execution_ms: number;
}

export interface ReportResponse {
  result: Record<string, ReportResultEntry> | null;
  error?: string | null;
  timing?: ReportTiming | null;
}

export interface DuckDBDatabase {
  database_name: string;
  database_oid: number;
  path?: string;
  comment?: string;
  tags?: string;
  internal: boolean;
  type: string;
  readonly: boolean;
}

export interface DatabaseTable {
  table_name: string;
  schema_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default?: string;
  ordinal_position: number;
}

export interface Chip {
  chip_id: string;
  sub_chip_id: string;
  table_name: string;
  partition_value: string;
  created_at?: number;
}

export interface ChipMetadata {
  chip_id: string;
  query?: string;
  created_at: number;
  description: string;
  name: string;
}

export interface ChipsResponse {
  chips: Chip[];
  metadata: ChipMetadata[];
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
  table_name: string;
  estimated_size: number;
  column_count: number;
  friendly_name: string;
  filter: string;
  schema: string;
  database_name: string;
}

export interface ModelerConfig {
  pct_single_group: number;
  pct_of_groups: number;
  majority_count: number;
  majority_threshold: number;
}

export interface TyperConfig {
  date_sample_pct: number;
  non_zero_time_pct: number;
}

export interface ProfilerConfig {
  modeler: ModelerConfig;
  typer: TyperConfig;
  mapping_pct: number;
}

export interface DatalatheConfig {
  data_path: string;
  duckdb_connection_string: string;
  profiler: ProfilerConfig;
}

// Source file types

export interface SourceColumn {
  id: number | null;
  column_name: string;
  column_name_lowercase: string;
  source_header_id: number | null;
  data_type: string | null;
  possible_key: boolean | null;
  is_primary_key: boolean | null;
  source_file_offset: number | null;
  found_type: string | null;
  is_populated: boolean | null;
  is_possible_characteristic: boolean | null;
}

export interface SourceHeader {
  id: number | null;
  header_hash: string;
  possible_mapping_file: boolean | null;
}

export interface FoundFile {
  path: string;
  found_time: number;
}

export interface LoadScan {
  scan_id: number;
  file_id: number;
  file_path: string;
}

export interface LoadError {
  scan_id: number;
  file_id: number;
  line: number;
  line_byte_position: number;
  byte_position: number;
  column_idx: number;
  column_name: string;
  error_type: string;
  csv_line: string;
  error_message: string;
  file_path: string;
  delimiter: string;
  quote: string;
  escape: string;
  newline_delimiter: string;
  skip_rows: number;
  has_header: boolean;
}

export interface DataModelColumn {
  column_id: number;
  is_primary_key: boolean | null;
  is_populated: boolean | null;
  is_characteristic: boolean | null;
  found_type: string | null;
  is_data_date: boolean | null;
}

export interface SourceFileDetails {
  file_name: string;
  source_file_id: number;
  source_columns: SourceColumn[];
  source_header: SourceHeader;
  found_files: FoundFile[];
  load_scans: LoadScan[];
  load_errors: LoadError[];
  data_model_columns: DataModelColumn[];
}

// Job types

export interface Job {
  id: string;
  name: string;
  status: string;
  created_at: number;
  message: string;
}

// Schema mapping types

export interface SchemaMapping {
  id: number;
  columnName: string;
}
