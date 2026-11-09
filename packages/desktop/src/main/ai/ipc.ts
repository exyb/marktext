import { ipcMain, net } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import type {
  AiChatConfig,
  AiChatRequest,
  AiChatSession,
  AiModelProbeRequest,
  AiProviderCredentials,
  AiStreamEvent
} from '@shared/types/aiChat'
import { AiChatStore } from './store'
import { streamChatCompletion } from './providers'
import { listProviderModels, testProviderModel } from './providers/probe'

// Handler registration runs before Accessor exists, so the store is bound to
// the user data path lazily, mirroring the plantuml server source pattern.
let storeSource: (() => string) | null = null
let store: AiChatStore | null = null

export const setAiChatStoreSource = (source: () => string): void => {
  storeSource = source
}

const getStore = (): AiChatStore => {
  if (!store) {
    if (!storeSource) throw new Error('AI chat store is not initialized')
    store = new AiChatStore(storeSource())
  }
  return store
}

const activeRequests = new Map<string, AbortController>()

const registerConfigHandlers = (): void => {
  ipcMain.handle('mt::ai::config-get', () => getStore().getConfig())
  ipcMain.handle('mt::ai::config-update', (_event: IpcMainInvokeEvent, config: AiChatConfig) =>
    getStore().updateConfig(config)
  )
}

const registerSessionHandlers = (): void => {
  ipcMain.handle('mt::ai::session-list', () => getStore().listSessions())
  ipcMain.handle('mt::ai::session-load', (_event: IpcMainInvokeEvent, id: string) =>
    getStore().loadSession(id)
  )
  ipcMain.handle('mt::ai::session-save', (_event: IpcMainInvokeEvent, session: AiChatSession) =>
    getStore().saveSession(session)
  )
  ipcMain.handle('mt::ai::session-delete', (_event: IpcMainInvokeEvent, id: string) =>
    getStore().deleteSession(id)
  )
}

const registerChatHandlers = (): void => {
  ipcMain.handle('mt::ai::chat-start', (event: IpcMainInvokeEvent, request: AiChatRequest) => {
    const controller = new AbortController()
    activeRequests.set(request.requestId, controller)
    const sender = event.sender
    const push = (streamEvent: AiStreamEvent): void => {
      if (!sender.isDestroyed()) sender.send('mt::ai::chat-event', request.requestId, streamEvent)
    }
    // The streaming loop runs detached; completion and errors are pushed as
    // events, and the renderer drives any tool-call continuation rounds.
    void streamChatCompletion(request, net.fetch, push, controller.signal)
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          push({ type: 'aborted' })
          return
        }
        push({
          type: 'error',
          message: error instanceof Error ? error.message : String(error)
        })
      })
      .finally(() => {
        activeRequests.delete(request.requestId)
      })
    return true
  })

  ipcMain.handle('mt::ai::chat-abort', (_event, requestId: string) => {
    const controller = activeRequests.get(requestId)
    if (!controller) return false
    controller.abort()
    return true
  })
}

const registerProbeHandlers = (): void => {
  ipcMain.handle(
    'mt::ai::fetch-models',
    (_event: IpcMainInvokeEvent, credentials: AiProviderCredentials) =>
      listProviderModels(credentials, net.fetch)
  )
  ipcMain.handle(
    'mt::ai::test-model',
    (_event: IpcMainInvokeEvent, request: AiModelProbeRequest) =>
      testProviderModel(request, net.fetch)
  )
}

export const registerAiChatHandlers = (): void => {
  registerConfigHandlers()
  registerSessionHandlers()
  registerChatHandlers()
  registerProbeHandlers()
}
