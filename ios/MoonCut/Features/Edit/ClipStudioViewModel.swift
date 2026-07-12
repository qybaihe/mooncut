import Foundation
import Observation

@MainActor
@Observable
final class ClipStudioViewModel {
    var stage: ClipStage = .empty
    var asset: VideoAsset?
    var job: EditJobDTO?
    var localResultURL: URL?
    var progress: Double?
    var stageLabel: String = ""
    var progressIndeterminate = false
    var previewMode: PreviewMode = .after
    var title: String = ""
    var prompt: String = "按默认原生规范剪辑，突出口播重点"
    var imageGeneration: String = "auto"
    var isImporting = false
    var errorMessage: String?
    var errorDiagnostic: String?
    var toast = ""

    private let api: MoonCutAPIClient
    private let env: AppEnvironment
    private var pollTask: Task<Void, Never>?
    private var toastTask: Task<Void, Never>?

    init(api: MoonCutAPIClient, env: AppEnvironment) {
        self.api = api
        self.env = env
    }

    func onAppear() {
        if let jobId = env.activeJobId, job == nil {
            Task { await restoreJob(id: jobId) }
        }
        syncPet()
    }

    func importVideo(from url: URL, alreadyManaged: Bool = false) {
        isImporting = true
        defer { isImporting = false }
        errorMessage = nil
        do {
            let localURL = alreadyManaged ? url : try VideoFileStore.importVideo(from: url)
            let size = VideoFileStore.sizeLabel(for: localURL)
            replaceAsset(
                VideoAsset(
                    name: url.lastPathComponent.isEmpty ? "本地视频.mov" : url.lastPathComponent,
                    sizeLabel: size,
                    url: localURL,
                    source: .upload
                )
            )
            Task {
                if let seconds = await VideoFileStore.durationSeconds(for: localURL) {
                    let label = MediaFormatters.duration(seconds)
                    if var current = asset, current.url == localURL {
                        current = VideoAsset(
                            id: current.id,
                            name: current.name,
                            sizeLabel: current.sizeLabel,
                            url: current.url,
                            durationLabel: label,
                            durationSeconds: seconds,
                            source: current.source
                        )
                        asset = current
                    }
                }
            }
        } catch {
            errorMessage = "视频读取失败，请换一个文件试试"
            env.pet.apply(.permissionOrNetworkFailure)
        }
    }

    func receiveRecording(_ asset: VideoAsset) {
        guard asset.isPlayable else {
            errorMessage = "录制文件不存在，无法交给剪辑"
            return
        }
        replaceAsset(asset)
    }

    func replaceAsset(_ newAsset: VideoAsset) {
        pollTask?.cancel()
        if asset?.url != newAsset.url { VideoFileStore.remove(asset?.url) }
        asset = newAsset
        stage = .ready
        progress = nil
        progressIndeterminate = false
        job = nil
        localResultURL = nil
        previewMode = .after
        if title.isEmpty {
            title = newAsset.name
        }
        syncPet()
    }

    func reset() {
        pollTask?.cancel()
        VideoFileStore.remove(asset?.url)
        VideoFileStore.remove(localResultURL)
        asset = nil
        job = nil
        localResultURL = nil
        stage = .empty
        progress = nil
        env.activeJobId = nil
        errorMessage = nil
        syncPet()
    }

    func startProcessing() {
        guard let asset, let url = asset.url, asset.isPlayable else {
            errorMessage = "请先选择可播放的真实视频素材"
            return
        }
        pollTask?.cancel()
        errorMessage = nil
        errorDiagnostic = nil
        stage = .uploading
        progress = nil
        progressIndeterminate = true
        stageLabel = "上传素材"
        env.pet.apply(.uploading)
        syncPet()

        pollTask = Task { [weak self] in
            guard let self else { return }
            do {
                let filename = asset.name.isEmpty ? url.lastPathComponent : asset.name
                let contentType = VideoFileStore.contentType(for: url)
                let uploaded = try await api.uploadAsset(
                    fileURL: url,
                    filename: filename,
                    contentType: contentType
                )
                guard !Task.isCancelled else { return }

                stage = .queued
                stageLabel = "创建任务"
                env.pet.apply(.jobQueued)

                let created = try await api.createEditJob(
                    assetId: uploaded.assetId,
                    title: title.isEmpty ? nil : title,
                    prompt: prompt.isEmpty ? nil : prompt,
                    imageGeneration: imageGeneration,
                    billingEstimateSeconds: max(1, Int(ceil(asset.durationSeconds ?? 60)))
                )
                guard !Task.isCancelled else { return }

                env.activeJobId = created.id
                stage = .processing
                progressIndeterminate = true
                progress = nil
                stageLabel = "排队中"
                await pollLoop(jobId: created.id)
            } catch is CancellationError {
                return
            } catch {
                await fail(error)
            }
        }
    }

    func restoreJob(id: String) async {
        stage = .processing
        progressIndeterminate = true
        stageLabel = "恢复任务"
        env.pet.apply(.jobRunning)
        do {
            let job = try await api.getEditJob(id: id)
            applyJob(job)
            if job.status == .queued || job.status == .running {
                await pollLoop(jobId: id)
            } else if job.status == .completed {
                await downloadIfNeeded(job)
            }
        } catch {
            await fail(error)
        }
    }

    /// 失败任务「重试」：对已 failed 的 job 重新上传并创建新任务；进行中的才恢复轮询。
    func retry() {
        if let job, job.status == .failed || stage == .failed {
            // 保留本地素材，重新走上传 + 创建
            env.activeJobId = nil
            self.job = nil
            localResultURL = nil
            errorMessage = nil
            errorDiagnostic = nil
            progress = nil
            if asset?.isPlayable == true {
                stage = .ready
                startProcessing()
            } else {
                stage = .empty
                errorMessage = "没有可重试的本地素材，请重新选择视频"
            }
            return
        }
        if let id = env.activeJobId ?? job?.id, job?.status == .queued || job?.status == .running {
            Task { await restoreJob(id: id) }
            return
        }
        startProcessing()
    }

