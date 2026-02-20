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
}

export interface StageDataRequest {
  source_type: SourceType;
  source_request: SourceRequest;
  chip_id?: string;
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
}

export interface ReportResultEntry {
  idx: string;
  result: (string | null)[][] | null;
  data?: (string | null)[][] | null;
  error: string | null;
  schema: SchemaField[] | null;
}

export interface ReportResponse {
  result: Record<string, ReportResultEntry> | null;
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
