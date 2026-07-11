import type { WorkspacePage } from '../types'

/** Workspace destinations that require authentication. */
export type WorkspaceDestination = Exclude<WorkspacePage, 'landing'>

export type AuthMode = 'login' | 'register'

/** Resolve where to send the user after successful login/register. */
export function resolvePostAuthPage(
  intent: WorkspaceDestination | null | undefined,
  fallback: WorkspacePage = 'landing',
): WorkspacePage {
  return intent ?? fallback
}

/** Pages other than landing require a signed-in user. */
export function requiresAuth(page: WorkspacePage): boolean {
  return page !== 'landing'
}

/** Human-readable destination labels for the auth surface. */
export function destinationLabel(
  intent: WorkspaceDestination | null | undefined,
  mode: AuthMode = 'login',
): string | null {
  if (!intent) return null
  const verb = mode === 'register' ? '注册后' : '登录后'
  const labels: Record<WorkspaceDestination, string> = {
    record: `${verb}进入录制间，从想法开始写稿、提词录制。`,
    edit: `${verb}进入剪辑台，上传或继续剪辑素材。`,
    community: `${verb}浏览社区作品。`,
    queue: `${verb}查看渲染队列。`,
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
