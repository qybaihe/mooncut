<script setup lang="ts">
import { Mic2, Scissors } from '@lucide/vue'
import type { WorkspacePage } from '../types'
import BrandMark from './BrandMark.vue'

const activePage = defineModel<WorkspacePage>({ required: true })
defineProps<{ immersive?: boolean }>()

const destinations = [
  { id: 'edit' as const, label: '剪辑台', icon: Scissors },
  { id: 'record' as const, label: '录制间', icon: Mic2 },
]
</script>

<template>
  <header v-if="!immersive" class="app-header">
    <div class="header-inner">
      <BrandMark />
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
          <component :is="destination.icon" :size="17" :stroke-width="2.2" />
          {{ destination.label }}
        </button>
      </nav>
      <div class="header-meta">
        <span class="local-pill"><span class="status-dot" /> 本地演示</span>
        <span class="avatar" aria-label="当前用户">M</span>
      </div>
    </div>
  </header>

  <nav v-if="!immersive" class="mobile-nav" aria-label="移动端主导航">
    <button
      v-for="destination in destinations"
      :key="destination.id"
      :class="{ 'is-active': activePage === destination.id }"
      type="button"
      :aria-current="activePage === destination.id ? 'page' : undefined"
      @click="activePage = destination.id"
    >
      <component :is="destination.icon" :size="21" :stroke-width="2.1" />
      <span>{{ destination.label }}</span>
    </button>
  </nav>
</template>
