export interface DatalatheCommand<TRequest, TResponse> {
  readonly endpoint: string;
  readonly request: TRequest;
  parseResponse(json: unknown): TResponse;
}
