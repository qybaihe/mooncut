import Foundation

enum DemoContent {
    static let defaultDraft = """
    很多人第一次做口播，总觉得自己没内容。

    但真正的问题，往往不是没内容，而是开头给得太慢。观众刷到你的前三秒，还不知道这条视频和自己有什么关系，自然就划走了。

    你可以试试一个很简单的方法：先说结果，再解释原因。比如不要从“今天想和大家聊聊”开始，直接说“如果你的口播总没人看，先检查开头这句话”。

    下一条视频，先把开场白删掉，只留下观众最想知道的那一句。你会发现，表达不需要更用力，只需要更快地抵达重点。
    """

    static let initialMessage = ChatMessage(
        role: .assistant,
        content: "先告诉我：这条口播，你最想让观众记住什么？我会陪你把想法一步步变成能直接念的稿子。"
    )

    static let quickTopics = ["讲一个知识点", "做产品介绍", "分享个人经历", "表达一个观点"]

    static let suggestions = [
        ScriptSuggestion(id: 0, eyebrow: "开头钩子", title: "先说一个常见误区", detail: "不是你没内容，而是开头给得太慢。", symbol: "bolt.fill"),
        ScriptSuggestion(id: 1, eyebrow: "中段支撑", title: "加入一个具体场景", detail: "让观众立刻联想到自己经历过的时刻。", symbol: "lightbulb.fill"),
        ScriptSuggestion(id: 2, eyebrow: "结尾动作", title: "给一个马上能做的动作", detail: "把观点变成一句可执行的小建议。", symbol: "arrow.right")
    ]

    static let processingSteps = [
        ProcessingStep(label: "读取口播内容", detail: "识别人声与句子边界"),
        ProcessingStep(label: "整理停顿与重复", detail: "保留自然呼吸感"),
        ProcessingStep(label: "设计字幕节奏", detail: "重点词自动强调"),
        ProcessingStep(label: "合成口播成片", detail: "即将可以预览")
    ]
}

enum DraftProcessor {
    static func makeOral(_ text: String) -> String {
        text
            .replacingOccurrences(of: "因此", with: "所以")
            .replacingOccurrences(of: "但是", with: "但")
            .replacingOccurrences(of: "我们可以", with: "你可以")
    }

    static func shorten(_ text: String) -> String {
        let sentences = splitSentences(text)
        return sentences
            .enumerated()
            .filter { ![2, 5].contains($0.offset) }
            .prefix(8)
            .map(\.element)
            .joined()
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func addEmotion(_ text: String) -> String {
        text.hasPrefix("先别急着划走。") ? text : "先别急着划走。\n\n\(text)"
    }

    static func splitSentences(_ text: String) -> [String] {
        var result: [String] = []
        var current = ""
        let endings: Set<Character> = ["。", "！", "？"]

        for character in text {
            current.append(character)
            if endings.contains(character) {
                let sentence = current.trimmingCharacters(in: .whitespacesAndNewlines)
                if !sentence.isEmpty { result.append(sentence) }
                current = ""
            }
        }

        let trailing = current.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trailing.isEmpty { result.append(trailing) }
        return result
    }
}

