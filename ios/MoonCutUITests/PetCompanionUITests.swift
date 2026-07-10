import XCTest

final class PetCompanionUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testPettingCompanionRaisesHappiness() {
        let app = XCUIApplication()
        app.launch()

        let pet = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "摸摸小月")).firstMatch
        XCTAssertTrue(pet.waitForExistence(timeout: 8))
        let before = pet.label

        pet.tap()

        let updatedPet = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "摸摸小月")).firstMatch
        XCTAssertTrue(updatedPet.waitForExistence(timeout: 2))
        XCTAssertNotEqual(updatedPet.label, before)
    }
}
