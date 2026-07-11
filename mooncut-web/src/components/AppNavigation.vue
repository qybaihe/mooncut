<script setup lang="ts">
import { Activity, Home, LogOut, Mic2, Scissors, UsersRound } from '@lucide/vue'
import { onMounted, ref } from 'vue'
import { getServiceModels } from '../services/api'
import type { WorkspacePage } from '../types'
import BrandMark from './BrandMark.vue'
import ThemeToggle from './ThemeToggle.vue'

const activePage = defineModel<WorkspacePage>({ required: true })
const props = defineProps<{ immersive?: boolean; userEmail: string }>()
const emit = defineEmits<{ logout: [] }>()
const agentOnline = ref(false)

onMounted(async () => {
  try {
    await getServiceModels()
    agentOnline.value = true
  } catch {
    agentOnline.value = false
  }
})

const destinations = [
  { id: 'edit' as const, label: '剪辑台', icon: Scissors },
  { id: 'record' as const, label: '录制间', icon: Mic2 },
  { id: 'community' as const, label: '社区', icon: UsersRound },
  { id: 'queue' as const, label: '队列', icon: Activity },
]
const userInitial = props.userEmail.slice(0, 1).toUpperCase() || 'M'
</script>

<template>
  <header v-if="!immersive" class="app-header">
    <div class="header-inner">
      <button class="brand-home-button" type="button" aria-label="返回 MoonCut 首页" @click="activePage = 'landing'">
        <BrandMark />
      </button>
      <nav class="desktop-nav" aria-label="主导航">
        <button
          v-for="destination in destinations"
          :key="destination.id"
          class="nav-button"
          :class="{ 'is-active': activePage === destination.id }"
          type="button"
          :aria-current="activePage === destination.id ? 'page' : undefined"
          @click="activePage = destination.id"
        >
          <component :is="destination.icon" :size="16" :stroke-width="2" />
          {{ destination.label }}
        </button>
      </nav>
      <div class="header-meta">
        <span class="local-pill"><span class="status-dot" :class="{ amber: !agentOnline }" /> {{ agentOnline ? 'Agent 已连接' : '连接 Agent' }}</span>
        <ThemeToggle />
        <div class="account-summary" :title="userEmail">
          <span class="avatar" aria-hidden="true">{{ userInitial }}</span>
          <span class="account-email">{{ userEmail }}</span>
        </div>
        <button class="header-icon-button" type="button" aria-label="退出登录" title="退出登录" @click="emit('logout')">
          <LogOut :size="16" />
        </button>
      </div>
    </div>
  </header>

  <nav v-if="!immersive" class="mobile-nav" aria-label="移动端主导航">
    <button
      :class="{ 'is-active': activePage === 'landing' }"
      type="button"
      :aria-current="activePage === 'landing' ? 'page' : undefined"
      aria-label="返回首页"
      @click="activePage = 'landing'"
    >
      <Home :size="20" :stroke-width="2" />
      <span>首页</span>
    </button>
    <button
      v-for="destination in destinations"
      :key="destination.id"
      :class="{ 'is-active': activePage === destination.id }"
      type="button"
      :aria-current="activePage === destination.id ? 'page' : undefined"
      @click="activePage = destination.id"
    >
      <component :is="destination.icon" :size="20" :stroke-width="2" />
      <span>{{ destination.label }}</span>
    </button>
  </nav>
</template>
