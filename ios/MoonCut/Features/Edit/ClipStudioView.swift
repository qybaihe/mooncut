import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

struct ClipStudioView: View {
    @Bindable var model: ClipStudioViewModel
    @Environment(AppEnvironment.self) private var env
    @Environment(\.theme) private var theme
    @State private var pickerItem: PhotosPickerItem?
    @State private var showsFileImporter = false
    @State private var publishCaption = ""
    @State private var showsPublish = false

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 16) {
                if theme.usesMemphisChrome {
                    MemphisAccentShape()
                        .frame(maxWidth: .infinity, alignment: .trailing)
                        .frame(height: 24)
                }

                switch model.stage {
                case .empty:
                    emptyStage
                case .ready:
                    readyStage
                case .uploading, .queued, .processing, .downloading:
                    processingStage
                case .done:
                    doneStage
                case .failed:
                    failedStage
                }

                if let error = model.errorMessage, model.stage != .failed {
                    ErrorBanner(
                        message: error,
                        diagnostic: model.errorDiagnostic,
                        onRetry: model.retry
                    )
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 28)
        }
        .background(theme.canvas.ignoresSafeArea())
        .navigationTitle("剪辑")
        .navigationBarTitleDisplayMode(.inline)
        .fileImporter(
            isPresented: $showsFileImporter,
            allowedContentTypes: [.movie, .mpeg4Movie, .quickTimeMovie],
            allowsMultipleSelection: false
        ) { result in
            switch result {
            case .success(let urls):
                if let url = urls.first { model.importVideo(from: url) }
            case .failure:
                model.errorMessage = "没有读取到视频"
            }
        }
        .onChange(of: pickerItem) { _, item in
            guard let item else { return }
            Task {
                model.isImporting = true
                defer { model.isImporting = false }
                do {
                    guard let movie = try await item.loadTransferable(type: ImportedMovie.self) else {
                        model.errorMessage = "没有读取到视频"
                        return
                    }
                    model.importVideo(from: movie.url, alreadyManaged: true)
                } catch {
                    model.errorMessage = "视频读取失败，请换一个试试"
                }
                pickerItem = nil
            }
        }
        .onAppear { model.onAppear() }
        .overlay(alignment: .bottom) {
            ToastView(message: model.toast)
                .padding(.bottom, 16)
        }
        .sheet(isPresented: $showsPublish) {
            publishSheet
                .presentationDetents([.medium])
        }
        .accessibilityIdentifier("edit-screen")
    }

    private var emptyStage: some View {
        VStack(spacing: 16) {
            ContentUnavailableView(
                "选择一条口播素材",
                systemImage: "square.and.arrow.up",
                description: Text("相册或文件中的 MP4 / MOV。将上传到真实服务进行剪辑，不会伪造进度。")
            )
            PhotosPicker(selection: $pickerItem, matching: .videos) {
                Label("从相册选择", systemImage: "photo.on.rectangle")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(model.isImporting)

            Button { showsFileImporter = true } label: {
                Label("浏览文件", systemImage: "folder")
            }
            .buttonStyle(SecondaryButtonStyle())
        }
        .padding(16)
        .moonCard()
    }

    private var readyStage: some View {
        VStack(alignment: .leading, spacing: 14) {
            FlowStepper(labels: ["素材", "上传", "成片"], current: 0)
            if let asset = model.asset {
                VideoSurface(url: asset.url, label: "原片", isProcessed: false)
                LabeledContent("文件", value: asset.name)
                LabeledContent("大小", value: asset.sizeLabel)
                if let duration = asset.durationLabel {
                    LabeledContent("时长", value: duration)
                }
            }
            TextField("标题", text: $model.title)
                .padding(10)
                .background(theme.inset, in: RoundedRectangle(cornerRadius: 10))
            TextField("剪辑提示", text: $model.prompt, axis: .vertical)
                .lineLimit(3...6)
                .padding(10)
                .background(theme.inset, in: RoundedRectangle(cornerRadius: 10))
            Picker("配图", selection: $model.imageGeneration) {
                Text("自动").tag("auto")
                Text("关闭").tag("off")
            }
            .pickerStyle(.segmented)

            Button {
                model.startProcessing()
            } label: {
                Label("上传并创建真实任务", systemImage: "icloud.and.arrow.up")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(PrimaryButtonStyle())
            .accessibilityIdentifier("edit-start")

            Button("更换素材") { model.reset() }
                .buttonStyle(SecondaryButtonStyle())
        }
        .padding(16)
        .moonCard()
    }

    private var processingStage: some View {
        VStack(alignment: .leading, spacing: 14) {
            FlowStepper(labels: ["素材", "上传", "成片"], current: model.stage == .uploading ? 1 : 2)
            StatusPill(text: model.stageLabel, symbol: "gearshape.2", tint: theme.accent)
            if model.progressIndeterminate || model.progress == nil {
                ProgressView()
                    .frame(maxWidth: .infinity)
                Text("不确定，仍在等待服务更新")
                    .font(.caption)
                    .foregroundStyle(theme.textSecondary)
            } else {
                ProgressView(value: model.progress ?? 0)
                Text(MediaFormatters.progressPercent(model.progress))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(theme.textSecondary)
            }
            if let job = model.job {
                LabeledContent("任务", value: String(job.id.prefix(12)) + "…")
                LabeledContent("状态", value: job.status.rawValue)
            }
            Text("进度仅来自服务端 status/stage/progress，不会本地自增。")
                .font(.caption2)
                .foregroundStyle(theme.textTertiary)
        }
        .padding(16)
        .moonCard()
        .accessibilityIdentifier("edit-processing")
    }

    private var doneStage: some View {
        VStack(alignment: .leading, spacing: 14) {
            FlowStepper(labels: ["素材", "上传", "成片"], current: 3)
            Picker("预览", selection: $model.previewMode) {
                ForEach(PreviewMode.allCases) { mode in
                    Text(mode.rawValue).tag(mode)
                }
            }
            .pickerStyle(.segmented)

            let playURL: URL? = {
                switch model.previewMode {
                case .before: return model.asset?.url
                case .after: return model.localResultURL
                }
            }()
            VideoSurface(
                url: playURL,
                label: model.previewMode == .after ? "成片（已下载）" : "原片",
                isProcessed: model.previewMode == .after
            )

            if let job = model.job {
                if let summary = job.result?.summary, !summary.isEmpty {
                    Text(summary)
                        .font(.subheadline)
                        .foregroundStyle(theme.textSecondary)
                }
                if let quality = job.result?.quality?.ok {
                    StatusPill(
                        text: quality ? "质检通过" : "质检未通过",
                        symbol: quality ? "checkmark.seal" : "xmark.seal",
                        tint: quality ? theme.success : theme.warning
                    )
                }
            }

            if let url = model.localResultURL, FileManager.default.fileExists(atPath: url.path) {
                ShareLink(item: url) {
                    Label("分享成片", systemImage: "square.and.arrow.up")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(PrimaryButtonStyle())

                if model.job?.result?.quality?.ok == true {
                    Button("发布到社区") { showsPublish = true }
                        .buttonStyle(SecondaryButtonStyle())
                        .accessibilityIdentifier("edit-publish")
                } else {
                    Text("质检未通过或结果未知时不显示发布入口。")
                        .font(.caption)
                        .foregroundStyle(theme.textTertiary)
                }
            } else {
                ErrorBanner(
                    message: model.errorMessage ?? "成片尚未下载到本地，无法分享",
                    diagnostic: model.errorDiagnostic,
                    retryTitle: "重新下载",
                    onRetry: {
                        if let id = model.job?.id {
                            Task { await model.restoreJob(id: id) }
                        }
                    }
                )
            }

            Button("再剪一条") { model.reset() }
                .buttonStyle(SecondaryButtonStyle())
        }
        .padding(16)
        .moonCard()
    }

    private var failedStage: some View {
        VStack(alignment: .leading, spacing: 14) {
            ContentUnavailableView(
                "任务失败",
                systemImage: "exclamationmark.triangle",
                description: Text(model.errorMessage ?? "服务返回失败")
            )
            if let diagnostic = model.errorDiagnostic {
                Text("诊断：\(diagnostic)")
                    .font(.caption.monospaced())
                    .foregroundStyle(theme.textTertiary)
            }
            Button("重试真实请求") { model.retry() }
                .buttonStyle(PrimaryButtonStyle())
                .accessibilityIdentifier("edit-retry")
            Button("保留素材，返回设置") {
                model.stage = .ready
                model.errorMessage = nil
            }
            .buttonStyle(SecondaryButtonStyle())
        }
        .padding(16)
        .moonCard()
        .accessibilityIdentifier("edit-failed")
    }

    private var publishSheet: some View {
        NavigationStack {
            Form {
                TextField("说明", text: $publishCaption, axis: .vertical)
                Button("确认发布") {
                    Task {
                        await model.publishToCommunity(
                            authorName: env.user?.email.split(separator: "@").first.map(String.init),
                            caption: publishCaption
                        )
                        showsPublish = false
                    }
                }
            }
            .navigationTitle("发布社区")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
