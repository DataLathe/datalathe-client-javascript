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

function retryDelayMs(retryAfter: string | null, attempt: number): number {
  const parsed = retryAfter === null ? Number.NaN : Number(retryAfter);
  const seconds = Number.isFinite(parsed) && parsed >= 0 ? parsed : 2 ** attempt;
  return Math.min(seconds, 30) * 1000 + Math.random() * 250;
}

/**
 * Internal HTTP transport shared by all sub-modules.
 */
export class HttpClient {
  readonly baseUrl: string;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly defaultHeaders: Record<string, string>;
  private readonly timeout: number;
  private readonly maxRetries: number;

  constructor(baseUrl: string, options?: DatalatheClientOptions) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetchFn = options?.fetch ?? globalThis.fetch.bind(globalThis);
    this.defaultHeaders = options?.headers ?? {};
    this.timeout = options?.timeout ?? 30_000;
    this.maxRetries =
      options?.retryOn429 === false ? 0 : options?.maxRetries ?? 3;
  }

  /**
   * Runs a fetch with the per-attempt timeout, replaying on HTTP 429 (the
   * engine's admission gates reject before doing any work, so replay is safe
   * for every method). Waits honor Retry-After, capped at 30s, falling back
   * to exponential backoff when the header is absent.
   */
  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);
      let response: Response;
      try {
        response = await this.fetchFn(url, { ...init, signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }

      if (response.status !== 429 || attempt >= this.maxRetries) {
        return response;
      }

      const waitMs = retryDelayMs(response.headers.get("retry-after"), attempt);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
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
    const response = await this.fetchWithRetry(this.baseUrl + path, {
      method: "GET",
      headers: { ...this.defaultHeaders },
    });

    if (!response.ok) {
      const body = await response.text();
      throwForFailure("GET", path, response.status, body);
    }

    return this.parseJsonStream<T>("GET", path, response);
  }

  async del(path: string): Promise<void> {
    const response = await this.fetchWithRetry(this.baseUrl + path, {
      method: "DELETE",
      headers: { ...this.defaultHeaders },
    });

    if (!response.ok) {
      const body = await response.text();
      throwForFailure("DELETE", path, response.status, body);
    }
  }

  /**
   * Sends a POST or PUT request with a pre-built wire-format body.
   * Response is transformed from snake_case to camelCase.
   */
  async postRaw<T>(path: string, body: unknown, method: "POST" | "PUT" = "POST"): Promise<T> {
    const response = await this.fetchWithRetry(this.baseUrl + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...this.defaultHeaders,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const responseBody = await response.text();
      throwForFailure(method, path, response.status, responseBody);
    }

    return this.parseJsonStream<T>(method, path, response);
  }

  /**
   * POSTs a pre-built body and returns the raw response body stream for
   * incremental consumption. Pre-stream failures (status >= 400) are mapped
   * through the same error path as the buffered helpers before any bytes are
   * read. The timeout bounds time-to-headers only; the body is unbounded by
   * design (the caller owns draining it).
   */
  async postStream(path: string, body: unknown): Promise<ReadableStream<Uint8Array>> {
    const response = await this.fetchWithRetry(this.baseUrl + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.defaultHeaders,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const responseBody = await response.text();
      throwForFailure("POST", path, response.status, responseBody);
    }

    if (!response.body) {
      throw new DatalatheApiError(
        `POST ${path} returned ${response.status} with no response body`,
        response.status,
      );
    }

    return response.body;
  }
}
