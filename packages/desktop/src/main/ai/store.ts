import { readFile, readdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import { AtomicJsonFile } from '../applicationState/atomicJsonFile'
import type {
  AiChatConfig,
  AiChatMessage,
  AiChatSession,
  AiChatSessionMeta,
  AiMessagePart,
  AiProviderConfig,
  AiProviderType,
  AiThinkingLevel
} from '@shared/types/aiChat'

// Session ids double as file names, so restrict them to a safe charset.
const SESSION_ID_RE = /^[A-Za-z0-9_-]+$/

const THINKING_LEVELS: AiThinkingLevel[] = ['off', 'low', 'medium', 'high']
const PROVIDER_TYPES: AiProviderType[] = ['openai-compatible', 'anthropic']

const defaultConfig = (): AiChatConfig => ({
  providers: [],
  activeProviderId: '',
  activeModel: '',
  thinkingLevel: 'off'
})

const asString = (value: unknown, fallback: string): string =>
  typeof value === 'string' ? value : fallback

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

// Optional numeric provider fields are clamped so a bad value in the file
// cannot produce an unusable request downstream.
const asClampedNumber = (value: unknown, min: number, max: number): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(max, Math.max(min, value))
}

const parseProvider = (value: unknown): AiProviderConfig | null => {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const id = asString(raw.id, '')
  if (!id) return null
  return {
    id,
    name: asString(raw.name, id),
    type: PROVIDER_TYPES.includes(raw.type as AiProviderType)
      ? (raw.type as AiProviderType)
      : 'openai-compatible',
    baseUrl: asString(raw.baseUrl, ''),
    apiKey: asString(raw.apiKey, ''),
    models: asStringArray(raw.models),
    contextTokens: asClampedNumber(raw.contextTokens, 1024, 10_000_000),
    maxOutputTokens: asClampedNumber(raw.maxOutputTokens, 16, 1_000_000),
    temperature: asClampedNumber(raw.temperature, 0, 2)
  }
}

const parseConfig = (value: unknown): AiChatConfig => {
  if (typeof value !== 'object' || value === null) {
    throw new Error('AI chat config file is malformed')
  }
  const raw = value as Record<string, unknown>
  const providers = Array.isArray(raw.providers)
    ? raw.providers
      .map(parseProvider)
      .filter((provider): provider is AiProviderConfig => provider !== null)
    : []
  const activeProvider = providers.find(provider => provider.id === raw.activeProviderId)
  return {
    providers,
    activeProviderId: activeProvider ? activeProvider.id : '',
    activeModel: activeProvider?.models.includes(asString(raw.activeModel, ''))
      ? asString(raw.activeModel, '')
      : '',
    thinkingLevel: THINKING_LEVELS.includes(raw.thinkingLevel as AiThinkingLevel)
      ? (raw.thinkingLevel as AiThinkingLevel)
      : 'off'
  }
}

const parseMessagePart = (value: unknown): AiMessagePart | null => {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  switch (raw.type) {
    case 'text':
      return { type: 'text', text: asString(raw.text, '') }
    case 'thinking':
      return {
        type: 'thinking',
        text: asString(raw.text, ''),
        ...(typeof raw.signature === 'string' ? { signature: raw.signature } : {})
      }
    case 'tool-call':
      return {
        type: 'tool-call',
        id: asString(raw.id, ''),
        name: asString(raw.name, ''),
        args:
          typeof raw.args === 'object' && raw.args !== null
            ? (raw.args as Record<string, unknown>)
            : {}
      }
    case 'tool-result':
      return {
        type: 'tool-result',
        toolCallId: asString(raw.toolCallId, ''),
        ok: raw.ok === true,
        result: asString(raw.result, '')
      }
    default:
      return null
  }
}

const parseSession = (value: unknown): AiChatSession => {
  if (typeof value !== 'object' || value === null) {
    throw new Error('AI chat session file is malformed')
  }
  const raw = value as Record<string, unknown>
  const id = asString(raw.id, '')
  if (!id) throw new Error('AI chat session file has no id')
  const messages = Array.isArray(raw.messages)
    ? raw.messages
      .map((message): AiChatMessage | null => {
        if (typeof message !== 'object' || message === null) return null
        const item = message as Record<string, unknown>
        const parts = Array.isArray(item.parts)
          ? item.parts.map(parseMessagePart).filter((part): part is AiMessagePart => part !== null)
          : []
        return {
          id: asString(item.id, ''),
          role: item.role === 'assistant' ? 'assistant' : 'user',
          parts,
          createdAt: typeof item.createdAt === 'number' ? item.createdAt : 0
        }
      })
      .filter((message): message is AiChatMessage => message !== null)
    : []
  return {
    id,
    title: asString(raw.title, ''),
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
    messages
  }
}

export class AiChatStore {
  private readonly _configFile: AtomicJsonFile<AiChatConfig>
  private readonly _sessionsDir: string
  private readonly _sessionFiles = new Map<string, AtomicJsonFile<AiChatSession>>()

  constructor(userDataPath: string) {
    const aiDir = path.join(userDataPath, 'ai-chat')
    this._configFile = new AtomicJsonFile(
      path.join(aiDir, 'config.json'),
      parseConfig,
      defaultConfig
    )
    this._sessionsDir = path.join(aiDir, 'sessions')
  }

  async getConfig(): Promise<AiChatConfig> {
    return (await this._configFile.load()).value
  }

  async updateConfig(config: AiChatConfig): Promise<boolean> {
    // Re-parse through the same validator the file uses, so the API key and
    // provider shape stay consistent even when callers hand over raw objects.
    await this._configFile.write(parseConfig(config))
    return true
  }

  private _sessionFile(id: string): AtomicJsonFile<AiChatSession> {
    if (!SESSION_ID_RE.test(id)) throw new Error(`Invalid AI chat session id: ${id}`)
    let file = this._sessionFiles.get(id)
    if (!file) {
      file = new AtomicJsonFile(
        path.join(this._sessionsDir, `${id}.json`),
        parseSession,
        () => ({ id, title: '', createdAt: 0, updatedAt: 0, messages: [] })
      )
      this._sessionFiles.set(id, file)
    }
    return file
  }

  async listSessions(): Promise<AiChatSessionMeta[]> {
    let entries: string[]
    try {
      entries = await readdir(this._sessionsDir)
    } catch {
      return []
    }
    const metas: AiChatSessionMeta[] = []
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue
      try {
        const content = await readFile(path.join(this._sessionsDir, entry), 'utf8')
        const session = parseSession(JSON.parse(content))
        metas.push({
          id: session.id,
          title: session.title,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          messageCount: session.messages.length
        })
      } catch {
        // A corrupt session file is skipped so the list stays usable.
      }
    }
    metas.sort((a, b) => b.updatedAt - a.updatedAt)
    return metas
  }

  async loadSession(id: string): Promise<AiChatSession | null> {
    const result = await this._sessionFile(id).load()
    return result.status === 'loaded' || result.status === 'read-only-defaulted'
      ? result.value
      : null
  }

  async saveSession(session: AiChatSession): Promise<boolean> {
    await this._sessionFile(session.id).write(parseSession(session))
    return true
  }

  async deleteSession(id: string): Promise<boolean> {
    const file = this._sessionFile(id)
    await file.remove(() => {})
    this._sessionFiles.delete(id)
    try {
      await unlink(path.join(this._sessionsDir, `${id}.json`))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    return true
  }
}
