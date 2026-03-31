/**
 * Converts a snake_case string to camelCase.
 */
function snakeToCamel(str: string): string {
  return str.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

/**
 * Recursively transforms all object keys from snake_case to camelCase.
 * Arrays are traversed; primitives are returned as-is.
 */
export function snakeToCamelKeys<T>(obj: unknown): T {
  if (Array.isArray(obj)) {
    return obj.map((item) => snakeToCamelKeys(item)) as T;
  }
  if (obj !== null && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
        snakeToCamel(k),
        snakeToCamelKeys(v),
      ]),
    ) as T;
  }
  return obj as T;
}
