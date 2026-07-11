import type { WorkspacePage } from '../types'

/** Workspace destinations that require authentication. */
export type WorkspaceDestination = Exclude<WorkspacePage, 'landing' | 'public-community'>

export type AuthMode = 'login' | 'register'

/** Resolve where to send the user after successful login/register. */
export function resolvePostAuthPage(
  intent: WorkspaceDestination | null | undefined,
  fallback: WorkspacePage = 'landing',
): WorkspacePage {
  return intent ?? fallback
}

/** Community browsing is public; all creation and capability pages require a session. */
export function requiresAuth(page: WorkspacePage): boolean {
  return page !== 'landing' && page !== 'public-community'
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
    community: `${verb}发现并管理 Pi 能力。`,
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
