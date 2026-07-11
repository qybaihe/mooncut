<script setup lang="ts">
import UiIcon from "./UiIcon.vue";

defineProps<{message: string}>();
</script>

<template>
  <Transition name="toast">
    <div v-if="message" class="toast" role="status" aria-live="polite">
      <span class="toast-icon" aria-hidden="true">
        <UiIcon name="check" :size="13" />
      </span>
      <span>{{ message }}</span>
    </div>
  </Transition>
</template>
