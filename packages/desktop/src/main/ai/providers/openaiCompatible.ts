import type { AiChatRequest, AiStreamEvent, AiThinkingLevel } from '@shared/types/aiChat'
import { consumeSseStream } from './sse'

type FetchLike = (url: string, init: RequestInit) => Promise<Response>
type EventHandler = (event: AiStreamEvent) => void

const REASONING_EFFORT: Record<Exclude<AiThinkingLevel, 'off'>, string> = {
  low: 'low',
  medium: 'medium',
  high: 'high'
}

const joinUrl = (baseUrl: string, path: string): string =>
  `${baseUrl.replace(/\/+$/, '')}${path}`

interface OpenAiToolCallDelta {
  index: number
  id?: string
  function?: { name?: string; arguments?: string }
}

interface OpenAiChunk {
  choices?: Array<{
    delta?: {
      content?: string | null
      reasoning_content?: string | null
      reasoning?: string | null
      tool_calls?: OpenAiToolCallDelta[]
    }
    finish_reason?: string | null
  }>
}

/** Maps the unified conversation onto the chat/completions message shape. */
export const toOpenAiMessages = (request: AiChatRequest): unknown[] => {
  const wire: unknown[] = []
  if (request.system) wire.push({ role: 'system', content: request.system })
  for (const message of request.messages) {
    const text = message.parts
      .filter(part => part.type === 'text')
      .map(part => part.text)
      .join('\n\n')
    if (message.role === 'user') {
      wire.push({ role: 'user', content: text })
      continue
    }
    const toolCalls = message.parts
      .filter(part => part.type === 'tool-call')
      .map(part => ({
        id: part.id,
        type: 'function',
        function: { name: part.name, arguments: JSON.stringify(part.args) }
      }))
    if (toolCalls.length > 0) {
      // Reasoning content cannot be replayed against every compatible endpoint,
      // so thinking parts are dropped and only text + tool calls survive.
      wire.push({ role: 'assistant', content: text || null, tool_calls: toolCalls })
      continue
    }
    if (text) wire.push({ role: 'assistant', content: text })
  }
  // Tool results follow the assistant tool_calls as role:"tool" messages.
  for (const message of request.messages) {
    for (const part of message.parts) {
      if (part.type === 'tool-result') {
        wire.push({ role: 'tool', tool_call_id: part.toolCallId, content: part.result })
      }
    }
  }
  return wire
}

export const buildOpenAiRequestBody = (request: AiChatRequest): Record<string, unknown> => {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: toOpenAiMessages(request),
    stream: true
  }
  if (typeof request.provider.maxOutputTokens === 'number') {
    body.max_tokens = request.provider.maxOutputTokens
  }
  if (typeof request.provider.temperature === 'number') {
    body.temperature = request.provider.temperature
  }
  if (request.tools.length > 0) {
    body.tools = request.tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }))
  }
  if (request.thinkingLevel !== 'off') {
    body.reasoning_effort = REASONING_EFFORT[request.thinkingLevel]
  }
  return body
}

export const streamOpenAiCompatible = async(
  request: AiChatRequest,
  fetchImpl: FetchLike,
  onEvent: EventHandler,
  signal: AbortSignal
): Promise<void> => {
  const url = joinUrl(request.provider.baseUrl, '/chat/completions')
  const response = await fetchImpl(url, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      ...(request.provider.apiKey
        ? { Authorization: `Bearer ${request.provider.apiKey}` }
        : {})
    },
    body: JSON.stringify(buildOpenAiRequestBody(request))
  })

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500)
    throw new Error(`HTTP ${response.status}: ${detail || response.statusText}`)
  }
  if (!response.body) throw new Error('响应没有内容')

  // Tool-call arguments arrive as argument fragments keyed by delta index.
  const toolCalls = new Map<number, { id: string; name: string; argsJson: string }>()
  let finishReason = ''

  await consumeSseStream(response.body, data => {
    if (data === '[DONE]') return
    let chunk: OpenAiChunk
    try {
      chunk = JSON.parse(data)
    } catch {
      return
    }
    const choice = chunk.choices?.[0]
    if (!choice) return
    const delta = choice.delta ?? {}
    if (delta.content) onEvent({ type: 'text-delta', text: delta.content })
    const reasoning = delta.reasoning_content ?? delta.reasoning
    if (reasoning) onEvent({ type: 'thinking-delta', text: reasoning })
    for (const call of delta.tool_calls ?? []) {
      const slot = toolCalls.get(call.index) ?? { id: '', name: '', argsJson: '' }
      if (call.id) slot.id = call.id
      if (call.function?.name) slot.name += call.function.name
      if (call.function?.arguments) slot.argsJson += call.function.arguments
      toolCalls.set(call.index, slot)
    }
    if (choice.finish_reason) finishReason = choice.finish_reason
  })

  // Tool calls are published once complete; the renderer matches them to
  // tool-result parts and drives the next round.
  for (const slot of toolCalls.values()) {
    onEvent({ type: 'tool-call', id: slot.id, name: slot.name, argsJson: slot.argsJson })
  }
  onEvent({
    type: 'done',
    finishReason:
      finishReason === 'tool_calls' ? 'tool-calls' : finishReason === 'length' ? 'max-length' : 'end'
  })
}
