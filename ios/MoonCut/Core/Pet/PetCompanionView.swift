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
    @Bindable var store: PetStateStore
    var compact = false
    var showsBubble = true
    var forceHideBubble = false

    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var showsBubbleState = true
    @State private var heartBurst = 0

    private var canShowBubble: Bool {
        showsBubble && !forceHideBubble && !compact && !UIAccessibility.isVoiceOverRunning
    }

    private var mood: String {
        if store.happiness >= 90 { return "超开心" }
        if store.happiness >= 72 { return "很开心" }
        return "陪着你"
    }

    var body: some View {
        VStack(spacing: -4) {
            if showsBubbleState && canShowBubble {
                bubble
                    .transition(.scale(scale: 0.94, anchor: .bottom).combined(with: .opacity))
            }

            Button(action: pet) {
                ZStack(alignment: .bottom) {
                    RadialGradient(
                        colors: [theme.accent.opacity(0.14), .clear],
                        center: .bottom,
                        startRadius: 2,
                        endRadius: 54
                    )
                    .frame(width: compact ? 56 : 72, height: compact ? 60 : 78)

                    AnimatedPetSprite(state: store.animation)
                        .frame(width: compact ? 52 : 68, height: compact ? 56 : 74)
                        .offset(y: -2)

                    if heartBurst > 0, !reduceMotion {
                        PetHeartBurst()
                            .id(heartBurst)
                            .offset(y: -56)
                    }
                }
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(PetPressStyle())
            .accessibilityLabel("摸摸小月，当前开心值 \(store.happiness)")
            .accessibilityIdentifier("pet-companion")
        }
        .animation(.spring(response: 0.30, dampingFraction: 0.82), value: showsBubbleState)
        .task(id: store.animation) {
            guard canShowBubble else {
                showsBubbleState = false
                return
            }
            showsBubbleState = true
            try? await Task.sleep(nanoseconds: 3_400_000_000)
            guard !Task.isCancelled else { return }
            showsBubbleState = false
        }
    }

    private var bubble: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack {
                Text("小月")
                    .font(.caption.weight(.bold))
                Spacer(minLength: 12)
                Text("\(mood) · \(store.happiness)")
                    .font(.system(size: 9, weight: .medium, design: .monospaced))
                    .foregroundStyle(theme.textTertiary)
            }
            Text(store.message)
                .font(.caption)
                .foregroundStyle(theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            GeometryReader { geometry in
                Capsule()
                    .fill(theme.inset)
                    .overlay(alignment: .leading) {
                        Capsule()
                            .fill(
                                LinearGradient(
                                    colors: [Color(red: 1, green: 0.43, blue: 0.55), Color(red: 1, green: 0.66, blue: 0.39)],
                                    startPoint: .leading,
                                    endPoint: .trailing
                                )
                            )
                            .frame(width: geometry.size.width * CGFloat(store.happiness) / 100)
                    }
            }
            .frame(height: 4)
        }
        .padding(11)
        .frame(width: 174)
        .background(.regularMaterial, in: UnevenRoundedRectangle(topLeadingRadius: 14, bottomLeadingRadius: 14, bottomTrailingRadius: 5, topTrailingRadius: 14))
        .overlay(
            UnevenRoundedRectangle(topLeadingRadius: 14, bottomLeadingRadius: 14, bottomTrailingRadius: 5, topTrailingRadius: 14)
                .stroke(theme.hairline, lineWidth: 1)
        )
        .onTapGesture { showsBubbleState = false }
        .accessibilityElement(children: .combine)
    }

    private func pet() {
        store.apply(.touch)
        heartBurst += 1
        showsBubbleState = canShowBubble
        UIImpactFeedbackGenerator(style: .soft).impactOccurred()
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
