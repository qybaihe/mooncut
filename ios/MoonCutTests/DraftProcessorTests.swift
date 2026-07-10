import XCTest
@testable import MoonCut

final class DraftProcessorTests: XCTestCase {
    func testOralRewriteUsesConversationalWords() {
        let result = DraftProcessor.makeOral("因此我们可以继续，但是要快。")
        XCTAssertEqual(result, "所以你可以继续，但要快。")
    }

    func testEmotionPrefixIsIdempotent() {
        let once = DraftProcessor.addEmotion("这是正文。")
        XCTAssertEqual(DraftProcessor.addEmotion(once), once)
    }

    func testSentenceSplitKeepsChinesePunctuation() {
        XCTAssertEqual(DraftProcessor.splitSentences("第一句。第二句！还有吗？"), ["第一句。", "第二句！", "还有吗？"])
    }
}
