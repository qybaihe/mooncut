import SwiftUI

struct RootView: View {
    @AppStorage("mooncut:page") private var selectedRaw = WorkspaceTab.edit.rawValue
    @StateObject private var clipModel = ClipStudioViewModel()
    @StateObject private var recordModel = RecordStudioViewModel()

    private var selectedTab: Binding<WorkspaceTab> {
        Binding(
            get: { WorkspaceTab(rawValue: selectedRaw) ?? .edit },
            set: { selectedRaw = $0.rawValue }
        )
    }

    private var isImmersive: Bool {
        selectedTab.wrappedValue == .record && recordModel.mode == .teleprompter
    }

    private var activeToast: String {
        selectedTab.wrappedValue == .edit ? clipModel.toast : recordModel.toast
    }

    private var petState: PetAnimationState {
        if selectedTab.wrappedValue == .edit {
            if !clipModel.toast.isEmpty { return .jumping }
            switch clipModel.stage {
            case .empty: return .waiting
            case .ready: return .review
            case .processing: return .running
            case .done: return .jumping
            }
        }

        if !recordModel.toast.isEmpty || recordModel.mode == .review { return .jumping }
        if recordModel.mode == .teleprompter { return .waving }
        if recordModel.isThinking { return .running }
        if recordModel.panel == .draft || recordModel.messages.count > 1 { return .review }
        return .idle
    }

    var body: some View {
        ZStack {
            MoonColor.canvas.ignoresSafeArea()

            Group {
                switch selectedTab.wrappedValue {
                case .edit:
                    ClipStudioView(model: clipModel)
                case .record:
                    RecordStudioView(model: recordModel) { asset in
                        clipModel.receiveRecording(asset)
                        recordModel.returnToCompose()
                        selectedTab.wrappedValue = .edit
                    }
                }
            }
            .id(selectedTab.wrappedValue)
            .transition(.opacity)
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            if !isImmersive { AppHeader() }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if !isImmersive { BottomWorkspaceBar(selection: selectedTab) }
        }
        .overlay(alignment: isImmersive ? .topTrailing : .bottom) {
            PetCompanionView(state: petState, compact: isImmersive)
                .padding(.top, isImmersive ? 68 : 0)
                .padding(.trailing, isImmersive ? 8 : 0)
                .padding(.bottom, isImmersive ? 0 : 4)
                .zIndex(20)
        }
        .overlay(alignment: .bottom) {
            ToastView(message: activeToast)
                .padding(.bottom, isImmersive ? 24 : 84)
                .animation(.snappy, value: activeToast)
        }
        .animation(.easeInOut(duration: 0.18), value: isImmersive)
    }
}

#Preview {
    RootView()
}
