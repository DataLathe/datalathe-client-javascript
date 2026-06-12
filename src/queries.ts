import type { HttpClient } from "./http.js";
import type {
  ReportResultEntry,
  ReportResponse,
  ReportTiming,
} from "./types.js";
import { SourceType, ReportType } from "./types.js";
import { DatalatheApiError, DatalatheQueryError } from "./errors.js";
import { DatalatheStreamingResultSet } from "./results/streaming-result-set.js";

export interface GenerateReportResult {
  results: Map<number, ReportResultEntry>;
  timing: ReportTiming | null;
}

export class QueriesApi {
  constructor(private readonly http: HttpClient) {}

  /**
   * Executes queries against chip IDs.
   *
   * When `raiseOnQueryError` is true (the default), throws `DatalatheQueryError`
   * if any query fails at execution time. Pass false to inspect each entry's
   * `error` field on the returned results instead.
   */
  async generateReport(
    chipIds: string[],
    queries: string[],
    sourceType: SourceType = SourceType.LOCAL,
    transformQuery?: boolean,
    returnTransformedQuery?: boolean,
    raiseOnQueryError = true,
  ): Promise<GenerateReportResult> {
    const wireBody = {
      chip_id: chipIds,
      source_type: sourceType,
      type: ReportType.GENERIC,
      query_request: { query: queries },
      ...(transformQuery !== undefined ? { transform_query: transformQuery } : {}),
      ...(returnTransformedQuery !== undefined ? { return_transformed_query: returnTransformedQuery } : {}),
    };
    const response = await this.http.postRaw<ReportResponse>("/lathe/report", wireBody);
    const results = new Map<number, ReportResultEntry>();

    if (response.result) {
      for (const [key, entry] of Object.entries(response.result)) {
        results.set(parseInt(key, 10), entry);
      }
    }

    if (raiseOnQueryError) {
      const queryErrors = new Map<number, string>();
      for (const [idx, entry] of results) {
        if (entry.error != null) queryErrors.set(idx, entry.error);
      }
      if (queryErrors.size > 0) throw new DatalatheQueryError(queryErrors);
    }

    return { results, timing: response.timing ?? null };
  }

  /**
   * Executes a single query against chip IDs and streams the result
   * incrementally over NDJSON, returning a {@link DatalatheStreamingResultSet}.
   *
   * Unlike {@link generateReport}, this path is single-query only (the engine
   * rejects multi-query streams with 400) and is not subject to the server's
   * `max_result_rows` cap — it is the sanctioned escape hatch for large
   * results. Client memory is the caller's responsibility: consume the result
   * incrementally rather than collecting it all.
   *
   * @throws DatalatheApiError if more than one query is supplied.
   */
  async streamReport(
    chipIds: string[],
    query: string | string[],
    sourceType: SourceType = SourceType.LOCAL,
    transformQuery?: boolean,
    returnTransformedQuery?: boolean,
  ): Promise<DatalatheStreamingResultSet> {
    const queries = Array.isArray(query) ? query : [query];
    if (queries.length !== 1) {
      throw new DatalatheApiError(
        `streamReport supports exactly one query; received ${queries.length}. Use generateReport for multi-query batches.`,
        400,
      );
    }

    const wireBody = {
      chip_id: chipIds,
      source_type: sourceType,
      type: ReportType.GENERIC,
      query_request: { query: queries },
      stream: true,
      ...(transformQuery !== undefined ? { transform_query: transformQuery } : {}),
      ...(returnTransformedQuery !== undefined ? { return_transformed_query: returnTransformedQuery } : {}),
    };

    const body = await this.http.postStream("/lathe/report", wireBody);
    return new DatalatheStreamingResultSet(body);
  }

  async extractTables(query: string): Promise<string[]> {
    const response = await this.extractTablesWithTransform(query);
    return response.tables;
  }

  async extractTablesWithTransform(
    query: string,
    transform?: boolean,
  ): Promise<{ tables: string[]; transformedQuery: string | null }> {
    const response = await this.http.postRaw<{
      tables: string[];
      transformedQuery: string | null;
      error: string | null;
    }>("/lathe/query/tables", { query, transform });
    if (response.error) {
      throw new DatalatheApiError(
        `Failed to extract tables: ${response.error}`,
        400,
        response.error,
      );
    }
    return { tables: response.tables, transformedQuery: response.transformedQuery };
  }

  /**
   * Posts a raw stage data request.
   */
  async stageData(request: unknown): Promise<unknown> {
    return this.http.postRaw<unknown>("/lathe/stage/data", request);
  }

  /**
   * Posts a raw report request.
   */
  async postReport(request: unknown): Promise<unknown> {
    return this.http.postRaw<unknown>("/lathe/report", request);
  }
}
