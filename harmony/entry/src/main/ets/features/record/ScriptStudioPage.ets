import { pasteboard } from '@kit.BasicServicesKit';
import { AppStore } from '../../app/AppStore';
import { APIError } from '../../core/api/APIError';
import { presentError } from '../../core/api/ErrorPresentation';
import { ScriptAssistantResponse, ScriptMessage, ScriptSuggestion } from '../../core/api/APIModels';
import { themeTokens } from '../../core/design/AppTheme';
import { PetEvent } from '../../core/models/AppModels';

interface SelectableSuggestion {
  id: number;
  eyebrow: string;
  title: string;
  detail: string;
}

@Component
export struct ScriptStudioPage {
  @ObjectLink store: AppStore;
  onBack: () => void = () => {};
  onOpenTeleprompter: (draft: string) => void = () => {};
  @State messages: ScriptMessage[] = [
    { role: 'assistant', content: '先告诉我：这条口播，你最想让观众记住什么？我会通过真实脚本助手陪你成稿。' }
  ];
  @State input: string = '';
  @State draft: string = '';
  @State loading: boolean = false;
  @State panel: string = 'chat';
  @State suggestions: SelectableSuggestion[] = [];
  @State selectedSuggestionIds: number[] = [];
  @State lastModel: string = '';
  @State errorMessage: string = '';
  @State errorDiagnostic: string = '';
  private lastAction: string = 'guide';
  private lastStyle: string = '';
  private requestEpoch: number = 0;
  private visible: boolean = false;

  aboutToAppear(): void {
    this.visible = true;
    if (this.store.currentDraft) this.draft = this.store.currentDraft;
    if (this.store.scriptMessages.length > 0) this.messages = this.store.scriptMessages;
    else this.store.setScriptMessages(this.messages);
  }

  aboutToDisappear(): void { this.visible = false; this.requestEpoch += 1; this.loading = false; }

