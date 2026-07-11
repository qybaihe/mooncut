import { AuthUser, HealthResponse, ModelsResponse, ScriptMessage } from '../core/api/APIModels';
import { APIError } from '../core/api/APIError';
import { presentError } from '../core/api/ErrorPresentation';
import { MoonCutAPIClient } from '../core/api/MoonCutAPIClient';
import {
  AppTab, PetAnimationState, PetEvent, ThemeMode, VideoAsset, petEventMessage, petEventState
} from '../core/models/AppModels';
import { common, ConfigurationConstant } from '@kit.AbilityKit';
import { ClientPreferences } from '../core/storage/ClientPreferences';
import { SystemMotionPreference } from '../core/accessibility/SystemMotionPreference';
import { setThemeSystemDarkMode } from '../core/design/AppTheme';

interface HealthAttempt { value: HealthResponse | null; error: string; }
interface ModelsAttempt { value: ModelsResponse | null; error: string; }
interface SessionAttempt { value: AuthUser | null; error: string; }

@Observed
export class AppStore {
  readonly api: MoonCutAPIClient = new MoonCutAPIClient();
  user: AuthUser | null = null;
  health: HealthResponse | null = null;
  models: ModelsResponse | null = null;
  edgeOnline: boolean = false;
  restoringSession: boolean = true;
  serviceError: string = '';
  agentError: string = '';
  selectedTab: AppTab = AppTab.CREATE;
  themeMode: ThemeMode = ThemeMode.LIGHT;
  promptFontSize: number = 30;
  promptSpeed: number = 3;
  petState: PetAnimationState = PetAnimationState.IDLE;
  petOverride: string = '';
  petHappiness: number = 68;
  reducedMotion: boolean = false;
  systemDarkMode: boolean = false;
  themeFollowsSystem: boolean = true;
  toast: string = '';
  toastIsError: boolean = false;
  activeJobId: string = '';
  sessionEpoch: number = 0;
  pendingAsset: VideoAsset | null = null;
  pendingAssetOwnerId: string = '';
  clipTitle: string = '';
  clipPrompt: string = '按默认原生规范剪辑，突出口播重点';
  clipImageGeneration: string = 'auto';
  currentDraft: string = '';
  scriptMessages: ScriptMessage[] = [];
  private toastTimer: number = -1;
  private petReactionTimer: number = -1;
  private petTouchUntilMs: number = 0;
  private readonly preferences: ClientPreferences = new ClientPreferences();
  private abilityContext?: common.UIAbilityContext;
  private bootstrapGeneration: number = 0;

  get authenticated(): boolean { return this.user !== null; }
  get serviceConnected(): boolean { return this.edgeOnline; }
  get assistantAvailable(): boolean { return this.edgeOnline && this.models !== null; }
  get editingAvailable(): boolean { return this.health?.ok === true; }

  async bootstrap(context: common.UIAbilityContext): Promise<void> {
    const generation = ++this.bootstrapGeneration;
    this.abilityContext = context;
    this.restoringSession = true;
    this.refreshMotionPreference(context);
    try {
      await this.preferences.open(context);
      const storedTheme = await this.preferences.themeMode();
      this.themeFollowsSystem = storedTheme === null;
      this.themeMode = storedTheme ?? (this.systemDarkMode ? ThemeMode.DARK : ThemeMode.LIGHT);
      if (storedTheme !== null) this.applyPreferredColorMode(storedTheme);
      this.promptFontSize = await this.preferences.promptFontSize();
      this.promptSpeed = await this.preferences.promptSpeed();
    } catch (_) {
      this.themeMode = this.systemDarkMode ? ThemeMode.DARK : ThemeMode.LIGHT;
    }
    if (!this.api.configuration.isConfigured) {
      this.health = null;
      this.models = null;
      this.edgeOnline = false;
      this.transitionUser(null);
      this.serviceError = '公开预览包未配置服务地址，仅可浏览本地界面。';
      this.restoringSession = false;
      return;
    }
    try {
      await this.withTimeout(this.api.initialize(context), 6_000, '初始化服务连接超时');
      const attempts = await this.withTimeout(
        Promise.all([this.fetchModels(), this.fetchHealth(), this.fetchSession()]), 8_000, '连接服务超时'
      );
      if (generation !== this.bootstrapGeneration) return;
      const modelsAttempt = attempts[0] as ModelsAttempt;
      const healthAttempt = attempts[1] as HealthAttempt;
      const sessionAttempt = attempts[2] as SessionAttempt;
      this.models = modelsAttempt.value;
      this.edgeOnline = modelsAttempt.value !== null || sessionAttempt.error === '';
      this.health = healthAttempt.value;
      this.agentError = healthAttempt.error;
      this.serviceError = modelsAttempt.error || sessionAttempt.error;
      this.transitionUser(sessionAttempt.value);
      if (sessionAttempt.value) await this.loadUserPreferences(sessionAttempt.value.id);
    } catch (error) {
      if (generation !== this.bootstrapGeneration) return;
      this.health = null;
      this.models = null;
      this.edgeOnline = false;
      this.transitionUser(null);
      this.serviceError = this.message(error as object);
    } finally {
      if (generation === this.bootstrapGeneration) this.restoringSession = false;
    }
  }

