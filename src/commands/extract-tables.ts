import type { DatalatheCommand } from "./command.js";

export interface ExtractTablesRequest {
  query: string;
}

export interface ExtractTablesResponse {
  tables: string[];
  error: string | null;
}

export class ExtractTablesCommand
  implements DatalatheCommand<ExtractTablesRequest, ExtractTablesResponse>
{
  readonly endpoint = "/lathe/query/tables";
  readonly request: ExtractTablesRequest;

  constructor(query: string) {
    this.request = { query };
  }

  parseResponse(json: unknown): ExtractTablesResponse {
    return json as ExtractTablesResponse;
  }
}
