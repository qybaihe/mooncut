import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const BASE = process.env.MOONCUT_BASE || 'http://127.0.0.1:5188/'
const OUT = process.env.MOONCUT_SHOT_OUT || '/Users/baihe/Documents/moonbot/output/playwright'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const demoUser = {
  id: 'demo-user',
  email: 'demo@mooncut.local',
  createdAt: '2026-01-01T00:00:00.000Z',
}

async function installAuthMock(page, { authenticated = false } = {}) {
  await page.route('**/v1/auth/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: authenticated ? demoUser : null }),
    })
  })
  await page.route('**/v1/auth/login', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: demoUser }),
    })
  })
  await page.route('**/v1/auth/register', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: demoUser }),
    })
  })
  await page.route('**/v1/auth/logout', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    })
  })
  await page.route('**/v1/models', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        available: ['demo'],
        routing: {
          planner: 'demo',
          script: 'demo',
          coach: 'demo',
          vision: ['demo'],
          image: { configured: false, model: null, maxImages: 0 },
        },
      }),
    })
  })
}

async function shot(page, name, { fullPage = false } = {}) {
  await mkdir(OUT, { recursive: true })
  const path = `${OUT}/${name}.png`
  await page.screenshot({ path, fullPage })
  console.log('shot', name)
}

const browser = await chromium.launch({ headless: true })
const errors = []

async function newPage(viewport, { authenticated = false } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('mooncut:page')
    } catch {}
  })
  await installAuthMock(page, { authenticated })
  await page.goto(BASE)
  await page.waitForSelector('.landing-shell, .auth-shell, .auth-loading', { timeout: 10000 })
  await page.waitForSelector('.landing-shell', { timeout: 10000 })
  await sleep(450)
  return { ctx, page }
}

// 1) Guest landing desktop
{
  const { ctx, page } = await newPage({ width: 1440, height: 900 }, { authenticated: false })
  await sleep(700)
  await shot(page, 'mooncut-landing-desktop')
  await ctx.close()
}

// 2) Guest landing mobile
{
  const { ctx, page } = await newPage({ width: 390, height: 844 }, { authenticated: false })
  await sleep(700)
  await shot(page, 'mooncut-landing-mobile')
  await ctx.close()
}

// 3) Guest landing small — overflow check
{
  const { ctx, page } = await newPage({ width: 320, height: 568 }, { authenticated: false })
  await sleep(700)
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )
  console.log('320 overflow?', overflow)
  await shot(page, 'mooncut-landing-small')
  await ctx.close()
}

// 4) Guest CTA → auth (intent preserve)
{
  const { ctx, page } = await newPage({ width: 1440, height: 900 }, { authenticated: false })
  await page.getByRole('button', { name: /开始创作/ }).first().click()
  await page.waitForSelector('.auth-shell', { timeout: 6000 })
  await sleep(400)
  const intent = await page.locator('.auth-intent').textContent()
  console.log('auth intent:', intent?.trim())
  await shot(page, 'mooncut-landing-to-auth-record')
  // cancel back to landing
  await page.getByRole('button', { name: /返回首页|先看看产品介绍/ }).first().click()
  await page.waitForSelector('.landing-shell', { timeout: 6000 })
  await sleep(300)
  await shot(page, 'mooncut-landing-auth-cancel')
  await ctx.close()
}

// 5) Guest edit CTA → auth → mock login → edit
{
  const { ctx, page } = await newPage({ width: 1440, height: 900 }, { authenticated: false })
  await page.getByRole('button', { name: /直接剪视频/ }).first().click()
  await page.waitForSelector('.auth-shell', { timeout: 6000 })
  await page.locator('input[name="email"]').fill('demo@mooncut.local')
  await page.locator('input[name="password"]').fill('password123')
  // After login mock, re-route session to authenticated for subsequent getCurrentUser isn't needed
  // because handleAuthenticated sets user from response.
  await page.getByRole('button', { name: /登录并继续|注册并继续/ }).click()
  await page.waitForSelector('.clip-page', { timeout: 8000 })
  await sleep(500)
  const promiseGone = await page.locator('.promise-card').count()
  console.log('promise-card count:', promiseGone)
  await shot(page, 'mooncut-landing-to-edit')
  await ctx.close()
}

// 6) Authenticated: start creating → record
{
  const { ctx, page } = await newPage({ width: 1440, height: 900 }, { authenticated: true })
  await page.getByRole('button', { name: /开始创作/ }).first().click()
  await page.waitForSelector('.record-page, .teleprompter-page, .review-page', { timeout: 8000 }).catch(() => {})
  await sleep(600)
  await shot(page, 'mooncut-landing-to-record')
  await ctx.close()
}

// 7) Authenticated workspace back to landing
{
  const { ctx, page } = await newPage({ width: 1440, height: 900 }, { authenticated: true })
  await page.getByRole('button', { name: /直接剪视频/ }).first().click()
  await page.waitForSelector('.clip-page', { timeout: 8000 })
  await sleep(300)
  await page.getByRole('button', { name: /返回 MoonCut 首页/ }).click()
  await page.waitForSelector('.landing-shell', { timeout: 6000 })
  await sleep(400)
  await shot(page, 'mooncut-landing-back-from-edit')
  await ctx.close()
}

// 8) Theme stability after workspace round-trip
{
  const { ctx, page } = await newPage({ width: 1440, height: 900 }, { authenticated: true })
  await page.getByRole('button', { name: /开始创作/ }).first().click()
  await sleep(400)
  await page.getByRole('button', { name: /返回 MoonCut 首页/ }).click()
  await page.waitForSelector('.landing-shell', { timeout: 6000 })
  await sleep(400)
  const bg = await page.evaluate(() => {
    const el = document.querySelector('.landing-shell')
    return el ? getComputedStyle(el).backgroundColor : null
  })
  console.log('landing bg:', bg)
  await shot(page, 'mooncut-landing-theme-stable')
  await ctx.close()
}

// 9) Pet uniqueness on landing
{
  const { ctx, page } = await newPage({ width: 1440, height: 900 }, { authenticated: false })
  await sleep(400)
  const petCount = await page.locator('.pet-companion').count()
  console.log('landing pet count:', petCount)
  await ctx.close()
}

// 10) Mobile nav after entering record
{
  const { ctx, page } = await newPage({ width: 390, height: 844 }, { authenticated: true })
  await page.getByRole('button', { name: /开始创作/ }).first().click()
  await page.waitForSelector('.record-page, .teleprompter-page', { timeout: 8000 }).catch(() => {})
  await sleep(400)
  const mobileNavVisible = await page.locator('.mobile-nav').isVisible()
  console.log('mobile-nav visible after entering record:', mobileNavVisible)
  await shot(page, 'mooncut-landing-record-mobile-nav')
  await ctx.close()
}

// 11) Logout returns to public landing
{
  const { ctx, page } = await newPage({ width: 1440, height: 900 }, { authenticated: true })
  await page.getByRole('button', { name: /退出登录/ }).first().click()
  await page.waitForSelector('.landing-shell', { timeout: 6000 })
  await sleep(300)
  const loginVisible = await page.getByRole('button', { name: /^登录$/ }).count()
  console.log('login buttons after logout:', loginVisible)
  await shot(page, 'mooncut-landing-after-logout')
  await ctx.close()
}

console.log('console errors:', errors.length ? errors : 'none')
await browser.close()
