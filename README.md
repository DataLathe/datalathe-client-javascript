# @datalathe/client

TypeScript client library for the [DataLathe](https://github.com/DataLathe) data processing API.

## Installation

```bash
npm install @datalathe/client
```

## Usage

```typescript
import { DatalatheClient } from "@datalathe/client";

const client = new DatalatheClient("http://localhost:3000");

// Create a chip from a database query
const chipId = await client.createChip("my_database", "SELECT * FROM users", "users");

// Create a chip from a file
const fileChipId = await client.createChipFromFile("/path/to/data.csv");

// Run queries against chips
const results = await client.generateReport([chipId], ["SELECT count(*) FROM data"]);
```

## API

### `new DatalatheClient(baseUrl, options?)`

Creates a new client instance.

- `baseUrl` — Base URL of the DataLathe engine (e.g. `http://localhost:3000`)
- `options.fetch` — Custom fetch implementation
- `options.headers` — Default headers for all requests
- `options.timeout` — Request timeout in ms (default: 30000). Create-chip requests can take minutes; use a higher value (e.g. 600000 for 10 minutes) if needed.

### `client.createChip(sourceName, query, tableName, partition?)`

Creates a chip from a database source. Returns the chip ID. This operation can take several minutes for large datasets; ensure the client is constructed with a sufficient `timeout`.

### `client.createChipFromFile(filePath, tableName?, partition?)`

Creates a chip from a file (CSV, Parquet, etc.). Returns the chip ID.

### `client.generateReport(chipIds, queries)`

Executes SQL queries against chip data. Returns a map of results.

### `client.getDatabases()`

Lists available databases.

### `client.getDatabaseSchema(databaseName)`

Returns table and column metadata for a database.

### `client.listChips()`

Lists all chips and their metadata.

## License

MIT
