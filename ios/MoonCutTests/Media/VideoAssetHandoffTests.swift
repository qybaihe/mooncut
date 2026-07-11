import XCTest
@testable import MoonCut

final class VideoAssetHandoffTests: XCTestCase {
    func testPlayableRequiresExistingFile() {
        let missing = VideoAsset(
            name: "x.mov",
            sizeLabel: "1 MB",
            url: URL(fileURLWithPath: "/tmp/mooncut-does-not-exist-\(UUID().uuidString).mov"),
            source: .recording
        )
        XCTAssertFalse(missing.isPlayable)

        let temp = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("mov")
        FileManager.default.createFile(atPath: temp.path, contents: Data([0x00, 0x01]), attributes: nil)
        defer { try? FileManager.default.removeItem(at: temp) }

        let present = VideoAsset(
            name: "ok.mov",
            sizeLabel: VideoFileStore.sizeLabel(for: temp),
            url: temp,
            source: .recording
        )
        XCTAssertTrue(present.isPlayable)
    }

    func testNilURLIsNotPlayable() {
        let asset = VideoAsset(name: "demo", sizeLabel: "—", url: nil, source: .recording)
        XCTAssertFalse(asset.isPlayable)
    }

    func testStageCopyMapsServerStages() {
        XCTAssertEqual(JobStageCopy.title(for: "transcribing"), "转写口播")
        XCTAssertEqual(JobStageCopy.title(for: "rendering"), "渲染成片")
        XCTAssertEqual(JobStageCopy.title(for: "completed"), "已完成")
        XCTAssertEqual(JobStageCopy.title(for: nil), "排队中")
    }
}
