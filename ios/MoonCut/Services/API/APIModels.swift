import Foundation

// MARK: - Auth

struct AuthUserDTO: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let email: String
    let createdAt: String
}

struct AuthUserEnvelope: Codable, Sendable {
    let user: AuthUserDTO?
}

struct AuthLoginEnvelope: Codable, Sendable {
    let user: AuthUserDTO
}

// MARK: - Health

struct HealthzDTO: Codable, Sendable {
    let ok: Bool
    let service: String?
    let plannerModel: String?
    let visionModels: [String]?
    let imageGenerationConfigured: Bool?
    let communityPosts: Int?
    let gatewayReachable: Bool?
}

// MARK: - Assets / Jobs

struct AssetUploadResponse: Codable, Sendable {
    let assetId: String
    let filename: String?
    let bytes: Int?
}

struct EditJobCreateResponse: Codable, Sendable {
    let id: String
    let status: String
    let statusUrl: String?
    let videoUrl: String?
    let assetId: String?
}

struct EditJobDTO: Codable, Equatable, Sendable, Identifiable {
    let id: String
    let originalName: String?
    let status: JobStatus
    let stage: String?
    let progress: Double?
    let error: String?
    let request: EditJobRequestDTO?
    let result: EditJobResultDTO?
    let createdAt: String?
    let updatedAt: String?
}

struct EditJobRequestDTO: Codable, Equatable, Sendable {
    let imageGeneration: String?
    let title: String?
    let prompt: String?
}

struct EditJobResultDTO: Codable, Equatable, Sendable {
    let summary: String?
    let artifacts: [String: String]?
    let probe: MediaProbeDTO?
    let quality: QualityDTO?
    let models: JobModelsDTO?
}

struct MediaProbeDTO: Codable, Equatable, Sendable {
    let durationMs: Double?
    let width: Int?
    let height: Int?
    let hasAudio: Bool?
}

struct QualityDTO: Codable, Equatable, Sendable {
    let ok: Bool?
}

struct JobModelsDTO: Codable, Equatable, Sendable {
    let planner: String?
    let vision: String?
    let image: String?
}

enum JobStatus: String, Codable, Sendable {
    case queued
    case running
    case completed
    case failed
    case unknown

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = JobStatus(rawValue: raw) ?? .unknown
    }
}

// MARK: - Queue

struct RenderQueueSnapshotDTO: Codable, Sendable {
    let updatedAt: String?
    let summary: RenderQueueSummaryDTO?
    let active: [RenderQueueItemDTO]
    let recent: [RenderQueueItemDTO]
}

struct RenderQueueSummaryDTO: Codable, Sendable {
    let running: Int
    let queued: Int
    let completedToday: Int
}

struct RenderQueueItemDTO: Codable, Identifiable, Sendable, Equatable {
    var id: String { "\(name)-\(createdAt)-\(status)" }
    let name: String
    let status: String
    let stage: String
    let progress: Double
    let createdAt: String
    let updatedAt: String
    let queuePosition: Int?
    let mine: Bool
}

// MARK: - Assistant

struct ScriptMessageDTO: Codable, Sendable, Equatable {
    let role: String
    let content: String
}

struct ScriptAssistantRequest: Codable, Sendable {
    var action: String?
    var style: String?
    var messages: [ScriptMessageDTO]
    var draft: String?
}

struct ScriptSuggestionDTO: Codable, Sendable, Equatable, Identifiable {
    var id: String { "\(eyebrow)-\(title)" }
    let eyebrow: String
    let title: String
    let detail: String
}

struct ScriptAssistantResponseDTO: Codable, Sendable {
    let reply: String
    let phase: String?
    let ready: Bool?
    let draft: String?
    let petMessage: String?
    let suggestions: [ScriptSuggestionDTO]?
    let model: String?
}

struct CoachMetricsDTO: Codable, Sendable {
    let pace: Double
    let wordCount: Int
    let volume: Double
    let pauseCount: Int
    let eyeContact: Double?
    let elapsedSeconds: Double
}

struct CoachAdviceRequest: Codable, Sendable {
    let transcript: String
    let currentScript: String
    let currentSentence: String
    let lastAdvice: String?
    let metrics: CoachMetricsDTO
}

struct CoachAdviceResponseDTO: Codable, Sendable {
    let category: String?
    let advice: String
    let petMessage: String?
    let positive: Bool?
    let model: String?
}

// MARK: - Community

struct CommunityPostDTO: Codable, Identifiable, Sendable, Equatable {
    let id: String
    let authorName: String
    let title: String
    let caption: String
    let durationMs: Double?
    let width: Int?
    let height: Int?
    let createdAt: String
    let videoUrl: String
    let posterUrl: String?
}

struct CommunityListResponse: Codable, Sendable {
    let items: [CommunityPostDTO]
    let nextCursor: String?
}

struct CommunityPublishRequest: Codable, Sendable {
    let jobId: String
    var authorName: String?
    var title: String?
    var caption: String?
}

struct CommunityPublishResponse: Codable, Sendable {
    let created: Bool?
    let post: CommunityPostDTO
}

// MARK: - Server error body

struct APIErrorBody: Codable, Sendable {
    let error: String?
    let code: String?
    let requestId: String?
    let message: String?
}

// MARK: - Stage localization

enum JobStageCopy {
    static func title(for stage: String?) -> String {
        switch stage {
        case "inspecting-source", "preparing-source": return "检查素材"
        case "transcribing": return "转写口播"
        case "scheduling-visuals": return "素材调度"
        case "researching-x", "browsing-web": return "检索参考"
        case "tracking-speaker": return "跟脸取景"
        case "planning-edit": return "编排分镜"
        case "rendering": return "渲染成片"
        case "visual-quality-review", "verifying": return "质检"
        case "verified": return "质检通过"
        case "completed": return "已完成"
        case "failed": return "任务失败"
        case "interrupted": return "任务中断"
        case "queued", nil, "": return "排队中"
        default: return stage ?? "处理中"
        }
    }
}
