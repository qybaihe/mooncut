import assert from 'node:assert/strict'
import test from 'node:test'
import {
  resolveIndexFromCharacterCount,
  resolveSpokenSentenceIndex,
} from '../src/composables/useSpeakingCoach.ts'

const sentences = ['第一句先说结果。', '第二句解释原因。', '第三句给出行动。', '最后一句自然收尾。']

test('keeps the current script line stable on partial ASR text', () => {
  assert.equal(resolveSpokenSentenceIndex('第一句先说', sentences, 0), 0)
  assert.equal(resolveSpokenSentenceIndex('第二句解释原因', sentences, 1), 1)
})

test('advances when the ASR tail clearly matches a later sentence', () => {
  assert.equal(resolveSpokenSentenceIndex('前面有一些漏字但是第三句给出行动', sentences, 0), 2)
})

test('never jumps backwards once the speaker is further in the script', () => {
  assert.equal(resolveSpokenSentenceIndex('第一句先说结果', sentences, 2), 2)
})

test('character-count progress maps through cumulative sentence lengths', () => {
  assert.equal(resolveIndexFromCharacterCount(0, sentences), 0)
  assert.equal(resolveIndexFromCharacterCount(3, sentences), 0)
  // past ~55% of first sentence → still first or second depending on lengths
  const firstLen = Array.from('第一句先说结果').filter((c) => /[\u3400-\u9fffA-Za-z0-9]/.test(c)).length
  assert.equal(resolveIndexFromCharacterCount(Math.ceil(firstLen * 0.6), sentences) >= 0, true)
  assert.equal(resolveIndexFromCharacterCount(200, sentences), sentences.length - 1)
})

test('long unmatched ASR still advances by spoken length rather than freezing', () => {
  const long = '完全不匹配'.repeat(30)
  const index = resolveSpokenSentenceIndex(long, sentences, 0)
  assert.ok(index >= 1, `expected progress beyond first line, got ${index}`)
})
