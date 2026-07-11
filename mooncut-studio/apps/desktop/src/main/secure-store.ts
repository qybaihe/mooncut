/**
 * OS-backed secret storage for provider API keys.
 * Uses Electron safeStorage (Keychain / DPAPI) when available; never writes plain keys to project files.
 */

import {safeStorage} from "electron";
import {chmod, mkdir, readFile, rename, writeFile} from "node:fs/promises";
import {dirname} from "node:path";

type SecretBlob = {
  v: 1;
  /** base64 ciphertext from Electron safeStorage. Plaintext is never persisted. */
  data: string;
  encrypted: boolean;
};

export class SecureStore {
  constructor(private readonly filePath: string) {}

  private async loadAll(): Promise<Record<string, SecretBlob>> {
    try {
      return JSON.parse(await readFile(this.filePath, "utf8")) as Record<string, SecretBlob>;
    } catch {
      return {};
    }
  }

  private async saveAll(map: Record<string, SecretBlob>) {
    await mkdir(dirname(this.filePath), {recursive: true});
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(map, null, 2)}\n`, {encoding: "utf8", mode: 0o600});
    await rename(tmp, this.filePath);
    await chmod(this.filePath, 0o600);
  }

  async set(key: string, secret: string): Promise<void> {
    const map = await this.loadAll();
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("系统安全存储不可用；为保护 API Key，MoonCut 不会将其写入磁盘。");
    }
    const buf = safeStorage.encryptString(secret);
    map[key] = {v: 1, data: buf.toString("base64"), encrypted: true};
    await this.saveAll(map);
  }

  async get(key: string): Promise<string | null> {
    const map = await this.loadAll();
    const blob = map[key];
    if (!blob) return null;
    try {
      if (blob.encrypted && safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(Buffer.from(blob.data, "base64"));
      }
      // Reject historical unencrypted fallback records rather than silently
      // continuing to use a base64-encoded plaintext credential.
      return null;
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    const map = await this.loadAll();
    delete map[key];
    await this.saveAll(map);
  }

  async has(key: string): Promise<boolean> {
    const map = await this.loadAll();
    return Boolean(map[key]);
  }
}
