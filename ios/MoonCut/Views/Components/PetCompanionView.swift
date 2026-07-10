import SwiftUI
import UIKit

private struct AnimatedPetSprite: UIViewRepresentable {
    let state: PetAnimationState

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> UIImageView {
        let imageView = UIImageView()
        imageView.contentMode = .scaleAspectFit
        imageView.clipsToBounds = false
        update(imageView, coordinator: context.coordinator)
        return imageView
    }

    func updateUIView(_ uiView: UIImageView, context: Context) {
        guard context.coordinator.state != state else { return }
        update(uiView, coordinator: context.coordinator)
    }

    private func update(_ imageView: UIImageView, coordinator: Coordinator) {
        let frames = makeFrames()
        coordinator.state = state
        imageView.stopAnimating()
        imageView.animationImages = UIAccessibility.isReduceMotionEnabled ? nil : frames
        imageView.animationDuration = state.duration
        imageView.animationRepeatCount = 0
        imageView.image = frames.first
        if !UIAccessibility.isReduceMotionEnabled { imageView.startAnimating() }
    }

    private func makeFrames() -> [UIImage] {
        guard let source = UIImage(named: "HappyDogSpritesheet")?.cgImage else { return [] }
        let cellWidth = source.width / 8
        let cellHeight = source.height / 9

        return (0..<state.frameCount).compactMap { column in
            let rect = CGRect(
                x: column * cellWidth,
                y: state.row * cellHeight,
                width: cellWidth,
                height: cellHeight
            )
            guard let frame = source.cropping(to: rect) else { return nil }
            return UIImage(cgImage: frame, scale: UIScreen.main.scale, orientation: .up)
        }
    }

    final class Coordinator {
        var state: PetAnimationState?
    }
}

struct PetCompanionView: View {
    let state: PetAnimationState
    var compact = false

    @AppStorage("mooncut:pet-happiness") private var happiness = 68
    @State private var reactionState: PetAnimationState?
    @State private var touchedMessage = false
    @State private var showsBubble = true
    @State private var heartBurst = 0
    @State private var reactionNonce = 0

    private var activeState: PetAnimationState { reactionState ?? state }
    private var canShowBubble: Bool { !compact && UIScreen.main.bounds.height >= 700 }
    private var mood: String {
        if happiness >= 90 { return "超开心" }
        if happiness >= 72 { return "很开心" }
        return "陪着你"
    }

