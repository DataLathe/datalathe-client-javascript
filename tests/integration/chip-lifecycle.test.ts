import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatalatheApiError, DatalatheClient, SourceType } from "../../src";
import { DATALATHE_URL, E2E_CSV_PATH } from "./env";

describe("chip lifecycle (integration)", () => {
  const chipId = `int-js-${Date.now()}-${process.pid}`;
  const tableName = "stage_test";
  let client: DatalatheClient;

  beforeAll(() => {
    client = new DatalatheClient(DATALATHE_URL);
  });

  afterAll(async () => {
    try {
      await client.chips.delete(chipId);
    } catch {
      // primary delete may have already run
    }
  });

  it("stages a chip from a FILE source", async () => {
    await client.chips.createMultiple(
      [{ databaseName: "", query: "", filePath: E2E_CSV_PATH, tableName }],
      chipId,
      SourceType.FILE,
    );
    const search = await client.chips.search(tableName);
    const found = search.chips.some((c) => c.chipId === chipId);
    expect(found).toBe(true);
  });

  it("returns rows via generateReport", async () => {
    const { results } = await client.queries.generateReport(
      [chipId],
      [`SELECT COUNT(*) FROM ${tableName}`],
    );
    const entry = results.get(0);
    const cell = entry?.result?.[0]?.[0];
    expect(String(cell)).toBe("5");
  });

  it("rejects re-stage with TABLE_ALREADY_EXISTS (409)", async () => {
    await expect(
      client.chips.createMultiple(
        [{ databaseName: "", query: "", filePath: E2E_CSV_PATH, tableName }],
        chipId,
        SourceType.FILE,
      ),
    ).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof DatalatheApiError &&
        /TABLE_ALREADY_EXISTS|already exists/i.test(e.message),
    );
  });

  it("deletes the chip", async () => {
    await client.chips.delete(chipId);
    const search = await client.chips.search(tableName);
    const stillThere = search.chips.some((c) => c.chipId === chipId);
    expect(stillThere).toBe(false);
  });
});
