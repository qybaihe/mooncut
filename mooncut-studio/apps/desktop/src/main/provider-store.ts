/**
 * Provider profiles: catalog presets + user configs.
 * Secrets only via SecureStore; JSON never holds API keys.
 */

import {randomUUID} from "node:crypto";
import {mkdir, readFile, rename, writeFile} from "node:fs/promises";
import {dirname} from "node:path";
import {
  getCatalogEntry,
  mergeModelList,
  profileFromCatalog,
  PROVIDER_CATALOG,
  validateProviderBaseUrl,
  type ProviderCatalogEntry,
  type ProviderProfile,
  type ProviderProfileInput,
} from "@mooncut/studio-shared";
import type {SecureStore} from "./secure-store.js";

type StoredProfile = Omit<ProviderProfile, "hasApiKey"> & {secretKey: string};

const mockSeed = (): StoredProfile => {
  const input = profileFromCatalog("mock-local");
  return {
    id: "mock-local",
    name: input.name,
    kind: "mock",
    baseUrl: input.baseUrl,
    catalogId: "mock-local",
    plannerModel: input.plannerModel,
    visionModel: input.visionModel,
    imageModel: input.imageModel,
    models: input.models ?? ["mock-planner", "mock-vision"],
    allowVideoFrameUpload: false,
    timeoutMs: 30_000,
    enabled: true,
    isDefault: true,
    secretKey: "provider:mock-local",
  };
};

export class ProviderStore {
  constructor(
    private readonly filePath: string,
    private readonly secrets: SecureStore,
  ) {}

  catalog(): ProviderCatalogEntry[] {
    return [...PROVIDER_CATALOG];
  }

  private async loadRaw(): Promise<StoredProfile[]> {
    try {
      const raw = JSON.parse(await readFile(this.filePath, "utf8")) as {profiles: StoredProfile[]};
      if (!raw.profiles?.length) return [mockSeed()];
      return raw.profiles.map((profile) => this.migrate(profile));
    } catch {
      return [mockSeed()];
    }
  }

  private migrate(profile: StoredProfile): StoredProfile {
    const models = mergeModelList(profile.models, [
      profile.plannerModel,
      profile.visionModel,
      profile.imageModel,
    ].filter(Boolean) as string[]);
    return {
      ...profile,
      models: models.length ? models : ["default"],
      catalogId: profile.catalogId,
      enabled: profile.enabled !== false,
    };
  }

