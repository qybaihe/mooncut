import { AppStore } from '../../app/AppStore';
import { CommunityPost } from '../../core/api/APIModels';
import { APIError } from '../../core/api/APIError';
import { presentError } from '../../core/api/ErrorPresentation';
import { themeTokens } from '../../core/design/AppTheme';
import { common } from '@kit.AbilityKit';
import { PetEvent } from '../../core/models/AppModels';

interface LocalPoster {
  postId: string;
  uri: string;
}

@Component
export struct CommunityPage {
  @ObjectLink store: AppStore;
  onOpenSettings: () => void = () => {};
  @State posts: CommunityPost[] = [];
  @State loading: boolean = false;
  @State errorMessage: string = '';
  @State errorDiagnostic: string = '';
  @State playingPostId: string = '';
  @State localVideoUri: string = '';
  @State downloadingPostId: string = '';
  @State nextCursor: string = '';
  @State loadingMore: boolean = false;
  @State localPosters: LocalPoster[] = [];
  private requestEpoch: number = 0;
  private visible: boolean = false;

  aboutToAppear(): void { this.visible = true; this.load(true); }
  aboutToDisappear(): void {
    this.visible = false;
    this.requestEpoch += 1;
    this.loading = false;
    this.loadingMore = false;
  }

  build() {
    Stack() {
      Scroll() {
        Column({ space: 18 }) {
        Row() {
          Blank(); Text('社区').fontSize(20).fontWeight(FontWeight.Bold); Blank()
          Button('☼').fontSize(25).fontColor(themeTokens(this.store.themeMode).accent).backgroundColor(Color.Transparent)
            .accessibilityText('切换主题').onClick(() => this.store.cycleTheme())
          Button('⚙').fontSize(23).fontColor(themeTokens(this.store.themeMode).accent).backgroundColor(Color.Transparent)
            .accessibilityText('打开设置').onClick(() => this.onOpenSettings())
          Button('↻').fontSize(23).fontColor(themeTokens(this.store.themeMode).accent).backgroundColor(Color.Transparent)
            .accessibilityText('刷新社区').onClick(() => this.load(true))
        }
          .width('100%').height(54)
        Text('♟  MoonCut 社区').fontSize(14).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).accent).width('100%')
        Text('看看别人，怎么把话说出来。').fontSize(28).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textPrimary).width('100%')
        Text('生产边缘社区当前为只读占位能力；内容为空时不代表本地或网络故障。')
          .fontSize(16).lineHeight(24).fontColor(themeTokens(this.store.themeMode).textSecondary).width('100%')
        Row() {
          this.trustItem('✦', '仅主动发布'); this.trustItem('♙', '任务服务托管'); this.trustItem('✓', '质检通过可发')
        }.padding(16).width('100%').backgroundColor(themeTokens(this.store.themeMode).surface).borderRadius(themeTokens(this.store.themeMode).cardRadius)

        if (this.errorMessage) {
          Column({ space: 8 }) {
            Text(this.errorMessage).fontSize(14).fontColor(themeTokens(this.store.themeMode).danger).width('100%')
            if (this.errorDiagnostic) {
              Text(`诊断：${this.errorDiagnostic}`).fontSize(12).fontColor(themeTokens(this.store.themeMode).textTertiary).width('100%')
            }
            Button('重试真实请求').height(40).fontColor(themeTokens(this.store.themeMode).accent)
              .backgroundColor(themeTokens(this.store.themeMode).accentSoft).onClick(() => this.load(true))
          }.padding(14).width('100%').backgroundColor(themeTokens(this.store.themeMode).surface).borderRadius(12)
        }
        if (!this.loading && !this.errorMessage && this.posts.length === 0) {
          Column({ space: 16 }) {
            Text('♟').fontSize(62).fontColor(themeTokens(this.store.themeMode).accent)
            Text('社区还没有作品').fontSize(23).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textPrimary)
            Text('社区生产代理尚未正式开放。当前版本不提供发帖，后续开放后这里将展示创作者主动分享的作品。')
              .fontSize(15).lineHeight(23).fontColor(themeTokens(this.store.themeMode).textSecondary).textAlign(TextAlign.Center)
          }.padding({ left: 22, right: 22, top: 42, bottom: 42 }).width('100%').backgroundColor(themeTokens(this.store.themeMode).surface)
            .borderRadius(themeTokens(this.store.themeMode).cardRadius).border({ width: 1, color: themeTokens(this.store.themeMode).hairline })
        }
        ForEach(this.posts, (post: CommunityPost, index: number) => {
          Column({ space: 0 }) {
            Stack({ alignContent: Alignment.BottomStart }) {
              if (this.posterUri(post.id)) {
                Image(this.posterUri(post.id)).width('100%').height(168).objectFit(ImageFit.Cover)
              } else {
                Column({ space: 8 }) {
                  Text(post.title.slice(0, 1)).fontSize(42).fontWeight(FontWeight.Bold).fontColor('#EFFFFFFF')
                  Text('▶').fontSize(22).fontColor('#BFFFFFFF')
                }.width('100%').height(168).justifyContent(FlexAlign.Center)
                  .backgroundColor(index % 2 === 0 ? themeTokens(this.store.themeMode).videoWell : themeTokens(this.store.themeMode).accentSoft)
              }
              Row() {
                Text('▶  播放').fontSize(13).fontWeight(FontWeight.Bold).fontColor('#FFFFFF')
                  .padding({ left: 12, right: 12, top: 7, bottom: 7 }).backgroundColor('#66000000').borderRadius(16)
                Blank()
                if (post.durationMs !== undefined) {
                  Text(this.durationLabel(post.durationMs)).fontSize(12).fontWeight(FontWeight.Bold).fontColor('#FFFFFF')
                    .padding({ left: 10, right: 10, top: 7, bottom: 7 }).backgroundColor('#66000000').borderRadius(16)
                }
              }.width('100%').padding(12)
            }.width('100%').height(168)

            Column({ space: 8 }) {
              Text(post.title).fontSize(19).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textPrimary).width('100%')
              if (post.caption) {
                Text(post.caption).fontSize(14).lineHeight(21).fontColor(themeTokens(this.store.themeMode).textSecondary).width('100%').maxLines(3)
              }
              Row() {
                Text(`●  ${post.authorName}`).fontSize(13).fontColor(themeTokens(this.store.themeMode).textSecondary)
                Blank()
                Text(this.dateLabel(post.createdAt)).fontSize(12).fontColor(themeTokens(this.store.themeMode).textTertiary)
              }.width('100%')
            }.padding(14).width('100%').backgroundColor(themeTokens(this.store.themeMode).inset)
            Button(this.downloadingPostId === post.id ? '正在下载…' : '播放真实成片')
              .height(46).width('100%').backgroundColor(themeTokens(this.store.themeMode).accentSoft).fontColor(themeTokens(this.store.themeMode).accent)
              .enabled(!this.downloadingPostId).onClick(() => this.openPost(post))
          }.width('100%').backgroundColor(themeTokens(this.store.themeMode).surface).borderRadius(themeTokens(this.store.themeMode).cardRadius)
            .accessibilityDescription(`作品 ${post.title}，作者 ${post.authorName}`)
            .clip(true).border({ width: 1, color: themeTokens(this.store.themeMode).hairline })
            .onAppear(() => {
              if (post.id === this.posts[this.posts.length - 1]?.id && this.nextCursor) void this.load(false);
            })
        })
        if (this.nextCursor) {
          Button(this.loadingMore ? '正在加载…' : '加载更多').width('100%').height(50).enabled(!this.loadingMore)
            .backgroundColor(themeTokens(this.store.themeMode).surface).fontColor(themeTokens(this.store.themeMode).accent)
            .border({ width: 1, color: themeTokens(this.store.themeMode).hairline }).onClick(() => this.load(false))
        }
        }
        .padding({ left: 18, right: 18, bottom: 100 }).width('100%')
      }
      .width('100%').height('100%')
      if (this.loading && this.posts.length === 0) {
        Column({ space: 10 }) {
          LoadingProgress().width(34).height(34).color(themeTokens(this.store.themeMode).accent)
          Text('打开社区…').fontSize(14).fontColor(themeTokens(this.store.themeMode).textSecondary)
        }.padding(18).backgroundColor(themeTokens(this.store.themeMode).surface).borderRadius(14)
      }
      if (this.playingPostId && this.localVideoUri) {
        this.playerOverlay()
      }
    }
    .width('100%').height('100%').backgroundColor(themeTokens(this.store.themeMode).canvas)
  }

  @Builder
  private trustItem(icon: string, label: string) {
    Column({ space: 7 }) {
      Text(icon).fontSize(20).fontColor(themeTokens(this.store.themeMode).accent)
      Text(label).fontSize(12).fontWeight(FontWeight.Medium).fontColor(themeTokens(this.store.themeMode).textSecondary)
    }.layoutWeight(1)
  }

  @Builder
  private playerOverlay() {
    Column({ space: 0 }) {
      Row() {
        Button('关闭').fontColor(themeTokens(this.store.themeMode).accent).backgroundColor(Color.Transparent)
          .onClick(() => { this.playingPostId = ''; this.localVideoUri = ''; })
        Blank()
        Text('作品').fontSize(20).fontWeight(FontWeight.Bold).fontColor(themeTokens(this.store.themeMode).textPrimary)
        Blank()
        Text('关闭').fontColor(Color.Transparent)
      }.width('100%').height(58).padding({ left: 8, right: 8 })
      Video({ src: this.localVideoUri }).width('100%').height(330).controls(true)
        .objectFit(ImageFit.Contain).backgroundColor(themeTokens(this.store.themeMode).videoWell)
      Column({ space: 10 }) {
        Text(this.playingPost()?.title ?? '').fontSize(21).fontWeight(FontWeight.Bold)
          .fontColor(themeTokens(this.store.themeMode).textPrimary).width('100%')
        if (this.playingPost()?.caption) {
          Text(this.playingPost()?.caption ?? '').fontSize(15).lineHeight(22)
            .fontColor(themeTokens(this.store.themeMode).textSecondary).width('100%')
        }
        Row({ space: 16 }) {
          Text(`●  ${this.playingPost()?.authorName ?? ''}`).fontSize(13).fontColor(themeTokens(this.store.themeMode).textTertiary)
          if (this.playingPost()?.durationMs !== undefined) {
            Text(`◷  ${this.durationLabel(this.playingPost()?.durationMs ?? 0)}`).fontSize(13)
              .fontColor(themeTokens(this.store.themeMode).textTertiary)
          }
        }.width('100%')
      }.padding(18).width('100%').backgroundColor(themeTokens(this.store.themeMode).surface)
      Blank()
    }.width('100%').height('100%').backgroundColor(themeTokens(this.store.themeMode).canvas)
  }

  private async load(reset: boolean): Promise<void> {
    if (this.loading || this.loadingMore) return;
    if (!reset && !this.nextCursor) return;
    const epoch = this.requestEpoch + 1;
    this.requestEpoch = epoch;
    if (reset) this.loading = true; else this.loadingMore = true;
    try {
      const response = await this.store.api.community(reset ? undefined : this.nextCursor);
      if (!this.visible || epoch !== this.requestEpoch) return;
      this.posts = reset ? response.items : this.posts.concat(response.items);
      this.nextCursor = response.nextCursor ?? '';
      this.errorMessage = '';
      this.errorDiagnostic = '';
      if (reset && response.items.length > 0) {
        this.store.applyPet(PetEvent.PET_MESSAGE, '社区里有新的口播作品，一起看看别人怎么讲吧！');
      }
      void this.loadPosters(response.items, epoch);
    }
    catch (error) {
      if (!this.visible || epoch !== this.requestEpoch) return;
      this.errorMessage = presentError(error as object);
      this.errorDiagnostic = error instanceof APIError ? error.code : '';
      if (error instanceof APIError && error.unauthorized) this.store.handleError(error);
    }
    if (epoch === this.requestEpoch) {
      if (reset) this.loading = false; else this.loadingMore = false;
    }
  }

  private async loadPosters(posts: CommunityPost[], epoch: number): Promise<void> {
    const context = getContext(this) as common.UIAbilityContext;
    for (const post of posts) {
      if (!post.posterUrl || this.posterUri(post.id)) continue;
      try {
        const path = `${context.cacheDir}/community-poster-${post.id}.jpg`;
        await this.store.api.downloadUrl(post.posterUrl, path);
        if (!this.visible || epoch !== this.requestEpoch) return;
        this.localPosters = this.localPosters.concat([{ postId: post.id, uri: `file://${path}` }]);
      } catch (_) {
        // Keep the themed placeholder; a poster failure must not hide a playable post.
      }
    }
  }

  private posterUri(postId: string): string {
    return this.localPosters.find((item: LocalPoster) => item.postId === postId)?.uri ?? '';
  }

  private playingPost(): CommunityPost | null {
    return this.posts.find((post: CommunityPost) => post.id === this.playingPostId) ?? null;
  }

  private durationLabel(milliseconds: number): string {
    const total = Math.max(0, Math.round(milliseconds / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  }

  private dateLabel(raw: string): string {
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw.slice(0, 10);
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }

  private async openPost(post: CommunityPost): Promise<void> {
    this.downloadingPostId = post.id;
    try {
      const context = getContext(this) as common.UIAbilityContext;
      const path = `${context.cacheDir}/community-${post.id}.mp4`;
      await this.store.api.downloadUrl(post.videoUrl, path);
      this.localVideoUri = `file://${path}`; this.playingPostId = post.id;
    } catch (error) { this.store.handleError(error); }
    this.downloadingPostId = '';
  }
}
