import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { consumeSseStream } from '../../../src/main/ai/providers/sse'
import {
  streamOpenAiCompatible,
  toOpenAiMessages,
  buildOpenAiRequestBody
} from '../../../src/main/ai/providers/openaiCompatible'
import {
  streamAnthropic,
  buildAnthropicRequestBody
} from '../../../src/main/ai/providers/anthropic'
import { listProviderModels, testProviderModel } from '../../../src/main/ai/providers/probe'
import { applyUniqueReplacement, executeAiTool, setActiveAiEditor } from '../../../src/renderer/src/ai/tools'
import { buildSystemPrompt } from '../../../src/renderer/src/ai/prompt'
import { AiChatStore } from '../../../src/main/ai/store'
import type {
  AiChatMessage,
  AiChatRequest,
  AiStreamEvent
} from '../../../src/shared/types/aiChat'

const streamFromChunks = (chunks: string[]): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    }
  })
}

const makeRequest = (overrides: Partial<AiChatRequest> = {}): AiChatRequest => ({
  requestId: 'req-1',
  provider: { type: 'openai-compatible', baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test' },
  model: 'test-model',
  thinkingLevel: 'off',
  system: 'system prompt',
  messages: [],
  tools: [],
  ...overrides
})

const makeMessage = (role: 'user' | 'assistant', parts: AiChatMessage['parts']): AiChatMessage => ({
  id: 'm1',
  role,
  parts,
  createdAt: 0
})

const collectEvents = async(
  run: (onEvent: (event: AiStreamEvent) => void) => Promise<void>
): Promise<AiStreamEvent[]> => {
  const events: AiStreamEvent[] = []
  await run(event => events.push(event))
  return events
}

describe('AI chat SSE parsing', () => {
  it('yields one data payload per event and joins multi-line data', async() => {
    const payloads: string[] = []
    await consumeSseStream(
      streamFromChunks(['data: {"a":1}\n\ndata: line1\ndata: line2\n\n']),
      data => payloads.push(data)
    )
    expect(payloads).toEqual(['{"a":1}', 'line1\nline2'])
  })

  it('handles CRLF framing and a trailing event without a final blank line', async() => {
    const payloads: string[] = []
    await consumeSseStream(
      streamFromChunks(['data: one\r\n\r\ndata: two\r\n']),
      data => payloads.push(data)
    )
    expect(payloads).toEqual(['one', 'two'])
  })
})

describe('OpenAI-compatible adapter', () => {
  it('maps text, reasoning and tool-call deltas onto unified events', async() => {
    const body = [
      'data: {"choices":[{"delta":{"reasoning_content":"let me think"}}]}',
      'data: {"choices":[{"delta":{"content":"hello"}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"replace_text","arguments":"{\\"sea"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"rch\\":\\"a\\"}"}}]}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
      'data: [DONE]',
      ''
    ].join('\n\n')

    const fetchImpl = (async() => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      body: streamFromChunks([body])
    })) as unknown as typeof fetch

    const events = await collectEvents(onEvent =>
      streamOpenAiCompatible(makeRequest(), fetchImpl, onEvent, new AbortController().signal)
    )

    const calls = events.filter(event => event.type === 'tool-call')
    expect(events[0]).toEqual({ type: 'thinking-delta', text: 'let me think' })
    expect(events[1]).toEqual({ type: 'text-delta', text: 'hello' })
    expect(calls).toEqual([
      { type: 'tool-call', id: 'call-1', name: 'replace_text', argsJson: '{"search":"a"}' }
    ])
    expect(events[events.length - 1]).toEqual({ type: 'done', finishReason: 'tool-calls' })
  })

  it('builds the wire request with tools and reasoning effort', () => {
    const request = makeRequest({
      thinkingLevel: 'high',
      system: 'sys',
      messages: [
        makeMessage('user', [{ type: 'text', text: 'hi' }]),
        makeMessage('assistant', [
          { type: 'tool-call', id: 'call-1', name: 'replace_text', args: { search: 'a' } }
        ]),
        makeMessage('assistant', [
          { type: 'tool-result', toolCallId: 'call-1', ok: true, result: 'done' }
        ])
      ],
      tools: [
        { name: 'replace_text', description: 'd', parameters: { type: 'object' } }
      ]
    })
    const body = buildOpenAiRequestBody(request)
    expect(body.reasoning_effort).toBe('high')
    expect(body.tools).toEqual([
      { type: 'function', function: { name: 'replace_text', description: 'd', parameters: { type: 'object' } } }
    ])
    const messages = body.messages as Array<Record<string, unknown>>
    expect(messages[0]).toEqual({ role: 'system', content: 'sys' })
    expect(messages[1]).toEqual({ role: 'user', content: 'hi' })
    expect(messages[2]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'replace_text', arguments: '{"search":"a"}' } }]
    })
    expect(messages[3]).toEqual({ role: 'tool', tool_call_id: 'call-1', content: 'done' })
  })

  it('drops thinking parts on the openai-compatible wire format', () => {
    const messages = toOpenAiMessages(
      makeRequest({
        system: '',
        messages: [
          makeMessage('assistant', [
            { type: 'thinking', text: 'internal' },
            { type: 'text', text: 'answer' }
          ])
        ]
      })
    )
    expect(messages).toEqual([{ role: 'assistant', content: 'answer' }])
  })
})

