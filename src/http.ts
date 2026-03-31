import { JSONParser } from "@streamparser/json";
import { DatalatheApiError } from "./errors.js";
import { snakeToCamelKeys } from "./transform.js";
import type { DatalatheClientOptions } from "./types.js";

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

  /**
   * Parses a JSON response body using streaming to avoid V8's string length limit.
   * Falls back to response.json() if the body stream is not available.
   */
  private async parseJsonStream<T>(response: Response): Promise<T> {
    const body = response.body;
    if (!body) {
      return snakeToCamelKeys<T>(await response.json());
    }

    return new Promise<T>((resolve, reject) => {
      const parser = new JSONParser();
      let result: unknown;

      parser.onValue = ({ value, stack }) => {
        if (stack.length === 0) {
          result = value;
        }
      };
      parser.onEnd = () => resolve(snakeToCamelKeys<T>(result));
      parser.onError = (err: Error) => reject(err);

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
      pump().catch(reject);
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
        throw new DatalatheApiError(
          `GET ${path} failed: ${response.status} ${body}`,
          response.status,
          body,
        );
      }

      return this.parseJsonStream<T>(response);
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
        throw new DatalatheApiError(
          `DELETE ${path} failed: ${response.status} ${body}`,
          response.status,
          body,
        );
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
        throw new DatalatheApiError(
          `${method} ${path} failed: ${response.status} ${responseBody}`,
          response.status,
          responseBody,
        );
      }

      return this.parseJsonStream<T>(response);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
