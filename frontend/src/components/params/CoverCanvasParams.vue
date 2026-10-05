<script setup lang="ts">
/** 封面画布尺寸（与正文画布完全独立）。 */

import { computed } from 'vue'
import { useAppStore } from '../../stores/config'
import { ORIENTATIONS, SIZE_UNITS } from '../../types'
import { resolveCoverCanvas, unitFactor } from '../../core/pageCanvas'
import ParamField from '../ui/ParamField.vue'
import ParamSection from './ParamSection.vue'

const store = useAppStore()
const cfg = store.cfg

/** 换算后的实际像素（与渲染层用的是同一个函数，所见即所得） */
const px = computed(() => resolveCoverCanvas(cfg.coverCanvas))

/** 最简宽高比 */
const ratio = computed(() => {
  const w = px.value.width
  const h = px.value.height
  if (w <= 0 || h <= 0) return ''
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const d = gcd(w, h) || 1
  return `${w / d}:${h / d}`
})

const hint = computed(() => {
  if (cfg.coverCanvas.followBody) {
    return `当前跟随正文尺寸（${cfg.canvas.width} × ${cfg.canvas.height}），改动这里不会生效。`
  }
  const k = unitFactor(cfg.coverCanvas.unit)
  const same = px.value.width === cfg.canvas.width && px.value.height === cfg.canvas.height
  return `实际输出 ${px.value.width} × ${px.value.height} px（换算系数 ${k.toFixed(3)}）${
    same ? '，与正文尺寸相同' : ''
  }`
})

/** 关闭「跟随正文」时，把当前正文尺寸抄一份作为起点，避免用户面对空白输入框 */
function enableOwn(): void {
  cfg.coverCanvas.followBody = false
  if (cfg.coverCanvas.unit === 'px') {
    cfg.coverCanvas.width = cfg.canvas.width
    cfg.coverCanvas.height = cfg.canvas.height
  }
}

function onSizeChange(): void {
  store.scheduleRebuild(0)
}
</script>

<template>
  <ParamSection title="封面尺寸" :badge="cfg.coverCanvas.followBody ? '跟随正文' : ratio">
    <ParamField
      label="跟随正文"
      type="check"
      :modelValue="cfg.coverCanvas.followBody"
      @update:modelValue="
        (v) => {
          if (v) cfg.coverCanvas.followBody = true
          else enableOwn()
        }
      "
    />
    <div class="field-hint" style="margin-left: 0">
      {{ hint }}
    </div>

    <template v-if="!cfg.coverCanvas.followBody">
      <ParamField
        label="单位"
        type="select"
        :modelValue="cfg.coverCanvas.unit"
        :options="SIZE_UNITS.map((u) => ({ value: u.value, label: u.label }))"
        @update:modelValue="(v) => ((cfg.coverCanvas.unit = v as 'px'), onSizeChange())"
      />
      <ParamField
        label="宽"
        :modelValue="cfg.coverCanvas.width"
        :min="1"
        :max="100000"
        :step="1"
        unit="px"
        @update:modelValue="(v) => ((cfg.coverCanvas.width = Number(v)), onSizeChange())"
      />
      <ParamField
        label="高"
        :modelValue="cfg.coverCanvas.height"
        :min="1"
        :max="100000"
        :step="1"
        unit="px"
        @update:modelValue="(v) => ((cfg.coverCanvas.height = Number(v)), onSizeChange())"
      />
      <ParamField
        label="朝向"
        type="select"
        :modelValue="cfg.coverCanvas.orientation"
        :options="ORIENTATIONS.map((o) => ({ value: o.value, label: o.label }))"
        @update:modelValue="(v) => ((cfg.coverCanvas.orientation = v as 'auto'), onSizeChange())"
      />
      <div class="field-hint" style="margin-left: 0">
        朝向会按需交换宽高（横向/纵向），方形取两者较大值补齐。改动只影响封面，正文排版不变。
      </div>
    </template>
  </ParamSection>
</template>
