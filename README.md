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
- `options.retryOn429` — Retry requests rejected with HTTP 429 (default: `true`)
- `options.maxRetries` — Maximum number of 429 retries after the initial attempt (default: `3`)

When the engine sheds load it returns HTTP 429 with a `Retry-After` header, having done no work on the request, so the client transparently retries 429 responses for every method (up to 3 attempts by default, honoring `Retry-After`, with exponential backoff when the header is absent). Network errors are never retried. If retries are exhausted, the final 429 surfaces as a normal `DatalatheApiError`.

The API is grouped into namespaces on the client instance: `client.chips`, `client.queries`, `client.connections`, `client.ai`, and `client.profiler`, plus a few top-level methods.

## Top-level methods

| Method | Description |
|---|---|
| `getVersion()` | Engine version, e.g. `{ version: "1.15.0" }` |
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

## Chip resolution — find-or-create chips for reports

`ChipResolver` automates the find-or-create chip workflow for reports. Given the tables a report needs (or SQL queries to parse), partition values, and a tag for tenant isolation, it searches for existing chips, creates only the missing ones in parallel (deduplicating concurrent requests for the same chip), and tags new chips so future runs find them. Create one resolver per application and share it — if two concurrent resolves both need the same chip, only one API call is made.

| Method | Description |
|---|---|
| `new ChipResolver(client, options?)` | `options.timeoutMs` — per-chip creation timeout in ms (default: 10 minutes); `options.emptyRecheckMinutes` — how long an empty-source create failure is remembered before the resolver retries it (default: 30; 0 disables the cache) |
| `resolve(reportQueries, partitionValues, tagKey, tagValue, factory, transform?)` | Extract table names from the SQL queries via `extractTables()` (transforming MySQL/MariaDB syntax first when `transform` is `true`), then resolve |
| `resolveForTables(tables, partitionValues, tagKey, tagValue, factory)` | Resolve chips for known table names |
| `inflightCount()` | Number of chip creations currently in flight |

You supply a `ChipFactory` that tells the resolver which tables are partitioned (one chip per partition value, e.g. monthly snapshots) versus unpartitioned (one chip total, e.g. reference data), and how to build each chip's source — a `ChipSourceRequest`, which is a `SourceRequest` plus the `sourceType` to stage it as:

```typescript
import { ChipResolver, SourceType, type ChipFactory } from "@datalathe/client";

const resolver = new ChipResolver(client);

const factory: ChipFactory = {
  isPartitioned: (table) => table === "orders",
  buildSource: (table, partitionValue) => ({
    sourceType: SourceType.MYSQL,
    databaseName: "prod",
    tableName: table,
    query:
      partitionValue === null
        ? `SELECT * FROM ${table}`
        : `SELECT * FROM ${table} WHERE month = '${partitionValue}'`,
    partition:
      partitionValue === null
        ? undefined
        : { partitionBy: "month", partitionValues: [partitionValue] },
  }),
};

// From SQL — table names are extracted automatically
const chips = await resolver.resolve(
  ["SELECT u.name, o.total FROM users u JOIN orders o ON u.id = o.user_id"],
  ["2026-01", "2026-02"],
  "tenant", "42",
  factory,
);

// Or from known table names
const fromTables = await resolver.resolveForTables(
  ["users", "orders"],
  ["2026-01", "2026-02"],
  "tenant", "42",
  factory,
);

await client.queries.generateReport(chips.allChipIds(), [
  "SELECT month, sum(total) AS total FROM orders GROUP BY month",
]);
```

The result is a `ResolvedChips` with `unpartitionedIds` and `partitionedIds`; `allChipIds()` concatenates both. Resolution is incremental: the first run for a 13-month trend report creates all chips, subsequent runs find them via search and create nothing, and when the window slides forward a month only the single new chip per partitioned table is created.

When a create fails because the source has no rows (the engine's `EMPTY_SOURCE` error code, or the older "No partitions to register" failure on engines that predate it), the resolver logs one info line and skips re-creating that chip on subsequent resolves until the `emptyRecheckMinutes` window elapses. A cached entry clears as soon as a create succeeds or a search finds a chip for that key.

### Freshness tags

Chips are snapshots of their source; by default the resolver serves a found chip forever. A factory can opt a table into staleness tracking by implementing the optional `freshnessTags(table)` hook, returning the tag entries the table's chips are expected to carry (or `null`/`undefined`/empty when its chips never go stale):

```typescript
const factory: ChipFactory = {
  // ...isPartitioned and buildSource as above...
  freshnessTags: (table) =>
    table === "orders" ? { load_date: currentLoadDate } : null,
};
```

When non-empty, the resolver stamps these tags on every chip it creates for the table (atomically with creation, alongside the tenant tag) and, on each resolve, deletes any existing chip whose tags are missing an entry or carry a different value — the replacement is created in the same pass. Semantics are equality-only by design: encode each staleness dimension as its own entry (e.g. a schema version, a load-generation date) and change the value when chips staged under the old value must be rebuilt.

Caveats: the hook is called once per table on every resolve, so return precomputed values — dynamic values belong in the factory's constructor, computed once per request. A freshness tag key that collides with the tenant `tagKey` throws. A chip for the table created by any other writer without these tags is treated as stale and deleted, and on a partitioned table a value change evicts every partition's chip at once, so the next resolve re-stages all of them.

## Deprecated flat methods

Earlier releases exposed everything directly on the client (`client.createChip(...)`, `client.generateReport(...)`, `client.listConnections(...)`, ...). These still work as thin aliases that forward to the namespaced methods above, but they are `@deprecated` — new code should use the namespaced API.

## License

MIT
