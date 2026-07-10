import CoreTransferable
import Foundation
import UniformTypeIdentifiers

enum VideoFileStore {
    static var directory: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("MoonCutVideos", isDirectory: true)
    }

    static func importVideo(from sourceURL: URL) throws -> URL {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        let accessed = sourceURL.startAccessingSecurityScopedResource()
        defer {
            if accessed { sourceURL.stopAccessingSecurityScopedResource() }
        }

        let ext = sourceURL.pathExtension.isEmpty ? "mov" : sourceURL.pathExtension
        let destination = directory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension(ext)

        try FileManager.default.copyItem(at: sourceURL, to: destination)
        return destination
    }

    static func sizeLabel(for url: URL) -> String {
        guard let values = try? url.resourceValues(forKeys: [.fileSizeKey]), let bytes = values.fileSize else {
            return "本地视频"
        }
        if bytes < 1_048_576 {
            return "\(max(1, Int((Double(bytes) / 1024).rounded()))) KB"
        }
        return String(format: "%.1f MB", Double(bytes) / 1_048_576)
    }

    static func remove(_ url: URL?) {
        guard let url, url.path.hasPrefix(directory.path) else { return }
        try? FileManager.default.removeItem(at: url)
    }
}

struct ImportedMovie: Transferable, Sendable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .movie) { movie in
            SentTransferredFile(movie.url)
        } importing: { received in
            ImportedMovie(url: try VideoFileStore.importVideo(from: received.file))
        }
    }
}

