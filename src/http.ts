import { JSONParser } from "@streamparser/json";
import { ChipNotFoundError, DatalatheApiError } from "./errors.js";
import { snakeToCamelKeys } from "./transform.js";
import type { DatalatheClientOptions } from "./types.js";

/**
 * Inspects a failed HTTP response body and throws the most specific error
 * available. Falls back to DatalatheApiError for unrecognized failures.
 */
function throwForFailure(
  method: string,
  path: string,
  status: number,
  body: string,
): never {
  if (status === 404 && body) {
    try {
      const parsed = JSON.parse(body) as {
        error?: string;
        error_code?: string;
        chip_id?: string;
      };
      if (parsed.error_code === "chip_not_found") {
        throw new ChipNotFoundError(
          parsed.error ?? "Chip not available",
          parsed.chip_id ?? null,
          body,
        );
      }
    } catch (e) {
      if (e instanceof ChipNotFoundError) throw e;
      // body wasn't JSON — fall through to generic error
    }
  }
  throw new DatalatheApiError(
    `${method} ${path} failed: ${status} ${body}`,
    status,
    body,
  );
}

/**
 * Internal HTTP transport shared by all sub-modules.
 */
export class HttpClient {
  readonly baseUrl: string;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly defaultHeaders: Record<string, string>;
  private readonly timeout: number;

  constructor(baseUrl: string, options?: DatalatheClientOptions) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetchFn = options?.fetch ?? globalThis.fetch.bind(globalThis);
    this.defaultHeaders = options?.headers ?? {};
    this.timeout = options?.timeout ?? 30_000;
  }

  private async parseJsonStream<T>(
    method: string,
    path: string,
    response: Response,
  ): Promise<T> {
    const fail = (detail: string): never => {
      throw new DatalatheApiError(
        `${method} ${path} returned ${response.status} with an unreadable JSON body: ${detail}`,
        response.status,
        detail,
      );
    };

    const body = response.body;
    if (!body) {
      const text = await response.text();
      if (text.trim() === "") return fail("empty body");
      try {
        return snakeToCamelKeys<T>(JSON.parse(text));
      } catch {
        return fail(text);
      }
    }

    return new Promise<T>((resolve, reject) => {
      const parser = new JSONParser();
      let result: unknown;
      let sawValue = false;

      parser.onValue = ({ value, stack }) => {
        if (stack.length === 0) {
          result = value;
          sawValue = true;
        }
      };
      parser.onEnd = () => {
        if (!sawValue) {
          try {
            fail("empty body");
          } catch (e) {
            reject(e);
          }
          return;
        }
        resolve(snakeToCamelKeys<T>(result));
      };
      parser.onError = (err: Error) => {
        try {
          fail(err.message);
        } catch (e) {
          reject(e);
        }
      };

      const reader = body.getReader();
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            parser.end();
            break;
          }
          parser.write(value);
        }
      };
      pump().catch((e) => {
        try {
          fail(e instanceof Error ? e.message : String(e));
        } catch (wrapped) {
          reject(wrapped);
        }
      });
    });
  }

  async get<T>(path: string): Promise<T> {
    const url = this.baseUrl + path;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await this.fetchFn(url, {
        method: "GET",
        headers: { ...this.defaultHeaders },
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throwForFailure("GET", path, response.status, body);
      }

      return this.parseJsonStream<T>("GET", path, response);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async del(path: string): Promise<void> {
    const url = this.baseUrl + path;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await this.fetchFn(url, {
        method: "DELETE",
        headers: { ...this.defaultHeaders },
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throwForFailure("DELETE", path, response.status, body);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Sends a POST or PUT request with a pre-built wire-format body.
   * Response is transformed from snake_case to camelCase.
   */
  async postRaw<T>(path: string, body: unknown, method: "POST" | "PUT" = "POST"): Promise<T> {
    const url = this.baseUrl + path;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await this.fetchFn(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...this.defaultHeaders,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const responseBody = await response.text();
        throwForFailure(method, path, response.status, responseBody);
      }

      return this.parseJsonStream<T>(method, path, response);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
