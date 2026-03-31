import type { HttpClient } from "./http.js";
import type {
  ConnectionInfo,
  ConnectionRequest,
  ConnectionResponse,
} from "./types.js";

export class ConnectionsApi {
  constructor(private readonly http: HttpClient) {}

  async list(): Promise<ConnectionInfo[]> {
    return this.http.get<ConnectionInfo[]>("/lathe/connections");
  }

  async get(alias: string): Promise<ConnectionInfo> {
    return this.http.get<ConnectionInfo>(`/lathe/connections/${encodeURIComponent(alias)}`);
  }

  async upsert(alias: string, connection: ConnectionRequest): Promise<ConnectionResponse> {
    return this.http.postRaw<ConnectionResponse>(`/lathe/connections/${encodeURIComponent(alias)}`, connection, "PUT");
  }

  async delete(alias: string): Promise<void> {
    return this.http.del(`/lathe/connections/${encodeURIComponent(alias)}`);
  }

  async test(alias: string): Promise<ConnectionResponse> {
    return this.http.postRaw<ConnectionResponse>(`/lathe/connections/${encodeURIComponent(alias)}/test`, {});
  }
}
