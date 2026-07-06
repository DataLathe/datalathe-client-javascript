# @datalathe/client

TypeScript client library for the [DataLathe](https://github.com/DataLathe) data processing API.

## Installation

```bash
npm install @datalathe/client
```

## Usage

The client exposes its API through sub-modules: `client.chips`, `client.queries`, `client.connections`, `client.ai`, and `client.profiler`.

```typescript
import { DatalatheClient } from "@datalathe/client";

const client = new DatalatheClient("http://localhost:3000");

// Create a chip from a database query
const chipId = await client.chips.create("my_database", "SELECT * FROM users", "users");

// Create a chip from a file
const fileChipId = await client.chips.createFromFile("/path/to/data.csv");

// Run queries against chips
const { results } = await client.queries.generateReport([chipId], ["SELECT count(*) FROM data"]);
```

## API

### `new DatalatheClient(baseUrl, options?)`

Creates a new client instance.

- `baseUrl` — Base URL of the DataLathe engine (e.g. `http://localhost:3000`)
- `options.fetch` — Custom fetch implementation
- `options.headers` — Default headers for all requests
- `options.timeout` — Request timeout in ms (default: 30000). Create-chip requests can take minutes; use a higher value (e.g. 600000 for 10 minutes) if needed.

### Chips — `client.chips`

- `create(sourceName, query, tableName, partition?, chipName?, columnReplace?, storageConfig?, streaming?, keysetColumn?)` — Creates a chip from a database source. Returns the chip ID. This operation can take several minutes for large datasets; ensure the client is constructed with a sufficient `timeout`, or use `createAsync`.
- `createFromFile(filePath, tableName?, partition?, chipName?, columnReplace?, storageConfig?)` — Creates a chip from a file (CSV, Parquet, etc.). Returns the chip ID.
- `createFromS3(s3Path, tableName?, chipName?, columnReplace?, storageConfig?, partition?)` — Creates a chip from an S3 object. Returns the chip ID.
- `createFromChip(sourceChipIds, query?, tableName?, chipName?, storageConfig?)` — Creates a new chip using existing chip(s) as the data source. Returns the chip ID.
- `createMultiple(sources, chipId?, sourceType?, chipName?, storageConfig?, tags?)` — Creates chips from multiple `SourceRequest`s. Returns the chip IDs.
- `createWithDetails(source, ...)` / `createMultipleWithDetails(sources, ...)` — Same as above but return the full `StageDataResponse` object(s).
- `createAsync(source, chipId?, sourceType?, chipName?, storageConfig?, tags?)` — Submits a chip-creation request for background processing (v1.7.12+ engines). Returns immediately with the job and chip IDs.
- `getIngestJob(jobId)` — Fetches an ingest job's status.
- `listIngestJobs({ status? })` — Lists ingest jobs, optionally filtered by status.
- `waitForIngest(jobId, { pollIntervalMs?, timeoutMs? })` — Polls an ingest job until it reaches a terminal state.
- `resumeIngestJob(jobId)` — Resumes a failed, resumable ingest job.
- `list({ limit?, offset? })` — Lists chips and their metadata.
- `get(chipId)` — Fetches a single chip (with sub-chips, metadata, and tags) by ID.
- `search(tableName?, partitionValue?, tag?)` — Searches chips by table name, partition value, and/or tag.
- `addTags(chipId, tags)` — Adds key-value tags to a chip.
- `deleteTag(chipId, key)` — Removes a tag from a chip.
- `delete(chipId)` — Deletes a chip.

Async ingest example:

```typescript
const { jobId } = await client.chips.createAsync(
  { databaseName: "my_database", tableName: "users", query: "SELECT * FROM users" },
);
const job = await client.chips.waitForIngest(jobId);
console.log(job.chipId);
```

### Queries — `client.queries`

- `generateReport(chipIds, queries, sourceType?, transformQuery?, returnTransformedQuery?, raiseOnQueryError?)` — Executes SQL queries against chip data. Returns `{ results, timing }` where `results` is a `Map` keyed by query index. Throws `DatalatheQueryError` if any query fails (pass `raiseOnQueryError: false` to inspect per-entry `error` fields instead).
- `streamReport(chipIds, query, sourceType?, transformQuery?, returnTransformedQuery?)` — Executes a single query and streams the result incrementally over NDJSON. Returns a `DatalatheStreamingResultSet` (an `AsyncIterable` of rows). Not subject to the server's result-row cap — use it for large results.
- `extractTables(query)` — Returns the table names referenced by a SQL query.
- `extractTablesWithTransform(query, transform?)` — Same, optionally returning the transformed query.
- `stageData(request)` / `postReport(request)` — Post raw stage/report request bodies (escape hatches).

Streaming example:

```typescript
const stream = await client.queries.streamReport([chipId], "SELECT * FROM data");
for await (const row of stream) {
  console.log(row);
}
```

### Connections — `client.connections`

- `list()` — Lists configured connections.
- `get(alias)` — Fetches a connection by alias.
- `upsert(alias, connection)` — Creates or updates a connection.
- `delete(alias)` — Deletes a connection.
- `test(alias)` — Tests a connection.

### AI — `client.ai`

- `registerCredential(request)` / `listCredentials()` / `deleteCredential(credentialId)` — Manage AI provider credentials.
- `registerContext(request)` / `listContexts()` / `getContext(contextId)` / `updateContext(contextId, request)` / `deleteContext(contextId)` — Manage AI contexts (chip sets plus descriptions the model can query).
- `query(request)` — Direct text-to-SQL question against a context.
- `agent(request)` — Agentic question-answering: the model explores chip data with read-only tools before answering.
- `conversation(contextId, credentialId?)` — Returns an `AiConversation` that tracks history across `ask(question, model?)` calls.
- `deleteSession(sessionId)` — Deletes a server-side AI session.

```typescript
const conversation = client.ai.conversation(contextId);
const answer = await conversation.ask("Which region had the most orders last month?");
```

### Profiler — `client.profiler`

- `getTables()` — Lists profiled tables.
- `start(skipFiles)` — Starts a profiler run.
- `getTableDescription(tableId)` / `getTableData(tableId)` / `getTableSourceFiles(tableId)` / `getTableSummary(tableId)` — Fetch per-table profiling results.
- `getConfig()` / `updateConfig(config)` — Read and update profiler configuration.
- `getSchemaMappings()` / `getSchema(request)` — Schema mapping inspection.

### Top-level methods

- `client.getDatabases()` — Lists available databases.
- `client.getDatabaseSchema(databaseName)` — Returns table and column metadata for a database.
- `client.getLicense()` / `client.putLicense(licenseKey)` — License management.
- `client.getSourceFile(fileId)` — Fetches source file details.
- `client.getAllJobs()` — Lists profiler telemetry jobs.

### Deprecated aliases

Earlier releases exposed everything as top-level methods (`client.createChip()`, `client.createChipFromFile()`, `client.generateReport()`, `client.listChips()`, ...). These remain as `@deprecated` shims that delegate to the sub-modules above, so existing code keeps working — but new code should use `client.chips.*`, `client.queries.*`, `client.connections.*`, `client.ai.*`, and `client.profiler.*` directly.

## License

MIT
