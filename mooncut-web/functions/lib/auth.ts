import { hashPassword, newSaltHex, randomId, randomToken, sha256Hex, timingSafeEqualHex } from './crypto'
import { buildOtpEmail, friendlyEmailError, sendResendEmail, type ResendEnv } from './resend'

export type EdgeUser = {
  id: string
  email: string
  createdAt: string
}

export type OtpPurpose = 'login' | 'register'

export type Env = ResendEnv & {
  DB: D1Database
  AGENT_ORIGIN?: string
  AGENT_INTERNAL_KEY?: string
  SESSION_DAYS?: string
}

const SESSION_COOKIE = 'mooncut_session'
const OTP_TTL_MS = 10 * 60 * 1000
const OTP_RESEND_COOLDOWN_MS = 60 * 1000
const OTP_MAX_SENDS_PER_HOUR = 8
const OTP_MAX_ATTEMPTS = 5
const OTP_CODE_LENGTH = 6

const normalizeEmail = (value: string) => value.trim().toLowerCase()

export const validateEmailOnly = (emailValue: unknown) => {
  if (typeof emailValue !== 'string') {
    throw new AuthHttpError(400, 'INVALID_EMAIL', '请输入有效的邮箱地址')
  }
  const email = normalizeEmail(emailValue)
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new AuthHttpError(400, 'INVALID_EMAIL', '请输入有效的邮箱地址')
  }
  return email
}

export const validateCredentials = (emailValue: unknown, password: unknown) => {
  const email = validateEmailOnly(emailValue)
  if (typeof password !== 'string') {
    throw new AuthHttpError(400, 'INVALID_CREDENTIALS', '请输入邮箱和密码')
  }
  if (password.length < 8 || password.length > 128) {
    throw new AuthHttpError(400, 'INVALID_PASSWORD', '密码长度需要在 8 到 128 个字符之间')
  }
  return { email, password }
}

const validateOtpPurpose = (value: unknown): OtpPurpose => {
  if (value === 'login' || value === 'register') return value
  throw new AuthHttpError(400, 'INVALID_PURPOSE', '验证码用途无效')
}

const validateOtpCode = (value: unknown) => {
  if (typeof value !== 'string') {
    throw new AuthHttpError(400, 'INVALID_CODE', '请输入 6 位验证码')
  }
  const code = value.trim().replace(/\s+/g, '')
  if (!/^\d{6}$/u.test(code)) {
    throw new AuthHttpError(400, 'INVALID_CODE', '请输入 6 位数字验证码')
  }
  return code
}

const generateOtpCode = () => {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  // 100000–999999，避免前导零导致用户困惑（仍接受 6 位）
  const n = 100000 + (buf[0]! % 900000)
  return String(n).padStart(OTP_CODE_LENGTH, '0')
}

export class AuthHttpError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  })

export const sessionCookie = (token: string, maxAgeDays: number) => {
  const maxAge = Math.max(1, maxAgeDays) * 24 * 60 * 60
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`
}

export const clearSessionCookie = () =>
  `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`

export const parseSessionCookie = (cookieHeader: string | null) => {
  if (!cookieHeader) return null
  const parts = cookieHeader.split(';')
  for (const part of parts) {
    const [rawName, ...rest] = part.trim().split('=')
    if (rawName === SESSION_COOKIE) return rest.join('=') || null
  }
  return null
}

const sessionDays = (env: Env) => {
  const n = Number.parseInt(env.SESSION_DAYS || '30', 10)
  return Number.isFinite(n) && n > 0 ? Math.min(90, n) : 30
}

export const registerUser = async (env: Env, emailValue: unknown, passwordValue: unknown) => {
  const { email, password } = validateCredentials(emailValue, passwordValue)
  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()
  if (existing) throw new AuthHttpError(409, 'EMAIL_TAKEN', '该邮箱已注册')

  const id = randomId(16)
  const salt = newSaltHex()
  const passwordHash = await hashPassword(password, salt)
  const createdAt = new Date().toISOString()
  await env.DB.prepare(
    'INSERT INTO users (id, email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, email, passwordHash, salt, createdAt)
    .run()

  const session = await createSession(env, id)
  return {
    user: { id, email, createdAt } satisfies EdgeUser,
    sessionToken: session.token,
    maxAgeDays: sessionDays(env),
  }
}

export const loginUser = async (env: Env, emailValue: unknown, passwordValue: unknown) => {
  const { email, password } = validateCredentials(emailValue, passwordValue)
  const row = await env.DB.prepare(
    'SELECT id, email, password_hash, password_salt, created_at FROM users WHERE email = ?',
  )
    .bind(email)
    .first<{
      id: string
      email: string
      password_hash: string
      password_salt: string
      created_at: string
    }>()
  if (!row) throw new AuthHttpError(401, 'AUTH_FAILED', '邮箱或密码不正确')

  const actual = await hashPassword(password, row.password_salt)
  if (!timingSafeEqualHex(actual, row.password_hash)) {
    throw new AuthHttpError(401, 'AUTH_FAILED', '邮箱或密码不正确')
  }

  const session = await createSession(env, row.id)
  return {
    user: { id: row.id, email: row.email, createdAt: row.created_at } satisfies EdgeUser,
    sessionToken: session.token,
    maxAgeDays: sessionDays(env),
  }
}

const createSession = async (env: Env, userId: string) => {
  const token = randomToken(32)
  const tokenHash = await sha256Hex(token)
  const now = new Date()
  const expires = new Date(now.getTime() + sessionDays(env) * 24 * 60 * 60 * 1000)
  await env.DB.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(tokenHash, userId, now.toISOString(), expires.toISOString(), now.toISOString())
    .run()
  return { token, expiresAt: expires.toISOString() }
}

export const getUserBySession = async (env: Env, rawToken: string | null): Promise<EdgeUser | null> => {
  if (!rawToken) return null
  const tokenHash = await sha256Hex(rawToken)
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.created_at, s.expires_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?`,
  )
    .bind(tokenHash)
    .first<{ id: string; email: string; created_at: string; expires_at: string }>()
  if (!row) return null
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run()
    return null
  }
  await env.DB.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?')
    .bind(new Date().toISOString(), tokenHash)
    .run()
  return { id: row.id, email: row.email, createdAt: row.created_at }
}