  refreshMotionPreference(context: common.UIAbilityContext): void {
    try { this.reducedMotion = SystemMotionPreference.isReduced(context); }
    catch (_) { this.reducedMotion = false; }
  }

  setSystemDarkMode(isDark: boolean): void {
    this.systemDarkMode = isDark;
    setThemeSystemDarkMode(isDark);
    if (this.themeFollowsSystem) this.themeMode = isDark ? ThemeMode.DARK : ThemeMode.LIGHT;
  }

  async applyAuthenticated(user: AuthUser): Promise<void> {
    this.transitionUser(user);
    try { await this.loadUserPreferences(user.id); } catch (_) {}
    try {
      const sessionUser = await this.api.session();
      if (sessionUser) {
        this.transitionUser(sessionUser);
      } else if (!this.api.hasSessionCookie()) {
        this.serviceError = '登录响应已收到，但会话 Cookie 尚未建立。请重试登录。';
      }
    } catch (_) {
      // Preserve the login response; the next authenticated request remains authoritative.
    }
    this.petState = PetAnimationState.WAVING;
    this.showToast('已登录');
  }

  async refreshHealth(verifySession: boolean = false): Promise<void> {
    const attempts = await Promise.all([this.fetchModels(), this.fetchHealth()]);
    const modelsAttempt = attempts[0] as ModelsAttempt;
    const healthAttempt = attempts[1] as HealthAttempt;
    this.models = modelsAttempt.value;
    this.edgeOnline = modelsAttempt.value !== null;
    this.health = healthAttempt.value;
    this.serviceError = modelsAttempt.error;
    this.agentError = healthAttempt.error;
    if (!this.edgeOnline || !this.editingAvailable) this.applyPet(PetEvent.PERMISSION_OR_NETWORK_FAILURE);
    if (!verifySession || !this.user) return;
    try {
      const sessionUser = await this.api.session();
      if (sessionUser) {
        this.transitionUser(sessionUser);
      } else {
        this.transitionUser(null);
        this.showToast('登录已失效，请重新登录', true);
      }
    } catch (error) {
      if (!this.serviceError) this.serviceError = this.message(error);
      if (error instanceof APIError && error.unauthorized) {
        this.transitionUser(null);
        this.showToast('登录已失效，请重新登录', true);
      } else {
        this.showToast(this.message(error), true);
      }
      this.applyPet(PetEvent.PERMISSION_OR_NETWORK_FAILURE);
    }
  }

  setThemeMode(mode: ThemeMode): void {
    this.themeFollowsSystem = false;
    this.themeMode = mode;
    this.applyPreferredColorMode(mode);
    void this.preferences.setThemeMode(mode);
  }

  cycleTheme(): void {
    const next = this.themeMode === ThemeMode.LIGHT ? ThemeMode.DARK
      : this.themeMode === ThemeMode.DARK ? ThemeMode.MEMPHIS : ThemeMode.LIGHT;
    this.setThemeMode(next);
  }

  setPromptFontSize(value: number): void {
    this.promptFontSize = Math.min(44, Math.max(22, Math.round(value)));
    void this.preferences.setPromptFontSize(this.promptFontSize);
  }

  setPromptSpeed(value: number): void {
    this.promptSpeed = Math.min(6, Math.max(1, Math.round(value)));
    void this.preferences.setPromptSpeed(this.promptSpeed);
  }

  setCurrentDraft(draft: string): void {
    this.currentDraft = draft;
    if (this.user) void this.preferences.setDraft(this.user.id, draft);
  }

  setScriptMessages(messages: ScriptMessage[]): void {
    this.scriptMessages = messages;
    if (this.user) void this.preferences.setScriptMessages(this.user.id, JSON.stringify(messages));
  }

  setActiveJobId(id: string): void {
    this.activeJobId = id;
    if (this.user) void this.preferences.setActiveJobId(this.user.id, id);
  }

  setPendingAsset(asset: VideoAsset | null): void {
    if (!this.user) {
      this.pendingAsset = null;
      this.pendingAssetOwnerId = '';
      return;
    }
    this.pendingAsset = asset;
    this.pendingAssetOwnerId = asset ? this.user.id : '';
  }

