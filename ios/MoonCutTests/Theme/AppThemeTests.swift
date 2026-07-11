import XCTest
import SwiftUI
@testable import MoonCut

final class AppThemeTests: XCTestCase {
    func testThemeRawValuesMatchWebContract() {
        XCTAssertEqual(AppThemeMode.light.rawValue, "light")
        XCTAssertEqual(AppThemeMode.dark.rawValue, "dark")
        XCTAssertEqual(AppThemeMode.memphis.rawValue, "memphis")
        XCTAssertEqual(AppThemeMode.allCases.count, 3)
    }

    func testSystemDefaultResolutionWhenUnset() {
        XCTAssertEqual(AppThemeMode.resolved(stored: nil, system: .light), .light)
        XCTAssertEqual(AppThemeMode.resolved(stored: nil, system: .dark), .dark)
        XCTAssertEqual(AppThemeMode.resolved(stored: "", system: .dark), .dark)
        XCTAssertEqual(AppThemeMode.resolved(stored: "memphis", system: .dark), .memphis)
    }

    func testMemphisDoesNotForceLightColorScheme() {
        XCTAssertNil(AppThemeMode.memphis.preferredColorScheme)
        XCTAssertEqual(AppThemeMode.light.preferredColorScheme, .light)
        XCTAssertEqual(AppThemeMode.dark.preferredColorScheme, .dark)
    }

    func testMemphisTokensIndependentFromLightDark() {
        let light = ThemeTokens.tokens(for: .light, colorScheme: .light)
        let dark = ThemeTokens.tokens(for: .dark, colorScheme: .dark)
        let memphis = ThemeTokens.tokens(for: .memphis, colorScheme: .light)

        XCTAssertFalse(light.usesMemphisChrome)
        XCTAssertFalse(dark.usesMemphisChrome)
        XCTAssertTrue(memphis.usesMemphisChrome)
        XCTAssertNotEqual(light.canvas, memphis.canvas)
        XCTAssertNotEqual(dark.canvas, memphis.canvas)
    }

    func testPublicDistributionConfigIsNotConfiguredByDefaultToken() {
        // 结构字段存在性：公开模式语义由 APIConfiguration 负责
        XCTAssertEqual(APIConfiguration.unconfiguredPlaceholder.contains("unconfigured"), true)
    }

    func testThemePersistenceKeyRoundTrip() {
        let key = "mooncut:theme"
        let previous = UserDefaults.standard.string(forKey: key)
        defer {
            if let previous {
                UserDefaults.standard.set(previous, forKey: key)
            } else {
                UserDefaults.standard.removeObject(forKey: key)
            }
        }
        UserDefaults.standard.set(AppThemeMode.memphis.rawValue, forKey: key)
        let stored = UserDefaults.standard.string(forKey: key)
        XCTAssertEqual(AppThemeMode(rawValue: stored ?? ""), .memphis)
    }
}
