<script setup lang="ts">
/**
 * 背景图参数（对应决策 D-09：手动调参，不做自动分析）。
 *
 * 同一张背景图在所有页使用完全相同的目标矩形与滤镜，这是系列视觉一致性的前提。
 */

import { useAppStore } from '../../stores/config'
import ParamField from '../ui/ParamField.vue'
import ParamSection from './ParamSection.vue'

const store = useAppStore()
const cfg = store.cfg

const FILL_MODES = [
  { value: 'cover', label: '填充裁剪' },
  { value: 'contain', label: '完整显示' },
  { value: 'stretch', label: '拉伸' },
]
</script>

<template>
  <ParamSection title="背景图">
    <ParamField
      label="填充方式"
      type="select"
      :modelValue="cfg.background.fillMode"
      :options="FILL_MODES"
      @update:modelValue="(v) => (cfg.background.fillMode = v as 'cover' | 'contain' | 'stretch')"
    />
    <ParamField
      label="亮度"
      :modelValue="cfg.background.brightness"
      :min="0.3"
      :max="2"
      :step="0.01"
      :decimals="2"
      @update:modelValue="(v) => (cfg.background.brightness = Number(v))"
    />
    <ParamField
      label="对比度"
      :modelValue="cfg.background.contrast"
      :min="0.3"
      :max="2"
      :step="0.01"
      :decimals="2"
      @update:modelValue="(v) => (cfg.background.contrast = Number(v))"
    />
    <ParamField
      label="饱和度"
      :modelValue="cfg.background.saturate"
      :min="0"
      :max="2"
      :step="0.01"
      :decimals="2"
      @update:modelValue="(v) => (cfg.background.saturate = Number(v))"
    />
    <ParamField
      label="模糊"
      :modelValue="cfg.background.blur"
      :min="0"
      :max="40"
      :step="1"
      unit="px"
      @update:modelValue="(v) => (cfg.background.blur = Number(v))"
    />
    <ParamField
      label="暗角"
      :modelValue="cfg.background.vignette"
      :min="0"
      :max="1"
      :step="0.01"
      :decimals="2"
      @update:modelValue="(v) => (cfg.background.vignette = Number(v))"
    />

    <div class="field">
      <div class="field-label">取景微调</div>
      <div class="field-control">
        <button
          class="btn sm ghost"
          type="button"
          title="恢复默认"
          @click="
            () => {
              cfg.background.offsetX = 0
              cfg.background.offsetY = 0
            }
          "
        >
          重置
        </button>
      </div>
    </div>
    <ParamField
      label="水平偏移"
      :modelValue="cfg.background.offsetX"
      :min="-1"
      :max="1"
      :step="0.01"
      :decimals="2"
      @update:modelValue="(v) => (cfg.background.offsetX = Number(v))"
    />
    <ParamField
      label="垂直偏移"
      :modelValue="cfg.background.offsetY"
      :min="-1"
      :max="1"
      :step="0.01"
      :decimals="2"
      @update:modelValue="(v) => (cfg.background.offsetY = Number(v))"
    />

    <div class="field-hint">
      取景微调只在「填充裁剪」模式下生效，用于主体偏离画面中心时把构图挪回来。
    </div>
  </ParamSection>
</template>
