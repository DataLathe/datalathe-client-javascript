import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DatalatheClient } from "../src/client.js";
import { ChipResolver, type ChipFactory } from "../src/resolver.js";
import { SourceType } from "../src/types.js";
import { createMockFetch } from "./helpers.js";

const BASE = "http://localhost:8080";

function factory(
  partitioned: boolean,
  freshness: Record<string, string> | null,
): ChipFactory {
  return {
    isPartitioned: () => partitioned,
    buildSource: (table) => ({
      sourceType: SourceType.MYSQL,
      databaseName: "db",
      tableName: table,
      query: `SELECT * FROM ${table}`,
    }),
    freshnessTags: () => freshness,
  };
}

function chip(id: string, table: string, partitionValue: string | null) {
  return {
    chip_id: id,
    sub_chip_id: id,
    table_name: table,
    partition_value: partitionValue,
  };
}

function tag(chipId: string, key: string, value: string) {
  return { chip_id: chipId, key, value };
}

function search(chips: unknown[], tags: unknown[]) {
  return { status: 200, body: { chips, metadata: [], tags } };
}

function created(id: string) {
  return { status: 200, body: { chip_id: id, error: null } };
}

const deleted = { status: 200, body: {} };

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ChipResolver freshness", () => {
  it("evicts and recreates a stale chip in one pass", async () => {
    const { fetch, calls } = createMockFetch([
      search(
        [chip("c1", "users", null)],
        [tag("c1", "tenant", "42"), tag("c1", "schema_version", "v1")],
      ),
      deleted,
      created("c2"),
    ]);
    const client = new DatalatheClient(BASE, { fetch });
    const resolver = new ChipResolver(client);

    const resolved = await resolver.resolveForTables(
      ["users"], [], "tenant", "42", factory(false, { schema_version: "v2" }),
    );

    expect(resolved.allChipIds()).toEqual(["c2"]);
    expect(calls).toHaveLength(3);
    expect(calls[1].init.method).toBe("DELETE");
    expect(calls[1].url).toBe(`${BASE}/lathe/chips/c1`);
    expect(calls[2].init.method).toBe("POST");
  });

  it("keeps a chip whose freshness tags match", async () => {
    const { fetch, calls } = createMockFetch([
      search(
        [chip("c1", "users", null)],
        [tag("c1", "tenant", "42"), tag("c1", "schema_version", "v2")],
      ),
    ]);
    const client = new DatalatheClient(BASE, { fetch });
    const resolver = new ChipResolver(client);

    const resolved = await resolver.resolveForTables(
      ["users"], [], "tenant", "42", factory(false, { schema_version: "v2" }),
    );

    expect(resolved.allChipIds()).toEqual(["c1"]);
    expect(calls).toHaveLength(1);
  });

  it("evicts an untagged chip when the table declares freshness", async () => {
    const { fetch, calls } = createMockFetch([
      search([chip("c1", "users", null)], [tag("c1", "tenant", "42")]),
      deleted,
      created("c2"),
    ]);
    const client = new DatalatheClient(BASE, { fetch });
    const resolver = new ChipResolver(client);

    const resolved = await resolver.resolveForTables(
      ["users"], [], "tenant", "42", factory(false, { schema_version: "v2" }),
    );

    expect(resolved.allChipIds()).toEqual(["c2"]);
    expect(calls).toHaveLength(3);
  });

  it("leaves chips alone when freshnessTags returns null", async () => {
    const { fetch, calls } = createMockFetch([
      search([chip("c1", "users", null)], [tag("c1", "tenant", "42")]),
    ]);
    const client = new DatalatheClient(BASE, { fetch });
    const resolver = new ChipResolver(client);

    const resolved = await resolver.resolveForTables(
      ["users"], [], "tenant", "42", factory(false, null),
    );

    expect(resolved.allChipIds()).toEqual(["c1"]);
    expect(calls).toHaveLength(1);
  });

  it("evicts when any one of several tags differs", async () => {
    const { fetch, calls } = createMockFetch([
      search(
        [chip("c1", "users", null)],
        [
          tag("c1", "tenant", "42"),
          tag("c1", "schema_version", "v2"),
          tag("c1", "latest_max_date", "2026-07-31"),
        ],
      ),
      deleted,
      created("c2"),
    ]);
    const client = new DatalatheClient(BASE, { fetch });
    const resolver = new ChipResolver(client);

    const resolved = await resolver.resolveForTables(
      ["users"], [], "tenant", "42",
      factory(false, { schema_version: "v2", latest_max_date: "2026-08-19" }),
    );

    expect(resolved.allChipIds()).toEqual(["c2"]);
    expect(calls).toHaveLength(3);
  });

  it("stamps freshness tags on created chips", async () => {
    const { fetch, calls } = createMockFetch([search([], []), created("c1")]);
    const client = new DatalatheClient(BASE, { fetch });
    const resolver = new ChipResolver(client);

    await resolver.resolveForTables(
      ["users"], [], "tenant", "42", factory(false, { schema_version: "v2" }),
    );

    expect(calls).toHaveLength(2);
    const body = calls[1].body as Record<string, unknown>;
    expect(body.tags).toEqual({ tenant: "42", schema_version: "v2" });
  });

  it("treats a delete 404 as a concurrent evict and still recreates", async () => {
    const { fetch, calls } = createMockFetch([
      search(
        [chip("c1", "users", null)],
        [tag("c1", "tenant", "42"), tag("c1", "schema_version", "v1")],
      ),
      {
        status: 404,
        body: { error_code: "chip_not_found", chip_id: "c1", error: "gone" },
      },
      created("c2"),
    ]);
    const client = new DatalatheClient(BASE, { fetch });
    const resolver = new ChipResolver(client);

    const resolved = await resolver.resolveForTables(
      ["users"], [], "tenant", "42", factory(false, { schema_version: "v2" }),
    );

    expect(resolved.allChipIds()).toEqual(["c2"]);
    expect(calls).toHaveLength(3);
  });

  it("keeps the stale chip when the delete fails", async () => {
    const { fetch, calls } = createMockFetch([
      search(
        [chip("c1", "users", null)],
        [tag("c1", "tenant", "42"), tag("c1", "schema_version", "v1")],
      ),
      { status: 500, body: { error_code: "INTERNAL", message: "boom" } },
    ]);
    const client = new DatalatheClient(BASE, { fetch });
    const resolver = new ChipResolver(client);

    const resolved = await resolver.resolveForTables(
      ["users"], [], "tenant", "42", factory(false, { schema_version: "v2" }),
    );

    expect(resolved.allChipIds()).toEqual(["c1"]);
    expect(calls).toHaveLength(2);
  });

  it("recreates only the stale partition", async () => {
    const { fetch, calls } = createMockFetch([
      search(
        [chip("c1", "loans", "2026-01"), chip("c2", "loans", "2026-02")],
        [
          tag("c1", "tenant", "42"),
          tag("c1", "schema_version", "v1"),
          tag("c2", "tenant", "42"),
          tag("c2", "schema_version", "v2"),
        ],
      ),
      deleted,
      created("c3"),
    ]);
    const client = new DatalatheClient(BASE, { fetch });
    const resolver = new ChipResolver(client);

    const resolved = await resolver.resolveForTables(
      ["loans"], ["2026-01", "2026-02"], "tenant", "42",
      factory(true, { schema_version: "v2" }),
    );

    expect(new Set(resolved.allChipIds())).toEqual(new Set(["c2", "c3"]));
    expect(calls).toHaveLength(3);
    expect(calls[1].init.method).toBe("DELETE");
    expect(calls[1].url).toBe(`${BASE}/lathe/chips/c1`);
  });

  it("throws before any API call when a freshness key collides with the tenant tag", async () => {
    const { fetch, calls } = createMockFetch([]);
    const client = new DatalatheClient(BASE, { fetch });
    const resolver = new ChipResolver(client);

    await expect(
      resolver.resolveForTables(
        ["users"], [], "tenant", "42", factory(false, { tenant: "43" }),
      ),
    ).rejects.toThrow(/collides with the tenant tag key/);
    expect(calls).toHaveLength(0);
  });
});