describe('Anthropic adapter', () => {
  it('maps text/thinking/signature/input_json deltas and tool_use blocks', async() => {
    const body = [
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"hmm"}}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig-1"}}',
      'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu-1","name":"insert_svg"}}',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"svg\\":"}}',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\\"<svg/>\\"}"}}',
      'data: {"type":"content_block_stop","index":1}',
      'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}',
      ''
    ].join('\n\n')

    const fetchImpl = (async() => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      body: streamFromChunks([body])
    })) as unknown as typeof fetch

    const events = await collectEvents(onEvent =>
      streamAnthropic(
        makeRequest({ provider: { type: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'k' } }),
        fetchImpl,
        onEvent,
        new AbortController().signal
      )
    )

    expect(events[0]).toEqual({ type: 'thinking-delta', text: 'hmm' })
    expect(events[1]).toEqual({ type: 'thinking-signature', signature: 'sig-1' })
    expect(events).toContainEqual({
      type: 'tool-call',
      id: 'toolu-1',
      name: 'insert_svg',
      argsJson: '{"svg":"<svg/>"}'
    })
    expect(events[events.length - 1]).toEqual({ type: 'done', finishReason: 'tool-calls' })
  })

  it('replays signed thinking blocks and maps tool results to user tool_result blocks', () => {
    const body = buildAnthropicRequestBody(
      makeRequest({
        provider: { type: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'k' },
        thinkingLevel: 'medium',
        system: 'sys',
        messages: [
          makeMessage('assistant', [
            { type: 'thinking', text: 'plan', signature: 'sig-1' },
            { type: 'tool-call', id: 'toolu-1', name: 'replace_text', args: { search: 'a' } }
          ]),
          makeMessage('assistant', [
            { type: 'tool-result', toolCallId: 'toolu-1', ok: false, result: 'not found' }
          ])
        ]
      })
    )
    expect(body.system).toBe('sys')
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 8192 })
    expect(body.max_tokens).toBe(8192 + 12288)
    const messages = body.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>
    expect(messages[0].content[0]).toEqual({ type: 'thinking', thinking: 'plan', signature: 'sig-1' })
    expect(messages[0].content[1]).toEqual({
      type: 'tool_use',
      id: 'toolu-1',
      name: 'replace_text',
      input: { search: 'a' }
    })
    expect(messages[1].content[0]).toEqual({
      type: 'tool_result',
      tool_use_id: 'toolu-1',
      content: 'not found',
      is_error: true
    })
  })
})

describe('replace_text uniqueness helper', () => {
  it('rejects empty, missing and ambiguous searches', () => {
    expect(applyUniqueReplacement('abc', '', 'x').ok).toBe(false)
    expect(applyUniqueReplacement('abc', 'zzz', 'x').ok).toBe(false)
    expect(applyUniqueReplacement('aXa', 'a', 'b').ok).toBe(false)
  })

  it('replaces the single occurrence', () => {
    const result = applyUniqueReplacement('hello world', 'world', 'there')
    expect(result).toEqual({ ok: true, nextMarkdown: 'hello there' })
  })
})

describe('system prompt references', () => {
  it('renders dragged references with their source location', () => {
    const prompt = buildSystemPrompt({
      docMarkdown: null,
      references: [
        { text: 'quoted text', location: '¶2' },
        { text: 'plain reference' }
      ]
    })
    expect(prompt).toContain('<reference index="1" location="¶2">')
    expect(prompt).toContain('quoted text')
    expect(prompt).toContain('<reference index="2">')
    expect(prompt).toContain('plain reference')
  })
})

describe('provider probe', () => {
  const jsonResponse = (body: unknown, ok = true, status = 200): Response =>
    ({
      ok,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      text: async() => (ok ? '' : JSON.stringify(body)),
      json: async() => body
    }) as unknown as Response

  it('extracts sorted unique model ids from the openai-compatible list', async() => {
    const fetchImpl = (async() => jsonResponse({ data: [{ id: 'm-b' }, { id: 'm-a' }, { id: 'm-a' }] })) as unknown as typeof fetch
    const result = await listProviderModels(
      { type: 'openai-compatible', baseUrl: 'https://api.example.com/v1', apiKey: 'k' },
      fetchImpl
    )
    expect(result).toEqual({ ok: true, models: ['m-a', 'm-b'] })
  })

  it('reports failures with the response status', async() => {
    const fetchImpl = (async() => jsonResponse({ error: 'bad key' }, false, 401)) as unknown as typeof fetch
    const result = await listProviderModels(
      { type: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'bad' },
      fetchImpl
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('401')
  })

  it('probes an openai-compatible model and reports latency', async() => {
    const fetchImpl = (async() => jsonResponse({ choices: [{ message: { content: 'pong' } }] })) as unknown as typeof fetch
    const result = await testProviderModel(
      { type: 'openai-compatible', baseUrl: 'https://api.example.com/v1', apiKey: 'k', model: 'm' },
      fetchImpl
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.detail).toBe('pong')
      expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    }
  })

  it('probes an anthropic model via content blocks', async() => {
    const fetchImpl = (async() => jsonResponse({ content: [{ type: 'text', text: 'pong' }] })) as unknown as typeof fetch
    const result = await testProviderModel(
      { type: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'k', model: 'm' },
      fetchImpl
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.detail).toBe('pong')
  })
})

