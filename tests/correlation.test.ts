import { describe, expect, it, vi } from "vitest";
import { DatalatheClient } from "../src/index.js";
import { createMockFetch } from "./helpers.js";

const header = (init: RequestInit) =>
  (init.headers as Record<string, string>)["X-Correlation-ID"];

describe("withCorrelationId", () => {
  it("copy sends the header, original does not, both share fetch", async () => {
    const { fetch, calls } = createMockFetch([
      { status: 200, body: { version: "1.21.0" } },
      { status: 200, body: { version: "1.21.0" } },
    ]);
    const base = new DatalatheClient("http://engine", { fetch });
    const scoped = base.withCorrelationId("nc-1");
    expect(scoped).not.toBe(base);

    await scoped.getVersion();
    await base.getVersion();

    expect(header(calls[0].init)).toBe("nc-1");
    expect(header(calls[1].init)).toBeUndefined();
  });

  it("returns the same client for null, empty or blank", () => {
    const base = new DatalatheClient("http://engine", { fetch: createMockFetch([]).fetch });
    expect(base.withCorrelationId(null)).toBe(base);
    expect(base.withCorrelationId(undefined)).toBe(base);
    expect(base.withCorrelationId("  ")).toBe(base);
  });

  it("invalid_id_warns_and_sends_nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fetch, calls } = createMockFetch([{ status: 200, body: { version: "x" } }]);
    const base = new DatalatheClient("http://engine", { fetch });
    const scoped = base.withCorrelationId("bad id\n");
    expect(scoped).toBe(base);
    expect(warn).toHaveBeenCalledOnce();
    await scoped.getVersion();
    expect(header(calls[0].init)).toBeUndefined();
    warn.mockRestore();
  });

  it("chained_copy_uses_latest_id and keeps other headers", async () => {
    const { fetch, calls } = createMockFetch([{ status: 200, body: { version: "x" } }]);
    const scoped = new DatalatheClient("http://engine", {
      fetch,
      headers: { "x-datalathe-dev-key": "k" },
    })
      .withCorrelationId("first")
      .withCorrelationId("second");
    await scoped.getVersion();
    const sent = calls[0].init.headers as Record<string, string>;
    expect(sent["X-Correlation-ID"]).toBe("second");
    expect(sent["x-datalathe-dev-key"]).toBe("k");
  });

  it("parses correlationId on ingest jobs and tolerates absence", async () => {
    const { fetch } = createMockFetch([
      { status: 200, body: { job_id: "j1", status: "queued", correlation_id: "nc-job" } },
      { status: 200, body: { job_id: "j2", status: "queued" } },
    ]);
    const client = new DatalatheClient("http://engine", { fetch });
    expect((await client.chips.getIngestJob("j1")).correlationId).toBe("nc-job");
    expect((await client.chips.getIngestJob("j2")).correlationId).toBeUndefined();
  });
});

describe("withCorrelationId non-string input", () => {
  it("never throws on non-string ids", async () => {
    const { fetch, calls } = createMockFetch([{ status: 200, body: { version: "x" } }]);
    const base = new DatalatheClient("http://engine", { fetch });
    const scoped = base.withCorrelationId(12345 as unknown as string);
    await scoped.getVersion();
    expect(header(calls[0].init)).toBe("12345");
  });
});
