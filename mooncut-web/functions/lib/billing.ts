import { AuthHttpError, json, type EdgeUser, type Env } from './auth'

export type BillingPlanId = 'free' | 'creator' | 'pro'
export type BillingEnv = Env & {
  /** Hosted checkout entry point; configured only in the Pages environment. */
  BILLING_CHECKOUT_URL?: string
  /** HMAC key that lets the checkout service verify the plan and customer context. */
  BILLING_CHECKOUT_SIGNING_SECRET?: string
  /** Shared secret used by the payment provider's server-to-server callback. */
  BILLING_WEBHOOK_SECRET?: string
}

type BillingAccountRow = {
  user_id: string
  plan: BillingPlanId
  subscription_status: 'free' | 'active' | 'canceling' | 'past_due'
  period_started_at: string
  period_ends_at: string | null
  cancel_at_period_end: number
  created_at: string
  updated_at: string
}

type ReservationRow = {
  id: string
  user_id: string
  plan: BillingPlanId
  estimated_minutes: number
  reserved_creative_points: number
  state: 'reserved' | 'processing' | 'consumed' | 'released'
  job_id: string | null
  created_at: string
}

type UsageRow = { event_type: 'video_generation' | 'smart_minutes' | 'creative_points'; quantity: number }
type CheckoutRow = { id: string; requested_plan: 'creator' | 'pro'; status: string; checkout_url: string | null; created_at: string; updated_at: string }
type ProviderCheckoutRow = CheckoutRow & { user_id: string; provider_reference: string | null }

const plans = {
  free: {
    label: 'Free · 体验版',
    priceCny: 0,
    videoLimit: 3,
    smartMinuteLimit: 0,
    creativePointLimit: 12,
    maxSourceSeconds: 5 * 60,
    maxParallelJobs: 1,
    exportQuality: '720P',
    exportHeight: 720,
  },
  creator: {
    label: 'Creator · 创作版',
    priceCny: 39,
    videoLimit: null,
    smartMinuteLimit: 60,
    creativePointLimit: 80,
    maxSourceSeconds: null,
    maxParallelJobs: 2,
    exportQuality: '1080P',
    exportHeight: 1080,
  },
  pro: {
    label: 'Pro · 专业版',
    priceCny: 149,
    videoLimit: null,
    smartMinuteLimit: 300,
    creativePointLimit: 400,
    maxSourceSeconds: null,
    maxParallelJobs: 3,
    exportQuality: '4K',
    exportHeight: 2160,
  },
} as const

const now = () => new Date().toISOString()
const id = () => {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
}
const positiveInt = (value: unknown, fallback = 1) => {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) && number > 0 ? Math.max(1, Math.ceil(number)) : fallback
}

const constantTimeEqual = (left: string, right: string) => {
  const leftBytes = new TextEncoder().encode(left)
  const rightBytes = new TextEncoder().encode(right)
  let mismatch = leftBytes.length ^ rightBytes.length
  const length = Math.max(leftBytes.length, rightBytes.length)
  for (let index = 0; index < length; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0)
  }
  return mismatch === 0
}

