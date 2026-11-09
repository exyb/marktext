import type {
  AiModelListResult,
  AiModelProbeRequest,
  AiModelProbeResult,
  AiProviderCredentials
} from '@shared/types/aiChat'

type FetchLike = (url: string, init: RequestInit) => Promise<Response>

const PROBE_TIMEOUT_MS = 20000
const PROBE_MAX_TOKENS = 256

const joinUrl = (baseUrl: string, path: string): string =>
  `${baseUrl.replace(/\/+$/, '')}${path}`

const credentialsHeaders = (credentials: AiProviderCredentials): Record<string, string> =>
  credentials.type === 'anthropic'
    ? {
      'x-api-key': credentials.apiKey,
      'anthropic-version': '2023-06-01'
    }
    : { Authorization: `Bearer ${credentials.apiKey}` }

const errorFromResponse = async(response: Response): Promise<string> => {
  const detail = (await response.text().catch(() => '')).slice(0, 300)
  return `HTTP ${response.status}: ${detail || response.statusText}`
}

// OpenAI-compatible and Anthropic both expose GET /models returning
// `{ data: [{ id }] }`; only the path and auth headers differ.
export const listProviderModels = async(
  credentials: AiProviderCredentials,
  fetchImpl: FetchLike
): Promise<AiModelListResult> => {
  if (!credentials.baseUrl) return { ok: false, error: 'API 地址不能为空' }
  const path = credentials.type === 'anthropic' ? '/v1/models' : '/models'
  try {
    const response = await fetchImpl(joinUrl(credentials.baseUrl, path), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...credentialsHeaders(credentials)
      }
    })
    if (!response.ok) {
      return { ok: false, error: await errorFromResponse(response) }
    }
    const body = (await response.json()) as { data?: Array<{ id?: string }> }
    const models = (body.data ?? [])
      .map((item) => (typeof item?.id === 'string' ? item.id : ''))
      .filter(Boolean)
    return { ok: true, models: [...new Set(models)].sort() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const testProviderModel = async(
  request: AiModelProbeRequest,
  fetchImpl: FetchLike
): Promise<AiModelProbeResult> => {
  if (!request.baseUrl) return { ok: false, error: 'API 地址不能为空' }
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const isAnthropic = request.type === 'anthropic'
    const url = joinUrl(request.baseUrl, isAnthropic ? '/v1/messages' : '/chat/completions')
    const body = isAnthropic
      ? {
        model: request.model,
        max_tokens: PROBE_MAX_TOKENS,
        stream: false,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }]
      }
      : {
        model: request.model,
        max_tokens: PROBE_MAX_TOKENS,
        stream: false,
        messages: [{ role: 'user', content: 'ping' }]
      }
    const response = await fetchImpl(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...credentialsHeaders(request) },
      body: JSON.stringify(body)
    })
    if (!response.ok) {
      return { ok: false, error: await errorFromResponse(response) }
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      content?: Array<{ type?: string; text?: string }>
    }
    const reply = isAnthropic
      ? payload.content?.map((block) => block.text ?? '').join('') ?? ''
      : payload.choices?.[0]?.message?.content ?? ''
    const detail = reply.trim().slice(0, 120) || '连接成功(模型返回空回复)'
    return { ok: true, detail, latencyMs: Date.now() - started }
  } catch (error) {
    if (controller.signal.aborted) {
      return { ok: false, error: `连接超时(${PROBE_TIMEOUT_MS / 1000}s)` }
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timer)
  }
}
