import type { HttpClient } from "./http.js";
import type {
  SeriesListOptions,
  SeriesListResponse,
  SeriesSlotsOptions,
  SeriesSlotsResponse,
  SeriesReferenceOptions,
} from "./types.js";

/**
 * Reads series: named collections that hold the current chip for each table
 * and partition. Requires an engine with a chip manager.
 */
export class SeriesApi {
  constructor(private readonly http: HttpClient) {}

  /** Lists series, ordered by ID. Pass `nextCursor` back as `cursor` for the next page. */
  async list(options: SeriesListOptions = {}): Promise<SeriesListResponse> {
    const params = new URLSearchParams();
    if (options.prefix !== undefined) params.set("prefix", options.prefix);
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    if (options.cursor !== undefined) params.set("cursor", options.cursor);
    const query = params.toString();
    return this.http.get<SeriesListResponse>(`/lathe/chips/series${query ? `?${query}` : ""}`);
  }

  /**
   * Returns the chips that currently hold each table and partition of a
   * series. `at` takes the `asOf` token of an earlier response and returns
   * exactly that view, or fails if a chip in it is gone.
   */
  async slots(seriesId: string, options: SeriesSlotsOptions = {}): Promise<SeriesSlotsResponse> {
    const params = new URLSearchParams();
    if (options.at !== undefined) params.set("at", options.at);
    if (options.major !== undefined) params.set("major", String(options.major));
    if (options.table !== undefined) params.set("table", options.table);
    if (options.partition !== undefined) params.set("partition", options.partition);
    if (options.tables !== undefined) params.set("tables", options.tables.join(","));
    const query = params.toString();
    return this.http.get<SeriesSlotsResponse>(
      `/lathe/chips/series/${encodeURIComponent(seriesId)}/slots${query ? `?${query}` : ""}`,
    );
  }

  /**
   * Builds the reference that a report, AI, or chip query request accepts in
   * place of a chip ID, for example `series:1234/loan04@latest`.
   */
  reference(seriesId: string, options: SeriesReferenceOptions = {}): string {
    let ref = `series:${seriesId}`;
    if (options.table !== undefined) {
      ref += `/${options.table}`;
      if (options.partition !== undefined) ref += `/${options.partition}`;
    }
    if (options.major !== undefined) ref += `@major-${options.major}`;
    return `${ref}@${options.at ?? "latest"}`;
  }
}
