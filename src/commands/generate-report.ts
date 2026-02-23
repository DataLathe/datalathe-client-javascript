import type { DatalatheCommand } from "./command.js";
import type { ReportRequest, ReportResponse } from "../types.js";
import { ReportType, SourceType } from "../types.js";

export class GenerateReportCommand
  implements DatalatheCommand<ReportRequest, ReportResponse>
{
  readonly endpoint = "/lathe/report";
  readonly request: ReportRequest;

  constructor(
    chipIds: string[],
    sourceType: SourceType,
    queries: string[],
    reportType: ReportType = ReportType.GENERIC,
    transformQuery?: boolean,
    returnTransformedQuery?: boolean,
  ) {
    this.request = {
      chip_id: chipIds,
      source_type: sourceType,
      type: reportType,
      query_request: { query: queries },
      ...(transformQuery !== undefined ? { transform_query: transformQuery } : {}),
      ...(returnTransformedQuery !== undefined ? { return_transformed_query: returnTransformedQuery } : {}),
    };
  }

  parseResponse(json: unknown): ReportResponse {
    return json as ReportResponse;
  }
}
