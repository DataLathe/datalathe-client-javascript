import type { HttpClient } from "./http.js";
import type {
  AiCredential,
  CreateAiCredentialRequest,
  AiContext,
  CreateAiContextRequest,
  UpdateAiContextRequest,
  AiQueryRequest,
  AiQueryResponse,
  ConversationTurn,
} from "./types.js";

export class AiApi {
  constructor(private readonly http: HttpClient) {}

  async registerCredential(request: CreateAiCredentialRequest): Promise<AiCredential> {
    return this.http.postRaw<AiCredential>("/lathe/ai/credentials", {
      name: request.name,
      provider: request.provider,
      api_key: request.apiKey,
      default_model: request.defaultModel,
    });
  }

  async listCredentials(): Promise<AiCredential[]> {
    return this.http.get<AiCredential[]>("/lathe/ai/credentials");
  }

  async deleteCredential(credentialId: string): Promise<void> {
    return this.http.del(`/lathe/ai/credentials/${encodeURIComponent(credentialId)}`);
  }

  async registerContext(request: CreateAiContextRequest): Promise<AiContext> {
    return this.http.postRaw<AiContext>("/lathe/ai/contexts", {
      name: request.name,
      chip_ids: request.chipIds,
      column_descriptions: request.columnDescriptions,
      data_relationship_prompt: request.dataRelationshipPrompt,
    });
  }

  async listContexts(): Promise<AiContext[]> {
    return this.http.get<AiContext[]>("/lathe/ai/contexts");
  }

  async getContext(contextId: string): Promise<AiContext> {
    return this.http.get<AiContext>(`/lathe/ai/contexts/${encodeURIComponent(contextId)}`);
  }

  async updateContext(contextId: string, request: UpdateAiContextRequest): Promise<AiContext> {
    const wire: Record<string, unknown> = {};
    if (request.name !== undefined) wire.name = request.name;
    if (request.chipIds !== undefined) wire.chip_ids = request.chipIds;
    if (request.columnDescriptions !== undefined) wire.column_descriptions = request.columnDescriptions;
    if (request.dataRelationshipPrompt !== undefined) wire.data_relationship_prompt = request.dataRelationshipPrompt;
    return this.http.postRaw<AiContext>(`/lathe/ai/contexts/${encodeURIComponent(contextId)}`, wire, "PUT");
  }

  async deleteContext(contextId: string): Promise<void> {
    return this.http.del(`/lathe/ai/contexts/${encodeURIComponent(contextId)}`);
  }

  async query(request: AiQueryRequest): Promise<AiQueryResponse> {
    return this.http.postRaw<AiQueryResponse>("/lathe/ai/query", {
      context_id: request.contextId,
      ...(request.credentialId !== undefined ? { credential_id: request.credentialId } : {}),
      user_question: request.userQuestion,
      ...(request.conversationHistory !== undefined ? { conversation_history: request.conversationHistory } : {}),
      ...(request.sessionId !== undefined ? { session_id: request.sessionId } : {}),
      ...(request.model !== undefined ? { model: request.model } : {}),
    });
  }

  async deleteSession(sessionId: string): Promise<void> {
    return this.http.del(`/lathe/ai/sessions/${encodeURIComponent(sessionId)}`);
  }

  conversation(contextId: string, credentialId?: string): AiConversation {
    return new AiConversation(this, contextId, credentialId);
  }
}

export class AiConversation {
  private readonly history: ConversationTurn[] = [];

  constructor(
    private readonly api: AiApi,
    private readonly contextId: string,
    private readonly credentialId?: string,
  ) {}

  async ask(question: string, model?: string): Promise<AiQueryResponse> {
    const response = await this.api.query({
      contextId: this.contextId,
      credentialId: this.credentialId,
      userQuestion: question,
      conversationHistory: this.history.length > 0 ? this.history : undefined,
      model,
    });

    this.history.push({ role: "user", content: question });
    if (response.assistantTurn) {
      this.history.push(response.assistantTurn);
    } else if (response.explanation) {
      this.history.push({ role: "assistant", content: response.explanation });
    }

    return response;
  }

  getHistory(): ConversationTurn[] {
    return [...this.history];
  }

  clear(): void {
    this.history.length = 0;
  }
}
