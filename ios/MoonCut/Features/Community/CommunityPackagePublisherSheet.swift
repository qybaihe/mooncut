import SwiftUI
import UniformTypeIdentifiers

/// Native counterpart to the Web community-package publish form. It only moves
/// the three declarative files accepted by Pages; no downloaded package code is
/// ever executed by the app.
struct CommunityPackagePublisherSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.theme) private var theme

    let api: MoonCutAPIClient
    let onPublished: () -> Void

    @State private var slug = ""
    @State private var version = "1.0.0"
    @State private var publisherName = ""
    @State private var files: [String: URL] = [:]
    @State private var isPickingFiles = false
    @State private var isPublishing = false
    @State private var errorMessage: String?
    @State private var successMessage: String?

    private var manifestURL: URL? { files["manifest.json"] }
    private var skillURL: URL? { files["skill.md"] }
    private var connectorURL: URL? { files["connector.json"] }
    private var canPublish: Bool {
        validSlug && validVersion && !publisherName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && manifestURL != nil && skillURL != nil && connectorURL != nil && !isPublishing
    }
    private var validSlug: Bool {
        slug.range(of: "^[a-z0-9][a-z0-9-]{2,79}$", options: .regularExpression) != nil
    }
    private var validVersion: Bool {
        version.range(of: "^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$", options: .regularExpression) != nil
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("发布能力包") {
                    Text("与 Web 一样，Pages 只接收 manifest.json、SKILL.md、connector.json。连接操作仅引用审核过的本机 adapter，不会执行下载的代码。")
                        .font(.caption)
                        .foregroundStyle(theme.textSecondary)
                }

                Section("基本信息") {
                    TextField("唯一 slug，例如 my-story-research", text: $slug)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("版本，例如 1.0.0", text: $version)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("发布者名称", text: $publisherName)
                }

                Section("声明文件") {
                    Button {
                        isPickingFiles = true
                    } label: {
                        Label("选择三个声明文件", systemImage: "folder.badge.plus")
                    }
                    fileRow("manifest.json", url: manifestURL)
                    fileRow("SKILL.md", url: skillURL)
                    fileRow("connector.json", url: connectorURL)
                }

                if let errorMessage {
                    Section {
                        ErrorBanner(message: errorMessage, diagnostic: nil, onRetry: publish)
                    }
                }
                if let successMessage {
                    Section {
                        Label(successMessage, systemImage: "checkmark.circle.fill")
                            .foregroundStyle(theme.success)
                    }
                }
            }
            .navigationTitle("发布能力包")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        publish()
                    } label: {
                        if isPublishing { ProgressView() } else { Text("发布") }
                    }
                    .disabled(!canPublish)
                    .accessibilityIdentifier("community-package-publish-submit")
                }
            }
        }
        .fileImporter(
            isPresented: $isPickingFiles,
            allowedContentTypes: [.json, .plainText],
            allowsMultipleSelection: true,
            onCompletion: importFiles
        )
    }

    @ViewBuilder
    private func fileRow(_ expectedName: String, url: URL?) -> some View {
        HStack {
            Text(expectedName)
            Spacer()
            if let url {
                Label(url.lastPathComponent, systemImage: "checkmark.circle.fill")
                    .font(.caption)
                    .foregroundStyle(theme.success)
                    .lineLimit(1)
            } else {
                Text("未选择")
                    .font(.caption)
                    .foregroundStyle(theme.textTertiary)
            }
        }
    }

    private func importFiles(_ result: Result<[URL], Error>) {
        errorMessage = nil
        guard case .success(let urls) = result else {
            if case .failure(let error) = result { errorMessage = error.localizedDescription }
            return
        }
        var imported: [String: URL] = [:]
        for source in urls {
            let filename = source.lastPathComponent.lowercased()
            let key: String?
            switch filename {
            case "manifest.json": key = "manifest.json"
            case "skill.md": key = "skill.md"
            case "connector.json": key = "connector.json"
            default: key = nil
            }
            guard let key else { continue }
            do {
                imported[key] = try copyIntoTemporaryDirectory(source)
            } catch {
                errorMessage = "无法读取 \(source.lastPathComponent)：\(error.localizedDescription)"
                return
            }
        }
        files.merge(imported, uniquingKeysWith: { _, latest in latest })
        if manifestURL == nil || skillURL == nil || connectorURL == nil {
            errorMessage = "请一次选择 manifest.json、SKILL.md 与 connector.json 三个文件。"
        }
    }

    private func copyIntoTemporaryDirectory(_ source: URL) throws -> URL {
        let accessed = source.startAccessingSecurityScopedResource()
        defer {
            if accessed { source.stopAccessingSecurityScopedResource() }
        }
        let folder = FileManager.default.temporaryDirectory
            .appendingPathComponent("MoonCut-Community-Package", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let destination = folder.appendingPathComponent("\(UUID().uuidString)-\(source.lastPathComponent)")
        try FileManager.default.copyItem(at: source, to: destination)
        return destination
    }

    private func publish() {
        guard let manifestURL, let skillURL, let connectorURL, canPublish else { return }
        errorMessage = nil
        successMessage = nil
        isPublishing = true
        Task {
            defer { isPublishing = false }
            do {
                let result = try await api.uploadCommunityPackage(
                    slug: slug.trimmingCharacters(in: .whitespacesAndNewlines),
                    version: version.trimmingCharacters(in: .whitespacesAndNewlines),
                    publisherName: publisherName.trimmingCharacters(in: .whitespacesAndNewlines),
                    manifestURL: manifestURL,
                    skillURL: skillURL,
                    connectorURL: connectorURL
                )
                successMessage = "已发布 \(result.item.display.name) v\(result.item.release.version)"
                onPublished()
            } catch let error as APIError {
                errorMessage = error.errorDescription
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}
