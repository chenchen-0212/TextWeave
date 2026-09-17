<script setup lang="ts">
/**
 * 目标张数约束参数（F-05，P0）。
 *
 * 界面需要把求解结果如实反馈：命中了什么字号、是否触底、是否收紧了段间距。
 * 这些信息直接决定用户下一步该调什么。
 */

import { computed } from 'vue'
import { useAppStore } from '../../stores/config'
import ParamField from '../ui/ParamField.vue'
import ParamSection from './ParamSection.vue'

const store = useAppStore()
const cfg = store.cfg

const diag = computed(() => store.diag)

const badge = computed(() => {
  if (!cfg.constraint.enable) return '未启用'
  return `${cfg.constraint.minPages}–${cfg.constraint.maxPages} 张`
})

/** 求解得到的实际参数与设定值的差异说明 */
const appliedNote = computed(() => {
  const a = diag.value?.applied
  if (!a || !cfg.constraint.enable) return ''
  const parts: string[] = []
  if (Math.abs(a.fontSize - cfg.text.fontSize) >= 0.5) {
    parts.push(`字号 ${cfg.text.fontSize} → ${a.fontSize}px`)
  }
  if (a.tightenedSpacing) parts.push('段间距已收紧')
  return parts.join(' · ')
})
</script>

<template>
  <ParamSection title="目标张数约束" :badge="badge">
    <ParamField
      label="启用约束"
      type="check"
      :modelValue="cfg.constraint.enable"
      @update:modelValue="(v) => (cfg.constraint.enable = Boolean(v))"
    />

    <template v-if="cfg.constraint.enable">
      <ParamField
        label="最少张数"
        :modelValue="cfg.constraint.minPages"
        :min="1"
        :max="100"
        unit="张"
        @update:modelValue="(v) => (cfg.constraint.minPages = Number(v))"
      />
      <ParamField
        label="最多张数"
        :modelValue="cfg.constraint.maxPages"
        :min="1"
        :max="200"
        unit="张"
        @update:modelValue="(v) => (cfg.constraint.maxPages = Number(v))"
      />

      <div v-if="appliedNote" class="notice info">已自动适配：{{ appliedNote }}</div>
      <div v-if="store.layoutViolated" class="notice warn">{{ store.layoutMessage }}</div>
      <div
        v-else-if="store.layoutMessage && store.layoutMessage.indexOf('少于') >= 0"
        class="notice warn"
      >
        {{ store.layoutMessage }}
      </div>

      <div class="field-hint">
        通过二分搜索找到满足张数区间的最大字号：字号越大越清晰，但页数也越多。
        字号降到 24px 仍超页时会如实提示，不会静默截断内容。
      </div>
    </template>
  </ParamSection>
</template>
