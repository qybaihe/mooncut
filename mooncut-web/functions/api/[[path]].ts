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
import { communityReleaseForConnect, handleCommunityRequest } from '../lib/community'
import {
  assertCreativePointsAvailable,
  attachGenerationReservation,
  handleBillingRequest,
  recordCreativePoints,
  reconcileGeneration,
  releaseGenerationReservation,
  reserveGeneration,
  type BillingEnv,
} from '../lib/billing'
import { handleCoachAssistant, handleModels, handleScriptAssistant, type UpstreamEnv } from '../lib/upstream'

type FullEnv = Env & UpstreamEnv & AsrEnv & BillingEnv

const readJson = async (request: Request) => {
  try {
    return await request.json()
  } catch {
    return null
  }
}

const generationBillingEstimate = async (request: Request) => {
  if (!request.headers.get('content-type')?.includes('application/json')) return { seconds: 60, reservedCreativePoints: 8 }
  try {
    const payload = await request.clone().json() as { billingEstimateSeconds?: unknown; imageGeneration?: unknown }
    const seconds = Number(payload.billingEstimateSeconds)
    return {
      seconds: Number.isFinite(seconds) && seconds > 0 ? Math.min(Math.ceil(seconds), 24 * 60 * 60) : 60,
      reservedCreativePoints: payload.imageGeneration === 'off' ? 0 : 8,
    }
  } catch {
    return { seconds: 60, reservedCreativePoints: 8 }
  }
}

const responseJob = async (response: Response) => {
  try {
    const payload = await response.clone().json() as { id?: unknown }
    return typeof payload.id === 'string' ? payload.id : null
  } catch {
    return null
  }
}

const handleAuth = async (request: Request, env: FullEnv, pathname: string) => {
  const rawToken = parseSessionCookie(request.headers.get('cookie'))

  if (request.method === 'POST' && pathname === '/v1/auth/otp/send') {
    const body = (await readJson(request)) as { email?: unknown; purpose?: unknown } | null
    const result = await sendEmailOtp(env, body?.email, body?.purpose)
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

  if (request.method === 'POST' && pathname === '/v1/assistant/script') {
    const user = await getUserBySession(env, parseSessionCookie(request.headers.get('cookie')))
    if (!user) return json({ error: '请先登录', code: 'AUTH_REQUIRED' }, 401)
    const payload = await readJson(request)
    const chargePoint = Boolean(payload && typeof payload === 'object' && (payload as { action?: unknown }).action !== 'guide')
    if (chargePoint) await assertCreativePointsAvailable(env, user.id)
    const response = await handleScriptAssistant(env, payload)
    if (chargePoint && response.ok) await recordCreativePoints(env, user.id, 1, '脚本生成与润色')
    return response
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

    // Community registry is fully hosted by Pages + D1. It is intentionally
    // handled before the local-agent tunnel so browsing, upload and download
    // remain available while a creator's Mac is offline.
    const communityUser = await getUserBySession(env, parseSessionCookie(request.headers.get('cookie')))
    const billing = await handleBillingRequest(request, env, pathname, communityUser)
    if (billing) return billing
    const community = await handleCommunityRequest(request, env, pathname, communityUser)
    if (community) return community

    const connectMatch = pathname.match(/^\/v1\/community\/packages\/([a-z0-9-]{3,80})\/connect$/u)
    if (request.method === 'POST' && connectMatch) {
      if (!communityUser) return json({ error: '请先登录', code: 'AUTH_REQUIRED' }, 401)
      const release = await communityReleaseForConnect(env, connectMatch[1])
      // The agent receives only declarative files whose Connector has already
      // been checked for a reviewed local adapter. It never executes package code.
      const agentRequest = new Request(request.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(release),
      })
      return await proxyToAgent(agentRequest, env, '/v1/capabilities/import', communityUser)
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
      const isGeneration = request.method === 'POST' && (pathname === '/v1/edit-jobs' || pathname === '/v1/edits')
      if (isGeneration && user) {
        const estimate = await generationBillingEstimate(request)
        const reservation = await reserveGeneration(env, user.id, estimate.seconds, estimate.reservedCreativePoints)
        try {
          const response = await proxyToAgent(request, env, agentPath, user, { maxOutputHeight: reservation.maxOutputHeight })
          if (!response.ok) {
            await releaseGenerationReservation(env, reservation.id)
            return response
          }
          const jobId = await responseJob(response)
          if (!jobId) {
            await releaseGenerationReservation(env, reservation.id)
            return response
          }
          await attachGenerationReservation(env, reservation.id, jobId)
          return response
        } catch (error) {
          await releaseGenerationReservation(env, reservation.id)
          throw error
        }
      }
      const isSubtitleRepair = request.method === 'POST' && /^\/v1\/edit-jobs\/[a-f0-9]{32}\/subtitle-repairs$/u.test(pathname)
      if (isSubtitleRepair && user) await assertCreativePointsAvailable(env, user.id)
      const response = await proxyToAgent(request, env, agentPath, user)
      if (isSubtitleRepair && user && response.ok) await recordCreativePoints(env, user.id, 1, '字幕定点修复')
      if (request.method === 'GET' && /^\/v1\/edit-jobs\/[a-f0-9]{32}$/u.test(pathname) && user && response.ok) {
        try { await reconcileGeneration(env, user.id, await response.clone().json()) } catch { /* billing must not break status polling */ }
      }
      return response
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
    const message = error instanceof Error ? error.message : 'Internal error'
    return json({ error: message, code: 'EDGE_ERROR' }, 500)
  }
}