export const deleteSession = async (env: Env, rawToken: string | null) => {
  if (!rawToken) return
  const tokenHash = await sha256Hex(rawToken)
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run()
}

/** Send a 6-digit email OTP via Resend. */
export const sendEmailOtp = async (env: Env, emailValue: unknown, purposeValue: unknown) => {
  const email = validateEmailOnly(emailValue)
  const purpose = validateOtpPurpose(purposeValue)

  if (purpose === 'register') {
    const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()
    if (existing) throw new AuthHttpError(409, 'EMAIL_TAKEN', '该邮箱已注册，请直接登录')
  } else {
    const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()
    if (!existing) throw new AuthHttpError(404, 'USER_NOT_FOUND', '该邮箱尚未注册，请先注册')
  }

  const now = Date.now()
  const hourAgo = new Date(now - 60 * 60 * 1000).toISOString()
  const recent = await env.DB.prepare(
    `SELECT id, created_at FROM email_otps
     WHERE email = ? AND purpose = ? AND created_at >= ?
     ORDER BY created_at DESC
     LIMIT ?`,
  )
    .bind(email, purpose, hourAgo, OTP_MAX_SENDS_PER_HOUR)
    .all<{ id: string; created_at: string }>()

  const rows = recent.results ?? []
  if (rows.length >= OTP_MAX_SENDS_PER_HOUR) {
    throw new AuthHttpError(429, 'OTP_RATE_LIMIT', '验证码发送过于频繁，请一小时后再试')
  }
  const latest = rows[0]
  if (latest) {
    const elapsed = now - new Date(latest.created_at).getTime()
    if (elapsed < OTP_RESEND_COOLDOWN_MS) {
      const waitSec = Math.ceil((OTP_RESEND_COOLDOWN_MS - elapsed) / 1000)
      throw new AuthHttpError(429, 'OTP_COOLDOWN', `请 ${waitSec} 秒后再获取验证码`)
    }
  }

  // Invalidate outstanding codes for this email+purpose so only the latest is valid.
  await env.DB.prepare(
    `UPDATE email_otps SET consumed_at = ?
     WHERE email = ? AND purpose = ? AND consumed_at IS NULL`,
  )
    .bind(new Date(now).toISOString(), email, purpose)
    .run()

  const code = generateOtpCode()
  const codeHash = await sha256Hex(`${email}:${purpose}:${code}`)
  const id = randomId(12)
  const createdAt = new Date(now).toISOString()
  const expiresAt = new Date(now + OTP_TTL_MS).toISOString()

  await env.DB.prepare(
    `INSERT INTO email_otps (id, email, purpose, code_hash, attempts, created_at, expires_at, consumed_at)
     VALUES (?, ?, ?, ?, 0, ?, ?, NULL)`,
  )
    .bind(id, email, purpose, codeHash, createdAt, expiresAt)
    .run()

  const mail = buildOtpEmail({
    code,
    purpose,
    minutes: Math.round(OTP_TTL_MS / 60000),
  })

  try {
    await sendResendEmail(env, { to: email, ...mail })
  } catch (error) {
    // Roll back the unused code so a failed send does not burn cooldown silently.
    try {
      await env.DB.prepare('DELETE FROM email_otps WHERE id = ?').bind(id).run()
    } catch {
      /* best-effort cleanup */
    }
    const raw = error instanceof Error ? error.message : '验证码邮件发送失败'
    // Use 503 (not 502): Cloudflare often replaces Worker 502 bodies with bare "error code: 502".
    throw new AuthHttpError(503, 'EMAIL_SEND_FAILED', friendlyEmailError(raw))
  }

  return {
    ok: true as const,
    email,
    purpose,
    expiresInSec: Math.round(OTP_TTL_MS / 1000),
    resendAfterSec: Math.round(OTP_RESEND_COOLDOWN_MS / 1000),
  }
}

