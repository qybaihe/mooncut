import Foundation

@MainActor
final class ClipStudioViewModel: ObservableObject {
    @Published var stage: ClipStage = .empty
    @Published var asset: VideoAsset?
    @Published var progress = 0
    @Published var previewMode: PreviewMode = .after
    @Published var subtitleStyle: SubtitleStyle = .emphasis
    @Published var intensity: RhythmIntensity = .natural
    @Published var toast = ""
    @Published var isImporting = false

    let processingSteps = DemoContent.processingSteps
    private var processingTask: Task<Void, Never>?
    private var toastTask: Task<Void, Never>?

    var activeStep: Int {
        if progress < 27 { return 0 }
        if progress < 55 { return 1 }
        if progress < 82 { return 2 }
        return 3
    }

    func importVideo(from url: URL, alreadyManaged: Bool = false) {
        isImporting = true
        defer { isImporting = false }

        do {
            let localURL = alreadyManaged ? url : try VideoFileStore.importVideo(from: url)
            replaceAsset(
                VideoAsset(
                    name: url.lastPathComponent.isEmpty ? "本地视频.mov" : url.lastPathComponent,
                    sizeLabel: VideoFileStore.sizeLabel(for: localURL),
                    url: localURL,
                    source: .upload
                )
            )
        } catch {
            showToast("视频读取失败，请换一个文件试试")
        }
    }

    func receiveRecording(_ asset: VideoAsset) {
        replaceAsset(asset)
    }

    func replaceAsset(_ newAsset: VideoAsset) {
        processingTask?.cancel()
        if asset?.url != newAsset.url { VideoFileStore.remove(asset?.url) }
        asset = newAsset
        stage = .ready
        progress = 0
        previewMode = .after
    }

    func reset() {
        processingTask?.cancel()
        VideoFileStore.remove(asset?.url)
        asset = nil
        stage = .empty
        progress = 0
    }

    func startProcessing() {
        guard asset != nil else { return }
        processingTask?.cancel()
        stage = .processing
        progress = 2

        processingTask = Task { [weak self] in
            guard let self else { return }
            while self.progress < 100, !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 110_000_000)
                guard !Task.isCancelled else { return }
                self.progress = min(100, self.progress + (self.progress < 70 ? 2 : 1))
            }
            guard !Task.isCancelled else { return }
            try? await Task.sleep(nanoseconds: 450_000_000)
            guard !Task.isCancelled else { return }
            self.previewMode = .after
            self.stage = .done
        }
    }

    func showToast(_ message: String) {
        toastTask?.cancel()
        toast = message
        toastTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 2_600_000_000)
            guard !Task.isCancelled else { return }
            self?.toast = ""
        }
    }

    deinit {
        processingTask?.cancel()
        toastTask?.cancel()
    }
}

