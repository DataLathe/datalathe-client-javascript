import { describe, it, expect } from "vitest";
import { DatalatheClient } from "../src/client.js";
import { createMockFetch } from "./helpers.js";

const BASE = "http://localhost:8080";
const EMPTY = { chips: [], metadata: [], tags: [] };

describe("chips.search", () => {
  it("sends only the parameters that were given", async () => {
    const { fetch, calls } = createMockFetch([{ status: 200, body: EMPTY }]);
    const client = new DatalatheClient(BASE, { fetch });
    await client.chips.search("loan02", undefined, "tenant:42");
    expect(calls[0].url).toBe(
      `${BASE}/lathe/chips/search?table_name=loan02&tag=tenant%3A42`,
    );
  });

  it("filters by correlation id", async () => {
    const { fetch, calls } = createMockFetch([{ status: 200, body: EMPTY }]);
    const client = new DatalatheClient(BASE, { fetch });
    await client.chips.search(undefined, undefined, undefined, "run-7");
    expect(calls[0].url).toBe(`${BASE}/lathe/chips/search?correlation_id=run-7`);
  });

  it("keeps the deprecated top-level alias in step", async () => {
    const { fetch, calls } = createMockFetch([{ status: 200, body: EMPTY }]);
    const client = new DatalatheClient(BASE, { fetch });
    await client.searchChips("t", "2026-01", undefined, "run-8");
    expect(calls[0].url).toBe(
      `${BASE}/lathe/chips/search?table_name=t&partition_value=2026-01&correlation_id=run-8`,
    );
  });
});
