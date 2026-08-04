import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpClient } from "../src/http.js";
import { DatalatheApiError } from "../src/errors.js";

function tooMany(retryAfter?: string): () => Response {
  const headers: Record<string, string> =
    retryAfter === undefined ? {} : { "retry-after": retryAfter };
  return () => new Response("saturated", { status: 429, headers });
}

function ok(body = '{"version": "1.0.0"}'): () => Response {
  return () =>
    new Response(body, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
}

function fetchSequence(...responses: (() => Response)[]) {
  let calls = 0;
  const fn = (async () => {
    const make = responses[Math.min(calls, responses.length - 1)];
    calls++;
    return make();
  }) as unknown as typeof globalThis.fetch;
  return { fn, calls: () => calls };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("HttpClient 429 retry", () => {
  it("retries a 429 with Retry-After: 0 and succeeds", async () => {
    const fake = fetchSequence(tooMany("0"), ok());
    const http = new HttpClient("http://x", { fetch: fake.fn });

    const result = await http.get<{ version: string }>("/lathe/version");

    expect(result).toEqual({ version: "1.0.0" });
    expect(fake.calls()).toBe(2);
  });

  it("falls back to exponential backoff when Retry-After is missing", async () => {
    vi.useFakeTimers();
    const fake = fetchSequence(tooMany(), tooMany(), ok());
    const http = new HttpClient("http://x", { fetch: fake.fn });

    const start = Date.now();
    const promise = http.get<{ version: string }>("/lathe/version");
    await vi.runAllTimersAsync();

    expect(await promise).toEqual({ version: "1.0.0" });
    expect(fake.calls()).toBe(3);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(3000);
    expect(elapsed).toBeLessThanOrEqual(3500);
  });

  it("caps a large Retry-After at 30 seconds", async () => {
    vi.useFakeTimers();
    const fake = fetchSequence(tooMany("600"), ok());
    const http = new HttpClient("http://x", { fetch: fake.fn });

    const start = Date.now();
    const promise = http.get<{ version: string }>("/lathe/version");
    await vi.runAllTimersAsync();

    expect(await promise).toEqual({ version: "1.0.0" });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(30_000);
    expect(elapsed).toBeLessThanOrEqual(30_250);
  });

  it("throws DatalatheApiError with status 429 after four attempts", async () => {
    vi.useFakeTimers();
    const fake = fetchSequence(tooMany());
    const http = new HttpClient("http://x", { fetch: fake.fn });

    const promise = http.postRaw("/lathe/report", { queries: {} }).catch((e) => e);
    await vi.runAllTimersAsync();
    const error = await promise;

    expect(error).toBeInstanceOf(DatalatheApiError);
    expect(error.statusCode).toBe(429);
    expect(fake.calls()).toBe(4);
  });

  it("honors a tuned maxRetries", async () => {
    vi.useFakeTimers();
    const fake = fetchSequence(tooMany());
    const http = new HttpClient("http://x", { fetch: fake.fn, maxRetries: 1 });

    const promise = http.get("/lathe/version").catch((e) => e);
    await vi.runAllTimersAsync();
    const error = await promise;

    expect(error).toBeInstanceOf(DatalatheApiError);
    expect(fake.calls()).toBe(2);
  });

  it("does not retry when retryOn429 is false", async () => {
    const fake = fetchSequence(tooMany("0"));
    const http = new HttpClient("http://x", { fetch: fake.fn, retryOn429: false });

    await expect(http.get("/lathe/version")).rejects.toMatchObject({
      statusCode: 429,
    });
    expect(fake.calls()).toBe(1);
  });

  it("does not retry a 500", async () => {
    const fake = fetchSequence(
      () => new Response("boom", { status: 500 }),
      ok(),
    );
    const http = new HttpClient("http://x", { fetch: fake.fn });

    await expect(http.postRaw("/lathe/report", {})).rejects.toMatchObject({
      statusCode: 500,
    });
    expect(fake.calls()).toBe(1);
  });

  it("retries the streaming path before any body is consumed", async () => {
    const fake = fetchSequence(tooMany("0"), ok('{"idx":"0"}\n'));
    const http = new HttpClient("http://x", { fetch: fake.fn });

    const stream = await http.postStream("/lathe/report", { stream: true });
    const text = await new Response(stream).text();

    expect(text).toBe('{"idx":"0"}\n');
    expect(fake.calls()).toBe(2);
  });
});
