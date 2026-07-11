export type WorkspacePage = 'landing' | 'edit' | 'record' | 'community' | 'queue'

export type RenderQueueItem = {
  name: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  stage: string
  progress: number
  createdAt: string
  updatedAt: string
  queuePosition?: number
  mine: boolean
}

export type RenderQueueSnapshot = {
  updatedAt: string
  summary: { running: number; queued: number; completedToday: number }
  active: RenderQueueItem[]
  recent: RenderQueueItem[]
}

export type AuthUser = {
  id: string
  email: string
  createdAt: string
}

export type CommunityPost = {
  id: string
  authorName: string
  title: string
  caption: string
  durationMs: number
  width: number
  height: number
  createdAt: string
  videoUrl: string
  posterUrl?: string
}

export type Theme = 'light' | 'dark' | 'memphis'

export type PetAnimationState =
  | 'idle'
  | 'running'
  | 'waving'
  | 'jumping'
  | 'failed'
  | 'waiting'
  | 'review'

export type VideoAsset = {
  name: string
  sizeLabel: string
  url?: string
  file?: Blob
  resultUrl?: string
  jobId?: string
  source: 'upload' | 'recording'
}

export type ScriptSuggestion = {
  eyebrow: string
  title: string
  detail: string
}

export type ScriptAssistantResponse = {
  reply: string
  phase: 'discover' | 'outline' | 'draft'
  ready: boolean
  draft: string
  petMessage: string
  suggestions: ScriptSuggestion[]
  model: string
}

export type CoachAdviceResponse = {
  category: 'pace' | 'volume' | 'pause' | 'script' | 'camera' | 'steady'
  advice: string
  petMessage: string
  positive: boolean
  model: string
}

export type EditJob = {
  id: string
  originalName: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  stage: string
  progress: number
  request?: {
    imageGeneration?: 'auto' | 'off'
    title?: string
    prompt?: string
  }
  error?: string
  mail?: {
    recipient: string
    status: 'scheduled' | 'ready' | 'awaiting-confirmation' | 'sent' | 'failed'
    updatedAt: string
    sentAt?: string
    error?: string
  }
  subtitleRepair?: {
    parentJobId: string
    rootJobId: string
    feedback: {
      instruction: string
      atMs?: number
      replacementText?: string
    }
    analysis?: {
      summary: string
      model: string
      changes: Array<{
        segmentIndex: number
        before: string
        after: string
        startMs: number
        endMs: number
        reason: string
      }>
    }
  }
  result?: {
    summary: string
    artifacts: Record<string, string>
    probe?: {
      durationMs: number
      width: number
      height: number
      hasAudio: boolean
    }
    models?: {
      planner: string
      vision: string
      image?: string
    }
    visuals?: {
      mode: 'off' | 'none' | 'generated' | 'unavailable'
      reason: string
      maxImages: number
      requestedCount: number
      providerConfigured: boolean
      assets: Array<{ id: string; label: string; model: string }>
      errors: string[]
    }
    quality?: { ok: boolean }
  }
}