const signCheckoutContext = async (secret: string, checkoutRequestId: string, plan: string, customerId: string) => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${checkoutRequestId}.${plan}.${customerId}`))
  return Array.from(new Uint8Array(signature), (value) => value.toString(16).padStart(2, '0')).join('')
}

const usagePeriodStart = (account: BillingAccountRow) =>
  account.plan === 'free' ? account.created_at : account.period_started_at

const sumEvents = (rows: UsageRow[], type: UsageRow['event_type']) =>
  rows.filter((row) => row.event_type === type).reduce((sum, row) => sum + Number(row.quantity || 0), 0)

export const ensureBillingAccount = async (env: BillingEnv, userId: string) => {
  const timestamp = now()
  await env.DB.prepare(`INSERT OR IGNORE INTO billing_accounts (
    user_id, plan, subscription_status, period_started_at, period_ends_at,
    cancel_at_period_end, created_at, updated_at
  ) VALUES (?, 'free', 'free', ?, NULL, 0, ?, ?)`)
    .bind(userId, timestamp, timestamp, timestamp)
    .run()
  let account = await env.DB.prepare('SELECT * FROM billing_accounts WHERE user_id = ?').bind(userId).first<BillingAccountRow>()
  if (!account) throw new AuthHttpError(500, 'BILLING_ACCOUNT_MISSING', '账户额度暂时不可用，请稍后重试')
  const periodEnd = account.period_ends_at ? new Date(account.period_ends_at) : null
  if (account.plan !== 'free' && periodEnd && !Number.isNaN(periodEnd.getTime()) && periodEnd.getTime() <= Date.now()) {
    const timestamp = now()
    await env.DB.prepare(`UPDATE billing_accounts SET
      plan = 'free', subscription_status = 'free', period_started_at = ?, period_ends_at = NULL,
      cancel_at_period_end = 0, updated_at = ?
      WHERE user_id = ? AND plan != 'free' AND period_ends_at <= ?`)
      .bind(timestamp, timestamp, userId, timestamp).run()
    account = await env.DB.prepare('SELECT * FROM billing_accounts WHERE user_id = ?').bind(userId).first<BillingAccountRow>()
    if (!account) throw new AuthHttpError(500, 'BILLING_ACCOUNT_MISSING', '账户额度暂时不可用，请稍后重试')
  }
  return account
}

const loadUsage = async (env: BillingEnv, account: BillingAccountRow) => {
  const startsAt = usagePeriodStart(account)
  const [eventsResult, reservationsResult] = await Promise.all([
    env.DB.prepare(`SELECT event_type, COALESCE(SUM(quantity), 0) AS quantity
      FROM billing_usage_events WHERE user_id = ? AND created_at >= ? GROUP BY event_type`)
      .bind(account.user_id, startsAt).all<UsageRow>(),
    env.DB.prepare(`SELECT * FROM billing_generation_reservations
      WHERE user_id = ? AND created_at >= ? AND state IN ('reserved', 'processing')`)
      .bind(account.user_id, startsAt).all<ReservationRow>(),
  ])
  const events = eventsResult.results ?? []
  const reservations = reservationsResult.results ?? []
  return {
    generatedVideos: sumEvents(events, 'video_generation') + reservations.length,
    completedVideos: sumEvents(events, 'video_generation'),
    inProgressVideos: reservations.length,
    smartMinutes: sumEvents(events, 'smart_minutes') + reservations.reduce((sum, item) => sum + item.estimated_minutes, 0),
    completedSmartMinutes: sumEvents(events, 'smart_minutes'),
    creativePoints: sumEvents(events, 'creative_points') + reservations.reduce((sum, item) => sum + item.reserved_creative_points, 0),
    inProgressCreativePoints: reservations.reduce((sum, item) => sum + item.reserved_creative_points, 0),
  }
}

const remaining = (limit: number | null, used: number) => limit === null ? null : Math.max(0, limit - used)

const upgradePrompt = (plan: BillingPlanId, usage: Awaited<ReturnType<typeof loadUsage>>) => {
  const config = plans[plan]
  if (plan === 'free') {
    const left = remaining(config.videoLimit, usage.generatedVideos) ?? 0
    if (left === 0) return {
      level: 'critical' as const,
      title: '体验成片额度已用完',
      detail: '升级 Creator 后可获得每月 60 分钟智能处理与 1080P 导出。',
      recommendedPlan: 'creator' as const,
    }
    if (left === 1) return {
      level: 'warning' as const,
      title: '仅剩 1 次体验成片',
      detail: '下一条完成后，智能剪辑将需要升级套餐。',
      recommendedPlan: 'creator' as const,
    }
    return {
      level: 'info' as const,
      title: '体验额度正在使用中',
      detail: '需要每周稳定发布、1080P 或更多 AI 处理量时，可以升级 Creator。',
      recommendedPlan: 'creator' as const,
    }
  }
  const minutesLeft = remaining(config.smartMinuteLimit, usage.smartMinutes) ?? 0
  if (plan === 'creator' && minutesLeft <= 12) return {
    level: minutesLeft === 0 ? 'critical' as const : 'warning' as const,
    title: minutesLeft === 0 ? '本周期智能处理分钟已用完' : `仅剩 ${minutesLeft} 分钟智能处理量`,
    detail: 'Pro 提供 300 分钟、400 创作点、4K 导出与优先处理能力。',
    recommendedPlan: 'pro' as const,
  }
  return null
}

export const getBillingSummary = async (env: BillingEnv, userId: string) => {
  const account = await ensureBillingAccount(env, userId)
  const [usage, checkoutResult] = await Promise.all([
    loadUsage(env, account),
    env.DB.prepare(`SELECT id, requested_plan, status, checkout_url, created_at, updated_at
      FROM billing_checkout_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 6`)
      .bind(userId).all<CheckoutRow>(),
  ])
  const config = plans[account.plan]
  return {
    account: {
      plan: account.plan,
      planLabel: config.label,
      subscriptionStatus: account.subscription_status,
      periodStartedAt: account.period_started_at,
      periodEndsAt: account.period_ends_at,
      cancelAtPeriodEnd: Boolean(account.cancel_at_period_end),
      exportQuality: config.exportQuality,
      maxParallelJobs: config.maxParallelJobs,
    },
    usage: {
      videoGenerations: {
        used: usage.generatedVideos,
        completed: usage.completedVideos,
        inProgress: usage.inProgressVideos,
        limit: config.videoLimit,
        remaining: remaining(config.videoLimit, usage.generatedVideos),
      },
      smartMinutes: {
        used: usage.smartMinutes,
        completed: usage.completedSmartMinutes,
        limit: config.smartMinuteLimit || null,
        remaining: remaining(config.smartMinuteLimit || null, usage.smartMinutes),
      },
      creativePoints: {
        used: usage.creativePoints,
        inProgress: usage.inProgressCreativePoints,
        limit: config.creativePointLimit,
        remaining: remaining(config.creativePointLimit, usage.creativePoints),
      },
    },
    limits: {
      maxSourceSeconds: config.maxSourceSeconds,
      checkoutConfigured: Boolean(env.BILLING_CHECKOUT_URL && env.BILLING_CHECKOUT_SIGNING_SECRET && env.BILLING_WEBHOOK_SECRET),
    },
    upgradePrompt: upgradePrompt(account.plan, usage),
    checkoutRequests: checkoutResult.results ?? [],
    plans: Object.entries(plans).map(([plan, item]) => ({
      id: plan as BillingPlanId,
      label: item.label,
      priceCny: item.priceCny,
      smartMinuteLimit: item.smartMinuteLimit || null,
      creativePointLimit: item.creativePointLimit,
      exportQuality: item.exportQuality,
      maxParallelJobs: item.maxParallelJobs,
    })),
  }
}

export const reserveGeneration = async (
  env: BillingEnv,
  userId: string,
  sourceDurationSeconds: unknown,
  reservedCreativePoints = 0,
) => {
  const account = await ensureBillingAccount(env, userId)
  const config = plans[account.plan]
  const seconds = positiveInt(sourceDurationSeconds, 60)
  const estimatedMinutes = Math.max(1, Math.ceil(seconds / 60))
  const usage = await loadUsage(env, account)
  if (config.maxSourceSeconds !== null && seconds > config.maxSourceSeconds) {
    throw new AuthHttpError(402, 'TRIAL_SOURCE_TOO_LONG', `Free 体验版单条素材最多 ${Math.floor(config.maxSourceSeconds / 60)} 分钟；升级 Creator 可处理更长素材`)
  }
  if (config.videoLimit !== null && usage.generatedVideos >= config.videoLimit) {
    throw new AuthHttpError(402, 'QUOTA_EXHAUSTED', '体验成片额度已用完。升级 Creator 可继续智能剪辑并获得每月处理分钟。')
  }
  if (config.smartMinuteLimit > 0 && usage.smartMinutes + estimatedMinutes > config.smartMinuteLimit) {
    throw new AuthHttpError(402, 'QUOTA_EXHAUSTED', `本周期仅剩 ${Math.max(0, config.smartMinuteLimit - usage.smartMinutes)} 分钟智能处理量。${account.plan === 'creator' ? '升级 Pro 可获得 300 分钟。' : '请等待下个订阅周期。'}`)
  }
  const visualPointReservation = Math.max(0, Math.min(8, Math.floor(reservedCreativePoints)))
  if (usage.creativePoints + visualPointReservation > config.creativePointLimit) {
    throw new AuthHttpError(402, 'CREATIVE_POINTS_EXHAUSTED', `创作点不足，无法为本条任务预留 AI 视觉额度（剩余 ${Math.max(0, config.creativePointLimit - usage.creativePoints)} 点）。${account.plan === 'free' ? '升级 Creator 可获得每月 80 点。' : account.plan === 'creator' ? '升级 Pro 可获得每月 400 点。' : '请等待下个订阅周期。'}`)
  }
  const reservation = {
    id: id(),
    estimatedMinutes,
    reservedCreativePoints: visualPointReservation,
    maxOutputHeight: config.exportHeight,
    plan: account.plan,
  }
  await env.DB.prepare(`INSERT INTO billing_generation_reservations (
    id, user_id, plan, estimated_minutes, reserved_creative_points, state, job_id, created_at, finalized_at
  ) VALUES (?, ?, ?, ?, ?, 'reserved', NULL, ?, NULL)`)
    .bind(reservation.id, userId, reservation.plan, reservation.estimatedMinutes, reservation.reservedCreativePoints, now()).run()
  return reservation
}

export const attachGenerationReservation = async (env: BillingEnv, reservationId: string, jobId: string) => {
  await env.DB.prepare(`UPDATE billing_generation_reservations
    SET state = 'processing', job_id = ? WHERE id = ? AND state = 'reserved'`)
    .bind(jobId, reservationId).run()
}

export const releaseGenerationReservation = async (env: BillingEnv, reservationId: string) => {
  await env.DB.prepare(`UPDATE billing_generation_reservations
    SET state = 'released', finalized_at = ? WHERE id = ? AND state IN ('reserved', 'processing')`)
    .bind(now(), reservationId).run()
}

export const assertCreativePointsAvailable = async (env: BillingEnv, userId: string, quantity = 1) => {
  const account = await ensureBillingAccount(env, userId)
  const usage = await loadUsage(env, account)
  const limit = plans[account.plan].creativePointLimit
  if (usage.creativePoints + quantity > limit) {
    throw new AuthHttpError(402, 'CREATIVE_POINTS_EXHAUSTED', `创作点不足（剩余 ${Math.max(0, limit - usage.creativePoints)} 点）。${account.plan === 'free' ? '升级 Creator 可获得每月 80 点。' : account.plan === 'creator' ? '升级 Pro 可获得每月 400 点。' : '请等待下个订阅周期。'}`)
  }
}

export const recordCreativePoints = async (env: BillingEnv, userId: string, quantity: number, description: string, jobId?: string) => {
  if (quantity <= 0) return
  await env.DB.prepare(`INSERT OR IGNORE INTO billing_usage_events
    (id, user_id, event_type, quantity, job_id, description, created_at)
    VALUES (?, ?, 'creative_points', ?, ?, ?, ?)`)
    .bind(`${jobId ?? id()}-points`, userId, quantity, jobId ?? null, description.slice(0, 80), now()).run()
}

export const reconcileGeneration = async (env: BillingEnv, userId: string, job: unknown) => {
  if (!job || typeof job !== 'object') return
  const source = job as Record<string, unknown>
  if (typeof source.id !== 'string' || typeof source.status !== 'string') return
  const reservation = await env.DB.prepare(`SELECT * FROM billing_generation_reservations
    WHERE user_id = ? AND job_id = ? LIMIT 1`).bind(userId, source.id).first<ReservationRow>()
  if (!reservation || reservation.state !== 'processing') return
  if (source.status === 'failed') {
    await releaseGenerationReservation(env, reservation.id)
    return
  }
  if (source.status !== 'completed') return
  const result = source.result && typeof source.result === 'object' ? source.result as Record<string, unknown> : null
  const probe = result?.probe && typeof result.probe === 'object' ? result.probe as Record<string, unknown> : null
  const durationMs = typeof probe?.durationMs === 'number' ? probe.durationMs : reservation.estimated_minutes * 60_000
  const actualMinutes = Math.max(1, Math.ceil(durationMs / 60_000))
  const visuals = result?.visuals && typeof result.visuals === 'object' ? result.visuals as Record<string, unknown> : null
  const visualAssets = Array.isArray(visuals?.assets) ? visuals.assets : []
  // The Agent caps generated visuals at two images. The pre-reserved amount
  // keeps the user from exceeding their point allowance even under concurrency.
  const visualPoints = Math.min(visualAssets.length * 4, reservation.reserved_creative_points)
  const timestamp = now()
  const statements = [
    env.DB.prepare(`UPDATE billing_generation_reservations
      SET state = 'consumed', estimated_minutes = ?, finalized_at = ? WHERE id = ? AND state = 'processing'`)
      .bind(actualMinutes, timestamp, reservation.id),
    env.DB.prepare(`INSERT OR IGNORE INTO billing_usage_events
      (id, user_id, event_type, quantity, job_id, description, created_at)
      VALUES (?, ?, 'video_generation', 1, ?, '智能成片', ?)`)
      .bind(`${reservation.id}-video`, userId, source.id, timestamp),
    env.DB.prepare(`INSERT OR IGNORE INTO billing_usage_events
      (id, user_id, event_type, quantity, job_id, description, created_at)
      VALUES (?, ?, 'smart_minutes', ?, ?, '智能处理时长', ?)`)
      .bind(`${reservation.id}-minutes`, userId, actualMinutes, source.id, timestamp),
  ]
  if (visualPoints > 0) {
    statements.push(env.DB.prepare(`INSERT OR IGNORE INTO billing_usage_events
      (id, user_id, event_type, quantity, job_id, description, created_at)
      VALUES (?, ?, 'creative_points', ?, ?, 'AI 视觉生成', ?)`)
      .bind(`${reservation.id}-visuals`, userId, visualPoints, source.id, timestamp))
  }
  await env.DB.batch(statements)
}

export const createCheckoutRequest = async (env: BillingEnv, user: EdgeUser, plan: unknown) => {
  if (plan !== 'creator' && plan !== 'pro') throw new AuthHttpError(400, 'INVALID_PLAN', '请选择 Creator 或 Pro 套餐')
  const account = await ensureBillingAccount(env, user.id)
  if (account.plan === 'pro') throw new AuthHttpError(409, 'ALREADY_TOP_PLAN', '你的账户已是 Pro；当前周期内无需重复升级')
  if (account.plan === plan && account.subscription_status === 'active') {
    throw new AuthHttpError(409, 'ALREADY_ON_PLAN', `你的账户当前已是 ${plans[plan].label}，无需重复购买`)
  }
  const timestamp = now()
  const requestId = id()
  const base = env.BILLING_CHECKOUT_URL?.trim()
  const checkoutSigningSecret = env.BILLING_CHECKOUT_SIGNING_SECRET?.trim()
  const paymentWebhookSecret = env.BILLING_WEBHOOK_SECRET?.trim()
  const pendingStatus = base ? 'ready_for_payment' : 'pending_setup'
  const existing = await env.DB.prepare(`SELECT id, requested_plan, status, checkout_url, created_at, updated_at
    FROM billing_checkout_requests
    WHERE user_id = ? AND requested_plan = ? AND status = ?
    ORDER BY created_at DESC LIMIT 1`)
    .bind(user.id, plan, pendingStatus).first<CheckoutRow>()
  if (existing) {
    return {
      checkout: {
        id: existing.id,
        plan: existing.requested_plan,
        status: existing.status,
        checkoutUrl: existing.checkout_url,
        createdAt: existing.created_at,
      },
      message: existing.checkout_url
        ? '你已有一笔待支付的升级请求，可继续完成安全支付。'
        : '已记录升级请求。支付服务尚未配置，因此不会扣款，也不会提前开通付费权益。',
    }
  }
  let checkoutUrl: string | null = null
  let status: 'pending_setup' | 'ready_for_payment' = 'pending_setup'
  if (base) {
    if (!checkoutSigningSecret || checkoutSigningSecret.length < 24 || !paymentWebhookSecret || paymentWebhookSecret.length < 24) {
      throw new AuthHttpError(503, 'CHECKOUT_SECURITY_UNCONFIGURED', '支付服务尚未完成安全签名与回调配置，请联系 MoonCut 支持')
    }
    try {
      const checkout = new URL(base)
      checkout.searchParams.set('checkoutRequestId', requestId)
      checkout.searchParams.set('plan', plan)
      checkout.searchParams.set('customer', user.id)
      checkout.searchParams.set('checkoutToken', await signCheckoutContext(checkoutSigningSecret, requestId, plan, user.id))
      checkoutUrl = checkout.toString()
      status = 'ready_for_payment'
    } catch {
      throw new AuthHttpError(503, 'CHECKOUT_URL_INVALID', '支付服务地址配置无效，请联系 MoonCut 支持')
    }
  }
  await env.DB.prepare(`INSERT INTO billing_checkout_requests (
    id, user_id, requested_plan, status, provider_reference, checkout_url, created_at, updated_at
  ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`)
    .bind(requestId, user.id, plan, status, checkoutUrl, timestamp, timestamp).run()
  return {
    checkout: { id: requestId, plan, status, checkoutUrl, createdAt: timestamp },
    message: checkoutUrl
      ? '已生成安全支付链接；支付成功后由支付回调开通套餐。'
      : '已记录升级请求。支付服务尚未配置，因此不会扣款，也不会提前开通付费权益。',
  }
}

const parsePeriodEnd = (value: unknown, startedAt: Date) => {
  if (typeof value !== 'string') return new Date(startedAt.getTime() + 30 * 24 * 60 * 60 * 1000)
  const parsed = new Date(value)
  const maxEnd = startedAt.getTime() + 400 * 24 * 60 * 60 * 1000
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= startedAt.getTime() || parsed.getTime() > maxEnd) {
    throw new AuthHttpError(400, 'INVALID_BILLING_PERIOD', '支付回调中的订阅周期无效')
  }
  return parsed
}

/**
 * The browser can create an intent, but only a provider-authenticated callback
 * can change the account plan. Repeated delivery is accepted when it carries
 * the same provider reference, which keeps ordinary webhook retries safe.
 */
export const fulfillCheckoutFromProvider = async (env: BillingEnv, payload: unknown) => {
  if (!payload || typeof payload !== 'object') throw new AuthHttpError(400, 'INVALID_PAYMENT_EVENT', '支付回调格式无效')
  const event = payload as Record<string, unknown>
  const checkoutRequestId = typeof event.checkoutRequestId === 'string' ? event.checkoutRequestId.trim() : ''
  const providerReference = typeof event.providerReference === 'string' ? event.providerReference.trim() : ''
  if (!/^[a-f0-9]{32}$/u.test(checkoutRequestId) || providerReference.length < 3 || providerReference.length > 160) {
    throw new AuthHttpError(400, 'INVALID_PAYMENT_EVENT', '支付回调缺少有效订单标识')
  }
  const checkout = await env.DB.prepare(`SELECT id, user_id, requested_plan, status, checkout_url, created_at, updated_at, provider_reference
    FROM billing_checkout_requests WHERE id = ?`).bind(checkoutRequestId).first<ProviderCheckoutRow>()
  if (!checkout) throw new AuthHttpError(404, 'CHECKOUT_NOT_FOUND', '升级请求不存在')
  if (checkout.status === 'paid') {
    if (checkout.provider_reference !== providerReference) {
      throw new AuthHttpError(409, 'PAYMENT_REFERENCE_MISMATCH', '升级请求已由另一笔支付完成')
    }
    return { ok: true, alreadyFulfilled: true, checkoutRequestId }
  }
  if (checkout.status !== 'ready_for_payment') {
    throw new AuthHttpError(409, 'CHECKOUT_NOT_PAYABLE', '该升级请求当前不能完成支付')
  }
  const periodStartedAt = new Date()
  const periodEndsAt = parsePeriodEnd(event.periodEndsAt, periodStartedAt)
  const timestamp = periodStartedAt.toISOString()
  try {
    await env.DB.batch([
      env.DB.prepare(`UPDATE billing_checkout_requests
        SET status = 'paid', provider_reference = ?, updated_at = ?
        WHERE id = ? AND status = 'ready_for_payment'`)
        .bind(providerReference, timestamp, checkout.id),
      env.DB.prepare(`INSERT INTO billing_accounts (
        user_id, plan, subscription_status, period_started_at, period_ends_at,
        cancel_at_period_end, created_at, updated_at
      ) VALUES (?, ?, 'active', ?, ?, 0, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        plan = excluded.plan,
        subscription_status = 'active',
        period_started_at = excluded.period_started_at,
        period_ends_at = excluded.period_ends_at,
        cancel_at_period_end = 0,
        updated_at = excluded.updated_at`)
        .bind(checkout.user_id, checkout.requested_plan, timestamp, periodEndsAt.toISOString(), timestamp, timestamp),
    ])
  } catch (error) {
    const existing = await env.DB.prepare(`SELECT provider_reference, status FROM billing_checkout_requests WHERE id = ?`)
      .bind(checkout.id).first<{ provider_reference: string | null; status: string }>()
    if (existing?.status === 'paid' && existing.provider_reference === providerReference) {
      return { ok: true, alreadyFulfilled: true, checkoutRequestId }
    }
    throw error
  }
  return { ok: true, alreadyFulfilled: false, checkoutRequestId, plan: checkout.requested_plan, periodEndsAt: periodEndsAt.toISOString() }
}

export const handleBillingRequest = async (request: Request, env: BillingEnv, pathname: string, user: EdgeUser | null) => {
  if (!pathname.startsWith('/v1/billing')) return null
  if (request.method === 'POST' && pathname === '/v1/billing/provider/webhook') {
    const secret = env.BILLING_WEBHOOK_SECRET?.trim()
    const authorization = request.headers.get('authorization')
    const providedSecret = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : ''
    if (!secret) return json({ error: '支付回调尚未配置', code: 'BILLING_WEBHOOK_UNCONFIGURED' }, 503)
    if (!constantTimeEqual(providedSecret, secret)) return json({ error: '支付回调未授权', code: 'BILLING_WEBHOOK_UNAUTHORIZED' }, 401)
    let body: unknown
    try { body = await request.json() } catch { throw new AuthHttpError(400, 'INVALID_PAYMENT_EVENT', '支付回调必须为 JSON') }
    return json(await fulfillCheckoutFromProvider(env, body))
  }
  if (!user) return json({ error: '请先登录', code: 'AUTH_REQUIRED' }, 401)
  if (request.method === 'GET' && pathname === '/v1/billing/summary') {
    return json(await getBillingSummary(env, user.id))
  }
  if (request.method === 'POST' && pathname === '/v1/billing/checkout') {
    let body: { plan?: unknown } = {}
    try { body = await request.json() as { plan?: unknown } } catch { /* validation below */ }
    return json(await createCheckoutRequest(env, user, body.plan), 202)
  }
  return json({ error: 'Not found', code: 'BILLING_NOT_FOUND' }, 404)
}
