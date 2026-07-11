import AVFoundation
import CoreTransferable
import Foundation
import UniformTypeIdentifiers

enum VideoFileStore {
    static var directory: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("MoonCutVideos", isDirectory: true)
    }

    static var downloadsDirectory: URL {
        directory.appendingPathComponent("Downloads", isDirectory: true)
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

        if FileManager.default.fileExists(atPath: destination.path) {
            try FileManager.default.removeItem(at: destination)
        }
        try FileManager.default.copyItem(at: sourceURL, to: destination)
        return destination
    }

    static func sizeLabel(for url: URL) -> String {
        guard let values = try? url.resourceValues(forKeys: [.fileSizeKey]), let bytes = values.fileSize else {
            return "本地视频"
        }
        return MediaFormatters.byteCount(bytes)
    }

    static func byteSize(for url: URL) -> Int? {
        (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize
    }

    static func durationSeconds(for url: URL) async -> Double? {
        let asset = AVURLAsset(url: url)
        do {
            let duration = try await asset.load(.duration)
            return CMTimeGetSeconds(duration)
        } catch {
            return nil
        }
    }

    static func contentType(for url: URL) -> String {
        switch url.pathExtension.lowercased() {
        case "mp4", "m4v": return "video/mp4"
        case "mov": return "video/quicktime"
        default: return "application/octet-stream"
        }
    }

    static func remove(_ url: URL?) {
        guard let url, url.path.hasPrefix(directory.path) else { return }
        try? FileManager.default.removeItem(at: url)
    }

    static func downloadDestination(jobId: String, ext: String = "mp4") throws -> URL {
        try FileManager.default.createDirectory(at: downloadsDirectory, withIntermediateDirectories: true)
        return downloadsDirectory
            .appendingPathComponent("job-\(jobId)")
            .appendingPathExtension(ext)
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
