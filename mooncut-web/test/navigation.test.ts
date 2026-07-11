import assert from 'node:assert/strict'
import test from 'node:test'
import {
  authModeForEntry,
  destinationLabel,
  requiresAuth,
  resolvePostAuthPage,
} from '../src/lib/navigation.ts'

test('resolvePostAuthPage restores intent or falls back to landing', () => {
  assert.equal(resolvePostAuthPage('record'), 'record')
  assert.equal(resolvePostAuthPage('edit'), 'edit')
  assert.equal(resolvePostAuthPage(null), 'landing')
  assert.equal(resolvePostAuthPage(undefined), 'landing')
  assert.equal(resolvePostAuthPage(null, 'queue'), 'queue')
})

test('requiresAuth leaves landing and public community open', () => {
  assert.equal(requiresAuth('landing'), false)
  assert.equal(requiresAuth('public-community'), false)
  assert.equal(requiresAuth('edit'), true)
  assert.equal(requiresAuth('record'), true)
  assert.equal(requiresAuth('community'), true)
  assert.equal(requiresAuth('queue'), true)
})

test('destinationLabel explains next step without exaggerating', () => {
  assert.match(destinationLabel('record') ?? '', /登录后进入录制间/)
  assert.match(destinationLabel('edit', 'register') ?? '', /注册后进入剪辑台/)
  assert.equal(destinationLabel(null), null)
})

test('authModeForEntry maps CTA and account actions', () => {
  assert.equal(authModeForEntry('cta-create'), 'register')
  assert.equal(authModeForEntry('sign-up'), 'register')
  assert.equal(authModeForEntry('sign-in'), 'login')
  assert.equal(authModeForEntry('cta-edit'), 'login')
  assert.equal(authModeForEntry('workspace'), 'login')
})