const consumeValidOtp = async (env: Env, email: string, purpose: OtpPurpose, code: string) => {
  const row = await env.DB.prepare(
    `SELECT id, code_hash, attempts, expires_at, consumed_at
     FROM email_otps
     WHERE email = ? AND purpose = ?
     ORDER BY created_at DESC
     LIMIT 1`,
  )
    .bind(email, purpose)
    .first<{
      id: string
      code_hash: string
      attempts: number
      expires_at: string
      consumed_at: string | null
    }>()

  if (!row || row.consumed_at) {
    throw new AuthHttpError(400, 'OTP_INVALID', '验证码无效或已过期，请重新获取')
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await env.DB.prepare('UPDATE email_otps SET consumed_at = ? WHERE id = ?')
      .bind(new Date().toISOString(), row.id)
      .run()
    throw new AuthHttpError(400, 'OTP_EXPIRED', '验证码已过期，请重新获取')
  }
  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    await env.DB.prepare('UPDATE email_otps SET consumed_at = ? WHERE id = ?')
      .bind(new Date().toISOString(), row.id)
      .run()
    throw new AuthHttpError(429, 'OTP_LOCKED', '验证码错误次数过多，请重新获取')
  }

  const expected = await sha256Hex(`${email}:${purpose}:${code}`)
  if (!timingSafeEqualHex(expected, row.code_hash)) {
    await env.DB.prepare('UPDATE email_otps SET attempts = attempts + 1 WHERE id = ?').bind(row.id).run()
    const left = OTP_MAX_ATTEMPTS - row.attempts - 1
    throw new AuthHttpError(
      401,
      'OTP_MISMATCH',
      left > 0 ? `验证码不正确，还可尝试 ${left} 次` : '验证码不正确，请重新获取',
    )
  }

  await env.DB.prepare('UPDATE email_otps SET consumed_at = ?, attempts = attempts + 1 WHERE id = ?')
    .bind(new Date().toISOString(), row.id)
    .run()
}

/** Register with password + email OTP, then create session. */
export const registerWithOtp = async (
  env: Env,
  emailValue: unknown,
  passwordValue: unknown,
  codeValue: unknown,
) => {
  const { email, password } = validateCredentials(emailValue, passwordValue)
  const code = validateOtpCode(codeValue)

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()
  if (existing) throw new AuthHttpError(409, 'EMAIL_TAKEN', '该邮箱已注册')

  await consumeValidOtp(env, email, 'register', code)

  const id = randomId(16)
  const salt = newSaltHex()
  const passwordHash = await hashPassword(password, salt)
  const createdAt = new Date().toISOString()
  try {
    await env.DB.prepare(
      'INSERT INTO users (id, email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(id, email, passwordHash, salt, createdAt)
      .run()
  } catch {
    throw new AuthHttpError(409, 'EMAIL_TAKEN', '该邮箱已注册')
  }

  const session = await createSession(env, id)
  return {
    user: { id, email, createdAt } satisfies EdgeUser,
    sessionToken: session.token,
    maxAgeDays: sessionDays(env),
  }
}

/** Login with email OTP (no password). */
export const loginWithOtp = async (env: Env, emailValue: unknown, codeValue: unknown) => {
  const email = validateEmailOnly(emailValue)
  const code = validateOtpCode(codeValue)

  const row = await env.DB.prepare(
    'SELECT id, email, created_at FROM users WHERE email = ?',
  )
    .bind(email)
    .first<{ id: string; email: string; created_at: string }>()
  if (!row) throw new AuthHttpError(404, 'USER_NOT_FOUND', '该邮箱尚未注册，请先注册')

  await consumeValidOtp(env, email, 'login', code)

  const session = await createSession(env, row.id)
  return {
    user: { id: row.id, email: row.email, createdAt: row.created_at } satisfies EdgeUser,
    sessionToken: session.token,
    maxAgeDays: sessionDays(env),
  }
}
