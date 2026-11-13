import { describe, it, expect } from "vitest";
import { DatalatheClient } from "../src/client.js";
import { createMockFetch } from "./helpers.js";

const BASE = "http://localhost:8080";

describe("series.list", () => {
  it("sends the prefix, limit, and cursor that were given", async () => {
    const body = {
      series: [
        {
          series_id: "1234",
          as_of: "r7f3a91c2-12",
          revision: 12,
          tables: 3,
          live_slot_entries: 40,
          last_published_at: 1794500000,
        },
      ],
      next_cursor: "1234",
    };
    const { fetch, calls } = createMockFetch([{ status: 200, body }]);
    const client = new DatalatheClient(BASE, { fetch });

    const page = await client.series.list({ prefix: "12", limit: 1, cursor: "1199" });

    expect(calls[0].url).toBe(`${BASE}/lathe/chips/series?prefix=12&limit=1&cursor=1199`);
    expect(page.series[0]).toEqual({
      seriesId: "1234",
      asOf: "r7f3a91c2-12",
      revision: 12,
      tables: 3,
      liveSlotEntries: 40,
      lastPublishedAt: 1794500000,
    });
    expect(page.nextCursor).toBe("1234");
  });

  it("sends no query string without options", async () => {
    const { fetch, calls } = createMockFetch([{ status: 200, body: { series: [] } }]);
    const client = new DatalatheClient(BASE, { fetch });
    await client.series.list();
    expect(calls[0].url).toBe(`${BASE}/lathe/chips/series`);
  });
});

describe("series.slots", () => {
  const body = {
    series_id: "1234",
    as_of: "r7f3a91c2-12",
    revision: 12,
    tables: [
      {
        table_name: "loan04",
        contract_major: 1,
        columns: [
          ["id", "INTEGER"],
          ["branch_name", "VARCHAR"],
        ],
        slots: [
          {
            partition_value: "2026-10-31",
            chip_id: "c9",
            sub_chip_id: "c9-a",
            version: 9,
            column_count: 2,
            published_revision: 11,
          },
        ],
      },
    ],
  };

  it("returns tables and slots and leaves column names alone", async () => {
    const { fetch, calls } = createMockFetch([{ status: 200, body }]);
    const client = new DatalatheClient(BASE, { fetch });

    const view = await client.series.slots("1234");

    expect(calls[0].url).toBe(`${BASE}/lathe/chips/series/1234/slots`);
    expect(view.asOf).toBe("r7f3a91c2-12");
    expect(view.tables[0].tableName).toBe("loan04");
    expect(view.tables[0].columns[1]).toEqual(["branch_name", "VARCHAR"]);
    expect(view.tables[0].slots[0]).toEqual({
      partitionValue: "2026-10-31",
      chipId: "c9",
      subChipId: "c9-a",
      version: 9,
      columnCount: 2,
      publishedRevision: 11,
    });
  });

  it("sends the view, major, and filters", async () => {
    const { fetch, calls } = createMockFetch([{ status: 200, body }]);
    const client = new DatalatheClient(BASE, { fetch });

    await client.series.slots("tenant:1234", {
      at: "r7f3a91c2-12",
      major: 1,
      table: "loan04",
      partition: "2026-10-31",
      tables: ["loan04", "loan_origination"],
    });

    expect(calls[0].url).toBe(
      `${BASE}/lathe/chips/series/tenant%3A1234/slots?at=r7f3a91c2-12&major=1&table=loan04&partition=2026-10-31&tables=loan04%2Cloan_origination`,
    );
  });
});

describe("series.reference", () => {
  const client = new DatalatheClient(BASE, { fetch: createMockFetch([]).fetch });

  it("defaults to the whole collection at latest", () => {
    expect(client.series.reference("1234")).toBe("series:1234@latest");
  });

  it("adds a table, a partition, a major, and a saved view", () => {
    expect(client.series.reference("1234", { table: "loan04" })).toBe("series:1234/loan04@latest");
    expect(client.series.reference("1234", { table: "loan04", partition: "2026-10-31" })).toBe(
      "series:1234/loan04/2026-10-31@latest",
    );
    expect(client.series.reference("1234", { major: 1 })).toBe("series:1234@major-1@latest");
    expect(client.series.reference("1234", { table: "loan04", major: 1, at: "r7f3a91c2-12" })).toBe(
      "series:1234/loan04@major-1@r7f3a91c2-12",
    );
  });

  it("ignores a partition without a table", () => {
    expect(client.series.reference("1234", { partition: "2026-10-31" })).toBe("series:1234@latest");
  });
});
