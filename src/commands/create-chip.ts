import type { DatalatheCommand } from "./command.js";
import type {
  SourceRequest,
  StageDataRequest,
  StageDataResponse,
} from "../types.js";
import { SourceType } from "../types.js";

export class CreateChipCommand
  implements DatalatheCommand<StageDataRequest, StageDataResponse>
{
  readonly endpoint = "/lathe/stage/data";
  readonly request: StageDataRequest;

  constructor(
    sourceType: SourceType,
    source: SourceRequest,
    chipId?: string,
  ) {
    this.request = {
      source_type: sourceType,
      source_request: source,
      ...(chipId !== undefined ? { chip_id: chipId } : {}),
    };
  }

  parseResponse(json: unknown): StageDataResponse {
    return json as StageDataResponse;
  }
}
