import XCTest
@testable import MoonCut

@MainActor
final class PetStateStoreTests: XCTestCase {
    func testEmptyWorkspaceIsWaiting() {
        let mapped = PetStateStore.reduce(.emptyWorkspace)
        XCTAssertEqual(mapped.state, .waiting)
    }

    func testNetworkWorkIsRunning() {
        XCTAssertEqual(PetStateStore.reduce(.scriptRequesting).state, .running)
        XCTAssertEqual(PetStateStore.reduce(.uploading).state, .running)
        XCTAssertEqual(PetStateStore.reduce(.jobRunning).state, .running)
        XCTAssertEqual(PetStateStore.reduce(.jobDownloading).state, .running)
    }

    func testRecordingIsWaving() {
        XCTAssertEqual(PetStateStore.reduce(.recording).state, .waving)
    }

    func testSuccessIsJumping() {
        XCTAssertEqual(PetStateStore.reduce(.jobCompleted).state, .jumping)
        XCTAssertEqual(PetStateStore.reduce(.coachPositive).state, .jumping)
    }

    func testFailureIsFailed() {
        XCTAssertEqual(PetStateStore.reduce(.jobFailed).state, .failed)
        XCTAssertEqual(PetStateStore.reduce(.permissionOrNetworkFailure).state, .failed)
    }

    func testStoreAppliesBusinessEvents() {
        let store = PetStateStore(userId: "test-user")
        store.apply(.emptyWorkspace)
        XCTAssertEqual(store.animation, .waiting)
        store.apply(.jobRunning)
        XCTAssertEqual(store.animation, .running)
        store.apply(.jobCompleted)
        XCTAssertEqual(store.animation, .jumping)
        store.apply(.jobFailed)
        XCTAssertEqual(store.animation, .failed)
    }

    func testTouchRaisesHappinessOnly() {
        let store = PetStateStore(userId: UUID().uuidString)
        let before = store.happiness
        store.apply(.touch)
        XCTAssertEqual(store.happiness, min(100, before + 4))
        XCTAssertEqual(store.animation, .jumping)
    }
}
