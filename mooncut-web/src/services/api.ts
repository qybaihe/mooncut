import type { AuthUser, BillingPlanId, BillingSummary, CapabilityCatalogItem, CapabilityInstallation, CapabilityInvocation, CoachAdviceResponse, CommunityPost, CommunityRegistryPackage, EditJob, ScriptAssistantResponse } from '../types'

// 生产（Cloudflare Pages）：同域 /api/* → Pages Functions（auth/助手）+ 剪辑走 Tunnel。
// 本地开发：可设 VITE_MOONCUT_API_BASE_URL=http://127.0.0.1:4317
const apiBase = (import.meta.env.VITE_MOONCUT_API_BASE_URL || '/api').replace(/\/$/, '')

function friendlyNetworkError(error: unknown): Error {
  if (!(error instanceof Error)) return new Error('网络异常，请稍后再试')
  const msg = error.message || ''
  // Safari: TypeError "Load failed"; Chromium: "Failed to fetch"
  if (
    error.name === 'TypeError' ||
    /load failed|failed to fetch|networkerror|network request failed/i.test(msg)
  ) {
    return new Error('网络连接失败，请检查网络后重试。若刚部署站点，请强制刷新页面（⌘⇧R）。')
  }
  if (/unexpected token|json|not valid json/i.test(msg)) {
    return new Error('服务返回了异常页面，请稍后重试或强制刷新。')
  }
  return error
}

function isRetryableNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const msg = error.message || ''
  return (
    error.name === 'TypeError' ||
    /load failed|failed to fetch|networkerror|network request failed/i.test(msg)
  )
}

async function rawFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${apiBase}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.headers || {}),
    },
  })
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await rawFetch(path, init)
  } catch (error) {
    // One quiet retry for auth/session — Safari "Load failed" is often a transient blip during deploys.
    const method = (init?.method || 'GET').toUpperCase()
    const isAuth = path.startsWith('/v1/auth/')
    if (isAuth && isRetryableNetworkError(error) && method !== 'GET' && method !== 'HEAD') {
      try {
        await new Promise((r) => setTimeout(r, 350))
        response = await rawFetch(path, init)
      } catch (retryError) {
        throw friendlyNetworkError(retryError)
      }
    } else if (isAuth && isRetryableNetworkError(error) && (method === 'GET' || method === 'HEAD')) {
      try {
        await new Promise((r) => setTimeout(r, 250))
        response = await rawFetch(path, init)
      } catch (retryError) {
        throw friendlyNetworkError(retryError)
      }
    } else {
      throw friendlyNetworkError(error)
    }
  }

  const text = await response.text()
  let body: Record<string, unknown> = {}
  if (text) {
    try {
      body = JSON.parse(text) as Record<string, unknown>
    } catch {
      // SPA fallback HTML or empty edge error — common right after a partial deploy
      if (!response.ok) {
        throw new Error(`请求失败（${response.status}），接口暂时不可用，请强制刷新后重试`)
      }
      throw new Error('服务返回了非 JSON 响应，请强制刷新后重试')
    }
  }

  if (!response.ok) {
    const err = typeof body.error === 'string' ? body.error : `请求失败（${response.status}）`
    throw new Error(err)
  }
  return body as T
}

export async function getCurrentUser() {
  return request<{ user: AuthUser | null }>('/v1/auth/session')
}

export async function getBillingSummary() {
  return request<BillingSummary>('/v1/billing/summary')
}

export async function createBillingCheckout(plan: Exclude<BillingPlanId, 'free'>) {
  return request<{
    checkout: { id: string; plan: Exclude<BillingPlanId, 'free'>; status: string; checkoutUrl: string | null; createdAt: string }
    message: string
  }>('/v1/billing/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan }),
  })
}

export type AuthOtpPurpose = 'login' | 'register'

export async function sendAuthOtp(email: string, purpose: AuthOtpPurpose) {
  return request<{
    ok: true
    email: string
    purpose: AuthOtpPurpose
    expiresInSec: number
    resendAfterSec: number
  }>('/v1/auth/otp/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, purpose }),
  })
}

/** Register with password + email verification code. */
export async function register(email: string, password: string, code: string) {
  return request<{ user: AuthUser }>('/v1/auth/otp/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, code, purpose: 'register' }),
  })
}

