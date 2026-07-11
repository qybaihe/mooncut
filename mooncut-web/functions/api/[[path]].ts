// MoonCut edge API
//
// Auth + assistants: Cloudflare (D1 / env-configured upstreams)
// Video cut only: Tunnel → local agent → email finished MP4 to user

import {
  AuthHttpError,
  clearSessionCookie,
  deleteSession,
  getUserBySession,
  json,
  loginUser,
  loginWithOtp,
  parseSessionCookie,
  registerWithOtp,
  sendEmailOtp,
  sessionCookie,
  type Env,
} from '../lib/auth'
import { handleAsrStatus, handleAsrTranscribe, type AsrEnv } from '../lib/asr'
import { isAuthPath, isVideoAgentPath, proxyToAgent } from '../lib/proxy'
import { handleCoachAssistant, handleModels, handleScriptAssistant, type UpstreamEnv } from '../lib/upstream'

type FullEnv = Env & UpstreamEnv & AsrEnv

const readJson = async (request: Request) => {
  try {
    return await request.json()
  } catch {
    return null
  }
}

const handleAuth = async (request: Request, env: FullEnv, pathname: string) => {
  const rawToken = parseSessionCookie(request.headers.get('cookie'))

  if (request.method === 'POST' && pathname === '/v1/auth/otp/send') {
    const body = (await readJson(request)) as { email?: unknown; purpose?: unknown } | null
    const clientIp = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')
    const result = await sendEmailOtp(env, body?.email, body?.purpose, clientIp)
    return json(result, 200)
  }

  if (request.method === 'POST' && pathname === '/v1/auth/otp/verify') {
    const body = (await readJson(request)) as {
      email?: unknown
      code?: unknown
      password?: unknown
      purpose?: unknown
    } | null
    const purpose = body?.purpose === 'register' ? 'register' : 'login'
    if (purpose === 'register') {
      const result = await registerWithOtp(env, body?.email, body?.password, body?.code)
      return json(
        { user: result.user },
        201,
        { 'Set-Cookie': sessionCookie(result.sessionToken, result.maxAgeDays) },
      )
    }
    const result = await loginWithOtp(env, body?.email, body?.code)
    return json(
      { user: result.user },
      200,
      { 'Set-Cookie': sessionCookie(result.sessionToken, result.maxAgeDays) },
    )
  }

  // Password register without OTP is disabled — force email verification.
  if (request.method === 'POST' && pathname === '/v1/auth/register') {
    const body = (await readJson(request)) as {
      email?: unknown
      password?: unknown
      code?: unknown
    } | null
    if (body?.code) {
      const result = await registerWithOtp(env, body.email, body.password, body.code)
      return json(
        { user: result.user },
        201,
        { 'Set-Cookie': sessionCookie(result.sessionToken, result.maxAgeDays) },
      )
    }
    return json(
      {
        error: '注册需要邮箱验证码。请先获取验证码后再提交。',
        code: 'OTP_REQUIRED',
      },
      400,
    )
  }

  if (request.method === 'POST' && pathname === '/v1/auth/login') {
    const body = (await readJson(request)) as {
      email?: unknown
      password?: unknown
      code?: unknown
    } | null
    // Prefer OTP when a code is present; otherwise keep password login for existing users.
    if (body?.code && !body?.password) {
      const result = await loginWithOtp(env, body.email, body.code)
      return json(
        { user: result.user },
        200,
        { 'Set-Cookie': sessionCookie(result.sessionToken, result.maxAgeDays) },
      )
    }
    const result = await loginUser(env, body?.email, body?.password)
    return json(
      { user: result.user },
      200,
      { 'Set-Cookie': sessionCookie(result.sessionToken, result.maxAgeDays) },
    )
  }

  if (request.method === 'POST' && pathname === '/v1/auth/logout') {
    await deleteSession(env, rawToken)
    return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() })
  }

  if ((request.method === 'GET' || request.method === 'HEAD') && pathname === '/v1/auth/session') {
    const user = await getUserBySession(env, rawToken)
    if (request.method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      })
    }
    return json({ user })
  }

  if ((request.method === 'GET' || request.method === 'HEAD') && pathname === '/v1/auth/me') {
    const user = await getUserBySession(env, rawToken)
    if (!user) {
      if (request.method === 'HEAD') {
        return new Response(null, {
          status: 401,
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
        })
      }
      return json({ error: '请先登录', code: 'AUTH_REQUIRED' }, 401)
    }
    if (request.method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      })
    }
    return json({ user })
  }

  return json({ error: 'Not found' }, 404)
}

