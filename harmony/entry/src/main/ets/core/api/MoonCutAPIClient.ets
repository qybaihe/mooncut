import { http } from '@kit.NetworkKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { common } from '@kit.AbilityKit';
import { url as urlKit } from '@kit.ArkTS';
import { APIConfiguration } from './APIConfiguration';
import { APIError } from './APIError';
import { presentError, standardError } from './ErrorPresentation';
import { NetworkTrust } from '../security/NetworkTrust';
import { SecureSessionStore } from '../security/SecureSessionStore';
import {
  AuthCredentialsRequest, AuthEnvelope, AuthUser, CoachAdviceRequest, CoachAdviceResponse, CommunityListResponse,
  CommunityPublishResponse, EditJob, EditJobCreateResponse, HealthResponse, RenderQueueSnapshot, AssetUploadResponse, UploadSession,
  ScriptAssistantRequest, ScriptAssistantResponse, EmptyRequest, UploadSessionCreateRequest, EditJobCreateRequest,
  CommunityPublishRequest
} from './APIModels';

interface ErrorBody { error?: string; code?: string; message?: string; requestId?: string; }
interface ParsedContentRange { start: number; end: number; total: number; }
interface RangeResponse { data: ArrayBuffer; headers: Record<string, string | string[]>; status: number; }

/** The native client uses only the user's mooncut_session cookie. */
export class MoonCutAPIClient {
  readonly configuration: APIConfiguration;
  private sessionCookie: string = '';
  private initialized: boolean = false;
  private readonly secureSessionStore: SecureSessionStore;

  constructor(
    configuration: APIConfiguration = APIConfiguration.current(),
    secureSessionStore: SecureSessionStore = new SecureSessionStore()
  ) {
    this.configuration = configuration;
    this.secureSessionStore = secureSessionStore;
  }

  async initialize(context: common.UIAbilityContext): Promise<void> {
    if (this.initialized) return;
    if (this.configuration.requiresBundledCA) {
      this.configuration.caPath = await NetworkTrust.prepareBundledCA(context);
    }
    this.sessionCookie = await this.secureSessionStore.load();
    this.initialized = true;
  }

  async health(): Promise<HealthResponse> { return this.requestJson<HealthResponse>('GET', '/healthz', undefined, false); }
  async session(): Promise<AuthUser | null> { return (await this.requestJson<AuthEnvelope>('GET', '/v1/auth/session')).user; }
  async register(email: string, password: string): Promise<AuthUser> {
    const payload: AuthCredentialsRequest = { email, password };
    return (await this.requestJson<AuthEnvelope>('POST', '/v1/auth/register', payload, false)).user!;
  }
  async login(email: string, password: string): Promise<AuthUser> {
    const payload: AuthCredentialsRequest = { email, password };
    return (await this.requestJson<AuthEnvelope>('POST', '/v1/auth/login', payload, false)).user!;
  }
  async logout(): Promise<void> {
    const payload: EmptyRequest = {};
    await this.requestJson<Record<string, boolean>>('POST', '/v1/auth/logout', payload);
    this.sessionCookie = '';
    await this.secureSessionStore.clear();
  }
  async getEditJob(id: string): Promise<EditJob> { return this.requestJson<EditJob>('GET', `/v1/edit-jobs/${id}`); }
  async createUploadSession(filename: string, bytes: number, contentType: string): Promise<UploadSession> {
    const payload: UploadSessionCreateRequest = { filename, bytes, contentType };
    return this.requestJson<UploadSession>('POST', '/v1/upload-sessions', payload);
  }
  async getUploadSession(id: string): Promise<UploadSession> {
    return this.requestJson<UploadSession>('GET', `/v1/upload-sessions/${id}`);
  }
  async uploadChunk(id: string, offset: number, data: ArrayBuffer): Promise<UploadSession> {
    return this.requestBinaryJson<UploadSession>(`/v1/upload-sessions/${id}/chunks?offset=${offset}`, data, 'application/octet-stream');
  }
  async completeUploadSession(id: string): Promise<AssetUploadResponse> {
    const payload: EmptyRequest = {};
    return this.requestJson<AssetUploadResponse>('POST', `/v1/upload-sessions/${id}/complete`, payload);
  }
  async createEditJob(assetId: string, title?: string, prompt?: string, imageGeneration: string = 'auto'): Promise<EditJobCreateResponse> {
    const payload: EditJobCreateRequest = { assetId, title, prompt, imageGeneration };
    return this.requestJson<EditJobCreateResponse>('POST', '/v1/edit-jobs', payload);
  }
  async renderQueue(): Promise<RenderQueueSnapshot> { return this.requestJson<RenderQueueSnapshot>('GET', '/v1/render-queue'); }
  async scriptAssistant(payload: ScriptAssistantRequest): Promise<ScriptAssistantResponse> {
    return this.requestJson<ScriptAssistantResponse>('POST', '/v1/assistant/script', payload);
  }
  async coachAdvice(payload: CoachAdviceRequest): Promise<CoachAdviceResponse> {
    return this.requestJson<CoachAdviceResponse>('POST', '/v1/assistant/coach', payload);
  }
  async community(cursor?: string): Promise<CommunityListResponse> {
    const suffix = cursor ? `?limit=12&cursor=${encodeURIComponent(cursor)}` : '?limit=12';
    return this.requestJson<CommunityListResponse>('GET', `/v1/community/posts${suffix}`);
  }
  async publishCommunity(jobId: string, authorName?: string, title?: string, caption?: string): Promise<CommunityPublishResponse> {
    const payload: CommunityPublishRequest = { jobId, authorName, title, caption };
    return this.requestJson<CommunityPublishResponse>('POST', '/v1/community/posts', payload);
  }