    var body: some View {
        VStack(spacing: -4) {
            if showsBubble && canShowBubble {
                bubble
                    .transition(.scale(scale: 0.94, anchor: .bottomTrailing).combined(with: .opacity))
            }

            Button(action: pet) {
                ZStack(alignment: .bottom) {
                    RadialGradient(
                        colors: [MoonColor.accent.opacity(0.14), .clear],
                        center: .bottom,
                        startRadius: 2,
                        endRadius: 54
                    )
                    .frame(width: compact ? 68 : 76, height: compact ? 74 : 86)

                    Capsule()
                        .fill(.black.opacity(0.10))
                        .frame(width: compact ? 44 : 54, height: 9)
                        .blur(radius: 4)
                        .offset(y: -4)

                    AnimatedPetSprite(state: activeState)
                        .frame(width: compact ? 64 : 72, height: compact ? 70 : 78)
                        .offset(y: -4)

                    if !compact {
                        Text("摸摸我")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 7)
                            .frame(height: 22)
                            .background(.regularMaterial, in: Capsule())
                            .overlay(Capsule().stroke(MoonColor.hairline, lineWidth: 1))
                            .offset(x: 8, y: 1)
                    }

                    if heartBurst > 0 {
                        PetHeartBurst()
                            .id(heartBurst)
                            .offset(y: -66)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(PetPressStyle())
            .accessibilityLabel("摸摸小月，当前开心值 \(happiness)")
        }
        .animation(.spring(response: 0.30, dampingFraction: 0.82), value: showsBubble)
        .task(id: state) {
            guard canShowBubble, reactionState == nil else { return }
            showsBubble = true
            try? await Task.sleep(nanoseconds: 3_400_000_000)
            guard !Task.isCancelled, reactionState == nil else { return }
            showsBubble = false
        }
    }

    private var bubble: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack {
                Text("小月")
                    .font(.caption.weight(.bold))
                Spacer(minLength: 12)
                Text("\(mood) · \(happiness)")
                    .font(.system(size: 9, weight: .medium, design: .monospaced))
                    .foregroundStyle(.tertiary)
            }
            Text(touchedMessage ? "摸到我啦，好开心！" : activeState.message)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            GeometryReader { geometry in
                Capsule()
                    .fill(MoonColor.inset)
                    .overlay(alignment: .leading) {
                        Capsule()
                            .fill(
                                LinearGradient(
                                    colors: [Color(red: 1, green: 0.43, blue: 0.55), Color(red: 1, green: 0.66, blue: 0.39)],
                                    startPoint: .leading,
                                    endPoint: .trailing
                                )
                            )
                            .frame(width: geometry.size.width * CGFloat(happiness) / 100)
                    }
            }
            .frame(height: 4)
        }
        .padding(11)
        .frame(width: 174)
        .background(.regularMaterial, in: UnevenRoundedRectangle(topLeadingRadius: 14, bottomLeadingRadius: 14, bottomTrailingRadius: 5, topTrailingRadius: 14))
        .overlay(
            UnevenRoundedRectangle(topLeadingRadius: 14, bottomLeadingRadius: 14, bottomTrailingRadius: 5, topTrailingRadius: 14)
                .stroke(MoonColor.hairline, lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.08), radius: 14, y: 6)
        .onTapGesture { showsBubble = false }
        .accessibilityElement(children: .combine)
    }

    private func pet() {
        reactionNonce += 1
        let nonce = reactionNonce
        happiness = min(100, happiness + 4)
        reactionState = .jumping
        touchedMessage = true
        showsBubble = canShowBubble
        heartBurst += 1
        UIImpactFeedbackGenerator(style: .soft).impactOccurred()

        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 1_400_000_000)
            guard nonce == reactionNonce else { return }
            reactionState = nil
            touchedMessage = false
            try? await Task.sleep(nanoseconds: 2_200_000_000)
            guard nonce == reactionNonce else { return }
            showsBubble = false
        }
    }
}

private struct PetPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.94 : 1)
            .offset(y: configuration.isPressed ? 2 : 0)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

private struct PetHeartBurst: View {
    @State private var expanded = false

    var body: some View {
        ZStack {
            heart(size: 15, color: Color(red: 1, green: 0.40, blue: 0.52), x: expanded ? -28 : 0, y: expanded ? -36 : 8, rotation: -16)
            heart(size: 11, color: Color(red: 1, green: 0.59, blue: 0.38), x: expanded ? 22 : 0, y: expanded ? -48 : 8, rotation: 14)
            heart(size: 9, color: Color(red: 1, green: 0.49, blue: 0.70), x: expanded ? 2 : 0, y: expanded ? -62 : 8, rotation: 4)
        }
        .opacity(expanded ? 0 : 1)
        .onAppear {
            withAnimation(.easeOut(duration: 0.92)) { expanded = true }
        }
        .allowsHitTesting(false)
    }

    private func heart(size: CGFloat, color: Color, x: CGFloat, y: CGFloat, rotation: Double) -> some View {
        Image(systemName: "heart.fill")
            .font(.system(size: size))
            .foregroundStyle(color)
            .offset(x: x, y: y)
            .rotationEffect(.degrees(rotation))
            .scaleEffect(expanded ? 1 : 0.4)
    }
}

#Preview {
    ZStack(alignment: .bottomTrailing) {
        MoonColor.canvas.ignoresSafeArea()
        PetCompanionView(state: .idle)
            .padding()
    }
}
