import { common } from '@kit.AbilityKit';
import { preferences } from '@kit.ArkData';
import { ThemeMode } from '../models/AppModels';

export class ClientPreferences {
  private store?: preferences.Preferences;

  async open(context: common.UIAbilityContext): Promise<void> {
    if (!this.store) this.store = await preferences.getPreferences(context, {name: 'mooncut_preferences'});
  }

  async themeMode(): Promise<ThemeMode | null> {
    const raw = await this.store?.get('mooncut:theme', '') as string;
    if (raw === ThemeMode.DARK) return ThemeMode.DARK;
    if (raw === ThemeMode.MEMPHIS) return ThemeMode.MEMPHIS;
    if (raw === ThemeMode.LIGHT) return ThemeMode.LIGHT;
    return null;
  }

  async setThemeMode(mode: ThemeMode): Promise<void> { await this.put('mooncut:theme', mode); }
  async promptFontSize(): Promise<number> { return await this.store?.get('mooncut:prompt-font-size', 30) as number; }
  async setPromptFontSize(value: number): Promise<void> { await this.put('mooncut:prompt-font-size', value); }
  async promptSpeed(): Promise<number> { return await this.store?.get('mooncut:prompt-speed', 3) as number; }
  async setPromptSpeed(value: number): Promise<void> { await this.put('mooncut:prompt-speed', value); }
  async draft(userId: string): Promise<string> { return await this.getString(this.userKey('mooncut:draft', userId)); }
  async setDraft(userId: string, draft: string): Promise<void> { await this.put(this.userKey('mooncut:draft', userId), draft); }
  async scriptMessages(userId: string): Promise<string> { return await this.getString(this.userKey('mooncut:messages', userId)); }
  async setScriptMessages(userId: string, messagesJson: string): Promise<void> { await this.put(this.userKey('mooncut:messages', userId), messagesJson); }
  async activeJobId(userId: string): Promise<string> { return await this.getString(this.userKey('mooncut:active-job-id', userId)); }
  async setActiveJobId(userId: string, id: string): Promise<void> {
    const key = this.userKey('mooncut:active-job-id', userId);
    if (id) await this.put(key, id); else { await this.store?.delete(key); await this.store?.flush(); }
  }
  async petHappiness(userId: string): Promise<number> {
    const value = await this.store?.get(this.userKey('mooncut:pet-happiness', userId), 68) as number;
    return Math.min(100, Math.max(0, value));
  }
  async setPetHappiness(userId: string, value: number): Promise<void> {
    await this.put(this.userKey('mooncut:pet-happiness', userId), Math.min(100, Math.max(0, value)));
  }

  private userKey(key: string, userId: string): string { return `${key}:${userId}`; }

  private async getString(key: string): Promise<string> {
    return await this.store?.get(key, '') as string;
  }

  private async put(key: string, value: preferences.ValueType): Promise<void> {
    if (!this.store) return;
    await this.store.put(key, value);
    await this.store.flush();
  }
}
