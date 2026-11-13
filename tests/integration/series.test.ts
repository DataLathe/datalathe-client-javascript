import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatalatheClient } from "../../src";
import { DATALATHE_URL, E2E_CSV_PATH } from "./env";

describe("series reads (integration)", () => {
  const seriesId = `int-js-series-${Date.now()}-${process.pid}`;
  const tableName = "series_test";
  const created: string[] = [];
  let client: DatalatheClient;

  async function publish(partition: string): Promise<string> {
    const response = await fetch(`${DATALATHE_URL}/lathe/stage/data`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_type: "FILE",
        source_request: {
          database_name: "",
          query: "",
          file_path: E2E_CSV_PATH,
          table_name: tableName,
        },
        series: { id: seriesId, partition },
      }),
    });
    const body = (await response.json()) as { chip_id?: string };
    if (!response.ok || !body.chip_id) {
      throw new Error(`stage failed: ${response.status} ${JSON.stringify(body)}`);
    }
    created.push(body.chip_id);
    return body.chip_id;
  }

  async function rowsThrough(reference: string): Promise<string> {
    const { results } = await client.queries.generateReport(
      [reference],
      [`SELECT COUNT(*) FROM ${tableName}`],
    );
    return String(results.get(0)?.result?.[0]?.[0]);
  }

  beforeAll(async () => {
    client = new DatalatheClient(DATALATHE_URL);
    await publish("2026-09-30");
    await publish("2026-10-31");
  });

  afterAll(async () => {
    for (const chipId of created) {
      try {
        await client.chips.delete(chipId);
      } catch {
        // already gone
      }
    }
  });

  it("lists the series by prefix", async () => {
    const { series } = await client.series.list({ prefix: seriesId });
    expect(series).toHaveLength(1);
    expect(series[0]?.seriesId).toBe(seriesId);
    expect(series[0]?.tables).toBe(1);
    expect(series[0]?.liveSlotEntries).toBe(2);
  });

  it("returns each partition's chip and the table's columns", async () => {
    const view = await client.series.slots(seriesId);
    expect(view.seriesId).toBe(seriesId);
    expect(view.tables).toHaveLength(1);
    const table = view.tables[0]!;
    expect(table.tableName).toBe(tableName);
    expect(table.columns.length).toBeGreaterThan(0);
    expect(table.columns[0]).toHaveLength(2);
    expect(table.slots.map((s) => s.partitionValue).sort()).toEqual(["2026-09-30", "2026-10-31"]);
    expect(table.slots.map((s) => s.chipId).sort()).toEqual([...created].sort());
  });

  it("narrows slots to one partition", async () => {
    const view = await client.series.slots(seriesId, { table: tableName, partition: "2026-10-31" });
    expect(view.tables[0]?.slots).toHaveLength(1);
    expect(view.tables[0]?.slots[0]?.chipId).toBe(created[1]);
  });

  it("builds references that a report accepts", async () => {
    expect(await rowsThrough(client.series.reference(seriesId))).toBe("10");
    expect(
      await rowsThrough(client.series.reference(seriesId, { table: tableName, partition: "2026-10-31" })),
    ).toBe("5");
  });

  it("reads a saved view after a later publish", async () => {
    const saved = await client.series.slots(seriesId);
    await publish("2026-11-30");

    expect(await rowsThrough(client.series.reference(seriesId))).toBe("15");
    expect(await rowsThrough(client.series.reference(seriesId, { at: saved.asOf }))).toBe("10");

    const again = await client.series.slots(seriesId, { at: saved.asOf });
    expect(again.revision).toBe(saved.revision);
    expect(again.tables[0]?.slots).toHaveLength(2);
  });
});
