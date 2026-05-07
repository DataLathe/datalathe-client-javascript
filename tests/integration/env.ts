const DATALATHE_URL = process.env.DATALATHE_URL;
const E2E_CSV_PATH = process.env.E2E_CSV_PATH ?? "/tmp/test-data.csv";

if (!DATALATHE_URL) {
  throw new Error(
    "DATALATHE_URL required for integration tests. " +
      "Run via `dagger call integration-js` or set the env var manually.",
  );
}

export { DATALATHE_URL, E2E_CSV_PATH };
