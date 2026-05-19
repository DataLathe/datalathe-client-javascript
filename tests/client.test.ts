import { describe, it, expect } from "vitest";
import { DatalatheClient } from "../src/client.js";
import { AiConversation } from "../src/ai.js";
import { DatalatheResultSet } from "../src/results/result-set.js";
import {
  ChipNotFoundError,
  DatalatheApiError,
  DatalatheStageError,
  DatalatheQueryError,
} from "../src/errors.js";
import { createMockFetch } from "./helpers.js";

describe("DatalatheClient", () => {
  it("testStageData", async () => {
    const { fetch, calls } = createMockFetch([
      { status: 200, body: { chip_id: "chip1", error: null } },
    ]);

    const client = new DatalatheClient("http://localhost:8080", {
      fetch,
    });

    const chipId = await client.chips.create(
      "test_db",
      "SELECT * FROM users",
      "test_table",
    );

    expect(chipId).toBe("chip1");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://localhost:8080/lathe/stage/data");

    // Wire format uses snake_case
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

    const { results } = await client.queries.generateReport(
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

    // Verify wire format request uses snake_case
    expect(calls).toHaveLength(1);
    const body = calls[0].body as Record<string, unknown>;
    expect(body.chip_id).toEqual(["chip1", "chip2"]);
    expect(body.source_type).toBe("CHIP");
    expect(
      (body.query_request as Record<string, unknown>).query,
    ).toEqual([
      "SELECT * FROM users",
      "SELECT * FROM orders",
    ]);
  });

  it("generateReport with raiseOnQueryError=false returns the error entry", async () => {
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

    const { results } = await client.queries.generateReport(
      ["chip1"],
      ["SELECT * FROM users"],
      undefined,
      undefined,
      undefined,
      false,
    );

    expect(results.size).toBe(1);
    expect(results.get(0)!.error).toBe("Table not found");
    expect(results.get(0)!.result).toBeNull();
  });

  it("generateReport raises DatalatheQueryError on a failed query", async () => {
    const { fetch } = createMockFetch([
      {
        status: 200,
        body: {
          result: {
            "0": {
              idx: "0",
              result: null,
              error: 'Binder Error: Referenced column "foo" not found',
              schema: null,
            },
          },
        },
      },
    ]);

    const client = new DatalatheClient("http://localhost:8080", { fetch });

    let caught: unknown;
    try {
      await client.queries.generateReport(["chip1"], ["SELECT foo FROM t"]);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(DatalatheQueryError);
    expect((caught as DatalatheQueryError).errors).toEqual(
      new Map([[0, 'Binder Error: Referenced column "foo" not found']]),
    );
  });

  it("generateReport reports every failed query", async () => {
    const { fetch } = createMockFetch([
      {
        status: 200,
        body: {
          result: {
            "0": { idx: "0", result: [["1"]], error: null, schema: null },
            "1": { idx: "1", result: null, error: "bad query", schema: null },
            "2": { idx: "2", result: null, error: "worse query", schema: null },
          },
        },
      },
    ]);

    const client = new DatalatheClient("http://localhost:8080", { fetch });

    let caught: unknown;
    try {
      await client.queries.generateReport(
        ["chip1"],
        ["SELECT 1", "SELECT bad", "SELECT worse"],
      );
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(DatalatheQueryError);
    expect((caught as DatalatheQueryError).errors).toEqual(
      new Map([
        [1, "bad query"],
        [2, "worse query"],
      ]),
    );
  });

  it("testStageDataApiError", async () => {
    const { fetch } = createMockFetch([
      { status: 500, body: { error: "Internal server error" } },
    ]);

    const client = new DatalatheClient("http://localhost:8080", {
      fetch,
    });

    await expect(
      client.chips.create("test_db", "SELECT 1", "test_table"),
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
      client.chips.create("test_db", "SELECT 1", "test_table"),
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

    const chipIds = await client.chips.createMultiple([
      {
        databaseName: "db1",
        query: "SELECT * FROM users",
        tableName: "users",
      },
      {
        databaseName: "db1",
        query: "SELECT * FROM orders",
        tableName: "orders",
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

  it("testCreateWithDetailsReturnsStreamingMetrics", async () => {
    const { fetch, calls } = createMockFetch([
      {
        status: 200,
        body: {
          chip_id: "chip1",
          error: null,
          total_rows: 1234,
          elapsed_ms: 567,
        },
      },
    ]);

    const client = new DatalatheClient("http://localhost:8080", { fetch });

    const response = await client.chips.createWithDetails({
      databaseName: "test_db",
      query: "SELECT * FROM users",
      tableName: "test_table",
      streaming: true,
    });

    expect(response.chipId).toBe("chip1");
    expect(response.totalRows).toBe(1234);
    expect(response.elapsedMs).toBe(567);
    expect(response.error).toBeNull();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://localhost:8080/lathe/stage/data");
    const body = calls[0].body as Record<string, unknown>;
    expect(body.source_type).toBe("MYSQL");
    const sourceRequest = body.source_request as Record<string, unknown>;
    expect(sourceRequest.streaming).toBe(true);
    expect(sourceRequest.database_name).toBe("test_db");
  });

  it("testCreateMultipleWithDetailsReturnsStreamingMetrics", async () => {
    const { fetch, calls } = createMockFetch([
      {
        status: 200,
        body: {
          chip_id: "chip1",
          error: null,
          total_rows: 1000,
          elapsed_ms: 250,
        },
      },
      {
        status: 200,
        body: {
          chip_id: "chip2",
          error: null,
          total_rows: 2000,
          elapsed_ms: 500,
        },
      },
    ]);

    const client = new DatalatheClient("http://localhost:8080", { fetch });

    const responses = await client.chips.createMultipleWithDetails([
      { databaseName: "db1", query: "SELECT * FROM users", tableName: "users" },
      { databaseName: "db1", query: "SELECT * FROM orders", tableName: "orders" },
    ]);

    expect(responses).toHaveLength(2);
    expect(responses[0].chipId).toBe("chip1");
    expect(responses[0].totalRows).toBe(1000);
    expect(responses[0].elapsedMs).toBe(250);
    expect(responses[1].chipId).toBe("chip2");
    expect(responses[1].totalRows).toBe(2000);
    expect(responses[1].elapsedMs).toBe(500);

    expect(calls).toHaveLength(2);
  });

  it("testGetDatabases", async () => {
    // Server returns snake_case
    const serverResponse = [
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
      { status: 200, body: serverResponse },
    ]);

    const client = new DatalatheClient("http://localhost:8080", { fetch });
    const result = await client.getDatabases();

    // Client returns camelCase
    expect(result[0].databaseName).toBe("mydb");
    expect(result[0].databaseOid).toBe(1);
    expect(result[1].databaseName).toBe("system");
    expect(result[1].internal).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "http://localhost:8080/lathe/stage/databases",
    );
    expect(calls[0].init.method).toBe("GET");
  });

  it("testGetDatabaseSchema", async () => {
    const serverResponse = [
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
      { status: 200, body: serverResponse },
    ]);

    const client = new DatalatheClient("http://localhost:8080", { fetch });
    const result = await client.getDatabaseSchema("mydb");

    expect(result[0].tableName).toBe("users");
    expect(result[0].columnName).toBe("id");
    expect(result[0].dataType).toBe("INTEGER");
    expect(result[0].isNullable).toBe("false");
    expect(result[1].columnName).toBe("name");
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
    const result = await client.chips.list();

    expect(result.chips).toHaveLength(1);
    expect(result.chips[0].chipId).toBe("chip1");
    expect(result.chips[0].tableName).toBe("users");
    expect(result.metadata).toHaveLength(1);
    expect(result.metadata[0].name).toBe("users_chip");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://localhost:8080/lathe/chips");
    expect(calls[0].init.method).toBe("GET");
  });

  it("testListChipsSurfacesUnreadableChipIds", async () => {
    const chipsResponse = {
      chips: [
        {
          chip_id: "good-1",
          sub_chip_id: "sub-1",
          table_name: "users",
          partition_value: "default",
          created_at: 1700000000,
        },
      ],
      metadata: [],
      unreadable_chip_ids: ["bad-1", "bad-2"],
    };

    const { fetch } = createMockFetch([
      { status: 200, body: chipsResponse },
    ]);

    const client = new DatalatheClient("http://localhost:8080", { fetch });
    const result = await client.chips.list();

    expect(result.chips).toHaveLength(1);
    expect(result.chips[0].chipId).toBe("good-1");
    expect(result.unreadableChipIds).toEqual(["bad-1", "bad-2"]);
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

    await client.chips.create("db", "SELECT 1", "t");

    expect(calls[0].url).toBe(
      "http://localhost:8080/lathe/stage/data",
    );
  });

  it("testAiQueryWithSessionId", async () => {
    const serverResponse = {
      request_id: "req1",
      explanation: "Total revenue is $1M",
      generated_sql: "SELECT SUM(revenue) FROM sales",
      assistant_turn: { role: "assistant", content: "Total revenue is $1M" },
      session_id: "sess-abc",
    };

    const { fetch, calls } = createMockFetch([
      { status: 200, body: serverResponse },
    ]);

    const client = new DatalatheClient("http://localhost:8080", { fetch });
    const result = await client.ai.query({
      contextId: "ctx1",
      credentialId: "cred1",
      userQuestion: "What is total revenue?",
      sessionId: "sess-abc",
    });

    expect(result.sessionId).toBe("sess-abc");
    expect(result.assistantTurn).toEqual({ role: "assistant", content: "Total revenue is $1M" });

    const body = calls[0].body as Record<string, unknown>;
    expect(body.session_id).toBe("sess-abc");
    expect(body.context_id).toBe("ctx1");
  });

  it("testAiConversationHelper", async () => {
    const response1 = {
      request_id: "req1",
      explanation: "Revenue is $1M",
      assistant_turn: { role: "assistant", content: "Revenue is $1M" },
    };
    const response2 = {
      request_id: "req2",
      explanation: "By region: US $600K, EU $400K",
      assistant_turn: { role: "assistant", content: "By region: US $600K, EU $400K" },
    };

    const { fetch, calls } = createMockFetch([
      { status: 200, body: response1 },
      { status: 200, body: response2 },
    ]);

    const client = new DatalatheClient("http://localhost:8080", { fetch });
    const conversation = client.ai.conversation("ctx1", "cred1");

    expect(conversation).toBeInstanceOf(AiConversation);

    const r1 = await conversation.ask("What is total revenue?");
    expect(r1.explanation).toBe("Revenue is $1M");

    // First call should have no conversation history
    const body1 = calls[0].body as Record<string, unknown>;
    expect(body1.conversation_history).toBeUndefined();

    const r2 = await conversation.ask("Break that down by region");
    expect(r2.explanation).toBe("By region: US $600K, EU $400K");

    // Second call should include history from first exchange
    const body2 = calls[1].body as Record<string, unknown>;
    expect(body2.conversation_history).toEqual([
      { role: "user", content: "What is total revenue?" },
      { role: "assistant", content: "Revenue is $1M" },
    ]);

    // History should now have 4 turns
    const history = conversation.getHistory();
    expect(history).toHaveLength(4);
    expect(history[0]).toEqual({ role: "user", content: "What is total revenue?" });
    expect(history[3]).toEqual({ role: "assistant", content: "By region: US $600K, EU $400K" });
  });

  it("testAiConversationClear", async () => {
    const response = {
      request_id: "req1",
      explanation: "Answer",
      assistant_turn: { role: "assistant", content: "Answer" },
    };

    const { fetch } = createMockFetch([
      { status: 200, body: response },
      { status: 200, body: response },
    ]);

    const client = new DatalatheClient("http://localhost:8080", { fetch });
    const conversation = client.ai.conversation("ctx1", "cred1");

    await conversation.ask("Question 1");
    expect(conversation.getHistory()).toHaveLength(2);

    conversation.clear();
    expect(conversation.getHistory()).toHaveLength(0);
  });

  it("testDeleteAiSession", async () => {
    const { fetch, calls } = createMockFetch([
      { status: 200, body: {} },
    ]);

    const client = new DatalatheClient("http://localhost:8080", { fetch });
    await client.ai.deleteSession("sess-abc");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://localhost:8080/lathe/ai/sessions/sess-abc");
    expect(calls[0].init.method).toBe("DELETE");
  });

  it("testAiQueryWithoutCredentialId", async () => {
    const serverResponse = {
      request_id: "req1",
      explanation: "Answer",
      session_id: "sess-abc",
    };

    const { fetch, calls } = createMockFetch([
      { status: 200, body: serverResponse },
    ]);

    const client = new DatalatheClient("http://localhost:8080", { fetch });
    const result = await client.ai.query({
      contextId: "ctx1",
      userQuestion: "Question",
      sessionId: "sess-abc",
    });

    expect(result.sessionId).toBe("sess-abc");

    // credential_id should not be in the wire body
    const body = calls[0].body as Record<string, unknown>;
    expect(body.credential_id).toBeUndefined();
    expect(body.context_id).toBe("ctx1");
  });

  it("throws ChipNotFoundError on 404 with chip_not_found body", async () => {
    const { fetch } = createMockFetch([
      {
        status: 404,
        body: {
          error: "Chip 'abc123' is not available (may have expired)",
          error_code: "chip_not_found",
          chip_id: "abc123",
        },
      },
    ]);

    const client = new DatalatheClient("http://localhost:8080", { fetch });

    await expect(
      client.queries.generateReport(["abc123"], ["SELECT 1"]),
    ).rejects.toMatchObject({
      name: "ChipNotFoundError",
      chipId: "abc123",
      statusCode: 404,
    });
  });

  it("ChipNotFoundError is catchable as DatalatheApiError (back-compat)", async () => {
    const { fetch } = createMockFetch([
      {
        status: 404,
        body: {
          error: "Chip 'xyz' is not available",
          error_code: "chip_not_found",
          chip_id: "xyz",
        },
      },
    ]);

    const client = new DatalatheClient("http://localhost:8080", { fetch });

    let caught: unknown;
    try {
      await client.queries.generateReport(["xyz"], ["SELECT 1"]);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ChipNotFoundError);
    expect(caught).toBeInstanceOf(DatalatheApiError);
  });

  it("falls back to DatalatheApiError on 404 without chip_not_found code", async () => {
    const { fetch } = createMockFetch([
      { status: 404, body: { error: "Some other 404" } },
    ]);

    const client = new DatalatheClient("http://localhost:8080", { fetch });

    let caught: unknown;
    try {
      await client.queries.generateReport(["abc"], ["SELECT 1"]);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(DatalatheApiError);
    expect(caught).not.toBeInstanceOf(ChipNotFoundError);
  });

  it("registerCredential sends region for bedrock", async () => {
    const { fetch, calls } = createMockFetch([
      {
        status: 200,
        body: {
          credential_id: "cred1",
          name: "bedrock-prod",
          provider: "bedrock",
          default_model: "anthropic.claude-sonnet-4-5-20250929-v1:0",
          created_at: 1,
          region: "us-west-2",
        },
      },
    ]);

    const client = new DatalatheClient("http://localhost:8080", { fetch });
    const cred = await client.ai.registerCredential({
      name: "bedrock-prod",
      provider: "bedrock",
      apiKey: "secret",
      defaultModel: "anthropic.claude-sonnet-4-5-20250929-v1:0",
      region: "us-west-2",
    });

    expect(cred.region).toBe("us-west-2");
    const body = calls[0].body as Record<string, unknown>;
    expect(body.region).toBe("us-west-2");
    expect(body.default_model).toBe("anthropic.claude-sonnet-4-5-20250929-v1:0");
    expect(body.api_key).toBe("secret");
  });

  it("registerCredential omits region when not provided", async () => {
    const { fetch, calls } = createMockFetch([
      {
        status: 200,
        body: {
          credential_id: "cred1",
          name: "anthropic-prod",
          provider: "anthropic",
          default_model: "claude-sonnet-4-5-20250929",
          created_at: 1,
        },
      },
    ]);

    const client = new DatalatheClient("http://localhost:8080", { fetch });
    await client.ai.registerCredential({
      name: "anthropic-prod",
      provider: "anthropic",
      apiKey: "secret",
      defaultModel: "claude-sonnet-4-5-20250929",
    });

    const body = calls[0].body as Record<string, unknown>;
    expect(body.region).toBeUndefined();
  });

  it("agent posts to /lathe/ai/agent and parses full response", async () => {
    const serverResponse = {
      request_id: "req1",
      answer: "LATAM had the highest growth at 23%.",
      attachments: [
        {
          caption: "Growth by region",
          sql: "SELECT region, growth FROM sales",
          data: {
            columns: [
              { name: "region", data_type: "Utf8" },
              { name: "growth", data_type: "Float64" },
            ],
            rows: [["LATAM", "0.23"]],
          },
          visualization: {
            type: "bar",
            x_axis: "region",
            y_axis: "growth",
          },
        },
      ],
      tool_calls: [
        {
          iteration: 1,
          tool: "list_tables",
          args: {},
          result_summary: "Found 3 tables",
          duration_ms: 12,
          is_error: false,
        },
      ],
      narration: [
        { kind: "assistant_text", iteration: 1, text: "Let me look at the tables." },
      ],
      session_id: "sess-abc",
      stop_reason: "end_turn",
      usage: {
        input_tokens: 1500,
        output_tokens: 200,
        model: "claude-sonnet-4-5-20250929",
        iterations: 2,
        tool_calls: 1,
      },
    };

    const { fetch, calls } = createMockFetch([{ status: 200, body: serverResponse }]);

    const client = new DatalatheClient("http://localhost:8080", { fetch });
    const result = await client.ai.agent({
      contextId: "ctx1",
      credentialId: "cred1",
      userQuestion: "Which region had the highest growth?",
      sessionId: "sess-abc",
      agentOptions: { maxIterations: 5, runSqlRowCap: 1000 },
    });

    expect(calls[0].url).toBe("http://localhost:8080/lathe/ai/agent");
    expect(result.requestId).toBe("req1");
    expect(result.answer).toBe("LATAM had the highest growth at 23%.");
    expect(result.stopReason).toBe("end_turn");
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].caption).toBe("Growth by region");
    expect(result.attachments[0].visualization?.xAxis).toBe("region");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].iteration).toBe(1);
    expect(result.toolCalls[0].resultSummary).toBe("Found 3 tables");
    expect(result.toolCalls[0].isError).toBe(false);
    expect(result.narration[0].kind).toBe("assistant_text");
    expect(result.usage?.toolCalls).toBe(1);
    expect(result.usage?.inputTokens).toBe(1500);

    const body = calls[0].body as Record<string, unknown>;
    expect(body.context_id).toBe("ctx1");
    expect(body.user_question).toBe("Which region had the highest growth?");
    expect(body.credential_id).toBe("cred1");
    expect(body.session_id).toBe("sess-abc");
    const opts = body.agent_options as Record<string, unknown>;
    expect(opts.max_iterations).toBe(5);
    expect(opts.run_sql_row_cap).toBe(1000);
    expect(opts.max_tool_calls).toBeUndefined();
  });

  it("stageData sends streaming and partition_column on wire", async () => {
    const { fetch, calls } = createMockFetch([
      { status: 200, body: { chip_id: "chip1", error: null } },
    ]);

    const client = new DatalatheClient("http://localhost:8080", { fetch });
    await client.chips.create(
      "test_db",
      "SELECT * FROM orders",
      "orders",
      undefined,
      undefined,
      undefined,
      undefined,
      true,
      "id",
    );

    const body = calls[0].body as Record<string, unknown>;
    const sr = body.source_request as Record<string, unknown>;
    expect(sr.streaming).toBe(true);
    expect(sr.partition_column).toBe("id");
  });

  it("stageData omits streaming and partition_column when not set", async () => {
    const { fetch, calls } = createMockFetch([
      { status: 200, body: { chip_id: "chip1", error: null } },
    ]);

    const client = new DatalatheClient("http://localhost:8080", { fetch });
    await client.chips.create("test_db", "SELECT 1", "t");

    const body = calls[0].body as Record<string, unknown>;
    const sr = body.source_request as Record<string, unknown>;
    expect(sr.streaming).toBeUndefined();
    expect(sr.partition_column).toBeUndefined();
  });

  it("agent omits agent_options when not provided", async () => {
    const { fetch, calls } = createMockFetch([
      {
        status: 200,
        body: {
          request_id: "req1",
          answer: "ok",
          attachments: [],
          tool_calls: [],
          narration: [],
        },
      },
    ]);

    const client = new DatalatheClient("http://localhost:8080", { fetch });
    await client.ai.agent({
      contextId: "ctx1",
      userQuestion: "Hi",
    });

    const body = calls[0].body as Record<string, unknown>;
    expect(body.agent_options).toBeUndefined();
    expect(body.credential_id).toBeUndefined();
  });

  it("agent surfaces ChipNotFoundError on 404", async () => {
    const { fetch } = createMockFetch([
      {
        status: 404,
        body: {
          error: "Chip 'lost' is not available (may have expired)",
          error_code: "chip_not_found",
          chip_id: "lost",
        },
      },
    ]);

    const client = new DatalatheClient("http://localhost:8080", { fetch });
    await expect(
      client.ai.agent({ contextId: "ctx1", userQuestion: "Q" }),
    ).rejects.toMatchObject({
      name: "ChipNotFoundError",
      chipId: "lost",
      statusCode: 404,
    });
  });
});
