<script setup lang="ts">
import {computed} from "vue";
import {type UiIconId, uiIconUrl} from "../composables/useUiIcon";

const props = withDefaults(
  defineProps<{
    name: UiIconId | string;
    size?: number | string;
    label?: string;
  }>(),
  {size: 16},
);

const src = computed(() => uiIconUrl(props.name));
const dim = computed(() => (typeof props.size === "number" ? `${props.size}px` : props.size));
</script>

<template>
  <span
    class="ui-icon"
    :class="[`ui-icon--${name}`]"
    :style="{
      width: dim,
      height: dim,
      WebkitMaskImage: `url(${src})`,
      maskImage: `url(${src})`,
    }"
    :role="label ? 'img' : 'presentation'"
    :aria-label="label"
    :aria-hidden="label ? undefined : 'true'"
  />
</template>
