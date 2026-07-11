import { asset } from '@kit.AssetStoreKit';
import { util } from '@kit.ArkTS';
import { BusinessError } from '@kit.BasicServicesKit';

/**
 * Asset Store is the HarmonyOS equivalent of the iOS Keychain for a short
 * user secret. The raw session cookie is never written to Preferences or a
 * regular sandbox file.
 */
export class SecureSessionStore {
  private readonly alias: string;

  constructor(alias: string = 'mooncut.session.cookie.v1') {
    this.alias = alias;
  }

  async load(): Promise<string> {
    const query: asset.AssetMap = new Map();
    query.set(asset.Tag.ALIAS, this.encode(this.alias));
    query.set(asset.Tag.RETURN_TYPE, asset.ReturnType.ALL);
    try {
      const results: asset.AssetMap[] = await asset.query(query);
      if (results.length === 0) return '';
      const secret = results[0].get(asset.Tag.SECRET) as Uint8Array | undefined;
      return secret ? this.decode(secret) : '';
    } catch (error) {
      const businessError = error as BusinessError;
      if (businessError.code === asset.ErrorCode.NOT_FOUND) return '';
      throw new Error(`Asset Store query failed (${businessError.code}): ${businessError.message}`);
    }
  }

  async save(cookie: string): Promise<void> {
    if (!cookie) {
      await this.clear();
      return;
    }
    const attributes: asset.AssetMap = new Map();
    attributes.set(asset.Tag.ALIAS, this.encode(this.alias));
    attributes.set(asset.Tag.SECRET, this.encode(cookie));
    attributes.set(asset.Tag.ACCESSIBILITY, asset.Accessibility.DEVICE_FIRST_UNLOCKED);
    attributes.set(asset.Tag.SYNC_TYPE, asset.SyncType.NEVER);
    attributes.set(asset.Tag.CONFLICT_RESOLUTION, asset.ConflictResolution.OVERWRITE);
    try {
      await asset.add(attributes);
    } catch (error) {
      const businessError = error as BusinessError;
      throw new Error(`Asset Store save failed (${businessError.code}): ${businessError.message}`);
    }
  }

  async clear(): Promise<void> {
    await this.removeIfPresent();
  }

  private async removeIfPresent(): Promise<void> {
    const query: asset.AssetMap = new Map();
    query.set(asset.Tag.ALIAS, this.encode(this.alias));
    try {
      await asset.remove(query);
    } catch (error) {
      const businessError = error as BusinessError;
      if (businessError.code !== asset.ErrorCode.NOT_FOUND) {
        throw new Error(`Asset Store remove failed (${businessError.code}): ${businessError.message}`);
      }
    }
  }

  private encode(value: string): Uint8Array {
    return new util.TextEncoder().encodeInto(value);
  }

  private decode(value: Uint8Array): string {
    return util.TextDecoder.create('utf-8', { ignoreBOM: true }).decodeWithStream(value, { stream: false });
  }
}
