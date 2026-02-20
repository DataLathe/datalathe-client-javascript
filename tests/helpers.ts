export interface MockCall {
  url: string;
  init: RequestInit;
  body: unknown;
}

export function createMockFetch(
  responses: Array<{ status: number; body: unknown }>,
) {
  let callIndex = 0;
  const calls: MockCall[] = [];

  const mockFetch = async (
    url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const resp = responses[callIndex++];
    const bodyText =
      typeof init?.body === "string" ? init.body : "";
    calls.push({
      url: url.toString(),
      init: init!,
      body: bodyText ? JSON.parse(bodyText) : null,
    });
    return new Response(JSON.stringify(resp.body), {
      status: resp.status,
      headers: { "Content-Type": "application/json" },
    });
  };

  return { fetch: mockFetch as typeof globalThis.fetch, calls };
}
