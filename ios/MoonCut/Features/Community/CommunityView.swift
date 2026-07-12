import AVKit
import SwiftUI

@MainActor
@Observable
final class CommunityViewModel {
    var posts: [CommunityPostDTO] = []
    var nextCursor: String?
    var packages: [CommunityRegistryPackageDTO] = []
    var isLoading = false
    var isLoadingPackages = false
    var connectingSlug: String?
    var errorMessage: String?
    var errorDiagnostic: String?
    var packageError: String?
    var connectHint: String?
    private let api: MoonCutAPIClient
    private let env: AppEnvironment

    var apiForPublisher: MoonCutAPIClient { api }

    init(api: MoonCutAPIClient, env: AppEnvironment) {
        self.api = api
        self.env = env
    }

    func load(reset: Bool = false) async {
        if isLoading { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let response = try await api.listCommunityPosts(cursor: reset ? nil : nextCursor)
            if reset {
                posts = response.items
            } else {
                posts.append(contentsOf: response.items)
            }
            nextCursor = response.nextCursor
            errorMessage = nil
            if reset, !response.items.isEmpty {
                env.pet.apply(.petMessage("社区里有新的口播作品，一起看看别人怎么讲吧！"))
            }
        } catch let error as APIError {
            errorMessage = error.errorDescription
            errorDiagnostic = error.diagnosticCode
            if error == .unauthorized { env.handleAPIError(error) }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func loadPackages() async {
        guard !isLoadingPackages else { return }
        isLoadingPackages = true
        defer { isLoadingPackages = false }
        do {
            packages = try await api.listCommunityPackages().items
            packageError = nil
        } catch let error as APIError {
            packageError = error.errorDescription
        } catch {
            packageError = error.localizedDescription
        }
    }

    func connect(_ item: CommunityRegistryPackageDTO) async {
        guard connectingSlug == nil else { return }
        connectingSlug = item.slug
        connectHint = nil
        defer { connectingSlug = nil }
        do {
            let result = try await api.connectCommunityPackage(slug: item.slug)
            connectHint = "\(item.display.name) 已\(result.created ? "连接到" : "同步到")本机 Agent，可在剪辑任务中选择。"
        } catch let error as APIError {
            connectHint = error.errorDescription
            if error == .unauthorized { env.handleAPIError(error) }
        } catch {
            connectHint = error.localizedDescription
        }
    }
}

struct CommunityView: View {
    @State private var model: CommunityViewModel
    @Environment(\.theme) private var theme
    @State private var playing: CommunityPostDTO?
    @State private var showsPackagePublisher = false

    init(api: MoonCutAPIClient, env: AppEnvironment) {
        _model = State(initialValue: CommunityViewModel(api: api, env: env))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                trustStrip
                registrySection

                if let error = model.errorMessage {
                    ErrorBanner(
                        message: error,
                        diagnostic: model.errorDiagnostic,
                        onRetry: { Task { await model.load(reset: true) } }
                    )
                }

                if model.posts.isEmpty && !model.isLoading && model.errorMessage == nil {
                    StudioEmptyState(
                        title: "社区还没有作品",
                        systemImage: "person.3",
                        description: "质检通过的成片可在剪辑完成后主动发布。这里只展示创作者自愿分享的真实口播。"
                    )
                    .accessibilityIdentifier("community-empty")
                }

                LazyVStack(spacing: 14) {
                    ForEach(Array(model.posts.enumerated()), id: \.element.id) { index, post in
                        CommunityPostCard(post: post, accentIndex: index) {
                            playing = post
                        }
                        .onAppear {
                            if post.id == model.posts.last?.id, model.nextCursor != nil {
                                Task { await model.load(reset: false) }
                            }
                        }
                    }
                }

                if model.nextCursor != nil, !model.posts.isEmpty {
                    Button {
                        Task { await model.load(reset: false) }
                    } label: {
                        if model.isLoading {
                            ProgressView()
                                .frame(maxWidth: .infinity, minHeight: 48)
                        } else {
                            Label("加载更多", systemImage: "arrow.down.circle")
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .buttonStyle(SecondaryButtonStyle())
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 32)
        }
        .background(theme.canvas.ignoresSafeArea())
        .navigationTitle("社区")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable {
            await model.load(reset: true)
            await model.loadPackages()
        }
        .overlay {
            if model.isLoading && model.posts.isEmpty {
                ProgressView("打开社区…")
                    .padding(16)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
        }
        .task {
            await model.load(reset: true)
            await model.loadPackages()
        }
        .sheet(item: $playing) { post in
            CommunityPlayerSheet(post: post)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $showsPackagePublisher) {
            CommunityPackagePublisherSheet(api: model.apiForPublisher) {
                Task { await model.loadPackages() }
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showsPackagePublisher = true
                } label: {
                    Image(systemName: "square.and.arrow.up")
                }
                .accessibilityLabel("发布能力包")
                .accessibilityIdentifier("community-package-publish")
            }
        }
        .accessibilityIdentifier("community-screen")
    }

    private var header: some View {
        ZStack(alignment: .topTrailing) {
            StudioSectionHeader(
                eyebrow: "MoonCut 社区",
                title: "看看别人，怎么把话说出来。",
                subtitle: "都是创作者主动分享的真实口播成片。找灵感，也欢迎把你的作品放进来。",
                symbol: "person.3.fill"
            )
            if theme.usesMemphisChrome {
                MemphisAccentShape(style: .corner)
                    .padding(.trailing, 2)
            }
        }
    }

    private var trustStrip: some View {
        HStack(spacing: 0) {
            trustItem(symbol: "sparkles", text: "仅主动发布")
            divider
            trustItem(symbol: "lock.shield", text: "任务服务托管")
            divider
            trustItem(symbol: "checkmark.seal", text: "质检通过可发")
        }
        .padding(.vertical, 12)
        .padding(.horizontal, 8)
        .moonCard(radius: 14)
    }

    @ViewBuilder
    private var registrySection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("能力社区")
                        .font(.headline)
                        .foregroundStyle(theme.textPrimary)
                    Text("与 Web 同一 Pages 目录。包只含声明文件；连接时仅允许已审核的本机 adapter。")
                        .font(.caption)
                        .foregroundStyle(theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
                Button {
                    Task { await model.loadPackages() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .frame(minWidth: 44, minHeight: 44)
                }
                .disabled(model.isLoadingPackages)
                .accessibilityLabel("刷新能力社区")
            }

            if let packageError = model.packageError {
                ErrorBanner(message: packageError, diagnostic: nil, onRetry: { Task { await model.loadPackages() } })
            } else if model.isLoadingPackages && model.packages.isEmpty {
                ProgressView("正在读取能力包…")
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else if model.packages.isEmpty {
                Text("还没有已发布能力包。你可以从右上角上传 manifest、SKILL.md 和 connector.json。")
                    .font(.caption)
                    .foregroundStyle(theme.textSecondary)
                    .padding(12)
                    .moonCard(radius: 14)
            } else {
                ForEach(model.packages) { item in
                    CommunityPackageCard(
                        item: item,
                        isConnecting: model.connectingSlug == item.slug,
                        onConnect: { Task { await model.connect(item) } },
                        packageURL: packageURL
                    )
                }
            }
            if let hint = model.connectHint {
                Text(hint)
                    .font(.caption)
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(14)
        .moonCard(radius: 16)
        .accessibilityIdentifier("community-package-registry")
    }

    private func packageURL(_ path: String) -> URL? {
        let normalized = path.hasPrefix("/api/") ? String(path.dropFirst(4)) : path
        return APIConfiguration.current.url(path: normalized)
    }

    private var divider: some View {
        Rectangle()
            .fill(theme.hairline)
            .frame(width: 1, height: 28)
            .padding(.horizontal, 6)
    }

    private func trustItem(symbol: String, text: String) -> some View {
        VStack(spacing: 6) {
            Image(systemName: symbol)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(theme.accent)
            Text(text)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(theme.textSecondary)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.85)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Capability registry

private struct CommunityPackageCard: View {
    @Environment(\.theme) private var theme
    let item: CommunityRegistryPackageDTO
    let isConnecting: Bool
    let onConnect: () -> Void
    let packageURL: (String) -> URL?

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(alignment: .firstTextBaseline) {
                Label(item.publisher.label, systemImage: "checkmark.shield")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(theme.textSecondary)
                Spacer()
                Text("v\(item.release.version)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(theme.textTertiary)
            }
            Text(item.display.name)
                .font(.subheadline.weight(.bold))
                .foregroundStyle(theme.textPrimary)
            Text(item.display.tagline)
                .font(.caption)
                .foregroundStyle(theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            if !item.permissions.isEmpty {
                Text("需要确认：\(item.permissions.map(\.reason).joined(separator: "；"))")
                    .font(.caption2)
                    .foregroundStyle(theme.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 10) {
                Button(action: onConnect) {
                    if isConnecting {
                        ProgressView().frame(minWidth: 108)
                    } else {
                        Label("连接到 Agent", systemImage: "cable.connector")
                    }
                }
                .buttonStyle(SecondaryButtonStyle())
                .disabled(isConnecting)
                .accessibilityIdentifier("community-connect-\(item.slug)")
                if let url = packageURL(item.release.files.package) {
                    Link(destination: url) {
                        Label("下载", systemImage: "arrow.down.circle")
                    }
                    .font(.caption.weight(.semibold))
                }
            }
        }
        .padding(12)
        .background(theme.inset.opacity(0.45), in: RoundedRectangle(cornerRadius: 13, style: .continuous))
    }
}

// MARK: - Post card

private struct CommunityPostCard: View {
    @Environment(\.theme) private var theme
    let post: CommunityPostDTO
    let accentIndex: Int
    let onPlay: () -> Void

    private var sticker: Color {
        guard theme.usesMemphisChrome else { return theme.accent }
        let colors = [theme.stickerYellow, theme.stickerPink, theme.stickerCyan, theme.stickerMint]
        return colors[accentIndex % colors.count]
    }

    var body: some View {
        Button(action: onPlay) {
            VStack(alignment: .leading, spacing: 0) {
                poster
                meta
            }
            .background(theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: theme.cardRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: theme.cardRadius, style: .continuous)
                    .stroke(
                        theme.usesMemphisChrome ? theme.ink.opacity(0.7) : theme.hairline,
                        lineWidth: theme.usesMemphisChrome ? 1.6 : 1
                    )
            )
            .shadow(
                color: theme.usesMemphisChrome ? theme.ink.opacity(0.12) : .black.opacity(0.05),
                radius: theme.usesMemphisChrome ? 0 : 12,
                x: theme.usesMemphisChrome ? 4 : 0,
                y: theme.usesMemphisChrome ? 4 : 4
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("播放 \(post.title)，作者 \(post.authorName)")
    }

    private var poster: some View {
        ZStack(alignment: .bottomLeading) {
            // 视觉井：无海报时用主题色块 + 标题首字，不伪造远程图成功
            RoundedRectangle(cornerRadius: 0)
                .fill(
                    LinearGradient(
                        colors: [
                            theme.videoWell,
                            theme.usesMemphisChrome
                                ? sticker.opacity(0.35)
                                : theme.accent.opacity(0.28)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .frame(height: 168)
                .overlay {
                    if let poster = post.posterUrl, let url = URL(string: poster) {
                        AsyncImage(url: url) { phase in
                            switch phase {
                            case .success(let image):
                                image
                                    .resizable()
                                    .scaledToFill()
                            case .failure:
                                posterPlaceholder
                            case .empty:
                                ProgressView().tint(.white)
                            @unknown default:
                                posterPlaceholder
                            }
                        }
                    } else {
                        posterPlaceholder
                    }
                }
                .clipped()

            LinearGradient(
                colors: [.clear, .black.opacity(0.55)],
                startPoint: .center,
                endPoint: .bottom
            )
            .frame(height: 168)
            .allowsHitTesting(false)

            HStack {
                playBadge
                Spacer()
                if let ms = post.durationMs {
                    Text(MediaFormatters.duration(ms / 1000))
                        .font(.caption.weight(.bold).monospacedDigit())
                        .foregroundStyle(.white)
                        .padding(.horizontal, 10)
                        .frame(height: 28)
                        .background(.black.opacity(0.45), in: Capsule())
                        .overlay {
                            if theme.usesMemphisChrome {
                                Capsule().stroke(.white.opacity(0.35), lineWidth: 1)
                            }
                        }
                }
            }
            .padding(12)
        }
    }

    private var posterPlaceholder: some View {
        VStack(spacing: 10) {
            Text(String(post.title.prefix(1)))
                .font(.system(size: 42, weight: .black, design: .rounded))
                .foregroundStyle(.white.opacity(0.9))
            Image(systemName: "play.rectangle.fill")
                .font(.title3)
                .foregroundStyle(.white.opacity(0.7))
        }
    }

    private var playBadge: some View {
        HStack(spacing: 6) {
            Image(systemName: "play.fill")
            Text("播放")
                .font(.caption.weight(.bold))
        }
        .foregroundStyle(theme.usesMemphisChrome ? theme.ink : .white)
        .padding(.horizontal, 12)
        .frame(height: 32)
        .background(
            Capsule().fill(theme.usesMemphisChrome ? sticker : Color.white.opacity(0.22))
        )
        .overlay {
            if theme.usesMemphisChrome {
                Capsule().stroke(theme.ink.opacity(0.7), lineWidth: 1.2)
            }
        }
    }

    private var meta: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(post.title)
                    .font(.headline)
                    .foregroundStyle(theme.textPrimary)
                    .lineLimit(2)
                Spacer(minLength: 8)
                if theme.usesMemphisChrome {
                    Circle()
                        .fill(sticker)
                        .frame(width: 10, height: 10)
                        .overlay(Circle().stroke(theme.ink.opacity(0.5), lineWidth: 1))
                }
            }
            if !post.caption.isEmpty {
                Text(post.caption)
                    .font(.subheadline)
                    .foregroundStyle(theme.textSecondary)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 8) {
                Label(post.authorName, systemImage: "person.fill")
                Spacer()
                Text(dateLabel)
                    .font(.caption2)
                    .foregroundStyle(theme.textTertiary)
            }
            .font(.caption.weight(.medium))
            .foregroundStyle(theme.textSecondary)
        }
        .padding(14)
        .background(
            theme.usesMemphisChrome
                ? sticker.opacity(0.08)
                : theme.inset.opacity(0.35)
        )
    }

    private var dateLabel: String {
        let raw = post.createdAt
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = formatter.date(from: raw) ?? ISO8601DateFormatter().date(from: raw)
        guard let date else { return String(raw.prefix(10)) }
        let out = DateFormatter()
        out.locale = Locale(identifier: "zh_CN")
        out.dateFormat = "M月d日"
        return out.string(from: date)
    }
}

// MARK: - Player

private struct CommunityPlayerSheet: View {
    let post: CommunityPostDTO
    @Environment(\.dismiss) private var dismiss
    @Environment(\.theme) private var theme
    @State private var player: AVPlayer?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ZStack {
                    theme.videoWell.ignoresSafeArea(edges: .bottom)
                    if let player {
                        VideoPlayer(player: player)
                    } else {
                        ProgressView("准备播放…")
                            .tint(.white)
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(minHeight: 280)

                VStack(alignment: .leading, spacing: 10) {
                    Text(post.title)
                        .font(.headline)
                        .foregroundStyle(theme.textPrimary)
                    if !post.caption.isEmpty {
                        Text(post.caption)
                            .font(.subheadline)
                            .foregroundStyle(theme.textSecondary)
                    }
                    HStack {
                        Label(post.authorName, systemImage: "person.fill")
                        if let ms = post.durationMs {
                            Label(MediaFormatters.duration(ms / 1000), systemImage: "clock")
                        }
                    }
                    .font(.caption)
                    .foregroundStyle(theme.textTertiary)
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.surface)
            }
            .background(theme.canvas.ignoresSafeArea())
            .navigationTitle("作品")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭") { dismiss() }
                        .frame(minWidth: 44, minHeight: 44)
                }
            }
            .task {
                // Cookie 会话由 URLSession 持有；AVPlayer 多数情况可用。
                // 若生产 Range 不带 Cookie，应改为先下载到本地再播放。
                if let url = URL(string: post.videoUrl) {
                    player = AVPlayer(url: url)
                    player?.play()
                }
            }
            .onDisappear { player?.pause() }
        }
    }
}
