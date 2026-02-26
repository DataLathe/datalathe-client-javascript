import { describe, it, expect } from "vitest";
import { DatalatheClient } from "../src/client.js";
import { DatalatheResultSet } from "../src/results/result-set.js";
import { DatalatheApiError, DatalatheStageError } from "../src/errors.js";
import { createMockFetch } from "./helpers.js";

describe("DatalatheClient", () => {
  it("testStageData", async () => {
    const { fetch, calls } = createMockFetch([
      { status: 200, body: { chip_id: "chip1", error: null } },
    ]);

    const client = new DatalatheClient("http://localhost:8080", {
      fetch,
    });

    const chipId = await client.createChip(
      "test_db",
      "SELECT * FROM users",
      "test_table",
    );

    expect(chipId).toBe("chip1");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://localhost:8080/lathe/stage/data");

    const body = calls[0].body as Record<string, unknown>;
    expect(body.source_type).toBe("MYSQL");
    expect(
      (body.source_request as Record<string, unknown>).query,
    ).toBe("SELECT * FROM users");
    expect(
      (body.source_request as Record<string, unknown>).database_name,
    ).toBe("test_db");
    expect(
      (body.source_request as Record<string, unknown>).table_name,
    ).toBe("test_table");
  });

  it("testQuery", async () => {
    const responseJson = {
      result: {
        "0": {
          result: [
            ["user1", "172"],
            ["user2", "173"],
          ],
          schema: [
            { name: "id", data_type: "Utf8" },
            { name: "companyId", data_type: "Int32" },
          ],
          error: null,
        },
        "1": {
          result: [
            ["order1", "100"],
            ["order2", "200"],
          ],
          schema: [
            { name: "id", data_type: "Utf8" },
            { name: "amount", data_type: "Int32" },
          ],
          error: null,
        },
      },
    };

    const { fetch, calls } = createMockFetch([
      { status: 200, body: responseJson },
    ]);

    const client = new DatalatheClient("http://localhost:8080", {
      fetch,
    });

    const { results } = await client.generateReport(
      ["chip1", "chip2"],
      ["SELECT * FROM users", "SELECT * FROM orders"],
    );

    expect(results.size).toBe(2);

    // Verify first result set
    const rs1 = new DatalatheResultSet(results.get(0)!);
    expect(rs1.next()).toBe(true);
    expect(rs1.getString(1)).toBe("user1");
    expect(rs1.getInt(2)).toBe(172);
    expect(rs1.next()).toBe(true);
    expect(rs1.getString(1)).toBe("user2");
    expect(rs1.getInt(2)).toBe(173);
    expect(rs1.next()).toBe(false);

    // Verify second result set
    const rs2 = new DatalatheResultSet(results.get(1)!);
    expect(rs2.next()).toBe(true);
    expect(rs2.getString(1)).toBe("order1");
    expect(rs2.getInt(2)).toBe(100);
    expect(rs2.next()).toBe(true);
    expect(rs2.getString(1)).toBe("order2");
    expect(rs2.getInt(2)).toBe(200);
    expect(rs2.next()).toBe(false);

    // Verify request
    expect(calls).toHaveLength(1);
    const body = calls[0].body as Record<string, unknown>;
    expect(body.chip_id).toEqual(["chip1", "chip2"]);
    expect(body.source_type).toBe("LOCAL");
    expect(
      (body.query_request as Record<string, unknown>).query,
    ).toEqual([
      "SELECT * FROM users",
      "SELECT * FROM orders",
    ]);
  });

  it("testQueryWithError", async () => {
    const responseJson = {
      result: {
        "0": {
          error: "Table not found",
          result: null,
          schema: null,
        },
      },
    };

    const { fetch } = createMockFetch([
      { status: 200, body: responseJson },
    ]);

    const client = new DatalatheClient("http://localhost:8080", {
      fetch,
    });

    const { results } = await client.generateReport(
      ["chip1"],
      ["SELECT * FROM users"],
    );

    // Result entry is present but contains the error
    expect(results.size).toBe(1);
    expect(results.get(0)!.error).toBe("Table not found");
    expect(results.get(0)!.result).toBeNull();
  });

  it("testStageDataApiError", async () => {
    const { fetch } = createMockFetch([
      { status: 500, body: { error: "Internal server error" } },
    ]);

    const client = new DatalatheClient("http://localhost:8080", {
      fetch,
    });

    await expect(
      client.createChip("test_db", "SELECT 1", "test_table"),
    ).rejects.toThrow(DatalatheApiError);
  });

  it("testStageDataWithStageError", async () => {
    const { fetch } = createMockFetch([
      {
        status: 200,
        body: { chip_id: null, error: "Source not found" },
      },
    ]);

    const client = new DatalatheClient("http://localhost:8080", {
      fetch,
    });

    await expect(
      client.createChip("test_db", "SELECT 1", "test_table"),
    ).rejects.toThrow(DatalatheStageError);
  });

  it("testCreateChipsMultipleSources", async () => {
    const { fetch, calls } = createMockFetch([
      { status: 200, body: { chip_id: "chip1", error: null } },
      { status: 200, body: { chip_id: "chip2", error: null } },
    ]);

    const client = new DatalatheClient("http://localhost:8080", {
      fetch,
    });

    const chipIds = await client.createChips([
      {
        database_name: "db1",
        query: "SELECT * FROM users",
        table_name: "users",
      },
      {
        database_name: "db1",
        query: "SELECT * FROM orders",
        table_name: "orders",
      },
    ]);

    expect(chipIds).toEqual(["chip1", "chip2"]);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe(
      "http://localhost:8080/lathe/stage/data",
    );
    expect(calls[1].url).toBe(
      "http://localhost:8080/lathe/stage/data",
    );
  });

  it("testGetDatabases", async () => {
    const databases = [
      {
        database_name: "mydb",
        database_oid: 1,
        path: "/tmp/mydb",
        internal: false,
        type: "datalathe",
        readonly: false,
      },
      {
        database_name: "system",
        database_oid: 2,
        internal: true,
        type: "duckdb",
        readonly: true,
      },
    ];

    const { fetch, calls } = createMockFetch([
      { status: 200, body: databases },
    ]);

    const client = new DatalatheClient("http://localhost:8080", { fetch });
    const result = await client.getDatabases();

    expect(result).toEqual(databases);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "http://localhost:8080/lathe/stage/databases",
    );
    expect(calls[0].init.method).toBe("GET");
  });

  it("testGetDatabaseSchema", async () => {
    const schema = [
      {
        table_name: "users",
        schema_name: "main",
        column_name: "id",
        data_type: "INTEGER",
        is_nullable: "false",
        ordinal_position: 1,
      },
      {
        table_name: "users",
        schema_name: "main",
        column_name: "name",
        data_type: "VARCHAR",
        is_nullable: "true",
        ordinal_position: 2,
      },
    ];

    const { fetch, calls } = createMockFetch([
      { status: 200, body: schema },
    ]);

    const client = new DatalatheClient("http://localhost:8080", { fetch });
    const result = await client.getDatabaseSchema("mydb");

    expect(result).toEqual(schema);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "http://localhost:8080/lathe/stage/schema/mydb",
    );
    expect(calls[0].init.method).toBe("GET");
  });

  it("testListChips", async () => {
    const chipsResponse = {
      chips: [
        {
          chip_id: "chip1",
          sub_chip_id: "sub1",
          table_name: "users",
          partition_value: "default",
          created_at: 1700000000,
        },
      ],
      metadata: [
        {
          chip_id: "chip1",
          query: "SELECT * FROM users",
          created_at: 1700000000,
          description: "User data",
          name: "users_chip",
        },
      ],
    };

    const { fetch, calls } = createMockFetch([
      { status: 200, body: chipsResponse },
    ]);

    const client = new DatalatheClient("http://localhost:8080", { fetch });
    const result = await client.listChips();

    expect(result.chips).toHaveLength(1);
    expect(result.chips[0].chip_id).toBe("chip1");
    expect(result.metadata).toHaveLength(1);
    expect(result.metadata[0].name).toBe("users_chip");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://localhost:8080/lathe/chips");
    expect(calls[0].init.method).toBe("GET");
  });

  it("testGetApiError", async () => {
    const { fetch } = createMockFetch([
      { status: 404, body: { error: "Not found" } },
    ]);

    const client = new DatalatheClient("http://localhost:8080", { fetch });

    await expect(client.getDatabases()).rejects.toThrow(DatalatheApiError);
  });

  it("testTrailingSlashStripped", async () => {
    const { fetch, calls } = createMockFetch([
      { status: 200, body: { chip_id: "chip1", error: null } },
    ]);

    const client = new DatalatheClient(
      "http://localhost:8080/",
      { fetch },
    );

    await client.createChip("db", "SELECT 1", "t");

    expect(calls[0].url).toBe(
      "http://localhost:8080/lathe/stage/data",
    );
  });
});
