import { chromium } from 'playwright'

const BASE = 'http://127.0.0.1:5188/'
const OUT = '/Users/baihe/Documents/moonbot/output/playwright'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function shot(page, name, { fullPage = false } = {}) {
  const path = `${OUT}/${name}.png`
  await page.screenshot({ path, fullPage })
  console.log('shot', name)
}

const browser = await chromium.launch({ headless: true })

async function newPage(viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  // 清空页面持久化，确保每次刷新都进入 Landing
  await page.addInitScript(() => {
    try { localStorage.removeItem('mooncut:page') } catch (e) {}
  })
  await page.goto(BASE)
  await page.waitForSelector('.landing-shell', { timeout: 8000 })
  await sleep(400)
  return { ctx, page }
}

const errors = []
const collect = (page) =>
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })

// 1) Landing 桌面 1440×900（首屏 viewport）
{
  const { ctx, page } = await newPage({ width: 1440, height: 900 })
  collect(page)
  await sleep(800)
  await shot(page, 'mooncut-landing-desktop')
  await ctx.close()
}

// 2) Landing 全页面移动 390×844（首屏 viewport 截图）
{
  const { ctx, page } = await newPage({ width: 390, height: 844 })
  collect(page)
  await sleep(800)
  await shot(page, 'mooncut-landing-mobile')
  await ctx.close()
}

// 3) Landing 小屏 320×568（首屏 viewport 截图，检查无横向溢出）
{
  const { ctx, page } = await newPage({ width: 320, height: 568 })
  collect(page)
  await sleep(800)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  console.log('320 overflow?', overflow)
  await shot(page, 'mooncut-landing-small')
  await ctx.close()
}

// 4) “开始创作” → record
{
  const { ctx, page } = await newPage({ width: 1440, height: 900 })
  collect(page)
  await page.getByRole('button', { name: /开始创作/ }).first().click()
  await page.waitForSelector('.record-page, .teleprompter-page, .review-page', { timeout: 6000 }).catch(() => {})
  await sleep(600)
  await shot(page, 'mooncut-landing-to-record')
  await ctx.close()
}

// 5) “直接剪视频” → edit 空状态（验证上传区居中、无 promise-card）
{
  const { ctx, page } = await newPage({ width: 1440, height: 900 })
  collect(page)
  await page.getByRole('button', { name: /直接剪视频/ }).first().click()
  await page.waitForSelector('.clip-page', { timeout: 6000 })
  await sleep(500)
  const promiseGone = await page.locator('.promise-card').count()
  console.log('promise-card count:', promiseGone)
  await shot(page, 'mooncut-landing-to-edit')
  await ctx.close()
}

// 6) 工作区返回 Landing（点击品牌标识）
{
  const { ctx, page } = await newPage({ width: 1440, height: 900 })
  collect(page)
  await page.getByRole('button', { name: /直接剪视频/ }).first().click()
  await page.waitForSelector('.clip-page', { timeout: 6000 })
  await sleep(300)
  await page.getByRole('button', { name: /返回 MoonCut 首页/ }).click()
  await page.waitForSelector('.landing-shell', { timeout: 6000 })
  await sleep(400)
  await shot(page, 'mooncut-landing-back-from-edit')
  await ctx.close()
}

// 7) 主题切换不影响 Landing（进入 record 后切 Memphis 再回 Landing）
{
  const { ctx, page } = await newPage({ width: 1440, height: 900 })
  collect(page)
  await page.getByRole('button', { name: /开始创作/ }).first().click()
  await page.waitForSelector('.record-page, .teleprompter-page', { timeout: 6000 }).catch(() => {})
  await sleep(300)
  // 不用强制点主题切换；这里只验证 Landing 仍为深色
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

// 8) 宠物在 Landing 上存在且唯一
{
  const { ctx, page } = await newPage({ width: 1440, height: 900 })
  collect(page)
  await sleep(500)
  const petCount = await page.locator('.pet-companion').count()
  console.log('landing pet count:', petCount)
  await ctx.close()
}

// 9) 录制间导航回归（在 Landing 点开始创作进入 record，再点移动底部“录制间”）
{
  const { ctx, page } = await newPage({ width: 390, height: 844 })
  collect(page)
  await page.getByRole('button', { name: /开始创作/ }).first().click()
  await page.waitForSelector('.record-page, .teleprompter-page', { timeout: 6000 }).catch(() => {})
  await sleep(400)
  const mobileNavVisible = await page.locator('.mobile-nav').isVisible()
  console.log('mobile-nav visible after entering record:', mobileNavVisible)
  await shot(page, 'mooncut-landing-record-mobile-nav')
  await ctx.close()
}

console.log('console errors:', errors.length ? errors : 'none')
await browser.close()