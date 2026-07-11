import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveSpokenSentenceIndex } from '../src/composables/useSpeakingCoach.ts'

const sentences = ['第一句先说结果。', '第二句解释原因。', '第三句给出行动。', '最后一句自然收尾。']

test('keeps the current script line stable on partial ASR text', () => {
  assert.equal(resolveSpokenSentenceIndex('第一句先说', sentences, 0), 0)
  assert.equal(resolveSpokenSentenceIndex('第二句解释原因', sentences, 1), 1)
})

test('advances directly when the ASR tail clearly matches a later sentence', () => {
  assert.equal(resolveSpokenSentenceIndex('前面有一些漏字但是第三句给出行动', sentences, 0), 2)
})

test('never jumps backwards and limits length-only drift to one sentence', () => {
  assert.equal(resolveSpokenSentenceIndex('第一句先说结果', sentences, 2), 2)
  assert.equal(resolveSpokenSentenceIndex('完全不匹配'.repeat(30), sentences, 0), 1)
})
