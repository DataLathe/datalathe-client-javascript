import type { SchemaField, ReportTiming } from "../types.js";
import { DatalatheApiError, DatalatheQueryError } from "../errors.js";
import { snakeToCamelKeys } from "../transform.js";

type SchemaFrame = {
  type: "schema";
  schema: Array<{ name: string; data_type: string }>;
  transformed_query?: string | null;
};
type RowsFrame = { type: "rows"; rows: (string | null)[][] };
type EndFrame = { type: "end"; row_count: number; timing?: unknown };
type ErrorFrame = { type: "error"; error: string; error_code?: string };

type StreamRow = Record<string, string | null>;

/**
 * Incremental, forward-only view over a streamed report result (NDJSON).
 *
 * `getSchema()` resolves once the schema frame arrives; iterating with
 * `for await (const row of resultSet)` yields one object per row, keyed by
 * column name. `getRowCount()` / `getTiming()` are only populated after the
 * stream completes (the `end` frame). An `error` terminal frame throws
 * `DatalatheQueryError` from the iterator; a stream that ends without a
 * terminal frame throws `DatalatheApiError`.
 *
 * The stream is consumed by a single background pump started at construction,
 * so `getSchema()` can be awaited before iteration without deadlocking. Rows
 * are buffered between the pump and the consumer; for very large results,
 * iterate promptly rather than letting them accumulate.
 */
export class DatalatheStreamingResultSet implements AsyncIterable<StreamRow> {
  private columnNames: string[] = [];
  private transformedQuery: string | null = null;
  private rowCount: number | null = null;
  private timing: ReportTiming | null = null;
  private iterated = false;

  private resolveSchema!: (schema: SchemaField[]) => void;
  private rejectSchema!: (err: unknown) => void;
  private readonly schemaPromise: Promise<SchemaField[]>;
  private schemaSettled = false;

  private readonly queue: StreamRow[] = [];
  private done = false;
  private error: unknown = null;
  private notify: (() => void) | null = null;

  constructor(stream: ReadableStream<Uint8Array>) {
    this.schemaPromise = new Promise<SchemaField[]>((resolve, reject) => {
      this.resolveSchema = resolve;
      this.rejectSchema = reject;
    });
    // Avoid an unhandled rejection if the schema promise is never awaited.
    this.schemaPromise.catch(() => {});
    void this.pump(stream);
  }

  /** Resolves with the column schema once the schema frame has been read. */
  getSchema(): Promise<SchemaField[]> {
    return this.schemaPromise;
  }

  /** Total rows produced; null until the stream completes. */
  getRowCount(): number | null {
    return this.rowCount;
  }

  /** Server-side timing; null until the stream completes. */
  getTiming(): ReportTiming | null {
    return this.timing;
  }

  /** Transformed query echoed in the schema frame, when present. */
  getTransformedQuery(): string | null {
    return this.transformedQuery;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<StreamRow> {
    if (this.iterated) {
      throw new DatalatheApiError(
        "A streaming result set can only be iterated once",
        0,
      );
    }
    this.iterated = true;

    while (true) {
      while (this.queue.length > 0) {
        yield this.queue.shift() as StreamRow;
      }
      if (this.error !== null) throw this.error;
      if (this.done) return;
      await new Promise<void>((resolve) => {
        this.notify = resolve;
      });
    }
  }

  private wake(): void {
    const notify = this.notify;
    this.notify = null;
    if (notify) notify();
  }

  private async pump(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let sawTerminal = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          if (this.handleLine(line)) sawTerminal = true;
          newlineIndex = buffer.indexOf("\n");
        }
      }

      // Flush any trailing line not terminated by a newline.
      if (buffer.trim().length > 0) {
        if (this.handleLine(buffer)) sawTerminal = true;
      }

      if (!sawTerminal) {
        throw new DatalatheApiError(
          "Stream ended without a terminal frame (transport error); the result may be incomplete",
          0,
        );
      }
      this.done = true;
    } catch (err) {
      this.error = err;
      if (!this.schemaSettled) {
        this.schemaSettled = true;
        this.rejectSchema(err);
      }
    } finally {
      reader.releaseLock();
      this.wake();
    }
  }

  /** Processes one NDJSON line. Returns true if it was the terminal frame. */
  private handleLine(line: string): boolean {
    const trimmed = line.trim();
    if (trimmed.length === 0) return false;

    let frame: SchemaFrame | RowsFrame | EndFrame | ErrorFrame;
    try {
      frame = JSON.parse(trimmed);
    } catch {
      throw new DatalatheApiError(`Malformed stream frame: ${trimmed}`, 0, trimmed);
    }

    switch (frame.type) {
      case "schema": {
        const schema = frame.schema.map((f) => snakeToCamelKeys<SchemaField>(f));
        this.columnNames = schema.map((f) => f.name);
        this.transformedQuery = frame.transformed_query ?? null;
        this.schemaSettled = true;
        this.resolveSchema(schema);
        return false;
      }
      case "rows": {
        for (const values of frame.rows) {
          this.queue.push(this.toRow(values));
        }
        this.wake();
        return false;
      }
      case "end": {
        this.rowCount = frame.row_count;
        this.timing = frame.timing
          ? snakeToCamelKeys<ReportTiming>(frame.timing)
          : null;
        return true;
      }
      case "error": {
        const errors = new Map<number, string>();
        errors.set(0, frame.error);
        throw new DatalatheQueryError(errors);
      }
      default:
        return false;
    }
  }

  private toRow(values: (string | null)[]): StreamRow {
    const row: StreamRow = {};
    for (let i = 0; i < this.columnNames.length; i++) {
      row[this.columnNames[i]] = values[i] ?? null;
    }
    return row;
  }
}
