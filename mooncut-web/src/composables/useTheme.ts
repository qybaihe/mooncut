import { ref, watch } from 'vue'
import type { Theme } from '../types'

const STORAGE_KEY = 'mooncut:theme'
const VALID_THEMES: readonly Theme[] = ['light', 'dark', 'memphis']

function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (VALID_THEMES as readonly string[]).includes(value)
}

function readStored(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    // Memphis 只由用户主动选择后才会落盘；未保存值时跟随系统浅/深偏好。
    if (isTheme(stored)) return stored
  } catch {
    /* localStorage 不可用时回退到系统偏好 */
  }
  const prefersDark =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
  return prefersDark ? 'dark' : 'light'
}

// 单例：整站共享同一个响应式主题状态。
const currentTheme = ref<Theme>(readStored())

// 初次同步 data-theme 属性，避免在内联引导脚本缺失时主题不一致。
if (typeof document !== 'undefined') {
  document.documentElement.setAttribute('data-theme', currentTheme.value)
}

function setTheme(value: Theme) {
  currentTheme.value = value
}

watch(currentTheme, (value) => {
  document.documentElement.setAttribute('data-theme', value)
  try {
    localStorage.setItem(STORAGE_KEY, value)
  } catch {
    /* 隐私模式或存储禁用时静默忽略 */
  }
  // 同步 <meta name="theme-color">，避免浏览器顶栏色与主题不符。
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', value === 'memphis' ? '#fff8e8' : value === 'dark' ? '#191919' : '#ffffff')
})

export function useTheme() {
  return { currentTheme, setTheme }
}