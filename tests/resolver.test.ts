import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DatalatheClient } from "../src/client.js";
import { ChipResolver, type ChipFactory } from "../src/resolver.js";
import { SourceType } from "../src/types.js";
import { createMockFetch } from "./helpers.js";

const BASE = "http://localhost:8080";

function factory(
  partitioned: boolean,
  freshness?: Record<string, string> | null,
): ChipFactory {
  const f: ChipFactory = {
    isPartitioned: () => partitioned,
    buildSource: (table) => ({
      sourceType: SourceType.MYSQL,
      databaseName: "db",
      tableName: table,
      query: `SELECT * FROM ${table}`,
    }),
  };
  if (freshness !== undefined) {
    f.freshnessTags = () => freshness;
  }
  return f;
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

function search(chips: unknown[] = [], tags: unknown[] = []) {
  return { status: 200, body: { chips, metadata: [], tags } };
}

function created(id: string) {
  return { status: 200, body: { chip_id: id, error: null } };
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ChipResolver core", () => {
  it("reuses an existing chip without creating", async () => {
    const { fetch, calls } = createMockFetch([
      search([chip("c1", "users", null)], [tag("c1", "tenant", "42")]),
    ]);
    const client = new DatalatheClient(BASE, { fetch });
    const resolver = new ChipResolver(client);

    const resolved = await resolver.resolveForTables(
      ["users"], [], "tenant", "42", factory(false),
    );

    expect(resolved.unpartitionedIds).toEqual(["c1"]);
    expect(resolved.partitionedIds).toEqual([]);
    expect(resolved.allChipIds()).toEqual(["c1"]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      `${BASE}/lathe/chips/search?tag=tenant%3D42`,
    );
  });

  it("creates a missing chip stamped with the tenant tag", async () => {
    const { fetch, calls } = createMockFetch([search(), created("c1")]);
    const client = new DatalatheClient(BASE, { fetch });
    const resolver = new ChipResolver(client);

    const resolved = await resolver.resolveForTables(
      ["users"], [], "tenant", "42", factory(false),
    );

    expect(resolved.allChipIds()).toEqual(["c1"]);
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toBe(`${BASE}/lathe/stage/data`);
    const body = calls[1].body as Record<string, unknown>;
    expect(body.source_type).toBe("MYSQL");
    expect(body.tags).toEqual({ tenant: "42" });
    expect(
      (body.source_request as Record<string, unknown>).query,
    ).toBe("SELECT * FROM users");
  });

  it("creates only the missing partition values", async () => {
    const { fetch, calls } = createMockFetch([
      search([chip("c1", "loans", "2026-01")], [tag("c1", "tenant", "42")]),
      created("c2"),
    ]);
    const client = new DatalatheClient(BASE, { fetch });
    const resolver = new ChipResolver(client);

    const resolved = await resolver.resolveForTables(
      ["loans"], ["2026-01", "2026-02"], "tenant", "42", factory(true),
    );

    expect(new Set(resolved.allChipIds())).toEqual(new Set(["c1", "c2"]));
    expect(resolved.partitionedIds).toContain("c1");
    expect(calls).toHaveLength(2);
  });

  it("deduplicates concurrent creates for the same chip", async () => {
    const { fetch, calls } = createMockFetch([
      search(),
      search(),
      created("c1"),
    ]);
    const client = new DatalatheClient(BASE, { fetch });
    const resolver = new ChipResolver(client);

    const [a, b] = await Promise.all([
      resolver.resolveForTables(["users"], [], "tenant", "42", factory(false)),
      resolver.resolveForTables(["users"], [], "tenant", "42", factory(false)),
    ]);

    expect(a.allChipIds()).toEqual(["c1"]);
    expect(b.allChipIds()).toEqual(["c1"]);
    expect(calls).toHaveLength(3);
  });

  it("clears the inflight entry once the chip is searchable", async () => {
    const { fetch, calls } = createMockFetch([
      search(),
      created("c1"),
      search([chip("c1", "users", null)], [tag("c1", "tenant", "42")]),
    ]);
    const client = new DatalatheClient(BASE, { fetch });
    const resolver = new ChipResolver(client);

    await resolver.resolveForTables(["users"], [], "tenant", "42", factory(false));
    expect(resolver.inflightCount()).toBe(1);

    const resolved = await resolver.resolveForTables(
      ["users"], [], "tenant", "42", factory(false),
    );
    expect(resolved.allChipIds()).toEqual(["c1"]);
    expect(resolver.inflightCount()).toBe(0);
    expect(calls).toHaveLength(3);
  });

  it("resolves tables extracted from report queries", async () => {
    const { fetch, calls } = createMockFetch([
      {
        status: 200,
        body: { tables: ["users"], transformed_query: null, error: null },
      },
      search([chip("c1", "users", null)], [tag("c1", "tenant", "42")]),
    ]);
    const client = new DatalatheClient(BASE, { fetch });
    const resolver = new ChipResolver(client);

    const resolved = await resolver.resolve(
      ["SELECT * FROM users"], [], "tenant", "42", factory(false),
    );

    expect(resolved.allChipIds()).toEqual(["c1"]);
    expect(calls[0].url).toBe(`${BASE}/lathe/query/tables`);
  });
});

