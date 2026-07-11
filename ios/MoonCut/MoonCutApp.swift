import SwiftUI

@main
struct MoonCutApp: App {
    @State private var env = AppEnvironment()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(env)
                .moonTheme()
                .task {
                    await env.bootstrap()
                }
        }
    }
}
