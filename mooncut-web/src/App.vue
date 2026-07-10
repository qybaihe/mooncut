<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import AppNavigation from './components/AppNavigation.vue'
import ClipStudio from './components/ClipStudio.vue'
import RecordStudio from './components/RecordStudio.vue'
import type { VideoAsset, WorkspacePage } from './types'

const storedPage = localStorage.getItem('mooncut:page') as WorkspacePage | null
const activePage = ref<WorkspacePage>(storedPage === 'record' ? 'record' : 'edit')
const handoffAsset = ref<VideoAsset | null>(null)
const recordMode = ref<'compose' | 'teleprompter' | 'review'>('compose')

watch(activePage, (page) => localStorage.setItem('mooncut:page', page))

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
  <div class="app-shell">
    <AppNavigation
      v-model="activePage"
      :immersive="activePage === 'record' && recordMode === 'teleprompter'"
    />
    <main class="app-main">
      <ClipStudio
        v-show="activePage === 'edit'"
        :initial-asset="handoffAsset"
        @clear-handoff="clearHandoff"
      />
      <RecordStudio
        v-show="activePage === 'record'"
        @send-to-edit="handleRecordingReady"
        @mode-change="recordMode = $event"
      />
    </main>
    <div class="ambient ambient-one" aria-hidden="true" />
    <div class="ambient ambient-two" aria-hidden="true" />
  </div>
</template>
