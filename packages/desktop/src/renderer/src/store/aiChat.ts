import { defineStore } from 'pinia'
import { ref } from 'vue'
import type {
  AiChatConfig,
  AiChatMessage,
  AiChatSession,
  AiChatSessionMeta,
  AiMessagePart,
  AiStreamEvent,
  AiTextPart,
  AiThinkingPart,
  AiToolCallPart
} from '@shared/types/aiChat'
import { AI_TOOLS, buildSystemPrompt, DOC_CONTEXT_MAX_LENGTH } from '@/ai/prompt'
import { executeAiTool, getActiveDocumentMarkdown } from '@/ai/tools'

const isToolCallPart = (part: AiMessagePart): part is AiToolCallPart =>
  part.type === 'tool-call'

const MAX_TOOL_ROUNDS = 8
const SESSION_TITLE_MAX_LENGTH = 40

const createId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`

const createSession = (): AiChatSession => {
  const now = Date.now()
  return { id: createId(), title: '', createdAt: now, updatedAt: now, messages: [] }
}

// contextBridge rejects Vue's reactive proxies ("An object could not be
// cloned"), so every payload crossing into preload must be a plain object.
const toPlain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export const useAiChatStore = defineStore('aiChat', () => {
  const config = ref<AiChatConfig>({
    providers: [],
    activeProviderId: '',
    activeModel: '',
    thinkingLevel: 'off'
  })
  const sessions = ref<AiChatSessionMeta[]>([])
  const activeSession = ref<AiChatSession | null>(null)
  const panelOpen = ref(false)
  const panelWidth = ref(360)
  const docContextEnabled = ref(true)
  const references = ref<{ id: string; text: string; location?: string }[]>([])
  const streaming = ref(false)
  const historyVisible = ref(false)
  const settingsVisible = ref(false)

  let requestSeq = 0
  let activeRequestId = ''
  // Resolved when the matching request finishes; the tool loop awaits it.
  let settleCurrentRequest: ((stop: 'done' | 'aborted' | 'error') => void) | null = null
  let unsubscribeEvents: (() => void) | null = null

  const LIST_SESSIONS = async(): Promise<void> => {
    try {
      sessions.value = await window.aiChat.listSessions()
    } catch {
      sessions.value = []
    }
  }

  const INIT_CONFIG = async(): Promise<void> => {
    try {
      const loaded = await window.aiChat.getConfig()
      config.value = loaded
    } catch {
      // Defaults keep the panel usable without persistence.
    }
    if (!unsubscribeEvents) {
      unsubscribeEvents = window.aiChat.onChatEvent(handleChatEvent)
    }
    await LIST_SESSIONS()
  }

  // Resolves to null on success, else the error text for UI surfacing.
  const UPDATE_CONFIG = async(next: AiChatConfig): Promise<string | null> => {
    try {
      await window.aiChat.updateConfig(toPlain(next))
      config.value = next
      return null
    } catch (error) {
      console.error('[aiChat] failed to update config', error)
      return error instanceof Error ? error.message : String(error)
    }
  }

  const TOGGLE_PANEL = (): void => {
    panelOpen.value = !panelOpen.value
    if (panelOpen.value) void INIT_CONFIG()
  }

  const SET_PANEL_WIDTH = (width: number): void => {
    panelWidth.value = Math.min(640, Math.max(280, width))
  }

  const ADD_REFERENCE = (text: string, location?: string): void => {
    const trimmed = text.trim()
    if (!trimmed) return
    references.value.push({ id: createId(), text: trimmed, location })
  }

  const REMOVE_REFERENCE = (id: string): void => {
    references.value = references.value.filter(item => item.id !== id)
  }

  const NEW_SESSION = (): void => {
    if (streaming.value) return
    activeSession.value = createSession()
    historyVisible.value = false
    void persistActiveSession()
  }

  const LOAD_SESSION = async(id: string): Promise<void> => {
    if (streaming.value) return
    try {
      const loaded = await window.aiChat.loadSession(id)
      if (loaded) {
        activeSession.value = loaded
        historyVisible.value = false
      }
    } catch (error) {
      console.error('[aiChat] failed to load session', error)
    }
  }

  const DELETE_SESSION = async(id: string): Promise<void> => {
    try {
      await window.aiChat.deleteSession(id)
      if (activeSession.value?.id === id) activeSession.value = null
    } catch (error) {
      console.error('[aiChat] failed to delete session', error)
    }
    await LIST_SESSIONS()
  }

  const persistActiveSession = async(): Promise<void> => {
    const session = activeSession.value
    if (!session || session.messages.length === 0) return
    try {
      await window.aiChat.saveSession(toPlain(session))
      await LIST_SESSIONS()
    } catch (error) {
      console.error('[aiChat] failed to save session', error)
    }
  }

  const ABORT = (): void => {
    if (!activeRequestId) return
    void window.aiChat.abortChat(activeRequestId)
  }

  const handleChatEvent = (requestId: string, event: AiStreamEvent): void => {
    if (requestId !== activeRequestId) return
    const session = activeSession.value
    const assistant = session?.messages[session.messages.length - 1]
    if (!session || !assistant || assistant.role !== 'assistant') return

    switch (event.type) {
      case 'text-delta': {
        const last = assistant.parts[assistant.parts.length - 1]
        if (last?.type === 'text') {
          last.text += event.text
        } else {
          const textPart: AiTextPart = { type: 'text', text: event.text }
          assistant.parts.push(textPart)
        }
        break
      }
      case 'thinking-delta': {
        const last = assistant.parts[assistant.parts.length - 1]
        if (last?.type === 'thinking') {
          last.text += event.text
        } else {
          const thinkingPart: AiThinkingPart = { type: 'thinking', text: event.text }
          assistant.parts.push(thinkingPart)
        }
        break
      }
      case 'thinking-signature': {
        for (let i = assistant.parts.length - 1; i >= 0; i--) {
          const part = assistant.parts[i]
          if (part.type === 'thinking') {
            part.signature = event.signature
            break
          }
        }
        break
      }
      case 'tool-call': {
        let args: Record<string, unknown> = {}
        try {
          args = event.argsJson ? (JSON.parse(event.argsJson) as Record<string, unknown>) : {}
        } catch {
          // An unparsable call yields an empty arg object; the executor
          // reports the failure back to the model as the tool result.
        }
        const callPart: AiToolCallPart = { type: 'tool-call', id: event.id, name: event.name, args }
        assistant.parts.push(callPart)
        break
      }
      case 'done':
        settleCurrentRequest?.('done')
        break
      case 'aborted':
        settleCurrentRequest?.('aborted')
        break
      case 'error': {
        const errorPart: AiTextPart = { type: 'text', text: `\n\n> ⚠️ ${event.message}` }
        assistant.parts.push(errorPart)
        settleCurrentRequest?.('error')
        break
      }
      default:
        break
    }
  }

  const ensureActiveSession = (): AiChatSession => {
    if (!activeSession.value) activeSession.value = createSession()
    return activeSession.value
  }

  const buildUserMessage = (prompt: string): AiChatMessage => {
    const message: AiChatMessage = {
      id: createId(),
      role: 'user',
      parts: [{ type: 'text', text: prompt }],
      createdAt: Date.now()
    }
    return message
  }

  // Rough token->character conversion (mixed CJK/Latin); clamped so a huge
  // context window still cannot produce an unbounded payload.
  const docContextCharLimit = (): number => {
    const provider = config.value.providers.find(
      item => item.id === config.value.activeProviderId
    )
    if (!provider?.contextTokens) return DOC_CONTEXT_MAX_LENGTH
    return Math.min(120000, Math.max(4000, Math.floor(provider.contextTokens * 3)))
  }

  // Fresh markdown every round so follow-up tool calls see earlier edits;
  // references ride only with the round that consumes them.
  const buildRequestSystem = (turnReferences: { text: string; location?: string }[]): string =>
    buildSystemPrompt({
      docMarkdown: docContextEnabled.value ? getActiveDocumentMarkdown() : null,
      references: turnReferences,
      maxDocChars: docContextCharLimit()
    })

  const runStreamRequest = (turnReferences: { text: string; location?: string }[]): Promise<'done' | 'aborted' | 'error'> => {
    return new Promise(resolve => {
      settleCurrentRequest = stop => {
        settleCurrentRequest = null
        resolve(stop)
      }
      const session = activeSession.value
      if (!session) {
        settleCurrentRequest('error')
        return
      }
      activeRequestId = `ai-${createId()}-${requestSeq++}`
      const provider = config.value.providers.find(
        item => item.id === config.value.activeProviderId
      )
      void window.aiChat
        .startChat({
          requestId: activeRequestId,
          provider: {
            type: provider?.type ?? 'openai-compatible',
            baseUrl: provider?.baseUrl ?? '',
            apiKey: provider?.apiKey ?? '',
            ...(provider?.maxOutputTokens !== undefined
              ? { maxOutputTokens: provider.maxOutputTokens }
              : {}),
            ...(provider?.temperature !== undefined ? { temperature: provider.temperature } : {})
          },
          model: config.value.activeModel,
          thinkingLevel: config.value.thinkingLevel,
          system: buildRequestSystem(turnReferences),
          messages: toPlain(session.messages),
          tools: AI_TOOLS
        })
        .catch(error => {
          const failure: AiTextPart = {
            type: 'text',
            text: `\n\n> ⚠️ ${error instanceof Error ? error.message : String(error)}`
          }
          session.messages[session.messages.length - 1]?.parts.push(failure)
          settleCurrentRequest?.('error')
        })
    })
  }

  const pendingToolCalls = (assistant: AiChatMessage): AiToolCallPart[] => {
    const answered = new Set(
      assistant.parts
        .filter(part => part.type === 'tool-result')
        .map(part => part.toolCallId)
    )
    return assistant.parts.filter(
      (part): part is AiToolCallPart => isToolCallPart(part) && !answered.has(part.id)
    )
  }

  const SEND_PROMPT = async(prompt: string): Promise<void> => {
    const trimmed = prompt.trim()
    if (!trimmed || streaming.value) return
    const provider = config.value.providers.find(item => item.id === config.value.activeProviderId)
    if (!provider || !config.value.activeModel) {
      settingsVisible.value = true
      return
    }

    const session = ensureActiveSession()
    if (!session.title) {
      session.title = trimmed.slice(0, SESSION_TITLE_MAX_LENGTH)
    }
    session.messages.push(buildUserMessage(trimmed))
    const assistant: AiChatMessage = {
      id: createId(),
      role: 'assistant',
      parts: [],
      createdAt: Date.now()
    }
    session.messages.push(assistant)
    session.updatedAt = Date.now()

    streaming.value = true
    // References are consumed by the request that carries them.
    const turnReferences = references.value.map(item => ({
      text: item.text,
      ...(item.location ? { location: item.location } : {})
    }))
    references.value = []

    try {
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        const stop = await runStreamRequest(round === 0 ? turnReferences : [])
        if (stop !== 'done') break

        const calls = pendingToolCalls(assistant)
        if (calls.length === 0) break
        if (round === MAX_TOOL_ROUNDS) {
          const limitPart: AiTextPart = {
            type: 'text',
            text: '\n\n> ⚠️ 工具调用轮数已达上限,已停止继续执行。'
          }
          assistant.parts.push(limitPart)
          break
        }
        for (const call of calls) {
          const execution = await executeAiTool(call)
          session.updatedAt = Date.now()
          assistant.parts.push({
            type: 'tool-result',
            toolCallId: call.id,
            ok: execution.ok,
            result: execution.result
          })
        }
      }
    } finally {
      streaming.value = false
      activeRequestId = ''
      session.updatedAt = Date.now()
      await persistActiveSession()
    }
  }

  const insertSvgFromMessage = async(svg: string): Promise<void> => {
    await executeAiTool({ name: 'insert_svg', args: { svg } })
  }

  return {
    config,
    sessions,
    activeSession,
    panelOpen,
    panelWidth,
    docContextEnabled,
    references,
    streaming,
    historyVisible,
    settingsVisible,
    INIT_CONFIG,
    UPDATE_CONFIG,
    LIST_SESSIONS,
    TOGGLE_PANEL,
    SET_PANEL_WIDTH,
    ADD_REFERENCE,
    REMOVE_REFERENCE,
    NEW_SESSION,
    LOAD_SESSION,
    DELETE_SESSION,
    ABORT,
    SEND_PROMPT,
    insertSvgFromMessage
  }
})