  build() {
    Column() {
      Row() {
        Button('‹ 创作').fontSize(17).fontColor(themeTokens(this.store.themeMode).accent).backgroundColor(Color.Transparent)
          .accessibilityText('返回创作').onClick(() => this.onBack())
        Blank(); Text('脚本助手').fontSize(20).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textPrimary); Blank()
      }.height(58).width('100%').padding({ left: 6, right: 62 })
      Row() {
        Button('和助手聊').layoutWeight(1).height(40).backgroundColor(this.panel === 'chat' ? themeTokens(this.store.themeMode).accentSoft : Color.Transparent)
          .fontColor(this.panel === 'chat' ? themeTokens(this.store.themeMode).accent : themeTokens(this.store.themeMode).textSecondary).onClick(() => { this.panel = 'chat'; })
        Button('我的口播稿').layoutWeight(1).height(40).backgroundColor(this.panel === 'draft' ? themeTokens(this.store.themeMode).accentSoft : Color.Transparent)
          .fontColor(this.panel === 'draft' ? themeTokens(this.store.themeMode).accent : themeTokens(this.store.themeMode).textSecondary).onClick(() => { this.panel = 'draft'; })
      }.margin({ left: 18, right: 18, bottom: 10 }).padding(3).backgroundColor(themeTokens(this.store.themeMode).inset).borderRadius(12)

      if (this.panel === 'chat') {
        this.chatPanel()
      } else {
        this.draftPanel()
      }
    }.width('100%').height('100%').backgroundColor(themeTokens(this.store.themeMode).canvas)
  }

  @Builder
  private chatPanel() {
    Column() {
      List({ space: 12 }) {
        ListItem() {
          Row() {
            Text('Moon 助手').fontSize(14).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textPrimary)
            Blank()
            Text(this.lastModel || '真实 API').fontSize(12).fontWeight(FontWeight.Medium).fontColor(themeTokens(this.store.themeMode).accent)
              .padding({ left: 9, right: 9, top: 5, bottom: 5 }).backgroundColor(themeTokens(this.store.themeMode).accentSoft).borderRadius(12)
          }.width('100%')
        }
        ForEach(this.messages, (message: ScriptMessage) => {
          ListItem() {
            Row() {
              if (message.role === 'user') Blank().layoutWeight(1)
              Text(message.content).fontSize(15).lineHeight(22)
                .fontColor(message.role === 'user' ? '#FFFFFF' : themeTokens(this.store.themeMode).textPrimary)
                .backgroundColor(message.role === 'user' ? themeTokens(this.store.themeMode).accent : themeTokens(this.store.themeMode).surface)
                .borderRadius(15).padding(14).constraintSize({ maxWidth: '84%' })
              if (message.role === 'assistant') Blank().layoutWeight(1)
            }.width('100%')
          }
        })
        if (this.loading) {
          ListItem() {
            Row({ space: 8 }) {
              LoadingProgress().width(18).height(18).color(themeTokens(this.store.themeMode).accent)
              Text('正在请求脚本助手…').fontSize(13).fontColor(themeTokens(this.store.themeMode).textSecondary)
            }.width('100%')
          }
        }
        if (this.suggestions.length > 0) {
          ListItem() { Text('建议角度').fontSize(13).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textSecondary).width('100%') }
          ForEach(this.suggestions, (item: SelectableSuggestion) => {
            ListItem() { this.suggestionCard(item) }
          })
          ListItem() {
            Column({ space: 9 }) {
              Button('按所选建议生成稿件').width('100%').height(44)
                .fontColor(themeTokens(this.store.themeMode).accent).backgroundColor(themeTokens(this.store.themeMode).accentSoft)
                .enabled(!this.loading && this.selectedSuggestionIds.length > 0).onClick(() => this.applySelectedSuggestions())
              Button('直接生成完整口播稿').width('100%').height(46)
                .fontColor('#FFFFFF').backgroundColor(themeTokens(this.store.themeMode).accent)
                .enabled(!this.loading).onClick(() => this.requestScript('generate'))
            }.width('100%')
          }
        }
        if (this.errorMessage) {
          ListItem() { this.errorBanner() }
        }
      }.layoutWeight(1).width('100%').padding({ left: 16, right: 16, top: 10 })
      Row({ space: 10 }) {
        TextArea({ placeholder: '说说你想讲什么…', text: this.input }).layoutWeight(1).height(54)
          .backgroundColor(themeTokens(this.store.themeMode).surface).fontColor(themeTokens(this.store.themeMode).textPrimary)
          .onChange((value: string) => { this.input = value; })
        Button(this.loading ? '…' : '发送').height(50).backgroundColor(themeTokens(this.store.themeMode).accent).fontColor('#FFFFFF')
          .enabled(!this.loading && this.input.trim().length > 0).accessibilityText('发送')
          .onClick(() => this.send())
      }.padding({ left: 14, right: 14, top: 10, bottom: 16 }).backgroundColor(themeTokens(this.store.themeMode).canvas)
    }.layoutWeight(1).width('100%')
  }

  @Builder
  private suggestionCard(item: SelectableSuggestion) {
    Row({ space: 10 }) {
      Text(this.selectedSuggestionIds.includes(item.id) ? '✓' : '○').fontSize(20).fontColor(themeTokens(this.store.themeMode).accent)
      Column({ space: 3 }) {
        Text(item.eyebrow).fontSize(11).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).accent).width('100%')
        Text(item.title).fontSize(15).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textPrimary).width('100%')
        Text(item.detail).fontSize(13).lineHeight(19).fontColor(themeTokens(this.store.themeMode).textSecondary).width('100%')
      }.layoutWeight(1).alignItems(HorizontalAlign.Start)
    }.padding(13).width('100%').backgroundColor(themeTokens(this.store.themeMode).surface)
      .borderRadius(12).border({ width: 1, color: themeTokens(this.store.themeMode).hairline })
      .accessibilityText(`${item.title}，${this.selectedSuggestionIds.includes(item.id) ? '已选择' : '未选择'}`)
      .onClick(() => this.toggleSuggestion(item.id))
  }

  @Builder
  private draftPanel() {
    Scroll() {
      Column({ space: 14 }) {
        Row() {
          Text(`${this.characterCount()} 字 · 约 ${this.estimatedSeconds()} 秒`).fontSize(13).fontColor(themeTokens(this.store.themeMode).textSecondary)
          Blank()
          Button('复制').fontSize(13).fontWeight(FontWeight.Medium).fontColor(themeTokens(this.store.themeMode).accent)
            .backgroundColor(Color.Transparent).enabled(this.draft.length > 0).onClick(() => this.copyDraft())
        }.width('100%')
        TextArea({ placeholder: '与助手沟通后，稿件会出现在这里，也可以直接编辑。', text: this.draft })
          .height(360).backgroundColor(themeTokens(this.store.themeMode).surface).fontColor(themeTokens(this.store.themeMode).textPrimary)
          .onChange((value: string) => { this.draft = value; this.store.setCurrentDraft(value); })
        Row({ space: 8 }) {
          Button('口语化').layoutWeight(1).enabled(!this.loading && this.draft.length > 0).onClick(() => this.requestScript('polish', 'oral'))
          Button('精简').layoutWeight(1).enabled(!this.loading && this.draft.length > 0).onClick(() => this.requestScript('polish', 'short'))
          Button('增强情绪').layoutWeight(1).enabled(!this.loading && this.draft.length > 0).onClick(() => this.requestScript('polish', 'emotional'))
        }
        Button('进入提词录制').width('100%').height(54).backgroundColor(themeTokens(this.store.themeMode).accent).fontColor('#FFFFFF')
          .enabled(this.draft.trim().length > 0).onClick(() => this.onOpenTeleprompter(this.draft))
        if (this.errorMessage) {
          this.errorBanner()
        }
      }.padding({ left: 18, right: 18, top: 16, bottom: 100 }).width('100%')
    }.layoutWeight(1).width('100%')
  }

  @Builder
  private errorBanner() {
    Column({ space: 8 }) {
      Text(this.errorMessage).fontSize(14).fontColor(themeTokens(this.store.themeMode).danger).width('100%')
      if (this.errorDiagnostic) {
        Text(`诊断：${this.errorDiagnostic}`).fontSize(12).fontColor(themeTokens(this.store.themeMode).textTertiary).width('100%')
      }
      Button('重试真实请求').height(40).fontColor(themeTokens(this.store.themeMode).accent)
        .backgroundColor(themeTokens(this.store.themeMode).accentSoft).onClick(() => this.retryLast())
    }.padding(14).width('100%').backgroundColor(themeTokens(this.store.themeMode).surface)
      .borderRadius(12).border({ width: 1, color: themeTokens(this.store.themeMode).hairline })
  }

  private send(preset: string = ''): void {
    const text = (preset || this.input).trim();
    if (!text || this.loading) return;
    this.messages = [...this.messages, { role: 'user', content: text }];
    this.store.setScriptMessages(this.messages);
    this.input = '';
    void this.requestScript('guide');
  }

  private applySelectedSuggestions(): void {
    const selected = this.suggestions.filter((item: SelectableSuggestion) => this.selectedSuggestionIds.includes(item.id));
    if (selected.length === 0) return;
    const text = selected.map((item: SelectableSuggestion) => `${item.title}：${item.detail}`).join('；');
    this.send(`请把这些角度写进稿件：${text}`);
  }

  private toggleSuggestion(id: number): void {
    if (this.selectedSuggestionIds.includes(id)) {
      this.selectedSuggestionIds = this.selectedSuggestionIds.filter((value: number) => value !== id);
    } else {
      this.selectedSuggestionIds = [...this.selectedSuggestionIds, id];
    }
  }

  private retryLast(): void { void this.requestScript(this.lastAction, this.lastStyle); }

  private async requestScript(action: string, style: string = ''): Promise<void> {
    if (this.loading) return;
    const epoch = this.requestEpoch + 1;
    this.requestEpoch = epoch;
    this.loading = true;
    this.errorMessage = '';
    this.errorDiagnostic = '';
    this.lastAction = action;
    this.lastStyle = style;
    this.store.applyPet(PetEvent.SCRIPT_REQUESTING);
    try {
      const response = await this.store.api.scriptAssistant({
        action: action,
        style: style || undefined,
        messages: this.messages.slice(Math.max(0, this.messages.length - 12)),
        draft: this.draft || undefined
      });
      if (!this.visible || epoch !== this.requestEpoch) return;
      this.applyResponse(response, action);
    } catch (error) {
      if (!this.visible || epoch !== this.requestEpoch) return;
      this.errorMessage = presentError(error as object);
      this.errorDiagnostic = error instanceof APIError ? error.code : '';
      this.store.handleError(error as object);
    }
    if (epoch === this.requestEpoch) this.loading = false;
  }

  private applyResponse(response: ScriptAssistantResponse, action: string): void {
    this.lastModel = response.model ?? '';
    if (action !== 'polish') {
      this.messages = [...this.messages, { role: 'assistant', content: response.reply }];
      this.store.setScriptMessages(this.messages);
    } else {
      this.store.showToast(response.reply);
    }
    if (response.draft) {
      this.draft = response.draft;
      this.store.setCurrentDraft(response.draft);
      if (action === 'generate' || action === 'polish') this.panel = 'draft';
    }
    if (response.suggestions && response.suggestions.length > 0) {
      this.suggestions = response.suggestions.map((item: ScriptSuggestion, index: number): SelectableSuggestion => ({
        id: index, eyebrow: item.eyebrow, title: item.title, detail: item.detail
      }));
      this.selectedSuggestionIds = this.suggestions.map((item: SelectableSuggestion) => item.id);
    }
    if (response.petMessage) this.store.applyPet(PetEvent.PET_MESSAGE, response.petMessage);
    this.store.applyPet(response.ready ? PetEvent.COACH_REVIEW : PetEvent.IDLE);
  }

  private characterCount(): number { return this.draft.replace(/\s/g, '').length; }
  private estimatedSeconds(): number { return Math.max(20, Math.round(this.characterCount() / 4.1)); }

  private async copyDraft(): Promise<void> {
    if (!this.draft) return;
    try {
      const data = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, this.draft);
      await pasteboard.getSystemPasteboard().setData(data);
      this.store.showToast('口播稿已复制到剪贴板');
    } catch (error) {
      this.store.handleError(error as object);
    }
  }
}
