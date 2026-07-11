import XCTest

/// Memphis 主题全站截图，输出到 ios/screenshots/memphis/
final class MemphisScreenshotUITests: XCTestCase {
    private var email: String {
        ProcessInfo.processInfo.environment["MOONCUT_UI_TEST_EMAIL"]
            ?? "ios-test-probe@example.com"
    }
    private var password: String {
        ProcessInfo.processInfo.environment["MOONCUT_UI_TEST_PASSWORD"]
            ?? "test-pass-12345"
    }

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testCaptureMemphisGallery() throws {
        let app = XCUIApplication()
        app.launchArguments += ["-mooncut.screenshot", "-mooncut:theme", "memphis"]
        app.launch()

        // 强制 Memphis（AppStorage）
        applyTheme(app, contains: "Memphis")
        sleep(1)

        loginIfNeeded(app)
        sleep(1)

        // 1 登录后首页（创作）
        goTab(app, "创作")
        applyTheme(app, contains: "Memphis")
        sleep(1)
        save("memphis-home")

        // 2 剪辑
        if app.buttons["home-start-edit"].waitForExistence(timeout: 3) {
            app.buttons["home-start-edit"].tap()
            sleep(1)
            save("memphis-edit")
            // back
            if app.navigationBars.buttons["创作"].waitForExistence(timeout: 2) {
                app.navigationBars.buttons["创作"].tap()
            }
        }

        // 3 脚本
        goTab(app, "创作")
        if app.buttons["home-start-script"].waitForExistence(timeout: 3) {
            app.buttons["home-start-script"].tap()
            sleep(1)
            save("memphis-script")
            if app.navigationBars.buttons["创作"].waitForExistence(timeout: 2) {
                app.navigationBars.buttons["创作"].tap()
            }
        }

        // 4 陪练
        goTab(app, "陪练")
        applyTheme(app, contains: "Memphis")
        sleep(1)
        save("memphis-coach")

        // 5 任务
        goTab(app, "任务")
        applyTheme(app, contains: "Memphis")
        sleep(2)
        save("memphis-jobs")

        // 6 社区
        goTab(app, "社区")
        applyTheme(app, contains: "Memphis")
        sleep(1)
        save("memphis-community")

        // 7 设置
        goTab(app, "创作")
        if app.buttons["settings-button"].waitForExistence(timeout: 3) {
            app.buttons["settings-button"].tap()
            sleep(1)
            save("memphis-settings")
        } else if app.buttons["gearshape"].waitForExistence(timeout: 2) {
            app.buttons["gearshape"].tap()
            sleep(1)
            save("memphis-settings")
        }

        // 8 若仍在登录页，也截一张 auth memphis
        if app.buttons["auth-submit"].exists {
            save("memphis-auth")
        }
    }

    private func goTab(_ app: XCUIApplication, _ title: String) {
        let tab = app.tabBars.buttons[title]
        if tab.waitForExistence(timeout: 4) {
            tab.tap()
            sleep(1)
        }
    }

    private func loginIfNeeded(_ app: XCUIApplication) {
        if app.tabBars.buttons["创作"].waitForExistence(timeout: 4) { return }
        if app.otherElements["home-screen"].waitForExistence(timeout: 2) { return }

        let emailField = app.textFields["auth-email"]
        guard emailField.waitForExistence(timeout: 8) else { return }
        emailField.tap()
        // clear
        if let value = emailField.value as? String, !value.isEmpty {
            let delete = String(repeating: XCUIKeyboardKey.delete.rawValue, count: value.count)
            emailField.typeText(delete)
        }
        emailField.typeText(email)

        let passwordField = app.secureTextFields["auth-password"]
        passwordField.tap()
        passwordField.typeText(password)
        app.buttons["auth-submit"].tap()
        _ = app.tabBars.buttons["创作"].waitForExistence(timeout: 12)
    }

    private func applyTheme(_ app: XCUIApplication, contains label: String) {
        let picker = app.descendants(matching: .any)["theme-picker"]
        guard picker.waitForExistence(timeout: 2) else { return }
        picker.tap()
        sleep(1)
        let item = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", label)).element(boundBy: 0)
        if item.waitForExistence(timeout: 2) {
            item.tap()
        } else {
            let menu = app.menuItems.matching(NSPredicate(format: "label CONTAINS %@", label)).element(boundBy: 0)
            if menu.waitForExistence(timeout: 1) { menu.tap() }
        }
        sleep(1)
    }

    private func save(_ name: String) {
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)

        let dir = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("screenshots/memphis", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try? shot.pngRepresentation.write(to: dir.appendingPathComponent("\(name).png"))
    }
}