  clearSession(): void {
    this.sessionCookie = '';
    void this.secureSessionStore.clear();
  }
  hasSessionCookie(): boolean { return this.sessionCookie.length > 0; }
  artifactUrl(jobId: string, artifact: string = 'video'): string {
    return this.configuration.url(`/v1/edit-jobs/${jobId}/artifacts/${artifact}`);
  }

  async downloadArtifact(jobId: string, destinationPath: string, artifact: string = 'video'): Promise<string> {
    return this.downloadUrl(this.artifactUrl(jobId, artifact), destinationPath);
  }

  async downloadUrl(url: string, destinationPath: string): Promise<string> {
    this.assertTrustedResourceUrl(url);
    const probe = await this.requestRange(url, 0, 0);
    const total = this.contentRangeTotal(probe.headers);
    if (total <= 0) throw new APIError('资源下载响应缺少文件大小', probe.status, 'DOWNLOAD_SIZE_MISSING');
    const file = fs.openSync(destinationPath, fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
    let completed = false;
    try {
      this.writeDownloadChunk(file.fd, probe.data);
      let offset = probe.data.byteLength;
      const chunkBytes = 2 * 1024 * 1024;
      while (offset < total) {
        const end = Math.min(total - 1, offset + chunkBytes - 1);
        const part = await this.requestRange(url, offset, end);
        if (part.data.byteLength === 0) throw new APIError('资源分段下载返回空数据', part.status, 'DOWNLOAD_EMPTY_CHUNK');
        if (offset + part.data.byteLength > total) {
          throw new APIError('资源分段下载超过服务声明大小', part.status, 'DOWNLOAD_SIZE_MISMATCH');
        }
        this.writeDownloadChunk(file.fd, part.data);
        offset += part.data.byteLength;
      }
      if (offset !== total) throw new APIError('资源下载长度不完整', 0, 'DOWNLOAD_SIZE_MISMATCH');
      completed = true;
    } finally {
      fs.closeSync(file);
      if (!completed) {
        try { fs.unlinkSync(destinationPath); } catch (_) {}
      }
    }
    return destinationPath;
  }

  private writeDownloadChunk(fd: number, data: ArrayBuffer): void {
    const written = fs.writeSync(fd, data);
    if (written !== data.byteLength) {
      throw new APIError(`资源写入中断：期望 ${data.byteLength} 字节，实际 ${written} 字节`, 0, 'DOWNLOAD_WRITE_INCOMPLETE');
    }
  }

  private assertTrustedResourceUrl(url: string): void {
    const base: urlKit.URL = urlKit.URL.parseURL(this.configuration.baseUrl);
    const resource: urlKit.URL = urlKit.URL.parseURL(url);
    if (base.protocol !== resource.protocol || base.hostname !== resource.hostname || base.port !== resource.port) {
      throw new APIError('拒绝向非 MoonCut 服务地址发送用户会话', 0, 'UNTRUSTED_RESOURCE_URL');
    }
  }

  private async requestBinaryJson<T>(path: string, data: ArrayBuffer, contentType: string): Promise<T> {
    const request = http.createHttp();
    const headers: Record<string, string> = { 'Content-Type': contentType, 'Accept': 'application/json' };
    if (this.sessionCookie) headers['Cookie'] = this.sessionCookie;
    try {
      const options: http.HttpRequestOptions = {
        method: http.RequestMethod.POST,
        header: headers,
        extraData: data,
        expectDataType: http.HttpDataType.STRING,
        connectTimeout: this.configuration.requestTimeoutMs,
        readTimeout: this.configuration.uploadTimeoutMs
      };
      this.applyTrust(options);
      const response = await request.request(this.configuration.url(path), options);
      const text = typeof response.result === 'string' ? response.result : '';
      if (response.responseCode < 200 || response.responseCode >= 300) {
        if (response.responseCode === 401) this.clearSession();
        let parsed: ErrorBody = {};
        try { parsed = JSON.parse(text) as ErrorBody; } catch (_) {}
        throw this.responseError(response.responseCode, parsed, `分块上传失败（${response.responseCode}）`, 'UPLOAD_CHUNK_FAILED');
      }
      return JSON.parse(text) as T;
    } catch (error) {
      if (error instanceof APIError) throw error;
      throw new APIError(`分块上传连接失败：${presentError(error as object)}`);
    } finally { request.destroy(); }
  }

  private async requestRange(url: string, start: number, end: number): Promise<RangeResponse> {
    const request = http.createHttp();
    const headers: Record<string, string> = { 'Range': `bytes=${start}-${end}` };
    if (this.sessionCookie) headers['Cookie'] = this.sessionCookie;
    try {
      const options: http.HttpRequestOptions = {
        method: http.RequestMethod.GET,
        header: headers,
        expectDataType: http.HttpDataType.ARRAY_BUFFER,
        connectTimeout: this.configuration.requestTimeoutMs,
        readTimeout: this.configuration.resourceTimeoutMs
      };
      this.applyTrust(options);
      const response = await request.request(url, options);
      if (response.responseCode === 401) {
        this.clearSession();
        throw new APIError('登录已失效，请重新登录', 401, 'AUTH_REQUIRED');
      }
      if (response.responseCode !== 206) {
        throw new APIError(`资源下载不支持 Range（${response.responseCode}）`, response.responseCode, 'DOWNLOAD_RANGE_UNSUPPORTED');
      }
      const data = response.result as ArrayBuffer;
      const responseHeaders = response.header as Record<string, string | string[]>;
      const contentRange = this.parseContentRange(responseHeaders);
      if (!contentRange || contentRange.start !== start || contentRange.end !== start + data.byteLength - 1 || contentRange.end > end) {
        throw new APIError('资源分段响应偏移不匹配', response.responseCode, 'DOWNLOAD_RANGE_MISMATCH');
      }
      return {
        data,
        headers: responseHeaders,
        status: response.responseCode
      };
    } catch (error) {
      if (error instanceof APIError) throw error;
      throw new APIError(`资源下载连接失败：${presentError(error as object)}`);
    } finally { request.destroy(); }
  }

  private contentRangeTotal(headers: Record<string, string | string[]>): number {
    return this.parseContentRange(headers)?.total ?? 0;
  }

  private parseContentRange(headers: Record<string, string | string[]>): ParsedContentRange | null {
    const key = Object.keys(headers).find((name) => name.toLowerCase() === 'content-range');
    if (!key) return null;
    const raw = Array.isArray(headers[key]) ? (headers[key] as string[])[0] : headers[key] as string;
    const match = raw.match(/^bytes\s+([0-9]+)-([0-9]+)\/([0-9]+)$/i);
    if (!match) return null;
    return { start: Number(match[1]), end: Number(match[2]), total: Number(match[3]) };
  }

  private async requestJson<T>(method: 'GET' | 'POST', path: string, body?: object, includeSession: boolean = true): Promise<T> {
    const request = http.createHttp();
    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (includeSession && this.sessionCookie) headers['Cookie'] = this.sessionCookie;
    try {
      const options: http.HttpRequestOptions = {
        method: method === 'POST' ? http.RequestMethod.POST : http.RequestMethod.GET,
        header: headers,
        extraData: body === undefined ? undefined : JSON.stringify(body),
        expectDataType: http.HttpDataType.STRING,
        connectTimeout: this.configuration.requestTimeoutMs,
        readTimeout: this.configuration.resourceTimeoutMs
      };
      this.applyTrust(options);
      const response = await request.request(this.configuration.url(path), options);
      await this.captureCookie(response.header as Record<string, string | string[]>, response.cookies);
      const text = typeof response.result === 'string' ? response.result : '';
      if (response.responseCode < 200 || response.responseCode >= 300) {
        if (response.responseCode === 401) this.clearSession();
        let parsed: ErrorBody = {};
        try { parsed = JSON.parse(text) as ErrorBody; } catch (_) {}
        throw this.responseError(response.responseCode, parsed, `请求失败（${response.responseCode}）`);
      }
      return JSON.parse(text || 'null') as T;
    } catch (error) {
      if (error instanceof APIError) throw error;
      throw new APIError(`无法连接 MoonCut 服务：${presentError(error as object)}`);
    } finally {
      request.destroy();
    }
  }

  private applyTrust(options: http.HttpRequestOptions): void {
    if (this.configuration.caPath) options.caPath = this.configuration.caPath;
  }

  private responseError(status: number, body: ErrorBody, fallback: string, fallbackCode: string = 'HTTP_ERROR'): APIError {
    let message = body.error ?? body.message ?? fallback;
    let code = body.code ?? fallbackCode;
    if (status === 401) { message = '登录已失效，请重新登录'; code = body.code ?? 'AUTH_REQUIRED'; }
    else if (status === 413) { message = '视频超过服务端大小限制（413）'; code = 'PAYLOAD_TOO_LARGE'; }
    else if (status === 415) { message = '不支持的视频格式（415）'; code = 'UNSUPPORTED_MEDIA'; }
    else if (status === 429) { message = body.error ?? body.message ?? '请求过于频繁，请稍后再试（429）'; code = body.code ?? 'RATE_LIMITED'; }
    if (body.requestId) message = `${message} · 诊断号 ${body.requestId}`;
    return new APIError(message, status, code);
  }

  private async captureCookie(headers: Record<string, string | string[]>, responseCookies: string = ''): Promise<void> {
    const key = Object.keys(headers).find((name) => name.toLowerCase() === 'set-cookie');
    const values: string[] = key ? (Array.isArray(headers[key]) ? headers[key] as string[] : [headers[key] as string]) : [];
    if (responseCookies) values.push(responseCookies);
    const match = values.join(',').match(/mooncut_session=([^;,\s]*)/);
    if (!match) return;
    if (!match[1]) {
      this.sessionCookie = '';
      await this.secureSessionStore.clear();
      return;
    }
    this.sessionCookie = `mooncut_session=${match[1]}`;
    try {
      await this.secureSessionStore.save(this.sessionCookie);
    } catch (error) {
      this.sessionCookie = '';
      throw standardError(error as object);
    }
  }
}
