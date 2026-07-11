<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, ref, watch} from "vue";
import {useTheme} from "../composables/useTheme";
import type {StudioTheme} from "@mooncut/studio-shared";
import UiIcon from "./UiIcon.vue";
import type {UiIconId} from "../composables/useUiIcon";

const {currentTheme, setTheme} = useTheme();
const open = ref(false);
const containerRef = ref<HTMLElement | null>(null);
const itemRefs = ref<HTMLElement[]>([]);

const options: Array<{value: StudioTheme; label: string; hint: string; icon: UiIconId}> = [
  {value: "light", label: "浅色", hint: "克制浅色设计", icon: "sun"},
  {value: "dark", label: "深色", hint: "专注深色设计", icon: "moon"},
  {value: "memphis", label: "Memphis", hint: "暖纸撞色贴纸", icon: "diamond"},
];

const current = computed(() => options.find((o) => o.value === currentTheme.value) ?? options[0]!);
const currentIndex = computed(() => options.findIndex((o) => o.value === currentTheme.value));

function toggle() {
  open.value = !open.value;
  if (open.value) nextTick(() => itemRefs.value[currentIndex.value]?.focus());
}

function close() {
  if (!open.value) return;
  open.value = false;
}

function choose(value: StudioTheme) {
  setTheme(value);
  close();
}

function handleOutside(event: MouseEvent) {
  if (containerRef.value && !containerRef.value.contains(event.target as Node)) close();
}

watch(open, (isOpen) => {
  if (isOpen) document.addEventListener("mousedown", handleOutside, true);
  else document.removeEventListener("mousedown", handleOutside, true);
});

onBeforeUnmount(() => document.removeEventListener("mousedown", handleOutside, true));
</script>

<template>
  <div ref="containerRef" class="theme-selector">
    <button
      class="theme-toggle theme-toggle-trigger"
      type="button"
      :aria-label="`当前 ${current.label} 主题`"
      :title="`主题：${current.label}`"
      @click="toggle"
    >
      <UiIcon :name="current.icon" :size="15" />
    </button>
    <Transition name="theme-menu">
      <ul v-if="open" class="theme-menu" role="menu" aria-label="选择主题">
        <li v-for="(option, index) in options" :key="option.value" role="none">
          <button
            :ref="(el) => { if (el) itemRefs[index] = el as HTMLElement }"
            class="theme-menu-item"
            :class="{ 'is-active': option.value === currentTheme }"
            type="button"
            role="menuitemradio"
            :aria-checked="option.value === currentTheme"
            @click="choose(option.value)"
          >
            <UiIcon :name="option.icon" :size="15" />
            <span class="theme-menu-text">
              <strong>{{ option.label }}</strong>
              <small>{{ option.hint }}</small>
            </span>
            <UiIcon v-if="option.value === currentTheme" name="check" :size="14" class="theme-menu-check" />
          </button>
        </li>
      </ul>
    </Transition>
  </div>
</template>
