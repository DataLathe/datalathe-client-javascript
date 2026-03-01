import type { DatalatheCommand } from "./command.js";
import type {
  SourceRequest,
  S3StorageConfig,
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
    chipName?: string,
    storageConfig?: S3StorageConfig,
  ) {
    this.request = {
      source_type: sourceType,
      source_request: source,
      ...(chipId !== undefined ? { chip_id: chipId } : {}),
      ...(chipName !== undefined ? { chip_name: chipName } : {}),
      ...(storageConfig !== undefined ? { storage_config: storageConfig } : {}),
    };
  }

  parseResponse(json: unknown): StageDataResponse {
    return json as StageDataResponse;
  }
}