/** Login with email verification code. */
export async function loginWithOtp(email: string, code: string) {
  return request<{ user: AuthUser }>('/v1/auth/otp/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code, purpose: 'login' }),
  })
}

/** Login with password (legacy / alternate). */
export async function login(email: string, password: string) {
  return request<{ user: AuthUser }>('/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
}

export async function logout() {
  return request<{ ok: true }>('/v1/auth/logout', { method: 'POST' })
}

export function artifactUrl(jobId: string, artifact = 'video') {
  return `${apiBase}/v1/edit-jobs/${jobId}/artifacts/${artifact}`
}

export async function getServiceModels() {
  return request<{
    available: string[]
    routing: {
      planner: string
      script: string
      coach: string
      vision: string[]
      image: { configured: boolean; model: string | null; maxImages: number }
    }
  }>('/v1/models')
}

export async function getMailStatus() {
  return request<{
    authorized: boolean
    aliases: Array<{ email: string; is_primary: boolean; name: string }>
    transport: 'agently-cli' | 'webhook' | 'local-agent'
    automatic: boolean
    requiresConfirmation: boolean
  }>('/v1/mail/status')
}

export async function uploadAsset(file: Blob, filename: string) {
  return request<{ assetId: string; filename: string; bytes: number }>(
    `/v1/assets?filename=${encodeURIComponent(filename)}`,
    { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file },
  )
}

export async function createEditJob(payload: {
  assetId: string
  title?: string
  prompt?: string
  notificationEmail?: string
  /** Browser-derived source duration for quota reservation; server reconciles with completed probe. */
  billingEstimateSeconds?: number
  imageGeneration?: 'auto' | 'off'
  capabilityInstallIds?: string[]
  capabilityRequests?: Array<
    | { installationId: string; tool: 'fifa_find_highlights'; input: { query: string } }
    | { installationId: string; tool: 'fifa_match_context'; input: { matchId: string; includeChineseContext?: boolean; screenshotView?: 'ratings' | 'match' | 'chat' }; confirmedArtifact?: boolean }
  >
}) {
  return request<{ id: string; status: EditJob['status']; statusUrl: string }>('/v1/edit-jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function getEditJob(jobId: string) {
  return request<EditJob>(`/v1/edit-jobs/${jobId}`)
}

export async function createSubtitleRepair(jobId: string, payload: {
  instruction: string
  atMs?: number
  replacementText?: string
}) {
  return request<{ id: string; status: EditJob['status']; statusUrl: string; parentJobId: string }>(`/v1/edit-jobs/${jobId}/subtitle-repairs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function listSubtitleRepairs(jobId: string) {
  return request<{ rootJobId: string; items: EditJob[] }>(`/v1/edit-jobs/${jobId}/subtitle-repairs`)
}

export async function prepareJobMail(jobId: string) {
  return request<{
    pendingId: string
    recipient: string
    summary: unknown
    expiresAt: string
  }>(`/v1/edit-jobs/${jobId}/mail/prepare`, { method: 'POST' })
}

export async function confirmJobMail(jobId: string, pendingId: string) {
  return request<{ ok: true; recipient: string }>(`/v1/edit-jobs/${jobId}/mail/${pendingId}/confirm`, { method: 'POST' })
}

export async function requestScriptAssistant(payload: {
  action?: 'guide' | 'generate' | 'polish'
  style?: 'oral' | 'short' | 'emotional'
  messages: Array<{ role: 'assistant' | 'user'; content: string }>
  draft?: string
}) {
  return request<ScriptAssistantResponse>('/v1/assistant/script', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function getAsrStatus() {
  return request<{
    configured: boolean
    provider: string
    model: string
    language: string
    mode: string
    note?: string
  }>('/v1/asr/status')
}

/** Send a short live audio chunk to edge → Deepgram. */
export async function transcribeAudioChunk(
  audio: Blob | ArrayBuffer,
  options?: {
    contentType?: string
    encoding?: string
    sampleRate?: number
    language?: string
    model?: string
    /** Nova-3 terminology hints from the known teleprompter script. */
    keyterms?: string[]
  },
) {
  const params = new URLSearchParams()
  if (options?.encoding) params.set('encoding', options.encoding)
  if (options?.sampleRate) params.set('sample_rate', String(options.sampleRate))
  if (options?.language) params.set('language', options.language)
  if (options?.model) params.set('model', options.model)
  for (const keyterm of options?.keyterms ?? []) {
    const value = keyterm.trim()
    if (value) params.append('keyterm', value)
  }
  const query = params.size ? `?${params}` : ''
  const body = audio instanceof Blob ? audio : new Blob([audio])
  return request<{
    transcript: string
    confidence: number | null
    duration: number | null
    provider: string
    model: string
    language: string
  }>(`/v1/asr/transcribe${query}`, {
    method: 'POST',
    headers: {
      'Content-Type': options?.contentType || (audio instanceof Blob ? audio.type || 'application/octet-stream' : 'application/octet-stream'),
    },
    body,
  })
}

export async function requestCoachAdvice(payload: {
  transcript: string
  currentScript: string
  currentSentence: string
  lastAdvice?: string
  metrics: {
    pace: number
    wordCount: number
    volume: number
    pauseCount: number
    eyeContact?: number
    elapsedSeconds: number
  }
}) {
  return request<CoachAdviceResponse>('/v1/assistant/coach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function listCommunityPosts(cursor?: string) {
  const query = new URLSearchParams({ limit: '12' })
  if (cursor) query.set('cursor', cursor)
  return request<{ items: CommunityPost[]; nextCursor?: string }>(`/v1/community/posts?${query}`)
}

export async function publishCommunityPost(payload: {
  jobId: string
  authorName?: string
  title?: string
  caption?: string
}) {
  return request<{ created: boolean; post: CommunityPost }>('/v1/community/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export function communityPackageAssetUrl(path: string) {
  if (!path.startsWith('/api/v1/community/packages/')) throw new Error('能力包资源地址无效')
  return `${apiBase}${path.slice('/api'.length)}`
}

export async function listCommunityPackages(query?: string) {
  const params = new URLSearchParams()
  if (query?.trim()) params.set('query', query.trim())
  return request<{ items: CommunityRegistryPackage[] }>(`/v1/community/packages${params.size ? `?${params}` : ''}`)
}

export async function uploadCommunityPackage(form: FormData) {
  return request<{ item: CommunityRegistryPackage }>('/v1/community/packages', {
    method: 'POST',
    body: form,
  })
}

export async function connectCommunityPackage(slug: string) {
  return request<{ created: boolean; installation: CapabilityInstallation }>(
    `/v1/community/packages/${encodeURIComponent(slug)}/connect`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
  )
}

export async function listCapabilities(query?: string) {
  const params = new URLSearchParams()
  if (query?.trim()) params.set('query', query.trim())
  return request<{ items: CapabilityCatalogItem[] }>(`/v1/capabilities${params.size ? `?${params}` : ''}`)
}

export async function listCapabilityInstallations() {
  return request<{ items: CapabilityInstallation[] }>('/v1/me/capability-installations')
}

export async function installCapability(slug: string) {
  return request<{ created: boolean; installation: CapabilityInstallation }>(`/v1/capabilities/${encodeURIComponent(slug)}/install`, { method: 'POST' })
}

export async function setCapabilityInstallationStatus(id: string, status: 'enabled' | 'disabled') {
  return request<{ installation: CapabilityInstallation }>(`/v1/me/capability-installations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })
}

export async function uninstallCapability(id: string) {
  return request<{ ok: true }>(`/v1/me/capability-installations/${id}`, { method: 'DELETE' })
}

export async function reconfirmCapability(id: string) {
  return request<{ installation: CapabilityInstallation }>(`/v1/me/capability-installations/${id}/reconfirm`, { method: 'POST' })
}

export async function preflightCapability(id: string, input: unknown = {}) {
  const result = await request<{ ok: boolean; detail?: string; message?: string }>(
    `/v1/me/capability-installations/${id}/preflight`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input ?? {}),
    },
  )
  return {
    ok: result.ok,
    message: result.message || result.detail || (result.ok ? '预检通过' : '预检未通过'),
  }
}

export async function invokeCapability(id: string, input: unknown) {
  return request<{ invocation: CapabilityInvocation }>(`/v1/me/capability-installations/${id}/invoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input ?? {}),
  })
}
