import AVKit
import SwiftUI

struct VideoSurface: View {
    let asset: VideoAsset?
    var processed = false
    var showCaption = false
    @State private var player: AVPlayer?

    var body: some View {
        ZStack {
            Color.black

            if let player {
                VideoPlayer(player: player)
            } else {
                EmptyPersonArtwork(large: true)
                    .foregroundStyle(.white)
            }

            LinearGradient(
                colors: [.clear, .black.opacity(processed ? 0.42 : 0.15)],
                startPoint: .center,
                endPoint: .bottom
            )
            .allowsHitTesting(false)

            if showCaption {
                VStack {
                    Spacer()
                    Text("把素口播，剪成\n**能发的成片**")
                        .font(.system(.title3, design: .rounded, weight: .bold))
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.white)
                        .shadow(color: .black.opacity(0.7), radius: 4, y: 2)
                        .padding(.bottom, 54)
                }
                .padding()
                .allowsHitTesting(false)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(processed ? MoonColor.accent.opacity(0.75) : MoonColor.hairline, lineWidth: processed ? 1.5 : 1)
        )
        .overlay(alignment: .topLeading) {
            StatusPill(
                text: processed ? "MoonCut 成片" : "原片 · 未处理",
                symbol: processed ? "sparkles" : "video.fill",
                color: processed ? MoonColor.accent : .white
            )
            .background(processed ? MoonColor.card.opacity(0.92) : Color.black.opacity(0.48), in: Capsule())
            .padding(12)
        }
        .overlay(alignment: .bottomTrailing) {
            if processed {
                Text("MOONCUT ✦")
                    .font(.caption2.weight(.bold))
                    .tracking(1)
                    .foregroundStyle(.white.opacity(0.88))
                    .padding(12)
                    .allowsHitTesting(false)
            }
        }
        .task(id: asset?.url) {
            player?.pause()
            if let url = asset?.url {
                player = AVPlayer(url: url)
            } else {
                player = nil
            }
        }
        .onDisappear { player?.pause() }
    }
}

