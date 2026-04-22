export class DatalatheError extends Error {
  public readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "DatalatheError";
    this.statusCode = statusCode;
  }
}

export class DatalatheApiError extends DatalatheError {
  public readonly responseBody?: string;

  constructor(message: string, statusCode: number, responseBody?: string) {
    super(message, statusCode);
    this.name = "DatalatheApiError";
    this.responseBody = responseBody;
  }
}

export class DatalatheStageError extends DatalatheError {
  constructor(message: string) {
    super(message);
    this.name = "DatalatheStageError";
  }
}

/**
 * Thrown when a request references a chip whose data is no longer available
 * (typically because the underlying S3 object has expired via lifecycle policy).
 *
 * Recovery pattern: catch this error, re-stage the chip from your own
 * source-of-truth using the same chipId, then retry the original call.
 */
export class ChipNotFoundError extends DatalatheApiError {
  public readonly chipId: string | null;

  constructor(message: string, chipId: string | null, responseBody: string) {
    super(message, 404, responseBody);
    this.name = "ChipNotFoundError";
    this.chipId = chipId;
  }
}
