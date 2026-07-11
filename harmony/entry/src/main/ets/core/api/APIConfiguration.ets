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
  readonly isConfigured: boolean;
  readonly distributionMode: string;
  readonly requestTimeoutMs: number;
  readonly resourceTimeoutMs: number;
  readonly uploadTimeoutMs: number;
  readonly pollInitialIntervalMs: number;
  readonly pollMaxIntervalMs: number;
  caPath: string = '';

  constructor(
    baseUrl: string = 'http://127.0.0.1:4317',
    trustedHost: string = '127.0.0.1',
    environment: BuildEnvironment = BuildEnvironment.DEBUG,
    requiresBundledCA: boolean = false,
    isConfigured: boolean = true,
    distributionMode: string = 'internal'
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.trustedHost = trustedHost;
    this.environment = environment;
    this.requiresBundledCA = requiresBundledCA;
    this.isConfigured = isConfigured;
    this.distributionMode = distributionMode;
    this.requestTimeoutMs = environment === BuildEnvironment.DEBUG ? 5_000 : 30_000;
    this.resourceTimeoutMs = environment === BuildEnvironment.DEBUG ? 8_000 : 120_000;
    this.uploadTimeoutMs = 600_000;
    this.pollInitialIntervalMs = 1_500;
    this.pollMaxIntervalMs = 5_000;
    this.validate();
  }

  static current(): APIConfiguration {
    const configuredEnvironment: string = BuildProfile.MoonCutEnvironment as string;
    const environment = configuredEnvironment === 'release'
      ? BuildEnvironment.RELEASE : BuildEnvironment.DEBUG;
    const rawBaseUrl = (BuildProfile.MoonCutApiBaseUrl as string).trim();
    const distributionMode = (BuildProfile.MoonCutDistributionMode as string).trim().toLowerCase();
    const isConfigured = distributionMode !== 'public' && rawBaseUrl !== '' && rawBaseUrl.toLowerCase() !== 'unconfigured';
    return new APIConfiguration(
      isConfigured ? rawBaseUrl : 'https://mooncut.unconfigured.invalid',
      isConfigured ? BuildProfile.MoonCutTrustedHost : '',
      environment,
      isConfigured && BuildProfile.MoonCutUseBundledCA,
      isConfigured,
      isConfigured ? (distributionMode || 'internal') : (distributionMode === 'public' ? 'public' : 'unconfigured')
    );
  }

  get isPublicDistribution(): boolean { return this.distributionMode === 'public' || !this.isConfigured; }

  url(path: string): string {
    return `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }

  private validate(): void {
    if (!this.isConfigured) return;
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
    if (parsed.protocol === 'http:' && !this.isLoopback(parsed.hostname)) {
      throw new Error('MoonCut 明文 HTTP 仅允许本机调试地址');
    }
  }

  private isLoopback(hostname: string): boolean {
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1' || hostname === '[::1]';
  }
}
