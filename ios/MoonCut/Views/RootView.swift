import SwiftUI

struct RootView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.theme) private var theme
    @State private var clipModel: ClipStudioViewModel?
    @State private var recordModel: RecordStudioViewModel?
    @State private var createPath = NavigationPath()
    @State private var coachPath = NavigationPath()

    var body: some View {
        Group {
            if env.isRestoringSession {
                ProgressView("恢复会话…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(theme.canvas.ignoresSafeArea())
                    .accessibilityIdentifier("restoring-session")
            } else if !env.isAuthenticated {
                AuthView()
            } else {
                mainTabs
            }
        }
        .onAppear {
            ensureModels()
        }
        .onChange(of: env.isAuthenticated) { _, authed in
            if authed { ensureModels() }
        }
        .overlay(alignment: .bottom) {
            ToastView(message: env.toast, isError: env.toastIsError)
                .padding(.bottom, env.isImmersiveTeleprompter ? 24 : 8)
        }
    }

    @ViewBuilder
    private var mainTabs: some View {
        @Bindable var env = env
        TabView(selection: $env.selectedTab) {
            NavigationStack(path: $createPath) {
                if let clipModel, let recordModel {
                    HomeView(
                        clipModel: clipModel,
                        recordModel: recordModel,
                        onOpenEdit: { createPath.append(CreateDestination.edit) },
                        onOpenScript: { createPath.append(CreateDestination.script) },
                        onOpenCoach: { env.selectedTab = .coach },
                        onOpenJobs: { env.selectedTab = .jobs }
                    )
                    .navigationDestination(for: CreateDestination.self) { dest in
                        switch dest {
                        case .edit:
                            ClipStudioView(model: clipModel)
                        case .script:
                            RecordStudioView(model: recordModel) { asset in
                                clipModel.receiveRecording(asset)
                                recordModel.returnToCompose()
                                createPath = NavigationPath()
                                createPath.append(CreateDestination.edit)
                            }
                        case .teleprompter:
                            TeleprompterView(model: recordModel)
                        case .settings:
                            SettingsView()
                        }
                    }
                    .toolbar { globalTrailingTools }
                }
            }
            .tabItem { Label(AppTab.create.title, systemImage: AppTab.create.symbol) }
            .tag(AppTab.create)
            .accessibilityIdentifier("tab-create")

            NavigationStack(path: $coachPath) {
                if let recordModel {
                    CoachView(
                        recordModel: recordModel,
                        onOpenTeleprompter: {
                            // mode already set by enterTeleprompter
                        },
                        onOpenScript: {
                            env.selectedTab = .create
                            createPath.append(CreateDestination.script)
                        }
                    )
                    .toolbar { globalTrailingTools }
                    .navigationDestination(isPresented: Binding(
                        get: { recordModel.mode == .teleprompter || recordModel.mode == .review },
                        set: { presented in
                            if !presented {
                                recordModel.returnToCompose()
                            }
                        }
                    )) {
                        RecordStudioView(model: recordModel) { asset in
                            clipModel?.receiveRecording(asset)
                            recordModel.returnToCompose()
                            env.selectedTab = .create
                            createPath.append(CreateDestination.edit)
                        }
                    }
                }
            }
            .tabItem { Label(AppTab.coach.title, systemImage: AppTab.coach.symbol) }
            .tag(AppTab.coach)
            .accessibilityIdentifier("tab-coach")

            NavigationStack {
                JobsView(api: env.api, env: env) { _ in
                    env.selectedTab = .create
                    createPath.append(CreateDestination.edit)
                }
                .toolbar { globalTrailingTools }
            }
            .tabItem { Label(AppTab.jobs.title, systemImage: AppTab.jobs.symbol) }
            .tag(AppTab.jobs)
            .accessibilityIdentifier("tab-jobs")

            NavigationStack {
                CommunityView(api: env.api, env: env)
                    .toolbar { globalTrailingTools }
            }
            .tabItem { Label(AppTab.community.title, systemImage: AppTab.community.symbol) }
            .tag(AppTab.community)
            .accessibilityIdentifier("tab-community")
        }
    }

    @ToolbarContentBuilder
    private var globalTrailingTools: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            ThemePickerMenu()
        }
        ToolbarItem(placement: .topBarTrailing) {
            Button {
                env.selectedTab = .create
                // 延迟一帧，确保 tab 切换后再 push
                DispatchQueue.main.async {
                    createPath.append(CreateDestination.settings)
                }
            } label: {
                Image(systemName: "gearshape")
                    .frame(minWidth: 44, minHeight: 44)
            }
            .accessibilityLabel("设置")
            .accessibilityIdentifier("settings-button")
        }
    }

    private func ensureModels() {
        if clipModel == nil {
            clipModel = ClipStudioViewModel(api: env.api, env: env)
        }
        if recordModel == nil {
            recordModel = RecordStudioViewModel(api: env.api, env: env)
        }
    }
}
