import { socket } from '@kit.NetworkKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { url as urlKit, util } from '@kit.ArkTS';
import { APIError } from './APIError';

export interface RawUploadResult {
  status: number;
  body: string;
}

interface RawResponse {
  status: number;
  headers: Map<string, string>;
  body: Uint8Array;
}

/**
 * Streams a file as the complete HTTP request body without multipart wrapping.
 *
 * HarmonyOS' system upload task always uses multipart/form-data, while MoonCut's
 * /v1/assets endpoint intentionally accepts the same raw body used by iOS
 * URLSession.upload(fromFile:). A socket-backed HTTP/1.1 request keeps memory
 * bounded to one 1 MiB file block and preserves that server contract.
 */
export class RawFileUploader {
  private readonly responseLimitBytes: number = 2 * 1024 * 1024;
  private readonly chunkBytes: number = 1024 * 1024;

  async upload(
    targetUrl: string,
    fileUri: string,
    fileBytes: number,
    contentType: string,
    sessionCookie: string,
    caPath: string,
    timeoutMs: number,
    onProgress?: (sentBytes: number, totalBytes: number) => void
  ): Promise<RawUploadResult> {
    const parsed = urlKit.URL.parseURL(targetUrl);
    const secure = parsed.protocol === 'https:';
    if (!secure && parsed.protocol !== 'http:') {
      throw new APIError('上传地址只允许 HTTP 或 HTTPS', 0, 'UPLOAD_URL_INVALID');
    }
    const port = parsed.port ? Number(parsed.port) : (secure ? 443 : 80);
    const path = `${parsed.pathname || '/'}${parsed.search || ''}`;
    const hostHeader = parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
    const headers = [
      `POST ${path} HTTP/1.1`,
      `Host: ${hostHeader}`,
      'Accept: application/json',
      `Content-Type: ${contentType}`,
      `Content-Length: ${fileBytes}`,
      'Connection: close'
    ];
    if (sessionCookie) headers.push(`Cookie: ${sessionCookie}`);
    const headerBlock = `${headers.join('\r\n')}\r\n\r\n`;

    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;
    let settled = false;
    let timer: number = -1;
    const tcp: socket.TCPSocket = socket.constructTCPSocketInstance();
    const tls: socket.TLSSocket = socket.constructTLSSocketInstance();

    const responsePromise = new Promise<RawUploadResult>((resolve, reject) => {
      const finish = (): void => {
        if (settled) return;
        settled = true;
        if (timer >= 0) clearTimeout(timer);
        try {
          const response = this.parseResponse(this.combine(chunks, receivedBytes));
          resolve({ status: response.status, body: this.decode(response.body) });
        } catch (error) {
          reject(error);
        }
      };
      const fail = (error: object): void => {
        if (settled) return;
        settled = true;
        if (timer >= 0) clearTimeout(timer);
        reject(error);
      };
      const receive = (info: socket.SocketMessageInfo): void => {
        if (settled) return;
        const data = new Uint8Array(info.message);
        receivedBytes += data.byteLength;
        if (receivedBytes > this.responseLimitBytes) {
          fail(new APIError('上传响应超过安全上限', 0, 'UPLOAD_RESPONSE_TOO_LARGE'));
          return;
        }
        chunks.push(data);
      };
      timer = setTimeout(() => fail(new APIError('视频上传超时，请检查网络后重试', 0, 'UPLOAD_TIMEOUT')), timeoutMs);
      if (secure) {
        tls.on('message', receive);
        tls.on('close', finish);
        tls.on('error', (error) => fail(new APIError(`TLS 上传连接失败：${error.message}`, 0, 'UPLOAD_CONNECTION_FAILED')));
      } else {
        tcp.on('message', receive);
        tcp.on('close', finish);
        tcp.on('error', (error) => fail(new APIError(`上传连接失败：${error.message}`, 0, 'UPLOAD_CONNECTION_FAILED')));
      }
    });

    try {
      if (secure) {
        const secureOptions: socket.TLSSecureOptions = {};
        if (caPath) secureOptions.ca = fs.readTextSync(caPath);
        await tls.connect({
          address: { address: parsed.hostname, port },
          secureOptions,
          ALPNProtocols: ['http/1.1'],
          timeout: Math.min(timeoutMs, 30_000)
        });
        await tls.send(headerBlock);
      } else {
        await tcp.connect({ address: { address: parsed.hostname, port }, timeout: Math.min(timeoutMs, 30_000) });
        await tcp.setExtraOptions({ keepAlive: false, TCPNoDelay: true });
        await tcp.send({ data: headerBlock, encoding: 'UTF-8' });
      }

      const file = fs.openSync(fileUri, fs.OpenMode.READ_ONLY);
      try {
        let offset = 0;
        while (offset < fileBytes) {
          const length = Math.min(this.chunkBytes, fileBytes - offset);
          const block = new ArrayBuffer(length);
          const read = fs.readSync(file.fd, block, { offset, length });
          if (read !== length) {
            throw new APIError(`视频读取中断：期望 ${length} 字节，实际 ${read} 字节`, 0, 'UPLOAD_FILE_READ_FAILED');
          }
          if (secure) await tls.send(block);
          else await tcp.send({ data: block });
          offset += read;
          onProgress?.(offset, fileBytes);
        }
      } finally {
        fs.closeSync(file);
      }
      return await responsePromise;
    } catch (error) {
      if (timer >= 0) clearTimeout(timer);
      try { if (secure) await tls.close(); else await tcp.close(); } catch (_) {}
      if (error instanceof APIError) throw error;
      throw new APIError(`视频上传失败：${(error as Error).message}`, 0, 'UPLOAD_FAILED');
    } finally {
      try { if (secure) await tls.close(); else await tcp.close(); } catch (_) {}
    }
  }

