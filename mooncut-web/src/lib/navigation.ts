import type { WorkspacePage } from '../types'

/** Workspace destinations that require authentication. */
export type WorkspaceDestination = Exclude<
  WorkspacePage,
  'landing' | 'public-community' | 'pricing' | 'privacy'
>

/**
 * Intent for where the user should land after authenticating.
 *
 * Includes `pricing` so the public pricing page can request that signed-in users
 * return to it after logging in, even though `pricing` itself is not an
 * auth-gated workspace destination.
 */
export type PostAuthIntent = WorkspaceDestination | 'pricing'

export type AuthMode = 'login' | 'register'

/** Resolve where to send the user after successful login/register. */
export function resolvePostAuthPage(
  intent: PostAuthIntent | null | undefined,
  fallback: WorkspacePage = 'landing',
): WorkspacePage {
  return intent ?? fallback
}

/** Community, pricing, privacy browsing are public; creation / account pages require a session. */
export function requiresAuth(page: WorkspacePage): boolean {
  return (
    page !== 'landing' &&
    page !== 'public-community' &&
    page !== 'pricing' &&
    page !== 'privacy'
  )
}

/** Human-readable destination labels for the auth surface. */
export function destinationLabel(
  intent: PostAuthIntent | null | undefined,
  mode: AuthMode = 'login',
): string | null {
  if (!intent) return null
  const verb = mode === 'register' ? '注册后' : '登录后'
  const labels: Record<PostAuthIntent, string> = {
    record: `${verb}进入录制间，从想法开始写稿、提词录制。`,
    edit: `${verb}进入剪辑台，上传或继续剪辑素材。`,
    me: `${verb}进入「我的」页，管理账户与创作偏好。`,
    queue: `${verb}查看渲染队列。`,
    pricing: `${verb}回到定价页继续选择适合你的套餐。`,
  }
  return labels[intent]
}

/** Prefer register for first-time “start creating” CTAs; login for explicit sign-in. */
export function authModeForEntry(
  entry: 'cta-create' | 'cta-edit' | 'sign-in' | 'sign-up' | 'workspace',
): AuthMode {
  if (entry === 'sign-up' || entry === 'cta-create') return 'register'
  return 'login'
}