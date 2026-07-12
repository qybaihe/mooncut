import { createApp } from 'vue'
import App from './App.vue'
import './styles.css'

// Build stamp kept in the bundle so content-hash rotates after CDN poison.
;(globalThis as unknown as { __MOONCUT_BUILD__?: string }).__MOONCUT_BUILD__ =
  '2026-07-11-asset-cache-fix-v2'
createApp(App).mount('#root')
