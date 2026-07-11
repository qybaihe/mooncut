export interface AuthUser {
  id: string;
  email: string;
  createdAt: string;
}

export interface AuthEnvelope { user: AuthUser | null; }
export interface AuthCredentialsRequest { email: string; password: string; }
export interface EmptyRequest {}
export interface HealthResponse {
  ok: boolean;
  service?: string;
  plannerModel?: string;
  visionModels?: string[];
  imageGenerationConfigured?: boolean;
  communityPosts?: number;
  gatewayReachable?: boolean;
}

export interface AssetUploadResponse { assetId: string; filename?: string; bytes?: number; }
export interface UploadSessionCreateRequest { filename: string; bytes: number; contentType: string; }
export interface EditJobCreateRequest { assetId: string; title?: string; prompt?: string; imageGeneration: string; }
export interface UploadSession {
  id: string;
  filename: string;
  bytes: number;
  receivedBytes: number;
  chunkBytes: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  statusUrl: string;
  chunkUrl: string;
  completeUrl: string;
}
export interface EditJobCreateResponse { id: string; status: string; statusUrl?: string; videoUrl?: string; assetId?: string; }
export interface EditJobRequest { imageGeneration?: string; title?: string; prompt?: string; }
export interface QualityResult { ok?: boolean; }
export interface MediaProbe { durationMs?: number; width?: number; height?: number; hasAudio?: boolean; }
export interface EditJobResult {
  summary?: string;
  artifacts?: Record<string, string>;
  probe?: MediaProbe;
  quality?: QualityResult;
}
export interface EditJob {
  id: string;
  originalName?: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | string;
  stage?: string;
  progress?: number;
  error?: string;
  request?: EditJobRequest;
  result?: EditJobResult;
  createdAt?: string;
  updatedAt?: string;
}

export interface RenderQueueSummary { running: number; queued: number; completedToday: number; }
export interface RenderQueueItem {
  name: string;
  status: string;
  stage: string;
  progress: number;
  createdAt: string;
  updatedAt: string;
  queuePosition?: number;
  mine: boolean;
}
export interface RenderQueueSnapshot {
  updatedAt?: string;
  summary: RenderQueueSummary;
  active: RenderQueueItem[];
  recent: RenderQueueItem[];
}

export interface ScriptMessage { role: 'assistant' | 'user'; content: string; }
export interface ScriptAssistantRequest { action?: string; style?: string; messages: ScriptMessage[]; draft?: string; }
export interface ScriptSuggestion { eyebrow: string; title: string; detail: string; }
export interface ScriptAssistantResponse {
  reply: string;
  phase?: string;
  ready?: boolean;
  draft?: string;
  petMessage?: string;
  suggestions?: ScriptSuggestion[];
  model?: string;
}

export interface CoachMetrics {
  pace: number; wordCount: number; volume: number; pauseCount: number; eyeContact?: number; elapsedSeconds: number;
}
export interface CoachAdviceRequest {
  transcript: string; currentScript: string; currentSentence: string; lastAdvice?: string; metrics: CoachMetrics;
}
export interface CoachAdviceResponse { category?: string; advice: string; petMessage?: string; positive?: boolean; model?: string; }

export interface CommunityPost {
  id: string; authorName: string; title: string; caption: string; durationMs?: number; width?: number; height?: number;
  createdAt: string; videoUrl: string; posterUrl?: string;
}
export interface CommunityListResponse { items: CommunityPost[]; nextCursor?: string; }
export interface CommunityPublishResponse { created?: boolean; post: CommunityPost; }
export interface CommunityPublishRequest { jobId: string; authorName?: string; title?: string; caption?: string; }

export function jobStageTitle(stage?: string): string {
  switch (stage) {
    case 'inspecting-source': case 'preparing-source': return '检查素材';
    case 'transcribing': return '转写口播';
    case 'scheduling-visuals': return '素材调度';
    case 'researching-x': case 'browsing-web': return '检索参考';
    case 'tracking-speaker': return '跟脸取景';
    case 'planning-edit': return '编排分镜';
    case 'rendering': return '渲染成片';
    case 'visual-quality-review': case 'verifying': return '质检';
    case 'verified': return '质检通过';
    case 'completed': return '已完成';
    case 'failed': return '任务失败';
    case 'interrupted': return '任务中断';
    case 'queued': case undefined: case '': return '排队中';
    default: return stage;
  }
}
