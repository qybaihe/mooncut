import { chromium } from 'playwright'

const BASE = 'http://127.0.0.1:5199/'
const OUT = '/Users/baihe/Documents/moonbot/output/playwright'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function setTheme(page, theme) {
  await page.evaluate((t) => {
    localStorage.setItem('mooncut:theme', t)
    document.documentElement.setAttribute('data-theme', t)
  }, theme)
}

async function shot(page, name, { fullPage = true } = {}) {
  const path = `${OUT}/${name}.png`
  await page.screenshot({ path, fullPage })
  console.log('shot', name)
}

const browser = await chromium.launch({ headless: true })

async function newPage(viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  await page.goto(BASE)
  await page.waitForSelector('.app-shell', { timeout: 8000 })
  await sleep(250)
  return { ctx, page }
}

// 1) Memphis 剪辑台桌面 1440×900
{
  const { ctx, page } = await newPage({ width: 1440, height: 900 })
  await setTheme(page, 'memphis')
  await sleep(300)
  await shot(page, 'mooncut-memphis-edit-desktop')
  await ctx.close()
}

// 2) Memphis 剪辑台移动 390×844
{
  const { ctx, page } = await newPage({ width: 390, height: 844 })
  await setTheme(page, 'memphis')
  await sleep(300)
  await shot(page, 'mooncut-memphis-edit-mobile')
  await ctx.close()
}

// 3) Memphis 录制间移动（compose 聊天态）
{
  const { ctx, page } = await newPage({ width: 390, height: 844 })
  await setTheme(page, 'memphis')
  await sleep(250)
  await page.getByRole('button', { name: /录制间/ }).first().click()
  await sleep(400)
  await shot(page, 'mooncut-memphis-record-mobile')
  await ctx.close()
}

// 4) Memphis 口播稿移动（切换到「我的口播稿」tab）
{
  const { ctx, page } = await newPage({ width: 390, height: 844 })
  await setTheme(page, 'memphis')
  await page.getByRole('button', { name: /录制间/ }).first().click()
  await sleep(300)
  await page.getByRole('tab', { name: /我的口播稿/ }).click()
  await sleep(400)
  await shot(page, 'mooncut-memphis-script-mobile')
  await ctx.close()
}

// 5) Memphis 提词移动（进入提词录制，演示降级镜头）
{
  const { ctx, page } = await newPage({ width: 390, height: 844 })
  await setTheme(page, 'memphis')
  await page.getByRole('button', { name: /录制间/ }).first().click()
  await sleep(300)
  await page.getByRole('tab', { name: /我的口播稿/ }).click()
  await sleep(250)
  await page.getByRole('button', { name: /进入提词录制/ }).click()
  await sleep(1200)
  await shot(page, 'mooncut-memphis-teleprompter-mobile')
  await ctx.close()
}

// 6) Memphis 320×568 小屏剪辑台（验收 CTA 不被遮挡）
{
  const { ctx, page } = await newPage({ width: 320, height: 568 })
  await setTheme(page, 'memphis')
  await sleep(300)
  await shot(page, 'mooncut-memphis-edit-320')
  await ctx.close()
}

// 7) 串色校验：light 与 dark 桌面剪辑台
{
  const { ctx, page } = await newPage({ width: 1440, height: 900 })
  await setTheme(page, 'light')
  await sleep(250)
  await shot(page, 'mooncut-memphis-bleed-check-light-desktop')
  await setTheme(page, 'dark')
  await sleep(250)
  await shot(page, 'mooncut-memphis-bleed-check-dark-desktop')
  await ctx.close()
}

await browser.close()
console.log('done')