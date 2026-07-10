import SwiftUI

@main
struct MoonCutApp: App {
    @AppStorage("mooncut:theme") private var theme = ThemeMode.system.rawValue

    var body: some Scene {
        WindowGroup {
            RootView()
                .preferredColorScheme(ThemeMode(rawValue: theme)?.colorScheme)
        }
    }
}

