import { AppStore } from '../../app/AppStore';
import { themeTokens } from '../../core/design/AppTheme';
import { ThemeMode } from '../../core/models/AppModels';
import { ServiceBadge } from '../../components/ServiceBadge';

@Component
export struct SettingsPage {
  @ObjectLink store: AppStore;
  onBack: () => void = () => {};
  @State refreshing: boolean = false;

  build() {
    Scroll() {
      Column({ space: 18 }) {
        Row() {
          Button('‹ 创作').backgroundColor(Color.Transparent).fontColor(themeTokens(this.store.themeMode).accent).onClick(() => this.onBack())
          Blank(); Text('设置').fontSize(20).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textPrimary); Blank()
        }.width('100%').height(54)
        Text('账号').fontSize(14).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textSecondary).width('100%')
        Column({ space: 12 }) {
          Text(this.store.user?.email ?? '').fontSize(17).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textPrimary).width('100%')
          Text('会话由服务端 Cookie 维持，客户端不嵌入服务 API Key。').fontSize(13).fontColor(themeTokens(this.store.themeMode).textSecondary).width('100%')
          Button('退出登录').width('100%').height(50).backgroundColor(themeTokens(this.store.themeMode).danger).fontColor('#FFFFFF').onClick(() => this.store.signOut())
        }.padding(18).width('100%').backgroundColor(themeTokens(this.store.themeMode).surface).borderRadius(themeTokens(this.store.themeMode).cardRadius)

        Text('外观').fontSize(14).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textSecondary).width('100%')
        Column({ space: 0 }) {
          this.themeRow(ThemeMode.LIGHT, '☼', '浅色', '高级编辑台')
          Divider().color(themeTokens(this.store.themeMode).hairline)
          this.themeRow(ThemeMode.DARK, '☾', '深色', '影视工作间')
          Divider().color(themeTokens(this.store.themeMode).hairline)
          this.themeRow(ThemeMode.MEMPHIS, '✦', 'Memphis', '暖纸点睛')
        }.width('100%').backgroundColor(themeTokens(this.store.themeMode).surface).borderRadius(themeTokens(this.store.themeMode).cardRadius)

        Text('服务').fontSize(14).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textSecondary).width('100%')
        Column({ space: 14 }) {
          this.valueRow('Base URL', this.store.api.configuration.baseUrl)
          Divider().color(themeTokens(this.store.themeMode).hairline)
          this.valueRow('受信 Host', this.store.api.configuration.trustedHost)
          Divider().color(themeTokens(this.store.themeMode).hairline)
          Row() {
            Text('边缘服务').fontSize(15).fontColor(themeTokens(this.store.themeMode).textPrimary)
            Blank()
            ServiceBadge({ connected: this.store.serviceConnected, loading: this.refreshing, theme: themeTokens(this.store.themeMode) })
          }.width('100%')
          if (this.store.models) {
            Divider().color(themeTokens(this.store.themeMode).hairline)
            this.valueRow('助手中继', this.store.models.relayConfigured === false ? '未配置' : '可用')
            this.valueRow('脚本模型', this.store.models.routing?.script ?? this.store.models.available[0] ?? '—')
          }
          Divider().color(themeTokens(this.store.themeMode).hairline)
          this.valueRow('剪辑节点', this.store.editingAvailable ? '在线' : '暂不可用')
          if (this.store.agentError) {
            Text(this.store.agentError).fontSize(12).fontColor(themeTokens(this.store.themeMode).warning).width('100%')
          }
          if (this.store.serviceError) {
            Text(this.store.serviceError).fontSize(12).fontColor(themeTokens(this.store.themeMode).danger).width('100%')
          }
          Button(this.refreshing ? '正在检查…' : '重新检查').width('100%').height(48).enabled(!this.refreshing)
            .backgroundColor(themeTokens(this.store.themeMode).accentSoft).fontColor(themeTokens(this.store.themeMode).accent)
            .onClick(() => this.retryService())
        }.padding(18).width('100%').backgroundColor(themeTokens(this.store.themeMode).surface).borderRadius(themeTokens(this.store.themeMode).cardRadius)

        Text('安全').fontSize(14).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textSecondary).width('100%')
        Text('认证使用邮箱 OTP 或兼容密码登录后的 Cookie 会话；会话保存在系统 Asset Store。Release 固定访问 mooncut.me 并使用系统 HTTPS 信任链，App 不嵌入模型、Agent 或 Tunnel 密钥。')
          .fontSize(13).lineHeight(21).fontColor(themeTokens(this.store.themeMode).textSecondary).width('100%')
          .padding(18).backgroundColor(themeTokens(this.store.themeMode).surface).borderRadius(themeTokens(this.store.themeMode).cardRadius)
      }.padding({ left: 18, right: 18, bottom: 50 }).width('100%')
    }.width('100%').height('100%').backgroundColor(themeTokens(this.store.themeMode).canvas)
  }

  @Builder
  private themeRow(mode: ThemeMode, icon: string, title: string, subtitle: string) {
    Row({ space: 14 }) {
      Text(icon).fontSize(24).fontColor(themeTokens(this.store.themeMode).accent)
      Column({ space: 3 }) {
        Text(title).fontSize(17).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textPrimary)
        Text(subtitle).fontSize(13).fontColor(themeTokens(this.store.themeMode).textSecondary)
      }.alignItems(HorizontalAlign.Start)
      Blank()
      Text(this.store.themeMode === mode ? '✓' : '').fontSize(20).fontColor(themeTokens(this.store.themeMode).accent)
    }.padding(18).width('100%').onClick(() => { this.store.setThemeMode(mode); })
  }

  @Builder
  private valueRow(label: string, value: string) {
    Row() {
      Text(label).fontSize(15).fontColor(themeTokens(this.store.themeMode).textPrimary)
      Blank()
      Text(value).fontSize(12).fontColor(themeTokens(this.store.themeMode).textSecondary).maxLines(2)
        .textAlign(TextAlign.End).constraintSize({ maxWidth: '64%' })
    }.width('100%')
  }

  private async retryService(): Promise<void> {
    this.refreshing = true;
    await this.store.refreshHealth(true);
    this.refreshing = false;
  }
}