describe("ChipResolver empty-source suppression", () => {
  const emptyFailure = {
    status: 500,
    body: { error_code: "EMPTY_SOURCE", message: "no rows" },
  };

  it("suppresses retries after an EMPTY_SOURCE failure", async () => {
    const { fetch, calls } = createMockFetch([search(), emptyFailure, search()]);
    const client = new DatalatheClient(BASE, { fetch });
    const resolver = new ChipResolver(client, { emptyRecheckMinutes: 30 });

    const first = await resolver.resolveForTables(
      ["users"], [], "tenant", "42", factory(false),
    );
    expect(first.allChipIds()).toEqual([]);
    expect(calls).toHaveLength(2);

    const second = await resolver.resolveForTables(
      ["users"], [], "tenant", "42", factory(false),
    );
    expect(second.allChipIds()).toEqual([]);
    expect(calls).toHaveLength(3);
  });

  it("suppresses retries on the legacy empty message", async () => {
    const { fetch, calls } = createMockFetch([
      search(),
      {
        status: 500,
        body: {
          error_code: "PROCESSING_ERROR",
          message:
            "No partitions to register - all partition values returned empty data",
        },
      },
      search(),
    ]);
    const client = new DatalatheClient(BASE, { fetch });
    const resolver = new ChipResolver(client, { emptyRecheckMinutes: 30 });

    await resolver.resolveForTables(["users"], [], "tenant", "42", factory(false));
    expect(calls).toHaveLength(2);

    await resolver.resolveForTables(["users"], [], "tenant", "42", factory(false));
    expect(calls).toHaveLength(3);
  });

  it("retries after the suppression window expires", async () => {
    const { fetch, calls } = createMockFetch([
      search(),
      emptyFailure,
      search(),
      created("c1"),
    ]);
    const client = new DatalatheClient(BASE, { fetch });
    const resolver = new ChipResolver(client, { emptyRecheckMinutes: 30 });
    let now = 0;
    resolver.clock = () => now;

    await resolver.resolveForTables(["users"], [], "tenant", "42", factory(false));
    expect(calls).toHaveLength(2);

    now += 31 * 60 * 1000;
    const resolved = await resolver.resolveForTables(
      ["users"], [], "tenant", "42", factory(false),
    );
    expect(resolved.allChipIds()).toEqual(["c1"]);
    expect(calls).toHaveLength(4);
  });

  it("does not suppress a different tag value", async () => {
    const { fetch, calls } = createMockFetch([
      search(),
      emptyFailure,
      search(),
      created("c2"),
    ]);
    const client = new DatalatheClient(BASE, { fetch });
    const resolver = new ChipResolver(client, { emptyRecheckMinutes: 30 });

    await resolver.resolveForTables(["users"], [], "tenant", "42", factory(false));
    expect(calls).toHaveLength(2);

    const resolved = await resolver.resolveForTables(
      ["users"], [], "tenant", "43", factory(false),
    );
    expect(resolved.allChipIds()).toEqual(["c2"]);
    expect(calls).toHaveLength(4);
  });

  it("disables suppression when the window is zero", async () => {
    const { fetch, calls } = createMockFetch([
      search(),
      emptyFailure,
      search(),
      emptyFailure,
    ]);
    const client = new DatalatheClient(BASE, { fetch });
    const resolver = new ChipResolver(client, { emptyRecheckMinutes: 0 });

    await resolver.resolveForTables(["users"], [], "tenant", "42", factory(false));
    expect(calls).toHaveLength(2);

    await resolver.resolveForTables(["users"], [], "tenant", "42", factory(false));
    expect(calls).toHaveLength(4);
  });
});

describe("ChipResolver failure logging", () => {
  async function resolveWithFailure(status: number, body: unknown) {
    const { fetch } = createMockFetch([search(), { status, body }]);
    const client = new DatalatheClient(BASE, { fetch });
    const resolver = new ChipResolver(client);
    return resolver.resolveForTables(
      ["users"], [], "tenant", "42", factory(false),
    );
  }

  function failureInfoLogs(): string[] {
    return (console.info as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => String(c[0]))
      .filter((m: string) => !m.startsWith("Creating chip"));
  }

  it("logs empty sources at info without an error object", async () => {
    await resolveWithFailure(500, {
      error_code: "EMPTY_SOURCE",
      message: "source returned no rows",
    });

    const logs = failureInfoLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("table=users");
    expect(logs[0]).toContain("message=source returned no rows");
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("logs the legacy empty message at info", async () => {
    await resolveWithFailure(500, {
      error_code: "PROCESSING_ERROR",
      message:
        "No partitions to register - all partition values returned empty data",
    });

    const logs = failureInfoLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("table=users");
    expect(logs[0]).toContain("message=No partitions to register");
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("logs structured API failures at warn", async () => {
    await resolveWithFailure(500, {
      error_code: "PROCESSING_ERROR",
      message: "staging query failed",
    });

    expect(console.warn).toHaveBeenCalledTimes(1);
    const message = String(
      (console.warn as ReturnType<typeof vi.fn>).mock.calls[0][0],
    );
    expect(message).toContain("table=users");
    expect(message).toContain("errorCode=PROCESSING_ERROR");
    expect(message).toContain("message=staging query failed");
    expect(console.error).not.toHaveBeenCalled();
  });

  it("logs unstructured failures at error with the cause", async () => {
    await resolveWithFailure(500, "Internal Server Error");

    expect(console.error).toHaveBeenCalledTimes(1);
    const call = (console.error as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(call[0])).toContain("table=users");
    expect(call[1]).toBeInstanceOf(Error);
    expect(console.warn).not.toHaveBeenCalled();
  });
});