  clearClipWorkspace(): void {
    this.pendingAsset = null;
    this.pendingAssetOwnerId = '';
    this.clipTitle = '';
    this.clipPrompt = '按默认原生规范剪辑，突出口播重点';
    this.clipImageGeneration = 'auto';
  }

  touchPet(): void {
    this.petHappiness = Math.min(100, this.petHappiness + 4);
    this.petState = PetAnimationState.JUMPING;
    this.petOverride = '摸到我啦，好开心！';
    this.petTouchUntilMs = Date.now() + 1400;
    if (this.user) void this.preferences.setPetHappiness(this.user.id, this.petHappiness);
    if (this.petReactionTimer >= 0) clearTimeout(this.petReactionTimer);
    this.petReactionTimer = setTimeout(() => {
      this.petState = PetAnimationState.IDLE;
      this.petOverride = '';
      this.petTouchUntilMs = 0;
    }, 1400);
  }

  applyPet(event: PetEvent, message: string = ''): void {
    if (event === PetEvent.PET_MESSAGE) {
      if (message) this.petOverride = message;
      return;
    }
    if (Date.now() < this.petTouchUntilMs) return;
    this.petState = petEventState(event);
    this.petOverride = petEventMessage(event);
  }

  async signOut(): Promise<void> {
    try { await this.api.logout(); } catch (_) { this.api.clearSession(); }
    this.transitionUser(null);
    this.showToast('已退出登录');
  }

  handleError(error: object): void {
    if (error instanceof APIError && error.unauthorized) {
      this.transitionUser(null);
      this.showToast('登录已失效，请重新登录', true);
    } else {
      this.showToast(this.message(error), true);
    }
    this.applyPet(PetEvent.PERMISSION_OR_NETWORK_FAILURE);
  }

  showToast(message: string, isError: boolean = false): void {
    if (this.toastTimer >= 0) clearTimeout(this.toastTimer);
    this.toast = message;
    this.toastIsError = isError;
    this.toastTimer = setTimeout(() => { this.toast = ''; }, 2800);
  }

  private message(error: object): string {
    return presentError(error);
  }

  private async loadUserPreferences(userId: string): Promise<void> {
    this.currentDraft = await this.preferences.draft(userId);
    this.activeJobId = await this.preferences.activeJobId(userId);
    const messages = await this.preferences.scriptMessages(userId);
    this.petHappiness = await this.preferences.petHappiness(userId);
    try { this.scriptMessages = messages ? JSON.parse(messages) as ScriptMessage[] : []; }
    catch (_) { this.scriptMessages = []; }
  }

  private async fetchHealth(): Promise<HealthAttempt> {
    try { return { value: await this.api.health(), error: '' }; }
    catch (error) { return { value: null, error: this.message(error as object) }; }
  }

  private async fetchModels(): Promise<ModelsAttempt> {
    try { return { value: await this.api.models(), error: '' }; }
    catch (error) { return { value: null, error: this.message(error as object) }; }
  }

  private async fetchSession(): Promise<SessionAttempt> {
    try { return { value: await this.api.session(), error: '' }; }
    catch (error) { return { value: null, error: this.message(error as object) }; }
  }

  private withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let completed = false;
      const timer = setTimeout(() => {
        if (completed) return;
        completed = true;
        reject(new APIError(message, 0, 'BOOTSTRAP_TIMEOUT'));
      }, timeoutMs);
      operation.then((value: T) => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        resolve(value);
      }).catch((error: object) => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  private transitionUser(next: AuthUser | null): void {
    const currentId = this.user?.id ?? '';
    const nextId = next?.id ?? '';
    if (currentId === nextId) {
      this.user = next;
      return;
    }
    this.user = next;
    this.sessionEpoch += 1;
    this.activeJobId = '';
    this.clearClipWorkspace();
    this.currentDraft = '';
    this.scriptMessages = [];
    this.petHappiness = 68;
    this.selectedTab = AppTab.CREATE;
  }

  private applyPreferredColorMode(mode: ThemeMode): void {
    if (!this.abilityContext) return;
    const colorMode = mode === ThemeMode.LIGHT ? ConfigurationConstant.ColorMode.COLOR_MODE_LIGHT
      : mode === ThemeMode.DARK ? ConfigurationConstant.ColorMode.COLOR_MODE_DARK
        : ConfigurationConstant.ColorMode.COLOR_MODE_NOT_SET;
    try { this.abilityContext.getApplicationContext().setColorMode(colorMode); } catch (_) {}
  }
}
