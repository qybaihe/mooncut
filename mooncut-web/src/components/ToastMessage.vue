<script setup lang="ts">
import { CheckCircle2 } from '@lucide/vue'

defineProps<{ message: string }>()
</script>

<template>
  <Transition name="toast">
    <div v-if="message" class="toast" role="status" aria-live="polite">
      <CheckCircle2 :size="18" />
      <span>{{ message }}</span>
    </div>
  </Transition>
</template>
