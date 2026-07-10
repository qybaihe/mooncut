import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

struct ClipStudioView: View {
    @ObservedObject var model: ClipStudioViewModel
    @State private var pickerItem: PhotosPickerItem?
    @State private var showsFileImporter = false

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 20) {
                PageIntro(
                    eyebrow: "智能口播剪辑",
                    symbol: "wand.and.stars",
                    title: "把素口播，\n剪成能发的成片。",
                    subtitle: "上传原视频，停顿、废话和字幕节奏交给 MoonCut。"
                )

                switch model.stage {
                case .empty:
                    emptyStage
                case .ready:
                    readyStage
                case .processing:
                    processingStage
                case .done:
                    doneStage
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 22)
            .padding(.bottom, 28)
        }
        .scrollDismissesKeyboard(.interactively)
        .fileImporter(
            isPresented: $showsFileImporter,
            allowedContentTypes: [.movie, .mpeg4Movie, .quickTimeMovie],
            allowsMultipleSelection: false
        ) { result in
            switch result {
            case .success(let urls):
                if let url = urls.first { model.importVideo(from: url) }
            case .failure:
                model.showToast("没有读取到视频")
            }
        }
        .onChange(of: pickerItem) { _, item in
            guard let item else { return }
            Task {
                model.isImporting = true
                defer { model.isImporting = false }
                do {
                    guard let movie = try await item.loadTransferable(type: ImportedMovie.self) else {
                        model.showToast("没有读取到视频")
                        return
                    }
                    model.importVideo(from: movie.url, alreadyManaged: true)
                } catch {
                    model.showToast("视频读取失败，请换一个试试")
                }
                pickerItem = nil
            }
        }
    }

    private var emptyStage: some View {
        VStack(spacing: 16) {
            VStack(spacing: 18) {
                ZStack {
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .fill(MoonColor.accent.opacity(0.08))
                        .frame(width: 92, height: 92)
                    Image(systemName: "square.and.arrow.up")
                        .font(.system(size: 30, weight: .semibold))
                        .foregroundStyle(MoonColor.accent)
                }

                VStack(spacing: 6) {
                    Text("选择一条素口播")
                        .font(.title3.weight(.bold))
                    Text("支持相册与“文件”中的 MP4、MOV 视频")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }

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

                HStack(spacing: 8) {
                    capability("自动删停顿", "scissors")
                    capability("清理重复", "sparkles")
                    capability("节奏字幕", "captions.bubble")
                }
            }
            .padding(20)
            .moonCard()

            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    StatusPill(text: "自然口播模式", symbol: "waveform")
                    Spacer()
                    Text("推荐")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 9)
                        .padding(.vertical, 5)
                        .background(Capsule().fill(MoonColor.accent))
                }
                Text("少一点剪辑感，\n多一点表达力。")
                    .font(.title2.weight(.bold))
                Text("不把每一处呼吸都剪掉，只处理真正影响观看节奏的部分。")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                VStack(spacing: 0) {
                    promiseRow("01", "听懂", "识别完整表达")
                    Divider().padding(.leading, 46)
                    promiseRow("02", "精简", "去掉无效停顿")
                    Divider().padding(.leading, 46)
                    promiseRow("03", "包装", "加上节奏字幕")
                }
                .padding(.horizontal, 12)
                .background(MoonColor.inset, in: RoundedRectangle(cornerRadius: 14, style: .continuous))

                Label("一条 3 分钟口播，演示版约 8 秒完成", systemImage: "bolt.fill")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(20)
            .moonCard()
        }
    }

    private var readyStage: some View {
        VStack(spacing: 16) {
            FlowStepper(labels: ["上传", "智能剪辑", "成片"], current: 0)
                .frame(maxWidth: .infinity, alignment: .leading)

            VStack(spacing: 12) {
                VideoSurface(asset: model.asset)
                    .aspectRatio(9 / 14, contentMode: .fit)
                    .frame(maxHeight: 430)
                fileRow
            }
            .padding(12)
            .moonCard()

            VStack(alignment: .leading, spacing: 16) {
                Text("本次剪辑")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(MoonColor.accent)
                Text("保持你的表达，\n只让节奏更好。")
                    .font(.title2.weight(.bold))

                HStack(spacing: 12) {
                    Image(systemName: "sparkles")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(MoonColor.accent)
                        .frame(width: 44, height: 44)
                        .background(RoundedRectangle(cornerRadius: 12).fill(MoonColor.accent.opacity(0.10)))
                    VStack(alignment: .leading, spacing: 3) {
                        Text("自然口播").font(.headline)
                        Text("轻度精简 · 动态字幕 · 保留语气")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(MoonColor.success)
                }
                .padding(14)
                .background(MoonColor.inset, in: RoundedRectangle(cornerRadius: 14))

                Divider()
                SettingRow(symbol: "captions.bubble", title: "字幕样式") {
                    Menu(model.subtitleStyle.rawValue) {
                        Picker("字幕样式", selection: $model.subtitleStyle) {
                            ForEach(SubtitleStyle.allCases) { style in
                                Text(style.rawValue).tag(style)
                            }
                        }
                    }
                    .font(.subheadline.weight(.semibold))
                }

                Divider()
                VStack(alignment: .leading, spacing: 10) {
                    Label("节奏强度", systemImage: "gauge.medium")
                        .font(.subheadline.weight(.medium))
                    Picker("节奏强度", selection: $model.intensity) {
                        ForEach(RhythmIntensity.allCases) { item in
                            Text(item.rawValue).tag(item)
                        }
                    }
                    .pickerStyle(.segmented)
                }

                Label("当前为本地演示，不会上传视频", systemImage: "lock.fill")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Button { model.startProcessing() } label: {
                    HStack {
                        Text("开始智能剪辑")
                        Spacer()
                        Image(systemName: "arrow.right")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
            }
            .padding(20)
            .moonCard()
        }
    }

    private var processingStage: some View {
        VStack(spacing: 16) {
            FlowStepper(labels: ["上传", "智能剪辑", "成片"], current: 1)

            ZStack {
                VideoSurface(asset: model.asset)
                    .aspectRatio(9 / 11, contentMode: .fit)
                    .frame(maxHeight: 390)
                Rectangle()
                    .fill(
                        LinearGradient(
                            colors: [.clear, MoonColor.accent.opacity(0.5), .clear],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .frame(height: 2)
                    .offset(y: CGFloat(model.progress - 50) * 2.4)
                    .animation(.linear(duration: 0.11), value: model.progress)
                    .allowsHitTesting(false)
            }
            .padding(12)
            .moonCard()

            VStack(alignment: .leading, spacing: 18) {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("AI 正在工作")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(MoonColor.accent)
                        Text(model.processingSteps[model.activeStep].label)
                            .font(.title3.weight(.bold))
                    }
                    Spacer()
                    Text("\(model.progress)")
                        .font(.system(size: 44, weight: .bold, design: .rounded))
                        .contentTransition(.numericText())
                    Text("%")
                        .font(.headline)
                        .foregroundStyle(.secondary)
                }

                ProgressView(value: Double(model.progress), total: 100)
                    .tint(MoonColor.accent)

                VStack(spacing: 0) {
                    ForEach(Array(model.processingSteps.enumerated()), id: \.element.id) { index, step in
                        HStack(spacing: 12) {
                            Image(systemName: index < model.activeStep ? "checkmark.circle.fill" : "\(index + 1).circle.fill")
                                .foregroundStyle(index <= model.activeStep ? MoonColor.accent : Color.secondary.opacity(0.42))
                                .font(.title3)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(step.label).font(.subheadline.weight(.semibold))
                                Text(step.detail).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                        }
                        .padding(.vertical, 11)
                        .opacity(index <= model.activeStep ? 1 : 0.55)
                        if index < model.processingSteps.count - 1 { Divider().padding(.leading, 34) }
                    }
                }

                Label("可以切到录制间，任务会继续运行", systemImage: "clock")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(20)
            .moonCard()
        }
    }

    private var doneStage: some View {
        VStack(spacing: 16) {
            FlowStepper(labels: ["上传", "智能剪辑", "成片"], current: 2)

            VStack(spacing: 12) {
                Picker("预览版本", selection: $model.previewMode) {
                    ForEach(PreviewMode.allCases) { mode in Text(mode.rawValue).tag(mode) }
                }
                .pickerStyle(.segmented)

                VideoSurface(
                    asset: model.asset,
                    processed: model.previewMode == .after,
                    showCaption: model.previewMode == .after
                )
                .aspectRatio(9 / 14, contentMode: .fit)
                .frame(maxHeight: 440)
            }
            .padding(12)
            .moonCard()

            VStack(alignment: .leading, spacing: 18) {
                StatusPill(text: "成片已完成", symbol: "checkmark.circle.fill", color: MoonColor.success)
                Text("节奏更紧了，\n表达还是你的。")
                    .font(.title2.weight(.bold))
                Text("我们保留了自然语气，只清理了真正拖慢内容的部分。")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                HStack(spacing: 0) {
                    metric("12", "处停顿")
                    Divider().frame(height: 44)
                    metric("38秒", "精简时长")
                    Divider().frame(height: 44)
                    metric("24", "个重点词")
                }
                .padding(.vertical, 14)
                .background(MoonColor.inset, in: RoundedRectangle(cornerRadius: 14))

                VStack(alignment: .leading, spacing: 9) {
                    checkLine("1080P 高清")
                    checkLine("节奏字幕已生成")
                    checkLine("原画质保留")
                }

                if let url = model.asset?.url {
                    ShareLink(item: url) {
                        Label("导出成片", systemImage: "square.and.arrow.up")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(PrimaryButtonStyle())
                } else {
                    Button { model.showToast("演示成片已准备好") } label: {
                        Label("导出成片", systemImage: "square.and.arrow.up")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                }

                HStack(spacing: 10) {
                    Button { model.startProcessing() } label: {
                        Label("重新剪一版", systemImage: "arrow.counterclockwise")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    Button { model.reset() } label: {
                        Label("换个视频", systemImage: "xmark")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                }
            }
            .padding(20)
            .moonCard()
        }
    }

    private var fileRow: some View {
        HStack(spacing: 12) {
            Image(systemName: "video.fill")
                .foregroundStyle(MoonColor.accent)
                .frame(width: 38, height: 38)
                .background(RoundedRectangle(cornerRadius: 10).fill(MoonColor.accent.opacity(0.1)))
            VStack(alignment: .leading, spacing: 2) {
                Text(model.asset?.name ?? "本地视频")
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                Text("\(model.asset?.sizeLabel ?? "") · 已准备好")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button("更换") { model.reset() }
                .font(.subheadline.weight(.semibold))
                .frame(minWidth: 44, minHeight: 44)
        }
    }

    private func capability(_ text: String, _ symbol: String) -> some View {
        VStack(spacing: 6) {
            Image(systemName: symbol).foregroundStyle(MoonColor.accent)
            Text(text).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
        }
        .frame(maxWidth: .infinity, minHeight: 58)
        .background(MoonColor.inset, in: RoundedRectangle(cornerRadius: 12))
    }

    private func promiseRow(_ number: String, _ title: String, _ detail: String) -> some View {
        HStack(spacing: 12) {
            Text(number)
                .font(.caption.weight(.bold))
                .foregroundStyle(MoonColor.accent)
                .frame(width: 34)
            Text(title).font(.subheadline.weight(.semibold))
            Text(detail).font(.caption).foregroundStyle(.secondary)
            Spacer()
        }
        .frame(minHeight: 48)
    }

    private func metric(_ value: String, _ label: String) -> some View {
        VStack(spacing: 4) {
            Text(value).font(.title3.weight(.bold))
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    private func checkLine(_ text: String) -> some View {
        Label(text, systemImage: "checkmark")
            .font(.caption)
            .foregroundStyle(.secondary)
            .symbolRenderingMode(.monochrome)
    }
}

#Preview {
    ClipStudioView(model: ClipStudioViewModel())
        .background(MoonColor.canvas)
}
