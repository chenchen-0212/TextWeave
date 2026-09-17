<script setup lang="ts">
/** 参数面板的可折叠分区。 */
import { ref } from 'vue'

const props = withDefaults(
  defineProps<{
    title: string
    badge?: string
    defaultOpen?: boolean
  }>(),
  { badge: '', defaultOpen: true },
)

const open = ref(props.defaultOpen)
</script>

<template>
  <div class="section">
    <button class="section-head" :class="{ open }" type="button" @click="open = !open">
      <i class="chev"></i>
      <span>{{ title }}</span>
      <span v-if="badge" class="badge">{{ badge }}</span>
    </button>
    <div v-show="open" class="section-body">
      <slot />
    </div>
  </div>
</template>
