import BuildProfile from 'BuildProfile';
import { url } from '@kit.ArkTS';

export enum BuildEnvironment {
  DEBUG = 'debug',
  RELEASE = 'release'
}

export class APIConfiguration {
  readonly baseUrl: string;
  readonly trustedHost: string;
  readonly environment: BuildEnvironment;
  readonly requiresBundledCA: boolean;
  readonly requestTimeoutMs: number;
  readonly resourceTimeoutMs: number;
  readonly uploadTimeoutMs: number;
  readonly pollIntervalMs: number;
  caPath: string = '';

  constructor(
    baseUrl: string = 'http://127.0.0.1:4317',
    trustedHost: string = '127.0.0.1',
    environment: BuildEnvironment = BuildEnvironment.DEBUG,
    requiresBundledCA: boolean = false
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.trustedHost = trustedHost;
    this.environment = environment;
    this.requiresBundledCA = requiresBundledCA;
    this.requestTimeoutMs = 30_000;
    this.resourceTimeoutMs = 120_000;
    this.uploadTimeoutMs = 600_000;
    this.pollIntervalMs = 3_000;
    this.validate();
  }

  static current(): APIConfiguration {
    const configuredEnvironment: string = BuildProfile.MoonCutEnvironment as string;
    const environment = configuredEnvironment === 'release'
      ? BuildEnvironment.RELEASE : BuildEnvironment.DEBUG;
    return new APIConfiguration(
      BuildProfile.MoonCutApiBaseUrl,
      BuildProfile.MoonCutTrustedHost,
      environment,
      BuildProfile.MoonCutUseBundledCA
    );
  }

  url(path: string): string {
    return `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }

  private validate(): void {
    const parsed: url.URL = url.URL.parseURL(this.baseUrl);
    if (parsed.hostname !== this.trustedHost) {
      throw new Error(`MoonCut 服务主机不匹配：${parsed.hostname}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('MoonCut 服务地址只允许 HTTP 或 HTTPS');
    }
    if (this.environment === BuildEnvironment.RELEASE && parsed.protocol !== 'https:') {
      throw new Error('MoonCut Release 构建只允许 HTTPS');
    }
    if (this.environment === BuildEnvironment.RELEASE && !this.requiresBundledCA) {
      throw new Error('MoonCut Release 构建必须启用捆绑 CA');
    }
    if (parsed.protocol === 'http:' && !this.isLoopback(parsed.hostname)) {
      throw new Error('MoonCut 明文 HTTP 仅允许本机调试地址');
    }
  }

  private isLoopback(hostname: string): boolean {
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1' || hostname === '[::1]';
  }
}
