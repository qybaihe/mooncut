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

enum AuthOTPPurpose: String, Codable, Sendable {
    case login
    case register
}

struct AuthOTPSendRequest: Codable, Sendable {
    let email: String
    let purpose: AuthOTPPurpose
}

struct AuthOTPSendResponse: Codable, Sendable {
    let ok: Bool
    let email: String
    let purpose: AuthOTPPurpose
    let expiresInSec: Int
    let resendAfterSec: Int
}

struct AuthOTPVerifyRequest: Codable, Sendable {
    let email: String
    let code: String
    let password: String?
    let purpose: AuthOTPPurpose
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

// MARK: - Billing

enum BillingPlanID: String, Codable, CaseIterable, Sendable {
    case free
    case creator
    case pro
}

struct BillingSummaryDTO: Codable, Sendable {
    let account: BillingAccountDTO
    let usage: BillingUsageDTO
    let limits: BillingLimitsDTO
    let upgradePrompt: BillingUpgradePromptDTO?
    let checkoutRequests: [BillingCheckoutRecordDTO]
    let plans: [BillingPlanDTO]
}

struct BillingAccountDTO: Codable, Sendable {
    let plan: BillingPlanID
    let planLabel: String
    let subscriptionStatus: String
    let periodStartedAt: String
    let periodEndsAt: String?
    let cancelAtPeriodEnd: Bool
    let exportQuality: String
    let maxParallelJobs: Int
}

struct BillingUsageDTO: Codable, Sendable {
    let videoGenerations: BillingMeterDTO
    let smartMinutes: BillingMeterDTO
    let creativePoints: BillingMeterDTO
}

struct BillingMeterDTO: Codable, Sendable {
    let used: Int
    let completed: Int?
    let inProgress: Int?
    let limit: Int?
    let remaining: Int?
}

struct BillingLimitsDTO: Codable, Sendable {
    let maxSourceSeconds: Int?
    let checkoutConfigured: Bool
}

struct BillingUpgradePromptDTO: Codable, Sendable {
    let level: String
    let title: String
    let detail: String
    let recommendedPlan: BillingPlanID
}

struct BillingPlanDTO: Codable, Identifiable, Sendable {
    let id: BillingPlanID
    let label: String
    let priceCny: Int
    let smartMinuteLimit: Int?
    let creativePointLimit: Int
    let exportQuality: String
    let maxParallelJobs: Int
}

struct BillingCheckoutRequest: Codable, Sendable {
    let plan: BillingPlanID
}

struct BillingCheckoutRecordDTO: Codable, Identifiable, Sendable {
    let id: String
    let requestedPlan: BillingPlanID
    let status: String
    let checkoutURL: String?
    let createdAt: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case requestedPlan = "requested_plan"
        case status
        case checkoutURL = "checkout_url"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

struct BillingCheckoutResponseDTO: Codable, Sendable {
    struct Checkout: Codable, Sendable {
        let id: String
        let plan: BillingPlanID
        let status: String
        let checkoutURL: String?
        let createdAt: String

        enum CodingKeys: String, CodingKey {
            case id
            case plan
            case status
            case checkoutURL = "checkoutUrl"
            case createdAt
        }
    }

    let checkout: Checkout
    let message: String
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

struct CommunityPackageListResponseDTO: Codable, Sendable {
    let items: [CommunityRegistryPackageDTO]
}

struct CommunityRegistryPackageDTO: Codable, Identifiable, Sendable {
    struct Publisher: Codable, Sendable {
        let id: String
        let label: String
        let trust: String
    }

    struct Display: Codable, Sendable {
        let name: String
        let tagline: String
        let category: String
    }

    struct Permission: Codable, Identifiable, Sendable {
        var id: String { "\(name)-\(reason)" }
        let name: String
        let reason: String
    }

    struct Release: Codable, Sendable {
        struct Files: Codable, Sendable {
            let package: String
            let manifest: String
            let skill: String
            let connector: String
        }

        let version: String
        let publishedAt: String
        let files: Files
    }

    let slug: String
    let publisher: Publisher
    let display: Display
    let kinds: [String]
    let permissions: [Permission]
    let release: Release

    var id: String { slug }
}

struct CommunityPackageConnectResponseDTO: Codable, Sendable {
    let created: Bool
}

struct CommunityPackageUploadResponseDTO: Codable, Sendable {
    let item: CommunityRegistryPackageDTO
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
