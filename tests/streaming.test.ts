import { describe, it, expect } from "vitest";
import { DatalatheClient } from "../src/client.js";
import { DatalatheApiError, DatalatheQueryError } from "../src/errors.js";

/**
 * Builds a fetch mock that returns a 200 NDJSON response whose body is a
 * ReadableStream emitting the supplied byte chunks in order. This lets tests
 * exercise line-buffering across arbitrary chunk boundaries.
 */
function ndjsonFetch(chunks: string[], status = 200) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const encoder = new TextEncoder();
  const mockFetch = async (
    url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const bodyText = typeof init?.body === "string" ? init.body : "";
    calls.push({
      url: url.toString(),
      body: bodyText ? JSON.parse(bodyText) : null,
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });
    return new Response(stream, {
      status,
      headers: { "Content-Type": "application/x-ndjson" },
    });
  };
  return { fetch: mockFetch as typeof globalThis.fetch, calls };
}

function jsonFetch(status: number, body: unknown) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const mockFetch = async (
    url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const bodyText = typeof init?.body === "string" ? init.body : "";
    calls.push({ url: url.toString(), body: bodyText ? JSON.parse(bodyText) : null });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fetch: mockFetch as typeof globalThis.fetch, calls };
}

describe("streamReport", () => {
  it("happy path: schema + 2 batches + end", async () => {
    const lines = [
      JSON.stringify({
        type: "schema",
        schema: [
          { name: "id", data_type: "Utf8" },
          { name: "n", data_type: "Int32" },
        ],
      }),
      JSON.stringify({ type: "rows", rows: [["a", "1"], ["b", null]] }),
      JSON.stringify({ type: "rows", rows: [["c", "3"]] }),
      JSON.stringify({
        type: "end",
        row_count: 3,
        timing: { total_ms: 5, chip_attach_ms: 1, query_execution_ms: 4 },
      }),
    ];
    const { fetch, calls } = ndjsonFetch([lines.join("\n") + "\n"]);
    const client = new DatalatheClient("http://localhost:8080", { fetch });

    const stream = await client.queries.streamReport(["chip1"], "SELECT * FROM t");

    const schema = await stream.getSchema();
    expect(schema).toEqual([
      { name: "id", dataType: "Utf8" },
      { name: "n", dataType: "Int32" },
    ]);

    const rows: Array<Record<string, string | null>> = [];
    for await (const row of stream) {
      rows.push(row);
    }
    expect(rows).toEqual([
      { id: "a", n: "1" },
      { id: "b", n: null },
      { id: "c", n: "3" },
    ]);

    expect(stream.getRowCount()).toBe(3);
    expect(stream.getTiming()).toEqual({
      totalMs: 5,
      chipAttachMs: 1,
      queryExecutionMs: 4,
    });

    // Wire body sets stream:true and a single query.
    const body = calls[0].body as Record<string, unknown>;
    expect(body.stream).toBe(true);
    expect((body.query_request as Record<string, unknown>).query).toEqual([
      "SELECT * FROM t",
    ]);
  });

  it("handles a chunk boundary that splits a line mid-frame", async () => {
    const schemaLine = JSON.stringify({
      type: "schema",
      schema: [{ name: "id", data_type: "Utf8" }],
    });
    const rowsLine = JSON.stringify({ type: "rows", rows: [["x"], ["y"]] });
    const endLine = JSON.stringify({ type: "end", row_count: 2, timing: {} });
    const full = `${schemaLine}\n${rowsLine}\n${endLine}\n`;
    // Split into bytes at an offset that lands in the middle of the rows frame.
    const splitAt = schemaLine.length + 10;
    const chunks = [full.slice(0, splitAt), full.slice(splitAt)];

    const { fetch } = ndjsonFetch(chunks);
    const client = new DatalatheClient("http://localhost:8080", { fetch });

    const stream = await client.queries.streamReport(["c"], "SELECT 1");
    const rows: Array<Record<string, string | null>> = [];
    for await (const row of stream) rows.push(row);

    expect(rows).toEqual([{ id: "x" }, { id: "y" }]);
    expect(stream.getRowCount()).toBe(2);
  });

  it("rejects multi-query requests before issuing a request", async () => {
    const { fetch, calls } = ndjsonFetch([""]);
    const client = new DatalatheClient("http://localhost:8080", { fetch });

    await expect(
      client.queries.streamReport(["c"], ["SELECT 1", "SELECT 2"]),
    ).rejects.toBeInstanceOf(DatalatheApiError);
    expect(calls).toHaveLength(0);
  });

  it("throws DatalatheQueryError on an error terminal frame", async () => {
    const lines = [
      JSON.stringify({
        type: "schema",
        schema: [{ name: "id", data_type: "Utf8" }],
      }),
      JSON.stringify({ type: "rows", rows: [["x"]] }),
      JSON.stringify({ type: "error", error: "cast failure", error_code: "scan" }),
    ];
    const { fetch } = ndjsonFetch([lines.join("\n") + "\n"]);
    const client = new DatalatheClient("http://localhost:8080", { fetch });

    const stream = await client.queries.streamReport(["c"], "SELECT 1");
    await expect(
      (async () => {
        for await (const _row of stream) {
          /* drain */
        }
      })(),
    ).rejects.toBeInstanceOf(DatalatheQueryError);
  });

  it("throws DatalatheApiError on a truncated stream (no terminal frame)", async () => {
    const lines = [
      JSON.stringify({
        type: "schema",
        schema: [{ name: "id", data_type: "Utf8" }],
      }),
      JSON.stringify({ type: "rows", rows: [["x"]] }),
    ];
    const { fetch } = ndjsonFetch([lines.join("\n") + "\n"]);
    const client = new DatalatheClient("http://localhost:8080", { fetch });

    const stream = await client.queries.streamReport(["c"], "SELECT 1");
    await expect(
      (async () => {
        for await (const _row of stream) {
          /* drain */
        }
      })(),
    ).rejects.toBeInstanceOf(DatalatheApiError);
  });

  it("handles an empty result (schema + end, no rows)", async () => {
    const lines = [
      JSON.stringify({
        type: "schema",
        schema: [{ name: "id", data_type: "Utf8" }],
      }),
      JSON.stringify({ type: "end", row_count: 0, timing: {} }),
    ];
    const { fetch } = ndjsonFetch([lines.join("\n") + "\n"]);
    const client = new DatalatheClient("http://localhost:8080", { fetch });

    const stream = await client.queries.streamReport(["c"], "SELECT 1");
    const schema = await stream.getSchema();
    expect(schema).toEqual([{ name: "id", dataType: "Utf8" }]);

    const rows: Array<Record<string, string | null>> = [];
    for await (const row of stream) rows.push(row);
    expect(rows).toEqual([]);
    expect(stream.getRowCount()).toBe(0);
  });

  it("maps a pre-stream HTTP failure to the existing error path", async () => {
    const { fetch } = jsonFetch(429, { error: "too many", error_code: "saturated" });
    const client = new DatalatheClient("http://localhost:8080", { fetch, retryOn429: false });

    await expect(
      client.queries.streamReport(["c"], "SELECT 1"),
    ).rejects.toBeInstanceOf(DatalatheApiError);
  });
});
