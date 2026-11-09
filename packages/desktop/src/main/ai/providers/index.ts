import type { AiChatRequest, AiStreamEvent } from '@shared/types/aiChat'
import { streamAnthropic } from './anthropic'
import { streamOpenAiCompatible } from './openaiCompatible'

type FetchLike = (url: string, init: RequestInit) => Promise<Response>
type EventHandler = (event: AiStreamEvent) => void

export type { consumeSseStream } from './sse'

/** Dispatches one streaming completion to the matching provider adapter. */
export const streamChatCompletion = (
  request: AiChatRequest,
  fetchImpl: FetchLike,
  onEvent: EventHandler,
  signal: AbortSignal
): Promise<void> => {
  if (request.provider.type === 'anthropic') {
    return streamAnthropic(request, fetchImpl, onEvent, signal)
  }
  return streamOpenAiCompatible(request, fetchImpl, onEvent, signal)
}
