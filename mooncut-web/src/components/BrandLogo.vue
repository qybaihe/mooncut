<script setup lang="ts">
import { mooncutLogoSrc, MOONCUT_LOGO_SIZE } from '../assets/brand'

withDefaults(
  defineProps<{
    /** mark = icon crop for compact nav; lockup = full square with wordmark */
    variant?: 'mark' | 'lockup'
    /**
     * When true, the image carries the accessible name (e.g. footer lockup alone).
     * When false, treat as decorative — parent provides aria-label / visible text.
     */
    labeled?: boolean
  }>(),
  {
    variant: 'mark',
    labeled: false,
  },
)
</script>

<template>
  <span
    class="brand-logo"
    :class="`brand-logo--${variant}`"
    :aria-hidden="labeled ? undefined : true"
  >
    <img
      :src="mooncutLogoSrc"
      :alt="labeled ? 'MoonCut' : ''"
      :width="MOONCUT_LOGO_SIZE"
      :height="MOONCUT_LOGO_SIZE"
      decoding="async"
      draggable="false"
    />
  </span>
</template>
