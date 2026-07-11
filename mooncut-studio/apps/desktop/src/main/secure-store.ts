/**
 * OS-backed secret storage for provider API keys.
 * Uses Electron safeStorage (Keychain / DPAPI) when available; never writes plain keys to project files.
 */

import {safeStorage} from "electron";
import {mkdir, readFile, rename, writeFile} from "node:fs/promises";
import {dirname} from "node:path";

type SecretBlob = {
  v: 1;
  /** base64 ciphertext from safeStorage, or base64 plain only if encryption unavailable (dev fallback flagged). */
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
    await writeFile(tmp, `${JSON.stringify(map, null, 2)}\n`, "utf8");
    await rename(tmp, this.filePath);
  }

  async set(key: string, secret: string): Promise<void> {
    const map = await this.loadAll();
    if (safeStorage.isEncryptionAvailable()) {
      const buf = safeStorage.encryptString(secret);
      map[key] = {v: 1, data: buf.toString("base64"), encrypted: true};
    } else {
      // Dev / headless CI fallback — still not written into project trees.
      map[key] = {v: 1, data: Buffer.from(secret, "utf8").toString("base64"), encrypted: false};
    }
    await saveQuiet(map, this.filePath);
  }

  async get(key: string): Promise<string | null> {
    const map = await this.loadAll();
    const blob = map[key];
    if (!blob) return null;
    try {
      if (blob.encrypted && safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(Buffer.from(blob.data, "base64"));
      }
      return Buffer.from(blob.data, "base64").toString("utf8");
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

async function saveQuiet(map: Record<string, SecretBlob>, filePath: string) {
  await mkdir(dirname(filePath), {recursive: true});
  const tmp = `${filePath}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(map, null, 2)}\n`, "utf8");
  await rename(tmp, filePath);
}
