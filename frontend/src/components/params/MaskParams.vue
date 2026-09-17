<script setup lang="ts">
/** 正文蒙版参数。 */

import { computed } from 'vue'
import type { MaskType } from '../../types'
import { useAppStore } from '../../stores/config'
import MaskControls from './MaskControls.vue'
import ParamSection from './ParamSection.vue'

const store = useAppStore()
const cfg = store.cfg

const badge = computed(() => {
  switch (cfg.mask.type) {
    case 'card':
      return '圆角卡片'
    case 'veil':
      return '全图遮罩'
    default:
      return '渐变遮罩'
  }
})

function onType(t: MaskType): void {
  store.switchMaskType(t)
}
</script>

<template>
  <ParamSection title="蒙版" :badge="badge">
    <MaskControls :mask="cfg.mask" @type-change="onType" />
  </ParamSection>
</template>
