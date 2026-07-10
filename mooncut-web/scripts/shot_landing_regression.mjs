import { chromium } from 'playwright'

const BASE = 'http://127.0.0.1:5188/'
const OUT = '/Users/baihe/Documents/moonbot/output/playwright'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch({ headless: true })
const errors = []
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(BASE)
await page.waitForSelector('.landing-shell', { timeout: 8000 })
await sleep(400)

// 进入 edit
await page.getByRole('button', { name: /直接剪视频/ }).first().click()
await page.waitForSelector('.clip-page', { timeout: 6000 })
await sleep(300)
// 验证上传区单列，promise-card 不存在
const uploadLayout = await page.locator('.upload-layout').count()
const promiseGone = await page.locator('.promise-card').count()
console.log('upload-layout:', uploadLayout, 'promise-card:', promiseGone)

// 主题三态切换，验证每态都应用
for (const theme of ['light', 'dark', 'memphis']) {
  await page.evaluate((t) => {
    localStorage.setItem('mooncut:theme', t)
    document.documentElement.setAttribute('data-theme', t)
  }, theme)
  await sleep(300)
  const attr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
  console.log('theme:', attr)
  await page.screenshot({ path: `${OUT}/mooncut-landing-edit-${theme}.png` })
}

// 切回 record，验证导航出现
await page.getByRole('button', { name: /录制间/ }).first().click()
await page.waitForSelector('.record-page, .teleprompter-page, .review-page', { timeout: 6000 }).catch(() => {})
await sleep(500)
await page.screenshot({ path: `${OUT}/mooncut-landing-regression-record.png` })
const recordVisible = await page.locator('.record-page, .teleprompter-page, .review-page').first().isVisible()
console.log('record visible:', recordVisible)

console.log('errors:', errors.length ? errors : 'none')
await browser.close()