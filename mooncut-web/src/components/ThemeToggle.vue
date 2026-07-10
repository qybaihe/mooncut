<script setup lang="ts">
import { Check, Moon, Palette, Sun } from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useTheme } from '../composables/useTheme'
import type { Theme } from '../types'

const { currentTheme, setTheme } = useTheme()

const open = ref(false)
const containerRef = ref<HTMLElement | null>(null)
const itemRefs = ref<HTMLElement[]>([])

interface ThemeOption {
  value: Theme
  label: string
  hint: string
  icon: typeof Sun
}

const options: ThemeOption[] = [
  { value: 'light', label: '浅色', hint: '克制浅色设计', icon: Sun },
  { value: 'dark', label: '深色', hint: '专注深色设计', icon: Moon },
  { value: 'memphis', label: 'Memphis', hint: '暖纸撞色贴纸', icon: Palette },
]

const currentIndex = computed(() => options.findIndex((option) => option.value === currentTheme.value))

function toggle() {
  open.value = !open.value
  if (open.value) {
    nextTick(() => itemRefs.value[currentIndex.value]?.focus())
  }
}

function close() {
  if (!open.value) return
  open.value = false
  containerRef.value?.querySelector<HTMLButtonElement>('.theme-toggle-trigger')?.focus()
}

function choose(value: Theme) {
  setTheme(value)
  close()
}

function handleKeydown(event: KeyboardEvent) {
  if (!open.value) return
  const lastIndex = options.length - 1
  let nextIndex = currentIndex.value

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      nextIndex = currentIndex.value >= lastIndex ? 0 : currentIndex.value + 1
      itemRefs.value[nextIndex]?.focus()
      break
    case 'ArrowUp':
      event.preventDefault()
      nextIndex = currentIndex.value <= 0 ? lastIndex : currentIndex.value - 1
      itemRefs.value[nextIndex]?.focus()
      break
    case 'Home':
      event.preventDefault()
      itemRefs.value[0]?.focus()
      break
    case 'End':
      event.preventDefault()
      itemRefs.value[lastIndex]?.focus()
      break
    case 'Escape':
      event.preventDefault()
      close()
      break
    case 'Tab':
      close()
      break
  }
}

function handleOutsideClick(event: MouseEvent) {
  if (containerRef.value && !containerRef.value.contains(event.target as Node)) {
    close()
  }
}

watch(open, (isOpen) => {
  if (isOpen) {
    document.addEventListener('mousedown', handleOutsideClick, true)
  } else {
    document.removeEventListener('mousedown', handleOutsideClick, true)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', handleOutsideClick, true)
})
</script>

<template>
  <div class="theme-selector" ref="containerRef" @keydown="handleKeydown">
    <button
      class="theme-toggle theme-toggle-trigger"
      type="button"
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-label="`当前 ${options[currentIndex].label} 主题，打开主题选择`"
      :title="`主题：${options[currentIndex].label}`"
      @click="toggle"
    >
      <component :is="options[currentIndex].icon" :size="16" :stroke-width="2" />
    </button>
    <Transition name="theme-menu">
      <ul
        v-if="open"
        class="theme-menu"
        role="menu"
        aria-label="选择主题"
      >
        <li v-for="(option, index) in options" :key="option.value" role="none">
          <button
            :ref="(el) => { if (el) itemRefs[index] = el as HTMLElement }"
            class="theme-menu-item"
            :class="{ 'is-active': option.value === currentTheme }"
            role="menuitemradio"
            type="button"
            :aria-checked="option.value === currentTheme"
            @click="choose(option.value)"
          >
            <component :is="option.icon" :size="16" :stroke-width="2" />
            <span class="theme-menu-text">
              <strong>{{ option.label }}</strong>
              <small>{{ option.hint }}</small>
            </span>
            <Check v-if="option.value === currentTheme" :size="15" class="theme-menu-check" />
          </button>
        </li>
      </ul>
    </Transition>
  </div>
</template>