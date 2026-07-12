import type { EdgeUser, Env } from './auth'
import { json } from './auth'

/**
 * Paths allowed to leave the edge and hit the local video agent via Tunnel.
 * Everything else stays on Cloudflare (auth, assistants, stubs).
 */
export const isVideoAgentPath = (pathname: string) => {
  // One-shot upload + create edit
  if (pathname === '/v1/edits') return true
  // Asset upload then create job (ClipStudio flow)
  if (pathname === '/v1/assets') return true
  if (pathname === '/v1/edit-jobs') return true
  // Status / cancel / artifacts / subtitle repair for in-flight jobs
  if (pathname.startsWith('/v1/edit-jobs/')) return true
  // A community package is installed only into the user's own local Agent.
  // Its bytes stay on Pages/D1; this route forwards a verified declaration.
  if (pathname === '/v1/capabilities/import') return true
  // Finished-video sharing remains local because the render artifacts live on
  // the creator's Agent. Package uploads/downloads are handled by Pages/D1.
  if (pathname.startsWith('/v1/community/posts')) return true
  // Health probe only
  if (pathname === '/healthz' || pathname === '/v1/agent/health') return true
  // LLM relay: CF edge → tunnel → local gateway (when CF cannot reach the LLM IP)
  if (pathname === '/v1/edge-relay/chat/completions') return true
  return false
}

export const isAuthPath = (pathname: string) =>
  pathname === '/v1/auth/register' ||
  pathname === '/v1/auth/login' ||
  pathname === '/v1/auth/logout' ||
  pathname === '/v1/auth/session' ||
  pathname === '/v1/auth/me' ||
  pathname === '/v1/auth/otp/send' ||
  pathname === '/v1/auth/otp/verify' ||
  pathname.startsWith('/v1/auth/')

/** Ensure create-edit requests always carry a delivery email for local mailing. */
export const withNotificationEmail = (request: Request, targetPath: string, user: EdgeUser | null) => {
  if (!user?.email) return { request, targetPath }
  const url = new URL(request.url)
  const pathname = url.pathname.replace(/^\/api/, '')
  const isCreate =
    (request.method === 'POST' && pathname === '/v1/edits') ||
    (request.method === 'POST' && pathname === '/v1/edit-jobs')
  if (!isCreate) return { request, targetPath }

  if (pathname === '/v1/edits') {
    const agentUrl = new URL(targetPath, 'https://agent.local')
    if (!agentUrl.searchParams.get('notificationEmail')) {
      agentUrl.searchParams.set('notificationEmail', user.email)
    }
    return { request, targetPath: agentUrl.pathname + agentUrl.search }
  }

  // JSON create job: inject notificationEmail into body if missing
  return { request, targetPath, injectEmail: user.email }
}

export const proxyToAgent = async (
  request: Request,
  env: Env,
  targetPath: string,
  user: EdgeUser | null,
  entitlements?: { maxOutputHeight?: 720 | 1080 | 2160 },
) => {
  const origin = (env.AGENT_ORIGIN || '').replace(/\/$/, '')
  const key = env.AGENT_INTERNAL_KEY || ''
  if (!origin) {
    return json(
      {
        error: '渲染节点未配置',
        code: 'AGENT_ORIGIN_MISSING',
        detail: 'Set AGENT_ORIGIN to the Cloudflare Tunnel URL for the local video agent.',
      },
      503,
    )
  }
  if (!key || key.length < 16) {
    return json(
      {
        error: '渲染节点密钥未配置',
        code: 'AGENT_KEY_MISSING',
        detail: 'Set AGENT_INTERNAL_KEY (must match MOONCUT_API_KEY on the local agent).',
      },
      503,
    )
  }

  const patched = withNotificationEmail(request, targetPath, user)
  let path = patched.targetPath
  if (entitlements?.maxOutputHeight && request.method === 'POST' && path.startsWith('/v1/edits')) {
    const agentUrl = new URL(path, 'https://agent.local')
    agentUrl.searchParams.set('maxOutputHeight', String(entitlements.maxOutputHeight))
    path = agentUrl.pathname + agentUrl.search
  }
  let body: ArrayBuffer | undefined

  const headers = new Headers()
  const contentType = request.headers.get('content-type')
  if (contentType) headers.set('content-type', contentType)
  const accept = request.headers.get('accept')
  if (accept) headers.set('accept', accept)
  headers.set('authorization', `Bearer ${key}`)
  if (user) {
    headers.set('x-mooncut-user-id', user.id)
    headers.set('x-mooncut-user-email', user.email)
  }
  headers.set('x-mooncut-edge', '1')

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    if (
      request.method === 'POST' &&
      path.startsWith('/v1/edit-jobs') &&
      !path.slice('/v1/edit-jobs'.length).includes('/') &&
      contentType?.includes('application/json') &&
      user?.email
    ) {
        const raw = await request.text()
        try {
          const parsed = JSON.parse(raw || '{}') as Record<string, unknown>
          if (!parsed.notificationEmail) parsed.notificationEmail = user.email
          // Edge-owned entitlement: never accept a browser supplied export height.
          if (entitlements?.maxOutputHeight) parsed.maxOutputHeight = entitlements.maxOutputHeight
          body = new TextEncoder().encode(JSON.stringify(parsed)).buffer
        headers.set('content-type', 'application/json')
      } catch {
        body = new TextEncoder().encode(raw).buffer
      }
    } else {
      body = await request.arrayBuffer()
    }
  }

  const target = `${origin}${path}`
  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: 'manual',
    ...(body !== undefined ? { body } : {}),
  }

  try {
    const upstream = await fetch(target, init)
    const respHeaders = new Headers(upstream.headers)
    respHeaders.delete('content-encoding')
    respHeaders.delete('content-length')
    respHeaders.delete('set-cookie')
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: respHeaders,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Agent unreachable'
    return json(
      {
        error: '渲染节点不可达，请确认本机 Agent 与 Tunnel 已启动',
        code: 'AGENT_UNREACHABLE',
        detail: message,
      },
      502,
    )
  }
}