    func publishToCommunity(authorName: String?, caption: String?) async {
        guard let job, job.status == .completed, job.result?.quality?.ok == true else {
            errorMessage = "仅质检通过的完成任务可发布到社区"
            return
        }
        do {
            _ = try await api.publishCommunityPost(
                CommunityPublishRequest(
                    jobId: job.id,
                    authorName: authorName,
                    title: title.isEmpty ? job.originalName : title,
                    caption: caption
                )
            )
            showToast("已发布到社区")
            env.pet.apply(.jobCompleted)
        } catch {
            await fail(error)
        }
    }

    private func pollLoop(jobId: String) async {
        var transientFailures = 0
        while !Task.isCancelled {
            do {
                let job = try await api.getEditJob(id: jobId)
                transientFailures = 0
                applyJob(job)
                switch job.status {
                case .completed:
                    await downloadIfNeeded(job)
                    return
                case .failed:
                    stage = .failed
                    errorMessage = job.error ?? "任务失败"
                    env.pet.apply(.jobFailed)
                    return
                case .queued, .running, .unknown:
                    try await Task.sleep(nanoseconds: UInt64(api.configuration.pollInterval * 1_000_000_000))
                }
            } catch is CancellationError {
                return
            } catch let error as APIError {
                // 永久错误：停止轮询，给出可操作失败
                switch error {
                case .unauthorized, .forbidden, .notFound, .payloadTooLarge, .unsupportedMedia, .decoding, .notConfigured, .invalidURL, .certificateUntrusted:
                    await fail(error)
                    return
                case .offline, .rateLimited, .transport, .server, .cancelled, .invalidResponse:
                    transientFailures += 1
                    if transientFailures >= 8 {
                        await fail(error)
                        return
                    }
                    progressIndeterminate = true
                    stageLabel = "不确定，仍在等待服务更新"
                    progress = nil
                    try? await Task.sleep(nanoseconds: UInt64(api.configuration.pollInterval * 1_000_000_000))
                }
            } catch {
                transientFailures += 1
                if transientFailures >= 8 {
                    await fail(error)
                    return
                }
                progressIndeterminate = true
                stageLabel = "不确定，仍在等待服务更新"
                progress = nil
                try? await Task.sleep(nanoseconds: UInt64(api.configuration.pollInterval * 1_000_000_000))
            }
        }
    }

    private func applyJob(_ job: EditJobDTO) {
        self.job = job
        env.activeJobId = job.id
        stageLabel = JobStageCopy.title(for: job.stage)
        if let p = job.progress {
            progress = min(1, max(0, p))
            progressIndeterminate = false
        } else {
            progress = nil
            progressIndeterminate = true
        }
        switch job.status {
        case .queued:
            stage = .queued
            env.pet.apply(.jobQueued)
        case .running:
            stage = .processing
            env.pet.apply(.jobRunning)
        case .completed:
            stage = .downloading
        case .failed:
            stage = .failed
            errorMessage = job.error ?? "任务失败"
            env.pet.apply(.jobFailed)
        case .unknown:
            stage = .processing
        }
    }

    private func downloadIfNeeded(_ job: EditJobDTO) async {
        stage = .downloading
        progressIndeterminate = true
        stageLabel = "下载成片"
        env.pet.apply(.jobDownloading)
        do {
            let destination = try VideoFileStore.downloadDestination(jobId: job.id)
            if FileManager.default.fileExists(atPath: destination.path),
               (try? destination.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0 > 0 {
                localResultURL = destination
            } else {
                localResultURL = try await api.downloadArtifact(jobId: job.id, name: "video", to: destination)
            }
            stage = .done
            previewMode = .after
            progress = 1
            progressIndeterminate = false
            stageLabel = "已完成"
            env.pet.apply(.jobCompleted)
            showToast("成片已就绪")
        } catch {
            // 完成但下载失败：仍可尝试远程信息，明确告知
            stage = .done
            errorMessage = "任务已完成，但成片下载失败：\((error as? APIError)?.errorDescription ?? error.localizedDescription)"
            env.pet.apply(.jobFailed)
        }
    }

    private func fail(_ error: Error) async {
        stage = stage == .ready || stage == .empty ? stage : .failed
        if stage != .failed && stage != .ready { stage = .failed }
        if let apiError = error as? APIError {
            errorMessage = apiError.errorDescription
            errorDiagnostic = apiError.diagnosticCode
            if apiError == .unauthorized {
                env.handleAPIError(apiError)
            }
        } else {
            errorMessage = error.localizedDescription
        }
        env.pet.apply(.permissionOrNetworkFailure)
        syncPet()
    }

    private func syncPet() {
        switch stage {
        case .empty: env.pet.apply(.emptyWorkspace)
        case .ready: env.pet.apply(.idle)
        case .uploading: env.pet.apply(.uploading)
        case .queued: env.pet.apply(.jobQueued)
        case .processing: env.pet.apply(.jobRunning)
        case .downloading: env.pet.apply(.jobDownloading)
        case .done: env.pet.apply(.jobCompleted)
        case .failed: env.pet.apply(.jobFailed)
        }
    }

    func showToast(_ message: String) {
        toastTask?.cancel()
        toast = message
        toastTask = Task {
            try? await Task.sleep(nanoseconds: 2_600_000_000)
            guard !Task.isCancelled else { return }
            toast = ""
        }
    }

    func cancelTasks() {
        pollTask?.cancel()
        toastTask?.cancel()
    }
}
