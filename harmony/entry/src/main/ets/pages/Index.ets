import { AppStore } from '../app/AppStore';
import { ToastView } from '../components/ToastView';
import { themeTokens } from '../core/design/AppTheme';
import { AppTab } from '../core/models/AppModels';
import { common, ConfigurationConstant } from '@kit.AbilityKit';
import { AuthPage } from '../features/auth/AuthPage';
import { CoachPage } from '../features/coach/CoachPage';
import { CommunityPage } from '../features/community/CommunityPage';
import { ClipStudioPage } from '../features/edit/ClipStudioPage';
import { HomePage } from '../features/home/HomePage';
import { JobsPage } from '../features/jobs/JobsPage';
import { ScriptStudioPage } from '../features/record/ScriptStudioPage';
import { TeleprompterPage } from '../features/record/TeleprompterPage';
import { SettingsPage } from '../features/settings/SettingsPage';

@Entry
@Component
struct Index {
  @State store: AppStore = new AppStore();
  @State createScreen: string = 'home';
  @State teleprompterDraft: string = '';
  @StorageProp('currentColorMode') @Watch('onSystemColorModeChanged') currentColorMode: ConfigurationConstant.ColorMode =
    ConfigurationConstant.ColorMode.COLOR_MODE_NOT_SET;

  aboutToAppear(): void {
    this.onSystemColorModeChanged();
    this.store.bootstrap(getContext(this) as common.UIAbilityContext);
  }
  onPageShow(): void { this.store.refreshMotionPreference(getContext(this) as common.UIAbilityContext); }

  private onSystemColorModeChanged(): void {
    this.store.setSystemDarkMode(this.currentColorMode === ConfigurationConstant.ColorMode.COLOR_MODE_DARK);
  }

  build() {
    Stack({ alignContent: Alignment.Bottom }) {
      if (this.store.restoringSession) {
        Column({ space: 16 }) {
          LoadingProgress().width(42).height(42).color(themeTokens(this.store.themeMode).accent)
          Text('恢复会话…').fontSize(16).fontColor(themeTokens(this.store.themeMode).textSecondary)
        }.width('100%').height('100%').justifyContent(FlexAlign.Center).backgroundColor(themeTokens(this.store.themeMode).canvas)
      } else if (!this.store.authenticated) {
        AuthPage({ store: this.store, theme: themeTokens(this.store.themeMode), onAuthenticated: (user) => { void this.store.applyAuthenticated(user); } })
      } else {
        this.mainContent()
        if (!(this.store.selectedTab === AppTab.CREATE && this.createScreen !== 'home')) {
          this.bottomBar()
        }
      }
      ToastView({ message: this.store.toast, isError: this.store.toastIsError, theme: themeTokens(this.store.themeMode) })
    }.width('100%').height('100%').backgroundColor(themeTokens(this.store.themeMode).canvas)
  }

  @Builder
  private mainContent() {
    if (this.store.selectedTab === AppTab.CREATE) {
      if (this.createScreen === 'edit') {
        ClipStudioPage({ store: this.store, onBack: () => { this.createScreen = 'home'; } })
      } else if (this.createScreen === 'script') {
        ScriptStudioPage({
          store: this.store,
          onBack: () => { this.createScreen = 'home'; },
          onOpenTeleprompter: (draft: string) => {
            this.store.setCurrentDraft(draft); this.teleprompterDraft = draft; this.createScreen = 'teleprompter';
          }
        })
      } else if (this.createScreen === 'teleprompter') {
        TeleprompterPage({
          store: this.store,
          draft: this.teleprompterDraft,
          onBack: () => { this.createScreen = 'script'; },
          onSendToEdit: (asset) => { this.store.setPendingAsset(asset); this.createScreen = 'edit'; }
        })
      } else if (this.createScreen === 'settings') {
        SettingsPage({ store: this.store, onBack: () => { this.createScreen = 'home'; } })
      } else {
        HomePage({
          store: this.store,
          onOpenEdit: () => { this.createScreen = 'edit'; },
          onOpenScript: () => { this.createScreen = 'script'; },
          onOpenCoach: () => { this.store.selectedTab = AppTab.COACH; },
          onOpenJobs: () => { this.store.selectedTab = AppTab.JOBS; },
          onOpenSettings: () => { this.createScreen = 'settings'; }
        })
      }
    } else if (this.store.selectedTab === AppTab.COACH) {
      CoachPage({
        store: this.store,
        onOpenScript: () => { this.store.selectedTab = AppTab.CREATE; this.createScreen = 'script'; },
        onOpenSettings: () => { this.store.selectedTab = AppTab.CREATE; this.createScreen = 'settings'; },
        onStartPractice: (draft: string) => {
          this.teleprompterDraft = draft; this.store.selectedTab = AppTab.CREATE; this.createScreen = 'teleprompter';
        }
      })
    } else if (this.store.selectedTab === AppTab.JOBS) {
      JobsPage({
        store: this.store,
        onOpenSettings: () => { this.store.selectedTab = AppTab.CREATE; this.createScreen = 'settings'; },
        onOpenEdit: () => { this.store.selectedTab = AppTab.CREATE; this.createScreen = 'edit'; }
      })
    } else {
      CommunityPage({ store: this.store, onOpenSettings: () => { this.store.selectedTab = AppTab.CREATE; this.createScreen = 'settings'; } })
    }
  }

  @Builder
  private bottomBar() {
    Column() {
      Row() {
        this.tabButton(AppTab.CREATE, '✦', '创作')
        this.tabButton(AppTab.COACH, '♩', '陪练')
        this.tabButton(AppTab.JOBS, '▤', '任务')
        this.tabButton(AppTab.COMMUNITY, '♟', '社区')
      }
      .height(64)
      .width('100%')
      .padding({ left: 6, right: 6 })
    }
    .width('100%')
    .padding({ left: 10, right: 10, top: 8, bottom: 10 })
    .backgroundColor(themeTokens(this.store.themeMode).surface)
    .border({ width: { top: themeTokens(this.store.themeMode).usesMemphisChrome ? 1.5 : 1 }, color: themeTokens(this.store.themeMode).hairline })
    .shadow({
      radius: themeTokens(this.store.themeMode).usesMemphisChrome ? 0 : 16,
      color: '#14000000',
      offsetY: themeTokens(this.store.themeMode).usesMemphisChrome ? -2 : -4
    })
  }

  @Builder
  private tabButton(tab: AppTab, icon: string, label: string) {
    Button() {
      Column({ space: 3 }) {
        Text(icon)
          .fontSize(22)
          .fontWeight(this.store.selectedTab === tab ? FontWeight.Bold : FontWeight.Medium)
        Text(label)
          .fontSize(11)
          .fontWeight(this.store.selectedTab === tab ? FontWeight.Bold : FontWeight.Medium)
      }
    }
    .layoutWeight(1)
    .height(56)
    .borderRadius(14)
    .backgroundColor(this.store.selectedTab === tab ? themeTokens(this.store.themeMode).accentSoft : Color.Transparent)
    .accessibilityText(label)
    .accessibilityDescription(this.store.selectedTab === tab ? '已选择' : '')
    .fontColor(this.store.selectedTab === tab ? themeTokens(this.store.themeMode).accent : themeTokens(this.store.themeMode).textTertiary)
    .onClick(() => {
      this.store.selectedTab = tab;
      if (tab === AppTab.CREATE) {
        this.createScreen = 'home';
      }
    })
  }
}