const handleEdgeApis = async (request: Request, env: FullEnv, pathname: string) => {
  if (request.method === 'GET' && pathname === '/v1/models') {
    return handleModels(env)
  }

  if (request.method === 'GET' && pathname === '/v1/mail/status') {
    // Delivery is performed by the local agent after the cut; edge only reports intent.
    return json({
      authorized: true,
      aliases: [],
      transport: 'local-agent',
      automatic: true,
      requiresConfirmation: false,
      note: '成片由本机剪辑节点自动发往任务里的 notificationEmail',
    })
  }

  if (request.method === 'GET' && pathname === '/v1/render-queue') {
    // Queue lives on the worker; edge does not host job state yet.
    return json({
      updatedAt: new Date().toISOString(),
      summary: { running: 0, queued: 0, completedToday: 0 },
      active: [],
      recent: [],
      note: '任务状态请在剪辑台查看单任务进度；全局队列仍在本机 worker。',
    })
  }

  if (request.method === 'GET' && pathname === '/v1/capabilities') {
    return json({ items: [] })
  }

  if (request.method === 'GET' && pathname === '/v1/me/capability-installations') {
    return json({ items: [] })
  }

  if (request.method === 'GET' && pathname.startsWith('/v1/community')) {
    return json({ items: [], nextCursor: null })
  }

  if (request.method === 'POST' && pathname === '/v1/assistant/script') {
    const user = await getUserBySession(env, parseSessionCookie(request.headers.get('cookie')))
    if (!user) return json({ error: '请先登录', code: 'AUTH_REQUIRED' }, 401)
    return handleScriptAssistant(env, await readJson(request))
  }

  if (request.method === 'POST' && pathname === '/v1/assistant/coach') {
    const user = await getUserBySession(env, parseSessionCookie(request.headers.get('cookie')))
    if (!user) return json({ error: '请先登录', code: 'AUTH_REQUIRED' }, 401)
    return handleCoachAssistant(env, await readJson(request))
  }

  if (request.method === 'GET' && pathname === '/v1/asr/status') {
    return handleAsrStatus(env)
  }

  if (request.method === 'POST' && pathname === '/v1/asr/transcribe') {
    const user = await getUserBySession(env, parseSessionCookie(request.headers.get('cookie')))
    if (!user) return json({ error: '请先登录', code: 'AUTH_REQUIRED' }, 401)
    return handleAsrTranscribe(request, env)
  }

  return null
}

export const onRequest: PagesFunction<FullEnv> = async (context) => {
  const { request, env } = context
  const url = new URL(request.url)
  const pathname = url.pathname.replace(/^\/api/, '') || '/'
  const targetPath = pathname + url.search

  // Same-origin usually skips preflight, but some browsers still send OPTIONS
  // for application/json POST — answer early so auth never looks like "Load failed".
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': url.origin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept',
        'Access-Control-Max-Age': '86400',
      },
    })
  }

  try {
    if (isAuthPath(pathname)) {
      return await handleAuth(request, env, pathname)
    }

    const edge = await handleEdgeApis(request, env, pathname)
    if (edge) return edge

    if (isVideoAgentPath(pathname)) {
      const isHealth = pathname === '/healthz' || pathname === '/v1/agent/health'
      const user = await getUserBySession(env, parseSessionCookie(request.headers.get('cookie')))
      if (!isHealth && !user) {
        return json({ error: '请先登录', code: 'AUTH_REQUIRED' }, 401)
      }
      const agentPath =
        pathname === '/v1/agent/health' ? '/healthz' + url.search : targetPath
      const upstream = await proxyToAgent(request, env, agentPath, user)
      // A public liveness endpoint must not disclose models, gateway state, or
      // installed capabilities from the local render machine.
      if (isHealth) return json({ ok: upstream.ok, service: 'mooncut-render-agent' }, upstream.ok ? 200 : 503)
      return upstream
    }

    return json(
      {
        error: '该接口不走本机隧道。登录/助手在 Cloudflare；仅剪辑任务进入 Tunnel。',
        code: 'EDGE_ONLY',
        path: pathname,
      },
      404,
    )
  } catch (error) {
    if (error instanceof AuthHttpError) {
      return json({ error: error.message, code: error.code }, error.status)
    }
    const requestId = crypto.randomUUID()
    console.error(`[edge:${requestId}]`, error)
    return json({ error: '服务暂时不可用，请稍后重试', code: 'EDGE_ERROR', requestId }, 500)
  }
}
