<script setup lang="ts">
import { Play } from '@lucide/vue'
import type { VideoAsset } from '../types'

defineProps<{
  asset: VideoAsset | null
  failed: boolean
  controls?: boolean
}>()

defineEmits<{
  error: []
  time: [seconds: number]
}>()
</script>

<template>
  <video
    v-if="asset?.url && !failed"
    class="source-video"
    :src="asset.url"
    :controls="controls"
    muted
    playsinline
    @error="$emit('error')"
    @timeupdate="$emit('time', ($event.target as HTMLVideoElement).currentTime)"
  />
  <div v-else class="video-placeholder">
    <div class="person-silhouette" aria-hidden="true">
      <span class="person-head" />
      <span class="person-body" />
    </div>
    <span class="placeholder-grid" />
    <span v-if="controls" class="round-play" aria-hidden="true">
      <Play :size="19" fill="currentColor" />
    </span>
  </div>
</template>
