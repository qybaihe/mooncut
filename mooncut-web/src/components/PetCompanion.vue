<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { PetAnimationState } from '../types'

const props = defineProps<{
  state: PetAnimationState
  message?: string
  immersive?: boolean
  landing?: boolean
}>()

const storedValue = localStorage.getItem('mooncut:pet-happiness')
const storedHappiness = storedValue === null ? Number.NaN : Number(storedValue)
const happiness = ref(Number.isFinite(storedHappiness) ? Math.min(100, Math.max(0, storedHappiness)) : 68)
const interactionState = ref<PetAnimationState | null>(null)
const showBubble = ref(true)
const showHearts = ref(false)
const touchedMessage = ref(false)
let reactionTimer: number | null = null
let bubbleTimer: number | null = null

const activeState = computed(() => interactionState.value ?? props.state)

const stateMessage = computed(() => {
  if (touchedMessage.value) return '摸到我啦，好开心！'
  if (props.message) return props.message
  const messages: Record<PetAnimationState, string> = {
    idle: '我在这儿，慢慢来。',
    running: '正在努力跑进度！',
    waving: '准备好啦，一起开口。',
    jumping: '完成了！你真棒 ✦',
    failed: '没关系，我们再来一次。',
    waiting: '我陪你等灵感。',
    review: '这句很有感觉，再读一遍？',
  }
  return messages[activeState.value]
})

const moodLabel = computed(() => {
  if (happiness.value >= 90) return '超开心'
  if (happiness.value >= 72) return '很开心'
  return '陪着你'
})

function scheduleBubbleHide(delay = 3400) {
    if (bubbleTimer) window.clearTimeout(bubbleTimer)
  bubbleTimer = window.setTimeout(() => {
    showBubble.value = false
  }, delay)
}

function petDog() {
  if (reactionTimer) window.clearTimeout(reactionTimer)
  happiness.value = Math.min(100, happiness.value + 4)
  localStorage.setItem('mooncut:pet-happiness', String(happiness.value))
  interactionState.value = 'jumping'
  touchedMessage.value = true
  showBubble.value = true
  showHearts.value = false
  window.requestAnimationFrame(() => (showHearts.value = true))

  reactionTimer = window.setTimeout(() => {
    interactionState.value = null
    touchedMessage.value = false
    showHearts.value = false
    scheduleBubbleHide(2200)
  }, 1400)
}

watch(
  () => [props.state, props.message],
  () => {
    if (interactionState.value) return
    showBubble.value = true
    scheduleBubbleHide()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (reactionTimer) window.clearTimeout(reactionTimer)
  if (bubbleTimer) window.clearTimeout(bubbleTimer)
})
</script>

<template>
  <aside
    class="pet-companion"
    :class="{ 'is-immersive': immersive, 'is-landing': landing, 'has-bubble': showBubble }"
    aria-label="MoonCut 创作搭子小月"
    @mouseenter="showBubble = true"
    @mouseleave="scheduleBubbleHide(1800)"
  >
    <Transition name="pet-bubble">
      <div v-if="showBubble" class="pet-bubble" role="status" aria-live="polite">
        <div class="pet-bubble-topline">
          <strong>小月</strong>
          <span>{{ moodLabel }} · {{ happiness }}</span>
        </div>
        <p>{{ stateMessage }}</p>
        <span class="pet-happiness-track" aria-hidden="true"><i :style="{ width: `${happiness}%` }" /></span>
      </div>
    </Transition>

    <button
      class="pet-touch-target"
      type="button"
      :aria-label="`摸摸小月，当前开心值 ${happiness}`"
      title="摸摸小月"
      @click="petDog"
    >
      <span class="pet-hearts" :class="{ 'is-visible': showHearts }" aria-hidden="true">
        <i v-for="index in 3" :key="index">♥</i>
      </span>
      <span class="pet-sprite-frame" aria-hidden="true">
        <span class="pet-sprite" :class="`state-${activeState}`" />
      </span>
      <span class="pet-touch-hint">摸摸我</span>
    </button>
  </aside>
</template>