  private parseResponse(data: Uint8Array): RawResponse {
    const boundary = this.find(data, [13, 10, 13, 10]);
    if (boundary < 0) throw new APIError('上传响应格式无效', 0, 'UPLOAD_RESPONSE_INVALID');
    const headerText = this.decode(data.slice(0, boundary));
    const lines = headerText.split('\r\n');
    const statusMatch = lines[0].match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/);
    if (!statusMatch) throw new APIError('上传响应缺少 HTTP 状态码', 0, 'UPLOAD_RESPONSE_INVALID');
    const headers = new Map<string, string>();
    for (let index = 1; index < lines.length; index += 1) {
      const separator = lines[index].indexOf(':');
      if (separator > 0) headers.set(lines[index].slice(0, separator).toLowerCase(), lines[index].slice(separator + 1).trim());
    }
    let body = data.slice(boundary + 4);
    if ((headers.get('transfer-encoding') ?? '').toLowerCase().includes('chunked')) body = this.decodeChunked(body);
    const declaredLength = Number(headers.get('content-length') ?? body.byteLength);
    if (Number.isFinite(declaredLength) && declaredLength >= 0 && body.byteLength < declaredLength) {
      throw new APIError('上传响应未完整接收', 0, 'UPLOAD_RESPONSE_INCOMPLETE');
    }
    if (Number.isFinite(declaredLength) && declaredLength >= 0 && body.byteLength > declaredLength) body = body.slice(0, declaredLength);
    return { status: Number(statusMatch[1]), headers, body };
  }

  private decodeChunked(data: Uint8Array): Uint8Array {
    const chunks: Uint8Array[] = [];
    let total = 0;
    let offset = 0;
    while (offset < data.byteLength) {
      const lineEnd = this.find(data, [13, 10], offset);
      if (lineEnd < 0) throw new APIError('分块上传响应格式无效', 0, 'UPLOAD_RESPONSE_INVALID');
      const sizeText = this.decode(data.slice(offset, lineEnd)).split(';')[0].trim();
      const size = parseInt(sizeText, 16);
      if (!Number.isFinite(size) || size < 0) throw new APIError('分块上传响应大小无效', 0, 'UPLOAD_RESPONSE_INVALID');
      offset = lineEnd + 2;
      if (size === 0) break;
      if (offset + size + 2 > data.byteLength) throw new APIError('分块上传响应未完整接收', 0, 'UPLOAD_RESPONSE_INCOMPLETE');
      const chunk = data.slice(offset, offset + size);
      chunks.push(chunk);
      total += chunk.byteLength;
      offset += size + 2;
    }
    return this.combine(chunks, total);
  }

  private combine(chunks: Uint8Array[], total: number): Uint8Array {
    const combined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return combined;
  }

  private find(data: Uint8Array, needle: number[], start: number = 0): number {
    for (let index = start; index <= data.byteLength - needle.length; index += 1) {
      let match = true;
      for (let part = 0; part < needle.length; part += 1) {
        if (data[index + part] !== needle[part]) { match = false; break; }
      }
      if (match) return index;
    }
    return -1;
  }

  private decode(value: Uint8Array): string {
    return util.TextDecoder.create('utf-8', { ignoreBOM: true }).decodeWithStream(value, { stream: false });
  }
}
