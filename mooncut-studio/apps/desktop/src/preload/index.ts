/**
 * Strict typed IPC bridge. Renderer only sees `window.mooncut` — no Node APIs.
 * Built to a single CJS bundle so sandbox preload can load without ESM package imports.
 */

import {contextBridge, ipcRenderer} from "electron";

/** Inline channel names — must match @mooncut/studio-shared IPC_CHANNELS. */
const C = {
  appGetInfo: "studio:app:getInfo",
  settingsGet: "studio:settings:get",
  settingsUpdate: "studio:settings:update",
  onboardingGet: "studio:onboarding:get",
  onboardingComplete: "studio:onboarding:complete",
  projectList: "studio:project:list",
  projectCreate: "studio:project:create",
  projectOpen: "studio:project:open",
  projectDelete: "studio:project:delete",
  projectReveal: "studio:project:reveal",
  projectExportPackage: "studio:project:exportPackage",
  projectImportMedia: "studio:project:importMedia",
  projectListMedia: "studio:project:listMedia",
  projectProbeMedia: "studio:project:probeMedia",
  dialogSelectDirectory: "studio:dialog:selectDirectory",
  dialogSelectVideo: "studio:dialog:selectVideo",
  agentStatus: "studio:agent:status",
  agentRestart: "studio:agent:restart",
  jobCreate: "studio:job:create",
  jobGet: "studio:job:get",
  jobList: "studio:job:list",
  jobListAll: "studio:job:listAll",
  jobRenderQueue: "studio:job:renderQueue",
  jobCancel: "studio:job:cancel",
  jobRetry: "studio:job:retry",
  jobRevealArtifact: "studio:job:revealArtifact",
  subtitleRepairCreate: "studio:subtitleRepair:create",
  subtitleRepairList: "studio:subtitleRepair:list",
  asrStatus: "studio:asr:status",
  asrTranscribe: "studio:asr:transcribe",
  providerList: "studio:provider:list",
  providerCatalog: "studio:provider:catalog",
  providerUpsert: "studio:provider:upsert",
  providerDelete: "studio:provider:delete",
  providerTest: "studio:provider:test",
  depsList: "studio:deps:list",
  depsRefresh: "studio:deps:refresh",
  cacheClear: "studio:cache:clear",
  diagnosticsExport: "studio:diagnostics:export",
  shellOpenExternal: "studio:shell:openExternal",
  shellShowItem: "studio:shell:showItem",
  pathJoin: "studio:path:join",
  mediaPreviewUrl: "studio:media:previewUrl",
  mediaSaveRecording: "studio:media:saveRecording",
  assistantScript: "studio:assistant:script",
  assistantCoach: "studio:assistant:coach",
} as const;

const api = {
  getAppInfo: () => ipcRenderer.invoke(C.appGetInfo),
  getSettings: () => ipcRenderer.invoke(C.settingsGet),
  updateSettings: (input: unknown) => ipcRenderer.invoke(C.settingsUpdate, input),
  getOnboarding: () => ipcRenderer.invoke(C.onboardingGet),
  completeOnboarding: (input: unknown) => ipcRenderer.invoke(C.onboardingComplete, input),
  listProjects: () => ipcRenderer.invoke(C.projectList),
  createProject: (input: unknown) => ipcRenderer.invoke(C.projectCreate, input),
  openProject: (projectId: string) => ipcRenderer.invoke(C.projectOpen, projectId),
  deleteProject: (projectId: string, deleteFiles: boolean) =>
    ipcRenderer.invoke(C.projectDelete, {projectId, deleteFiles}),
  revealProject: (projectId: string) => ipcRenderer.invoke(C.projectReveal, projectId),
  exportProjectPackage: (projectId: string) => ipcRenderer.invoke(C.projectExportPackage, projectId),
  importMedia: (projectId: string, filePath?: string) =>
    ipcRenderer.invoke(C.projectImportMedia, {projectId, filePath}),
  listMedia: (projectId: string) => ipcRenderer.invoke(C.projectListMedia, projectId),
  probeMedia: (absolutePath: string) => ipcRenderer.invoke(C.projectProbeMedia, absolutePath),
  selectDirectory: () => ipcRenderer.invoke(C.dialogSelectDirectory),
  selectVideo: () => ipcRenderer.invoke(C.dialogSelectVideo),
  agentStatus: () => ipcRenderer.invoke(C.agentStatus),
  agentRestart: () => ipcRenderer.invoke(C.agentRestart),
  createJob: (input: unknown) => ipcRenderer.invoke(C.jobCreate, input),
  getJob: (projectId: string, jobId: string) =>
    ipcRenderer.invoke(C.jobGet, {projectId, jobId}),
  listJobs: (projectId: string) => ipcRenderer.invoke(C.jobList, projectId),
  cancelJob: (projectId: string, jobId: string) =>
    ipcRenderer.invoke(C.jobCancel, {projectId, jobId}),
  retryJob: (projectId: string, jobId: string) =>
    ipcRenderer.invoke(C.jobRetry, {projectId, jobId}),
  revealArtifact: (absolutePath: string) => ipcRenderer.invoke(C.jobRevealArtifact, absolutePath),
  listAllJobs: () => ipcRenderer.invoke(C.jobListAll),
  getRenderQueue: () => ipcRenderer.invoke(C.jobRenderQueue),
  createSubtitleRepair: (jobId: string, payload: unknown) =>
    ipcRenderer.invoke(C.subtitleRepairCreate, {jobId, payload}),
  listSubtitleRepairs: (jobId: string) =>
    ipcRenderer.invoke(C.subtitleRepairList, jobId),
  asrStatus: () => ipcRenderer.invoke(C.asrStatus),
  asrTranscribe: (audio: ArrayBuffer, options?: unknown) =>
    ipcRenderer.invoke(C.asrTranscribe, {audio, options}),
  listProviders: () => ipcRenderer.invoke(C.providerList),
  listProviderCatalog: () => ipcRenderer.invoke(C.providerCatalog),
  upsertProvider: (input: unknown) => ipcRenderer.invoke(C.providerUpsert, input),
  deleteProvider: (id: string) => ipcRenderer.invoke(C.providerDelete, id),
  testProvider: (profileId: string) => ipcRenderer.invoke(C.providerTest, profileId),
  listDeps: () => ipcRenderer.invoke(C.depsList),
  refreshDeps: () => ipcRenderer.invoke(C.depsRefresh),
  clearCache: () => ipcRenderer.invoke(C.cacheClear),
  exportDiagnostics: () => ipcRenderer.invoke(C.diagnosticsExport),
  openExternal: (url: string) => ipcRenderer.invoke(C.shellOpenExternal, url),
  showItem: (path: string) => ipcRenderer.invoke(C.shellShowItem, path),
  mediaPreviewUrl: (absolutePath: string) => ipcRenderer.invoke(C.mediaPreviewUrl, absolutePath),
  mediaSaveRecording: (payload: {
    projectId: string;
    filename: string;
    bytes: ArrayBuffer;
    mimeType?: string;
  }) => ipcRenderer.invoke(C.mediaSaveRecording, payload),
  assistantScript: (body: unknown) => ipcRenderer.invoke(C.assistantScript, body),
  assistantCoach: (body: unknown) => ipcRenderer.invoke(C.assistantCoach, body),
};

try {
  contextBridge.exposeInMainWorld("mooncut", api);
} catch (error) {
  // Surface preload failures instead of silent undefined window.mooncut
  console.error("[mooncut-preload] failed to expose API", error);
}

export type MooncutDesktopApi = typeof api;
