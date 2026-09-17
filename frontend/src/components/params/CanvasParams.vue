<script setup lang="ts">
/** 画布参数：手机尺寸预设 + 自定义宽高 + 像素倍率 + 输出格式。 */

import { computed } from 'vue'
import { CANVAS_PRESETS } from '../../types'
import { useAppStore } from '../../stores/config'
import ParamField from '../ui/ParamField.vue'
import ParamSection from './ParamSection.vue'

const store = useAppStore()
const cfg = store.cfg

const FORMATS = [
  { value: 'png', label: 'PNG 无损' },
  { value: 'jpeg', label: 'JPEG 体积小' },
  { value: 'webp', label: 'WebP' },
]

/** 最简宽高比，例如 9:16 */
const aspect = computed(() => {
  const w = Math.round(cfg.canvas.width)
  const h = Math.round(cfg.canvas.height)
  if (w <= 0 || h <= 0) return ''
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const d = gcd(w, h) || 1
  return `${w / d}:${h / d}`
})

/** 实际输出的像素尺寸 */
const outputPixels = computed(() => {
  const s = cfg.canvas.scale
  return `${Math.round(cfg.canvas.width * s)} × ${Math.round(cfg.canvas.height * s)}`
})

const isLossy = computed(() => cfg.canvas.format !== 'png')

function selectPreset(id: string): void {
  store.applyPreset(id)
}

function onSizeChange(): void {
  store.markCustomSize()
}
</script>

<template>
  <ParamSection title="画布" :badge="`${aspect} · ${outputPixels}`">
    <!--
      预设用两列网格而不是单行分段控件：
      4 个中文标签在 336px 的面板里塞不进一行，而分段控件是 nowrap 的、
      无法收缩，结果是按钮溢出到控件背景之外。网格布局同时也腾出空间
      显示分辨率，比只有名字更有用。
    -->
    <div class="field-stack">
      <div class="field-label">尺寸预设</div>
      <div class="preset-grid">
        <button
          v-for="p in CANVAS_PRESETS"
          :key="p.id"
          class="preset-btn"
          type="button"
          :class="{ active: cfg.canvas.preset === p.id }"
          :title="p.note"
          @click="selectPreset(p.id)"
        >
          <span class="preset-name">{{ p.label }}</span>
          <span class="preset-dim">{{ p.width }} × {{ p.height }}</span>
        </button>
      </div>
    </div>

    <ParamField
      label="宽度"
      type="number"
      :modelValue="cfg.canvas.width"
      :min="200"
      :max="8000"
      :step="1"
      unit="px"
      @update:modelValue="
        (v) => {
          cfg.canvas.width = Number(v)
          onSizeChange()
        }
      "
    />
    <ParamField
      label="高度"
      type="number"
      :modelValue="cfg.canvas.height"
      :min="200"
      :max="8000"
      :step="1"
      unit="px"
      @update:modelValue="
        (v) => {
          cfg.canvas.height = Number(v)
          onSizeChange()
        }
      "
    />
    <ParamField
      label="像素倍率"
      :modelValue="cfg.canvas.scale"
      :min="1"
      :max="3"
      :step="1"
      unit="×"
      @update:modelValue="(v) => (cfg.canvas.scale = Number(v))"
    />
    <ParamField
      label="输出格式"
      type="select"
      :modelValue="cfg.canvas.format"
      :options="FORMATS"
      @update:modelValue="(v) => (cfg.canvas.format = v as 'png' | 'jpeg' | 'webp')"
    />
    <ParamField
      v-if="isLossy"
      label="画质"
      :modelValue="cfg.canvas.quality"
      :min="0.5"
      :max="1"
      :step="0.01"
      :decimals="2"
      @update:modelValue="(v) => (cfg.canvas.quality = Number(v))"
    />

    <div class="field-hint">
      输出 {{ outputPixels }} 像素。1080 宽已满足绝大多数发布场景，像素倍率通常保持 1×。
    </div>
  </ParamSection>
</template>
