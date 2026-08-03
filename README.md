# @datalathe/client

TypeScript client library for the [DataLathe](https://github.com/DataLathe) data processing API.

## Installation

```bash
npm install @datalathe/client
```

## Quick start

```typescript
import { DatalatheClient } from "@datalathe/client";

const client = new DatalatheClient("http://localhost:3000", { timeout: 600000 });

// Create a chip (a portable data unit) from a file
const chipId = await client.chips.createFromFile("/path/to/data.csv", "users");

// Run SQL against it
const { results } = await client.queries.generateReport(
  [chipId],
  ["SELECT count(*) AS n FROM users"],
);
console.log(results.get(0)?.result);
```

### `new DatalatheClient(baseUrl, options?)`

- `baseUrl` — Base URL of the DataLathe engine (e.g. `http://localhost:3000`)
- `options.fetch` — Custom fetch implementation
- `options.headers` — Default headers for all requests
- `options.timeout` — Request timeout in ms (default: 30000). Chip creation can take minutes for large datasets; raise this (e.g. `600000`) when creating chips synchronously.

The API is grouped into namespaces on the client instance: `client.chips`, `client.queries`, `client.connections`, `client.ai`, and `client.profiler`, plus a few top-level methods.

## Top-level methods

| Method | Description |
|---|---|
| `getVersion()` | Engine version, e.g. `{ version: "1.9.0" }` |
| `getDatabases()` | Lists databases attached to the engine |
| `getDatabaseSchema(databaseName)` | Table and column metadata for a database |
| `getLicense()` / `putLicense(licenseKey)` | Read / install the engine license |
| `getSourceFile(fileId)` | Details for a profiled source file |
| `getAllJobs()` | Profiler job telemetry, keyed by job ID |

## `client.chips` — create and manage chips

| Method | Description |
|---|---|
| `create(sourceName, query, tableName, partition?, chipName?, columnReplace?, storageConfig?, streaming?, keysetColumn?)` | Create a chip from a MySQL source; returns the chip ID |
| `createFromFile(filePath, tableName?, partition?, chipName?, columnReplace?, storageConfig?)` | Create a chip from a local file (CSV, Parquet, etc.) |
| `createFromS3(s3Path, tableName?, chipName?, columnReplace?, storageConfig?, partition?)` | Create a chip from an S3 object |
| `createFromChip(sourceChipIds, query?, tableName?, chipName?, storageConfig?)` | Derive a new chip from existing chip(s) |
| `createMultiple(sources, chipId?, sourceType?, chipName?, storageConfig?, tags?)` | Create chips from multiple `SourceRequest`s; returns chip IDs |
| `createWithDetails(source, ...)` / `createMultipleWithDetails(sources, ...)` | Same, returning full responses (row counts, timings on streaming ingests) |
| `createAsync(source, chipId?, sourceType?, chipName?, storageConfig?, tags?)` | Submit ingest for background processing (engine 1.7.12+); returns `{ jobId, chipId }` |
| `getIngestJob(jobId)` / `listIngestJobs({ status? })` | Inspect async ingest jobs |
| `waitForIngest(jobId, { pollIntervalMs?, timeoutMs? })` | Poll until the job reaches a terminal state |
| `resumeIngestJob(jobId)` | Resume a failed, checkpointed ingest job |
| `list({ limit?, offset? })` | List chips with metadata and tags (paginated) |
| `get(chipId)` | Fetch one chip; throws `ChipNotFoundError` when absent |
| `search(tableName?, partitionValue?, tag?)` | Search chips by table, partition value, or `key:value` tag (e.g. `env:production`) |
| `query(chipIds, query)` | Run one read-only SQL statement against the chips' raw catalogs (`s_<sub_chip_id>.main.<table>`, engine 1.11+); returns `{ columns, rows, truncated }`, capped by the engine's `max_result_rows` |
| `addTags(chipId, tags)` / `deleteTag(chipId, key)` | Manage chip tags |
| `delete(chipId)` | Delete a chip |

Async ingest of a large MySQL table:

```typescript
const { jobId } = await client.chips.createAsync({
  databaseName: "prod",
  tableName: "orders",
  query: "SELECT * FROM orders",
  streaming: true,
  keysetColumn: "id",
});
const job = await client.chips.waitForIngest(jobId, { timeoutMs: 1800000 });
console.log(job.rowsIngested);
```

## `client.queries` — run SQL against chips

| Method | Description |
|---|---|
| `generateReport(chipIds, queries, sourceType?, transformQuery?, returnTransformedQuery?, raiseOnQueryError?)` | Execute one or more queries; returns `{ results, timing }` where `results` maps query index to rows + schema. Throws `DatalatheQueryError` on per-query failures unless `raiseOnQueryError` is `false` |
| `streamReport(chipIds, query, sourceType?, transformQuery?, returnTransformedQuery?)` | Execute a single query and stream rows incrementally (NDJSON); not subject to the server's row cap — use it for large results |
| `extractTables(query)` / `extractTablesWithTransform(query, transform?)` | List table names referenced by a query, optionally with the transformed query |
| `stageData(request)` / `postReport(request)` | Raw request passthrough for advanced use |

Streaming a large result:

```typescript
const resultSet = await client.queries.streamReport([chipId], "SELECT * FROM orders");
const schema = await resultSet.getSchema();
for await (const row of resultSet) {
  // row is an object keyed by column name, e.g. row.order_id
}
console.log(resultSet.getRowCount(), resultSet.getTiming());
```

`streamReport` accepts exactly one query; use `generateReport` for multi-query batches. A streaming result set can only be iterated once.

## `client.connections` — saved database connections

| Method | Description |
|---|---|
| `list()` / `get(alias)` | List saved connections / fetch one |
| `upsert(alias, { host, port, database, user, password })` | Create or update a connection |
| `test(alias)` | Test connectivity |
| `reattach(alias)` | Re-attach from stored config (engine 1.9.1+) |
| `delete(alias)` | Remove a connection |

```typescript
await client.connections.upsert("prod", {
  host: "db.internal",
  port: "3306",
  database: "prod",
  user: "reader",
  password: process.env.DB_PASSWORD!,
});
await client.connections.test("prod");
```

## `client.ai` — natural-language queries over chips

| Method | Description |
|---|---|
| `registerCredential({ name, provider, apiKey, defaultModel, region? })` | Store an LLM provider credential (`region` required for Bedrock) |
| `listCredentials()` / `deleteCredential(credentialId)` | Manage credentials |
| `registerContext({ name, chipIds, columnDescriptions, dataRelationshipPrompt })` | Define which chips a question can see, with schema hints |
| `listContexts()` / `getContext(id)` / `updateContext(id, patch)` / `deleteContext(id)` | Manage contexts |
| `query({ contextId, userQuestion, credentialId?, sessionId?, conversationHistory?, model? })` | Direct text-to-SQL; returns data, generated SQL, explanation, and an optional visualization hint |
| `agent({ contextId, userQuestion, ..., agentOptions? })` | Multi-step agent mode: the model explores chip data with read-only tools before answering |
| `conversation(contextId, credentialId?)` | Stateful helper that tracks history; call `.ask(question)` repeatedly |
| `deleteSession(sessionId)` | Discard a server-side session |

```typescript
const context = await client.ai.registerContext({
  name: "sales",
  chipIds: [chipId],
  columnDescriptions: { orders: { total: "Order total in USD" } },
  dataRelationshipPrompt: "Each row in orders is one purchase.",
});

const answer = await client.ai.query({
  contextId: context.contextId,
  userQuestion: "What were total sales last month?",
});
console.log(answer.explanation, answer.generatedSql, answer.data?.rows);
```

## `client.profiler` — data profiling

| Method | Description |
|---|---|
| `start(skipFiles)` | Kick off a profiling run |
| `getTables()` | Profiled tables with size and column counts |
| `getTableDescription(tableId)` / `getTableData(tableId)` / `getTableSummary(tableId)` / `getTableSourceFiles(tableId)` | Per-table profiling detail |
| `getConfig()` / `updateConfig(config)` | Read / update profiler configuration |
| `getSchemaMappings()` / `getSchema(request)` | Schema mapping inspection |

## Deprecated flat methods

Earlier releases exposed everything directly on the client (`client.createChip(...)`, `client.generateReport(...)`, `client.listConnections(...)`, ...). These still work as thin aliases that forward to the namespaced methods above, but they are `@deprecated` — new code should use the namespaced API.

## License

MIT
