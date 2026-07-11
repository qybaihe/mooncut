import type { AuthUser, CapabilityCatalogItem, CapabilityInstallation, CapabilityInvocation, CoachAdviceResponse, CommunityPost, EditJob, RenderQueueSnapshot, ScriptAssistantResponse } from '../types'

const apiBase = (import.meta.env.VITE_MOONCUT_API_BASE_URL || 'http://127.0.0.1:4317').replace(/\/$/, '')

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, { credentials: 'include', ...init })
  const text = await response.text()
  const body = text ? JSON.parse(text) : {}
  if (!response.ok) throw new Error(body.error || `请求失败（${response.status}）`)
  return body as T
}

export async function getCurrentUser() {
  return request<{ user: AuthUser | null }>('/v1/auth/session')
}

export async function register(email: string, password: string) {
  return request<{ user: AuthUser }>('/v1/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
}

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
    transport: 'agently-cli' | 'webhook'
    automatic: boolean
    requiresConfirmation: boolean
  }>('/v1/mail/status')
}

export async function getRenderQueue() {
  return request<RenderQueueSnapshot>('/v1/render-queue')
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

export async function preflightCapability(id: string) {
  return request<{ checkedAt: string; ok: boolean; message: string }>(`/v1/me/capability-installations/${id}/preflight`, { method: 'POST' })
}

export async function invokeCapability(id: string, payload: { tool: 'fifa_find_highlights'; input: { query: string } } | { tool: 'fifa_match_context'; input: { matchId: string; includeChineseContext?: boolean; screenshotView?: 'ratings' | 'match' | 'chat' }; confirmedArtifact?: boolean }) {
  return request<CapabilityInvocation>(`/v1/me/capability-installations/${id}/invoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}
