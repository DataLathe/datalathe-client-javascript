import type { DatalatheCommand } from "./command.js";

export interface ExtractTablesRequest {
  query: string;
  transform?: boolean;
}

export interface ExtractTablesResponse {
  tables: string[];
  transformed_query: string | null;
  error: string | null;
}

export class ExtractTablesCommand
  implements DatalatheCommand<ExtractTablesRequest, ExtractTablesResponse>
{
  readonly endpoint = "/lathe/query/tables";
  readonly request: ExtractTablesRequest;

  constructor(query: string, transform?: boolean) {
    this.request = { query, transform };
  }

  parseResponse(json: unknown): ExtractTablesResponse {
    return json as ExtractTablesResponse;
  }
}
