import type { IngestJob } from "./types.js";

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

/**
 * Thrown by generateReport when one or more queries fail at execution time.
 * The engine returns HTTP 200 with the failure in each entry's `error` field;
 * this surfaces it instead of letting a failed query look like an empty result.
 *
 * Pass `raiseOnQueryError: false` to generateReport to suppress this and
 * inspect `ReportResultEntry.error` on the returned results instead.
 */
export class DatalatheQueryError extends DatalatheError {
  public readonly errors: Map<number, string>;

  constructor(errors: Map<number, string>) {
    const detail = [...errors.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([idx, msg]) => `query ${idx}: ${msg}`)
      .join("; ");
    super(`Query execution failed (${detail})`);
    this.name = "DatalatheQueryError";
    this.errors = errors;
  }
}

/**
 * Thrown by waitForIngest when the job reaches a failed or cancelled state.
 * The full job record (including its `error` field) is attached.
 */
export class DatalatheIngestJobError extends DatalatheError {
  public readonly job: IngestJob;

  constructor(job: IngestJob) {
    super(
      `Ingest job ${job.jobId} ${job.status}${job.error ? `: ${job.error}` : ""}`,
    );
    this.name = "DatalatheIngestJobError";
    this.job = job;
  }
}

/**
 * Thrown by waitForIngest when the job has not reached a terminal state
 * within timeoutMs. The most recently observed job record is attached.
 */
export class DatalatheIngestTimeoutError extends DatalatheError {
  public readonly jobId: string;
  public readonly lastJob: IngestJob;

  constructor(jobId: string, timeoutMs: number, lastJob: IngestJob) {
    super(`Timed out after ${timeoutMs}ms waiting for ingest job ${jobId}`);
    this.name = "DatalatheIngestTimeoutError";
    this.jobId = jobId;
    this.lastJob = lastJob;
  }
}
