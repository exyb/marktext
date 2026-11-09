/**
 * AI copilot chat contract: provider configuration, the unified conversation
 * representation shared by renderer and main, and the normalized streaming
 * events the main-process LLM proxies push to the renderer.
 */

export type AiProviderType = 'openai-compatible' | 'anthropic'

export interface AiProviderConfig {
  id: string
  name: string
  type: AiProviderType
  // Origin including the version path, e.g. `https://api.openai.com/v1`.
  baseUrl: string
  apiKey: string
  models: string[]
  // Context window in tokens; bounds how much document text rides in the
  // system prompt. Absent = built-in default.
  contextTokens?: number
  // Output token cap sent with each completion request.
  maxOutputTokens?: number
  // Sampling temperature (0-2); Anthropic clamps to 0-1 and only when
  // thinking is off.
  temperature?: number
}

export type AiThinkingLevel = 'off' | 'low' | 'medium' | 'high'

export interface AiChatConfig {
  providers: AiProviderConfig[]
  activeProviderId: string
  activeModel: string
  thinkingLevel: AiThinkingLevel
}

export interface AiTextPart {
  type: 'text'
  text: string
}

export interface AiThinkingPart {
  type: 'thinking'
  text: string
  // Anthropic requires the signed thinking block replayed verbatim while the
  // tool loop continues; other providers ignore it.
  signature?: string
}

export interface AiToolCallPart {
  type: 'tool-call'
  id: string
  name: string
  args: Record<string, unknown>
}

export interface AiToolResultPart {
  type: 'tool-result'
  toolCallId: string
  ok: boolean
  result: string
}

export type AiMessagePart = AiTextPart | AiThinkingPart | AiToolCallPart | AiToolResultPart

export type AiChatRole = 'user' | 'assistant'

export interface AiChatMessage {
  id: string
  role: AiChatRole
  parts: AiMessagePart[]
  createdAt: number
}

export interface AiChatSessionMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
}

export interface AiChatSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: AiChatMessage[]
}

export interface AiToolSchema {
  name: string
  description: string
  // JSON schema for the tool arguments.
  parameters: Record<string, unknown>
}

export interface AiChatRequest {
  requestId: string
  provider: Pick<AiProviderConfig, 'type' | 'baseUrl' | 'apiKey' | 'maxOutputTokens' | 'temperature'>
  model: string
  thinkingLevel: AiThinkingLevel
  // Session messages verbatim; document context and references ride in `system`.
  system?: string
  messages: AiChatMessage[]
  tools: AiToolSchema[]
}

export interface AiProviderCredentials {
  type: AiProviderType
  baseUrl: string
  apiKey: string
}

export type AiModelListResult =
  | { ok: true; models: string[] }
  | { ok: false; error: string }

export interface AiModelProbeRequest extends AiProviderCredentials {
  model: string
}

export type AiModelProbeResult =
  | { ok: true; detail: string; latencyMs: number }
  | { ok: false; error: string }

export type AiStreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'thinking-delta'; text: string }
  | { type: 'thinking-signature'; signature: string }
  | { type: 'tool-call'; id: string; name: string; argsJson: string }
  | { type: 'done'; finishReason: string }
  | { type: 'aborted' }
  | { type: 'error'; message: string }
