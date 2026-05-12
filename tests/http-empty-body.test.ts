import { describe, expect, it } from "vitest";
import { HttpClient } from "../src/http.js";
import { DatalatheApiError } from "../src/errors.js";

function fakeFetch(body: string, status = 200): typeof globalThis.fetch {
  return (async () =>
    new Response(body, {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof globalThis.fetch;
}

describe("HttpClient JSON body guard", () => {
  it("turns an empty 2xx body into DatalatheApiError", async () => {
    const http = new HttpClient("http://x", { fetch: fakeFetch("") });
    await expect(http.get("/lathe/chips")).rejects.toBeInstanceOf(DatalatheApiError);
  });

  it("turns a non-JSON 2xx body into DatalatheApiError", async () => {
    const http = new HttpClient("http://x", { fetch: fakeFetch("<html>oops</html>") });
    await expect(http.get("/lathe/chips")).rejects.toThrow(/oops|invalid|JSON/i);
  });
});
