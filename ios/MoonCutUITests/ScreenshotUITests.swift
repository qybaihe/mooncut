import XCTest

/// 生成 redesign 验收截图。默认使用与 Web 相同的 Pages API；真实登录仅在
/// 注入测试凭据时执行。
/// 登录凭据仅从环境变量注入，勿把真实密码写入仓库：
/// `MOONCUT_UI_TEST_EMAIL` / `MOONCUT_UI_TEST_PASSWORD`
final class ScreenshotUITests: XCTestCase {
    private var email: String {
        ProcessInfo.processInfo.environment["MOONCUT_UI_TEST_EMAIL"] ?? ""
    }
    private var password: String {
        ProcessInfo.processInfo.environment["MOONCUT_UI_TEST_PASSWORD"] ?? ""
    }

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testCaptureRedesignScreenshots() throws {
        let app = XCUIApplication()
        app.launchArguments += ["-mooncut.screenshot"]
        // 预置浅色主题
        app.launchArguments += ["-mooncut:theme", "light"]
        app.launch()

        loginIfNeeded(app)
        guard waitForHome(app) else {
            // No credential is injected in ordinary CI. Keep the test honest:
            // validate and capture the real auth screen instead of claiming a
            // local/demo login succeeded.
            XCTAssertTrue(app.textFields["auth-email"].waitForExistence(timeout: 10) || app.buttons["auth-submit"].exists)
            let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            attachment.name = "light-auth-iphone16pro"
            attachment.lifetime = .keepAlways
            add(attachment)
            return
        }

        // light home
        applyTheme(app, title: "浅色")
        sleep(1)
        saveScreenshot(name: "light-home-iphone16pro")

        // dark edit
        applyTheme(app, title: "深色")
        sleep(1)
        openEdit(app)
        sleep(1)
        saveScreenshot(name: "dark-edit-iphone16pro")
        popToRoot(app)

        // memphis coach
        applyTheme(app, title: "Memphis")
        sleep(1)
        app.tabBars.buttons["陪练"].tap()
        sleep(1)
        saveScreenshot(name: "memphis-coach-iphone16pro")

        // memphis jobs
        app.tabBars.buttons["任务"].tap()
        sleep(2)
        saveScreenshot(name: "memphis-jobs-iphone16pro")

        // dark community
        applyTheme(app, title: "深色")
        sleep(1)
        app.tabBars.buttons["社区"].tap()
        sleep(1)
        saveScreenshot(name: "dark-community-iphone16pro")

        // light teleprompter (immersive if possible)
        applyTheme(app, title: "浅色")
        app.tabBars.buttons["创作"].tap()
        sleep(1)
        if app.buttons["home-start-script"].waitForExistence(timeout: 4) {
            app.buttons["home-start-script"].tap()
            sleep(1)
            seedDraftAndEnterTeleprompter(app)
        }
        sleep(2)
        saveScreenshot(name: "light-teleprompter-iphone16pro")
    }

    private func loginIfNeeded(_ app: XCUIApplication) {
        if waitForHome(app) { return }
        guard !email.isEmpty, !password.isEmpty else {
            // 无测试凭据时只拍登录/公开界面，不伪造登录成功
            return
        }
        let emailField = app.textFields["auth-email"]
        guard emailField.waitForExistence(timeout: 8) else { return }
        emailField.tap()
        emailField.typeText(email)
        let passwordLogin = app.segmentedControls.buttons["密码登录"]
        if passwordLogin.waitForExistence(timeout: 2) { passwordLogin.tap() }
        let passwordField = app.secureTextFields["auth-password"]
        guard passwordField.waitForExistence(timeout: 3) else { return }
        passwordField.tap()
        passwordField.typeText(password)
        app.buttons["auth-submit"].tap()
        _ = waitForHome(app)
    }

    private func waitForHome(_ app: XCUIApplication) -> Bool {
        app.otherElements["home-screen"].waitForExistence(timeout: 12)
            || app.navigationBars["创作"].waitForExistence(timeout: 2)
            || app.tabBars.buttons["创作"].waitForExistence(timeout: 2)
    }

    private func openEdit(_ app: XCUIApplication) {
        if app.buttons["home-start-edit"].waitForExistence(timeout: 3) {
            app.buttons["home-start-edit"].tap()
        }
    }

    private func popToRoot(_ app: XCUIApplication) {
        if app.navigationBars.buttons["创作"].waitForExistence(timeout: 2) {
            app.navigationBars.buttons["创作"].tap()
        } else if app.tabBars.buttons["创作"].exists {
            app.tabBars.buttons["创作"].tap()
        }
        sleep(1)
    }

    private func applyTheme(_ app: XCUIApplication, title: String) {
        let picker = app.descendants(matching: .any)["theme-picker"]
        guard picker.waitForExistence(timeout: 3) else { return }
        picker.tap()
        sleep(1)
        // 菜单项文案为「浅色 · 高级编辑台」等形式
        let candidates = [
            app.buttons.matching(NSPredicate(format: "label CONTAINS %@", title)).element(boundBy: 0),
            app.menuItems.matching(NSPredicate(format: "label CONTAINS %@", title)).element(boundBy: 0)
        ]
        for candidate in candidates where candidate.waitForExistence(timeout: 1) {
            candidate.tap()
            sleep(1)
            return
        }
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.15)).tap()
        sleep(1)
    }

    private func seedDraftAndEnterTeleprompter(_ app: XCUIApplication) {
        if app.segmentedControls.buttons["我的口播稿"].waitForExistence(timeout: 3) {
            app.segmentedControls.buttons["我的口播稿"].tap()
        }
        let draft = app.textViews["script-draft"]
        if draft.waitForExistence(timeout: 3) {
            draft.tap()
            draft.typeText("先说结论：口播开头三秒决定去留。再解释原因，最后给一个马上能做的动作。")
        }
        if app.buttons["enter-teleprompter"].waitForExistence(timeout: 3) {
            app.buttons["enter-teleprompter"].tap()
            // 允许权限系统弹窗：取消/不允许即可停留在权限说明态
            let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
            sleep(1)
            for label in ["不允许", "Don’t Allow", "取消", "Cancel", "好", "OK"] {
                if springboard.buttons[label].exists {
                    springboard.buttons[label].tap()
                    break
                }
            }
        }
    }

    private func saveScreenshot(name: String) {
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)

        let data = shot.pngRepresentation
        let dir = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("screenshots/redesign", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try? data.write(to: dir.appendingPathComponent("\(name).png"))
    }
}
