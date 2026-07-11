import AVKit
import SwiftUI

struct VideoSurface: View {
    let url: URL?
    var label: String = "视频"
    var isProcessed = false
    @Environment(\.theme) private var theme
    @State private var player: AVPlayer?

    var body: some View {
        ZStack {
            theme.videoWell

            if let player {
                VideoPlayer(player: player)
            } else {
                ContentUnavailableView("无可播放文件", systemImage: "video.slash", description: Text("需要真实本地成片或原片路径"))
                    .foregroundStyle(.white)
            }

            LinearGradient(
                colors: [.clear, .black.opacity(isProcessed ? 0.35 : 0.12)],
                startPoint: .center,
                endPoint: .bottom
            )
            .allowsHitTesting(false)
        }
        .frame(minHeight: 220)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(isProcessed ? theme.accent.opacity(0.75) : theme.hairline, lineWidth: isProcessed ? 1.5 : 1)
        )
        .overlay(alignment: .topLeading) {
            StatusPill(
                text: label,
                symbol: isProcessed ? "sparkles" : "video.fill",
                tint: isProcessed ? theme.accent : .white
            )
            .padding(12)
        }
        .task(id: url?.absoluteString) {
            player?.pause()
            if let url, FileManager.default.fileExists(atPath: url.path) {
                player = AVPlayer(url: url)
            } else {
                player = nil
            }
        }
        .onDisappear { player?.pause() }
    }
}
