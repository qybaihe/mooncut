import { AppStore } from '../../app/AppStore';
import { themeTokens } from '../../core/design/AppTheme';
import { DestructiveButton, SecondaryButton, cardBorderWidth, cardShadow } from '../../core/design/DesignSystem';
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
          Button('‹ 创作')
            .backgroundColor(Color.Transparent)
            .fontColor(themeTokens(this.store.themeMode).accent)
            .onClick(() => this.onBack())
          Blank()
          Text('设置').fontSize(20).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textPrimary)
          Blank()
        }.width('100%').height(54)

        Text('账号').fontSize(13).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textSecondary).width('100%')
        Column({ space: 12 }) {
          Text(this.store.user?.email ?? '')
            .fontSize(17)
            .fontWeight(FontWeight.Bold)
            .fontColor(themeTokens(this.store.themeMode).textPrimary)
            .width('100%')
          Text('会话由服务端 Cookie 维持，客户端不嵌入服务 API Key。')
            .fontSize(13)
            .fontColor(themeTokens(this.store.themeMode).textSecondary)
            .width('100%')
          DestructiveButton({
            theme: themeTokens(this.store.themeMode),
            label: '退出登录',
            onTap: () => this.store.signOut()
          })
        }
        .padding(18)
        .width('100%')
        .backgroundColor(themeTokens(this.store.themeMode).surface)
        .borderRadius(themeTokens(this.store.themeMode).cardRadius)
        .border({ width: cardBorderWidth(themeTokens(this.store.themeMode)), color: themeTokens(this.store.themeMode).hairline })
        .shadow(cardShadow(themeTokens(this.store.themeMode)))

        Text('外观').fontSize(13).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textSecondary).width('100%')
        Column({ space: 0 }) {
          this.themeRow(ThemeMode.LIGHT, '☼', '浅色', '高级编辑台')
          Divider().color(themeTokens(this.store.themeMode).hairline)
          this.themeRow(ThemeMode.DARK, '☾', '深色', '影视工作间')
          Divider().color(themeTokens(this.store.themeMode).hairline)
          this.themeRow(ThemeMode.MEMPHIS, '✦', 'Memphis', '暖纸点睛')
        }
        .width('100%')
        .backgroundColor(themeTokens(this.store.themeMode).surface)
        .borderRadius(themeTokens(this.store.themeMode).cardRadius)
        .border({ width: cardBorderWidth(themeTokens(this.store.themeMode)), color: themeTokens(this.store.themeMode).hairline })
        .shadow(cardShadow(themeTokens(this.store.themeMode)))

        Text('服务').fontSize(13).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textSecondary).width('100%')
        Column({ space: 14 }) {
          this.valueRow('Base URL', this.store.api.configuration.baseUrl)
          Divider().color(themeTokens(this.store.themeMode).hairline)
          this.valueRow('受信 Host', this.store.api.configuration.trustedHost)
          Divider().color(themeTokens(this.store.themeMode).hairline)
          Row() {
            Text('状态').fontSize(15).fontColor(themeTokens(this.store.themeMode).textPrimary)
            Blank()
            ServiceBadge({
              connected: this.store.serviceConnected,
              loading: this.refreshing,
              theme: themeTokens(this.store.themeMode)
            })
          }.width('100%')
          if (this.store.health) {
            Divider().color(themeTokens(this.store.themeMode).hairline)
            this.valueRow('网关', this.store.health.gatewayReachable === true ? '可达' : '不可达')
            this.valueRow('规划模型', this.store.health.plannerModel ?? '—')
          }
          if (this.store.serviceError) {
            Text(this.store.serviceError).fontSize(12).fontColor(themeTokens(this.store.themeMode).danger).width('100%')
          }
          SecondaryButton({
            theme: themeTokens(this.store.themeMode),
            label: this.refreshing ? '正在检查…' : '重新检查',
            isEnabled: !this.refreshing,
            onTap: () => this.retryService()
          })
        }
        .padding(18)
        .width('100%')
        .backgroundColor(themeTokens(this.store.themeMode).surface)
        .borderRadius(themeTokens(this.store.themeMode).cardRadius)
        .border({ width: cardBorderWidth(themeTokens(this.store.themeMode)), color: themeTokens(this.store.themeMode).hairline })
        .shadow(cardShadow(themeTokens(this.store.themeMode)))

        Text('安全').fontSize(13).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textSecondary).width('100%')
        Text('认证使用邮箱登录后的 Cookie 会话；会话保存在系统 Asset Store，App 不嵌入 MOONCUT_API_KEY。Release TLS 仅对固定生产 Host 使用捆绑 mooncut-ca。')
          .fontSize(13)
          .lineHeight(21)
          .fontColor(themeTokens(this.store.themeMode).textSecondary)
          .width('100%')
          .padding(18)
          .backgroundColor(themeTokens(this.store.themeMode).surface)
          .borderRadius(themeTokens(this.store.themeMode).cardRadius)
          .border({ width: cardBorderWidth(themeTokens(this.store.themeMode)), color: themeTokens(this.store.themeMode).hairline })
          .shadow(cardShadow(themeTokens(this.store.themeMode)))
      }.padding({ left: 16, right: 16, bottom: 50 }).width('100%')
    }.width('100%').height('100%').backgroundColor(themeTokens(this.store.themeMode).canvas)
  }

  @Builder
  private themeRow(mode: ThemeMode, icon: string, title: string, subtitle: string) {
    Row({ space: 14 }) {
      Text(icon)
        .fontSize(20)
        .fontColor(themeTokens(this.store.themeMode).accent)
        .width(36)
        .height(36)
        .textAlign(TextAlign.Center)
        .backgroundColor(themeTokens(this.store.themeMode).accentSoft)
        .borderRadius(10)
      Column({ space: 3 }) {
        Text(title).fontSize(16).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textPrimary)
        Text(subtitle).fontSize(13).fontColor(themeTokens(this.store.themeMode).textSecondary)
      }.alignItems(HorizontalAlign.Start).layoutWeight(1)
      Text(this.store.themeMode === mode ? '✓' : '')
        .fontSize(20)
        .fontColor(themeTokens(this.store.themeMode).accent)
    }
    .padding(16)
    .width('100%')
    .backgroundColor(this.store.themeMode === mode ? themeTokens(this.store.themeMode).accentSoft : Color.Transparent)
    .onClick(() => { this.store.setThemeMode(mode); })
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
