import type { AiChatMessage, AiChatRequest, AiStreamEvent, AiThinkingLevel } from '@shared/types/aiChat'
import { consumeSseStream } from './sse'

type FetchLike = (url: string, init: RequestInit) => Promise<Response>
type EventHandler = (event: AiStreamEvent) => void

const ANTHROPIC_VERSION = '2023-06-01'

// thinking budget_tokens must exceed max_tokens' floor of 1024; the visible
// output budget is stacked on top so replies keep room to be useful.
const THINKING_BUDGET: Record<Exclude<AiThinkingLevel, 'off'>, number> = {
  low: 4096,
  medium: 8192,
  high: 16384
}
const OUTPUT_BUDGET_WITH_THINKING = 12288
const OUTPUT_BUDGET_PLAIN = 8192

const joinUrl = (baseUrl: string, path: string): string =>
  `${baseUrl.replace(/\/+$/, '')}${path}`

interface AnthropicWireBlock {
  type: string
  [key: string]: unknown
}

/**
 * Unified -> Anthropic wire format. Tool results must ride in user messages
 * and signed thinking blocks must be replayed verbatim while the tool loop
 * continues, otherwise the API rejects the follow-up request.
 */
export const toAnthropicMessages = (messages: AiChatMessage[]): Array<{ role: string; content: AnthropicWireBlock[] }> => {
  const wire: Array<{ role: string; content: AnthropicWireBlock[] }> = []
  const pushBlock = (role: string, block: AnthropicWireBlock): void => {
    const last = wire[wire.length - 1]
    if (last && last.role === role) {
      last.content.push(block)
    } else {
      wire.push({ role, content: [block] })
    }
  }

  for (const message of messages) {
    for (const part of message.parts) {
      switch (part.type) {
        case 'text':
          if (part.text) pushBlock(message.role, { type: 'text', text: part.text })
          break
        case 'thinking': {
          if (message.role !== 'assistant' || !part.text) break
          const thinking: AnthropicWireBlock = { type: 'thinking', thinking: part.text }
          if (part.signature) thinking.signature = part.signature
          pushBlock('assistant', thinking)
          break
        }
        case 'tool-call':
          pushBlock('assistant', {
            type: 'tool_use',
            id: part.id,
            name: part.name,
            input: part.args
          })
          break
        case 'tool-result':
          pushBlock('user', {
            type: 'tool_result',
            tool_use_id: part.toolCallId,
            content: part.result,
            ...(part.ok ? {} : { is_error: true })
          })
          break
      }
    }
  }
  return wire
}

export const buildAnthropicRequestBody = (request: AiChatRequest): Record<string, unknown> => {
  const body: Record<string, unknown> = {
    model: request.model,
    stream: true,
    max_tokens: OUTPUT_BUDGET_PLAIN,
    messages: toAnthropicMessages(request.messages)
  }
  if (request.tools.length > 0) {
    body.tools = request.tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters
    }))
  }
  if (request.thinkingLevel !== 'off') {
    const budget = THINKING_BUDGET[request.thinkingLevel]
    body.thinking = { type: 'enabled', budget_tokens: budget }
    // The API rejects temperature alongside thinking, and max_tokens must
    // leave room above the reasoning budget.
    const configured = request.provider.maxOutputTokens
    body.max_tokens = configured && configured > budget + 1024
      ? configured
      : budget + OUTPUT_BUDGET_WITH_THINKING
  } else {
    body.max_tokens = request.provider.maxOutputTokens ?? OUTPUT_BUDGET_PLAIN
    if (typeof request.provider.temperature === 'number') {
      // Anthropic's sampling range tops out at 1.
      body.temperature = Math.min(1, request.provider.temperature)
    }
  }
  if (request.system) body.system = request.system
  return body
}

interface AnthropicSseEvent {
  type?: string
  index?: number
  content_block?: { type?: string; id?: string; name?: string }
  delta?: {
    type?: string
    text?: string
    thinking?: string
    signature?: string
    partial_json?: string
    stop_reason?: string
  }
  error?: { message?: string }
}

interface PendingToolCall {
  id: string
  name: string
  argsJson: string
}

interface PendingBlock {
  kind: 'text' | 'thinking' | 'tool_use'
  tool?: PendingToolCall
}

export const streamAnthropic = async(
  request: AiChatRequest,
  fetchImpl: FetchLike,
  onEvent: EventHandler,
  signal: AbortSignal
): Promise<void> => {
  const url = joinUrl(request.provider.baseUrl, '/v1/messages')
  const response = await fetchImpl(url, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': request.provider.apiKey,
      'anthropic-version': ANTHROPIC_VERSION
    },
    body: JSON.stringify(buildAnthropicRequestBody(request))
  })

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500)
    throw new Error(`HTTP ${response.status}: ${detail || response.statusText}`)
  }
  if (!response.body) throw new Error('响应没有内容')

  const blocks = new Map<number, PendingBlock>()
  const pendingToolCalls: PendingToolCall[] = []
  let stopReason = ''

  await consumeSseStream(response.body, data => {
    let event: AnthropicSseEvent
    try {
      event = JSON.parse(data)
    } catch {
      return
    }
    switch (event.type) {
      case 'content_block_start': {
        const blockType = event.content_block?.type
        const block: PendingBlock = { kind: blockType === 'tool_use' ? 'tool_use' : blockType === 'thinking' ? 'thinking' : 'text' }
        if (blockType === 'tool_use') {
          block.tool = {
            id: event.content_block?.id ?? '',
            name: event.content_block?.name ?? '',
            argsJson: ''
          }
        }
        if (typeof event.index === 'number') blocks.set(event.index, block)
        break
      }
      case 'content_block_delta': {
        const block = typeof event.index === 'number' ? blocks.get(event.index) : undefined
        if (!block) break
        const delta = event.delta ?? {}
        if (delta.type === 'text_delta' && delta.text) onEvent({ type: 'text-delta', text: delta.text })
        if (delta.type === 'thinking_delta' && delta.thinking) onEvent({ type: 'thinking-delta', text: delta.thinking })
        if (delta.type === 'signature_delta' && delta.signature) {
          onEvent({ type: 'thinking-signature', signature: delta.signature })
        }
        if (delta.type === 'input_json_delta' && delta.partial_json && block.tool) {
          block.tool.argsJson += delta.partial_json
        }
        break
      }
      case 'content_block_stop': {
        const block = typeof event.index === 'number' ? blocks.get(event.index) : undefined
        if (block?.tool) pendingToolCalls.push(block.tool)
        break
      }
      case 'message_delta':
        if (event.delta?.stop_reason) stopReason = event.delta.stop_reason
        break
      case 'error':
        throw new Error(event.error?.message ?? 'Anthropic stream error')
      default:
        break
    }
  })

  for (const tool of pendingToolCalls) {
    onEvent({ type: 'tool-call', id: tool.id, name: tool.name, argsJson: tool.argsJson })
  }
  onEvent({
    type: 'done',
    finishReason:
      stopReason === 'tool_use'
        ? 'tool-calls'
        : stopReason === 'max_tokens'
          ? 'max-length'
          : 'end'
  })
}
