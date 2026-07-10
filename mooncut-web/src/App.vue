<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import AppNavigation from './components/AppNavigation.vue'
import ClipStudio from './components/ClipStudio.vue'
import LandingPage from './components/LandingPage.vue'
import PetCompanion from './components/PetCompanion.vue'
import RecordStudio from './components/RecordStudio.vue'
import type { PetAnimationState, VideoAsset, WorkspacePage } from './types'

// 每次完整加载默认进入 Landing，不再从 localStorage 恢复初始页面；
// 主动导航时会记录工作区页，留给同会话内的偏好使用，但刷新后仍回到 Landing。
const activePage = ref<WorkspacePage>('landing')
const handoffAsset = ref<VideoAsset | null>(null)
const recordMode = ref<'compose' | 'teleprompter' | 'review'>('compose')
const clipPetState = ref<PetAnimationState>('waiting')
const recordPetState = ref<PetAnimationState>('idle')
const immersive = computed(() => activePage.value === 'record' && recordMode.value === 'teleprompter')
const activePetState = computed(() => activePage.value === 'edit' ? clipPetState.value : recordPetState.value)

watch(activePage, (page) => {
  // 仅当用户明确进入工作区时才记录，刷新入口仍回到 Landing。
  if (page === 'edit' || page === 'record') localStorage.setItem('mooncut:page', page)
  else localStorage.removeItem('mooncut:page')
})

function handleRecordingReady(asset: VideoAsset) {
  if (handoffAsset.value?.url && handoffAsset.value.url !== asset.url) {
    URL.revokeObjectURL(handoffAsset.value.url)
  }
  handoffAsset.value = asset
  activePage.value = 'edit'
}

function clearHandoff() {
  if (handoffAsset.value?.url) URL.revokeObjectURL(handoffAsset.value.url)
  handoffAsset.value = null
}

onBeforeUnmount(clearHandoff)
</script>

<template>
  <div class="app-shell" :class="{ 'is-landing': activePage === 'landing' }">
    <AppNavigation
      v-show="activePage !== 'landing'"
      v-model="activePage"
      :immersive="immersive"
    />
    <main class="app-main" :class="{ 'landing-main': activePage === 'landing' }">
      <LandingPage
        v-show="activePage === 'landing'"
        @navigate="activePage = $event"
      />
      <ClipStudio
        v-show="activePage === 'edit'"
        :initial-asset="handoffAsset"
        @clear-handoff="clearHandoff"
        @pet-state="clipPetState = $event"
      />
      <RecordStudio
        v-show="activePage === 'record'"
        @send-to-edit="handleRecordingReady"
        @mode-change="recordMode = $event"
        @pet-state="recordPetState = $event"
      />
    </main>
    <PetCompanion :state="activePetState" :immersive="immersive" :landing="activePage === 'landing'" />
  </div>
</template>