describe('provider request parameters', () => {
  it('applies max output tokens and temperature on the openai-compatible body', () => {
    const body = buildOpenAiRequestBody(
      makeRequest({
        provider: {
          type: 'openai-compatible',
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'k',
          maxOutputTokens: 2048,
          temperature: 0.7
        }
      })
    )
    expect(body.max_tokens).toBe(2048)
    expect(body.temperature).toBe(0.7)
  })

  it('keeps anthropic max_tokens above the thinking budget and drops temperature with thinking', () => {
    const body = buildAnthropicRequestBody(
      makeRequest({
        provider: {
          type: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          apiKey: 'k',
          maxOutputTokens: 2048,
          temperature: 0.9
        },
        thinkingLevel: 'medium'
      })
    )
    // 2048 would leave no room above the 8192 budget, so the floor applies.
    expect(body.max_tokens).toBe(8192 + 12288)
    expect(body.temperature).toBeUndefined()
  })

  it('honors a large anthropic max_tokens and clamps temperature without thinking', () => {
    const body = buildAnthropicRequestBody(
      makeRequest({
        provider: {
          type: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          apiKey: 'k',
          maxOutputTokens: 20480,
          temperature: 1.6
        },
        thinkingLevel: 'off'
      })
    )
    expect(body.max_tokens).toBe(20480)
    expect(body.temperature).toBe(1)
  })
})

describe('AI tool executor guards', () => {
  it('fails when no document is open', async() => {
    setActiveAiEditor(null)
    const execution = await executeAiTool({ name: 'replace_text', args: { search: 'a', replace: 'b' } })
    expect(execution.ok).toBe(false)
  })

  it('fails for a read-only document', async() => {
    setActiveAiEditor({ muya: {} as never, getReadOnly: () => true })
    const execution = await executeAiTool({ name: 'update_document', args: { new_markdown: '# x' } })
    expect(execution.ok).toBe(false)
    expect(execution.result).toContain('只读')
    setActiveAiEditor(null)
  })
})

describe('AI chat store', () => {
  let dir: string
  let store: AiChatStore

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'marktext-ai-chat-'))
    store = new AiChatStore(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns defaults when no config file exists', async() => {
    const config = await store.getConfig()
    expect(config).toEqual({ providers: [], activeProviderId: '', activeModel: '', thinkingLevel: 'off' })
  })

  it('round-trips config and rejects unknown keys on reparse', async() => {
    const config = {
      providers: [
        { id: 'p1', name: 'Test', type: 'anthropic' as const, baseUrl: 'https://x', apiKey: 'k', models: ['m'] }
      ],
      activeProviderId: 'p1',
      activeModel: 'm',
      thinkingLevel: 'low' as const
    }
    await expect(store.updateConfig(config)).resolves.toBe(true)
    expect(await store.getConfig()).toEqual(config)
  })

  it('saves, lists, loads and deletes sessions', async() => {
    const session = {
      id: 'session_1',
      title: 'Hello',
      createdAt: 1,
      updatedAt: 2,
      messages: [makeMessage('user', [{ type: 'text', text: 'hi' }])]
    }
    await expect(store.saveSession(session)).resolves.toBe(true)

    const metas = await store.listSessions()
    expect(metas).toEqual([
      { id: 'session_1', title: 'Hello', createdAt: 1, updatedAt: 2, messageCount: 1 }
    ])

    const loaded = await store.loadSession('session_1')
    expect(loaded).toEqual(session)

    await expect(store.deleteSession('session_1')).resolves.toBe(true)
    expect(await store.listSessions()).toEqual([])
    expect(await store.loadSession('session_1')).toBeNull()
    expect(existsSync(path.join(dir, 'ai-chat', 'sessions', 'session_1.json'))).toBe(false)
  })

  it('rejects session ids that could escape the sessions directory', async() => {
    await expect(store.loadSession('../config')).rejects.toThrow()
    await expect(store.saveSession({
      id: 'a/b', title: '', createdAt: 0, updatedAt: 0, messages: []
    })).rejects.toThrow()
  })
})