  private async saveRaw(profiles: StoredProfile[]) {
    await mkdir(dirname(this.filePath), {recursive: true});
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify({profiles}, null, 2)}\n`, "utf8");
    await rename(tmp, this.filePath);
  }

  private async toPublic(profile: StoredProfile): Promise<ProviderProfile> {
    return {
      id: profile.id,
      name: profile.name,
      kind: profile.kind,
      baseUrl: profile.baseUrl,
      catalogId: profile.catalogId,
      hasApiKey: await this.secrets.has(profile.secretKey),
      plannerModel: profile.plannerModel,
      visionModel: profile.visionModel,
      imageModel: profile.imageModel,
      models: [...profile.models],
      allowVideoFrameUpload: profile.allowVideoFrameUpload,
      timeoutMs: profile.timeoutMs,
      enabled: profile.enabled,
      isDefault: profile.isDefault,
    };
  }

  async list(): Promise<ProviderProfile[]> {
    const profiles = await this.loadRaw();
    return Promise.all(profiles.map((profile) => this.toPublic(profile)));
  }

  async upsert(input: ProviderProfileInput): Promise<ProviderProfile[]> {
    const baseUrl = validateProviderBaseUrl(input.baseUrl, input.kind);
    if (input.timeoutMs < 1_000 || input.timeoutMs > 600_000) {
      throw new Error("超时需在 1–600 秒之间");
    }
    const profiles = await this.loadRaw();
    const id = input.id ?? randomUUID().replaceAll("-", "").slice(0, 16);
    const secretKey = `provider:${id}`;
    const existing = profiles.find((item) => item.id === id);
    const models = mergeModelList(input.models, [
      input.plannerModel,
      input.visionModel,
      input.imageModel,
    ]);
    const next: StoredProfile = {
      id,
      name: input.name.trim().slice(0, 80) || "未命名",
      kind: input.kind,
      baseUrl,
      catalogId: input.catalogId ?? existing?.catalogId,
      plannerModel: input.plannerModel.trim() || models[0] || "",
      visionModel: input.visionModel.trim() || models[0] || "",
      imageModel: input.imageModel.trim(),
      models,
      allowVideoFrameUpload: Boolean(input.allowVideoFrameUpload),
      timeoutMs: input.timeoutMs,
      enabled: Boolean(input.enabled),
      isDefault: Boolean(input.isDefault ?? existing?.isDefault),
      secretKey,
    };
    if (input.clearApiKey) await this.secrets.delete(secretKey);
    else if (input.apiKey !== undefined && input.apiKey !== "") {
      await this.secrets.set(secretKey, input.apiKey);
    }
    let list = profiles.filter((item) => item.id !== id);
    if (next.isDefault) list = list.map((item) => ({...item, isDefault: false}));
    list.push(next);
    if (!list.some((item) => item.isDefault) && list[0]) list[0].isDefault = true;
    await this.saveRaw(list);
    return this.list();
  }

  async ensureCatalogProfiles(): Promise<ProviderProfile[]> {
    const profiles = await this.loadRaw();
    const byId = new Map(profiles.map((p) => [p.id, p]));
    let changed = false;
    for (const entry of PROVIDER_CATALOG) {
      if (!entry.builtin) continue;
      if (byId.has(entry.id)) continue;
      const seed = profileFromCatalog(entry.id, {
        id: entry.id,
        enabled: entry.id === "mock-local",
        isDefault: entry.id === "mock-local",
      });
      const stored: StoredProfile = {
        id: entry.id,
        name: seed.name,
        kind: seed.kind,
        baseUrl: seed.baseUrl,
        catalogId: entry.id,
        plannerModel: seed.plannerModel,
        visionModel: seed.visionModel,
        imageModel: seed.imageModel,
        models: seed.models ?? entry.defaultModels,
        allowVideoFrameUpload: seed.allowVideoFrameUpload,
        timeoutMs: seed.timeoutMs ?? 60_000,
        enabled: Boolean(seed.enabled),
        isDefault: Boolean(seed.isDefault),
        secretKey: `provider:${entry.id}`,
      };
      profiles.push(stored);
      changed = true;
    }
    if (changed) await this.saveRaw(profiles);
    return this.list();
  }

  async delete(id: string): Promise<ProviderProfile[]> {
    if (id === "mock-local") throw new Error("内置模拟 Provider 不可删除");
    const entry = getCatalogEntry(id);
    const profiles = await this.loadRaw();
    const target = profiles.find((item) => item.id === id);
    if (!target) return this.list();
    if (entry?.builtin) {
      const seed = profileFromCatalog(id, {id, enabled: false, isDefault: false});
      const reset: StoredProfile = {
        id,
        name: seed.name,
        kind: seed.kind,
        baseUrl: seed.baseUrl,
        catalogId: id,
        plannerModel: seed.plannerModel,
        visionModel: seed.visionModel,
        imageModel: seed.imageModel,
        models: seed.models ?? entry.defaultModels,
        allowVideoFrameUpload: seed.allowVideoFrameUpload,
        timeoutMs: 60_000,
        enabled: false,
        isDefault: false,
        secretKey: target.secretKey,
      };
      await this.secrets.delete(target.secretKey);
      const list = profiles.map((item) => (item.id === id ? reset : item));
      if (!list.some((item) => item.isDefault)) {
        const mock = list.find((item) => item.id === "mock-local");
        if (mock) {
          mock.isDefault = true;
          mock.enabled = true;
        }
      }
      await this.saveRaw(list);
      return this.list();
    }
    await this.secrets.delete(target.secretKey);
    let list = profiles.filter((item) => item.id !== id);
    if (!list.some((item) => item.isDefault) && list[0]) list[0].isDefault = true;
    await this.saveRaw(list);
    return this.list();
  }

  async getSecret(profileId: string): Promise<string | null> {
    return this.secrets.get(`provider:${profileId}`);
  }

  async getStored(profileId: string): Promise<StoredProfile | undefined> {
    const profiles = await this.loadRaw();
    return profiles.find((item) => item.id === profileId);
  }

  /** Default enabled profile, or first enabled, or null. */
  async getDefault(): Promise<ProviderProfile | null> {
    const list = await this.list();
    return list.find((item) => item.isDefault && item.enabled) ?? list.find((item) => item.enabled) ?? null;
  }

  /**
   * Resolve a profile (+ secret key) into Agent Supervisor provider runtime env fields.
   * `kind: mock` returns undefined so mock Agent mode stays offline.
   */
  async toRuntimeConfig(profileId?: string): Promise<{
    baseUrl: string;
    apiKey?: string;
    plannerModel: string;
    visionModel: string;
    imageModel?: string;
  } | null> {
    const profiles = await this.loadRaw();
    let stored = profileId ? profiles.find((item) => item.id === profileId) : undefined;
    if (!stored) {
      stored = profiles.find((item) => item.isDefault && item.enabled !== false) ?? profiles.find((item) => item.enabled !== false);
    }
    if (!stored || stored.kind === "mock") return null;
    const apiKey = (await this.secrets.get(stored.secretKey)) ?? undefined;
    return {
      baseUrl: stored.baseUrl,
      ...(apiKey ? {apiKey} : {}),
      plannerModel: stored.plannerModel,
      visionModel: stored.visionModel,
      ...(stored.imageModel ? {imageModel: stored.imageModel} : {}),
    };
  }
}
