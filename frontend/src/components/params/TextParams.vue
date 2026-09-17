<script setup lang="ts">
/** 文字参数：字体、字号、行高、间距、对齐、可用区边距。 */

import { computed, ref } from 'vue'
import { useAppStore } from '../../stores/config'
import FontPicker from '../FontPicker.vue'
import ParamField from '../ui/ParamField.vue'
import ParamSection from './ParamSection.vue'

const store = useAppStore()
const cfg = store.cfg

const showFonts = ref(false)

const WEIGHTS = [
  { value: 300, label: '细体 300' },
  { value: 400, label: '常规 400' },
  { value: 500, label: '中等 500' },
  { value: 700, label: '加粗 700' },
]

const ALIGNS = [
  { value: 'left', label: '左对齐' },
  { value: 'justify', label: '两端对齐' },
  { value: 'center', label: '居中' },
]

const fontLabel = computed(() => cfg.text.fontFamily || '未选择')

/** 当前生效字号（可能因张数约束与设定值不同） */
const appliedHint = computed(() => {
  const applied = store.diag?.applied
  if (!applied) return ''
  if (Math.abs(applied.fontSize - cfg.text.fontSize) < 0.5) return ''
  return `受张数约束影响，实际使用 ${applied.fontSize}px`
})
</script>

<template>
  <ParamSection title="文字" :badge="`${cfg.text.fontSize}px`">
    <div class="field">
      <div class="field-label">字体</div>
      <div class="field-control">
        <button
          class="btn sm grow"
          type="button"
          style="justify-content: space-between; overflow: hidden"
          @click="showFonts = !showFonts"
        >
          <span style="overflow: hidden; text-overflow: ellipsis">{{ fontLabel }}</span>
          <span class="muted">{{ showFonts ? '收起' : '更换' }}</span>
        </button>
      </div>
    </div>
    <div v-show="showFonts" class="mb8">
      <FontPicker />
    </div>

    <div v-if="store.fontWarning" class="notice warn">{{ store.fontWarning }}</div>

    <ParamField
      label="字号"
      :modelValue="cfg.text.fontSize"
      :min="16"
      :max="200"
      unit="px"
      @update:modelValue="(v) => (cfg.text.fontSize = Number(v))"
    />
    <div v-if="appliedHint" class="field-hint">{{ appliedHint }}</div>

    <ParamField
      label="字重"
      type="select"
      :modelValue="cfg.text.fontWeight"
      :options="WEIGHTS"
      @update:modelValue="(v) => (cfg.text.fontWeight = Number(v))"
    />
    <ParamField
      label="文字颜色"
      type="color"
      :modelValue="cfg.text.color"
      @update:modelValue="(v) => (cfg.text.color = String(v))"
    />
    <ParamField
      label="行高"
      :modelValue="cfg.text.lineHeightRatio"
      :min="1.2"
      :max="2.5"
      :step="0.05"
      :decimals="2"
      @update:modelValue="(v) => (cfg.text.lineHeightRatio = Number(v))"
    />
    <ParamField
      label="字间距"
      :modelValue="cfg.text.letterSpacing"
      :min="-2"
      :max="10"
      :step="0.5"
      :decimals="1"
      unit="px"
      @update:modelValue="(v) => (cfg.text.letterSpacing = Number(v))"
    />
    <ParamField
      label="段间距"
      :modelValue="cfg.text.paragraphSpacingRatio"
      :min="0"
      :max="2"
      :step="0.05"
      :decimals="2"
      @update:modelValue="(v) => (cfg.text.paragraphSpacingRatio = Number(v))"
    />
    <ParamField
      label="对齐方式"
      type="select"
      :modelValue="cfg.text.textAlign"
      :options="ALIGNS"
      @update:modelValue="(v) => (cfg.text.textAlign = v as 'left' | 'justify' | 'center')"
    />
    <ParamField
      label="首行缩进"
      :modelValue="cfg.text.textIndent"
      :min="0"
      :max="4"
      unit="字"
      @update:modelValue="(v) => (cfg.text.textIndent = Number(v))"
    />
    <ParamField
      label="区边距"
      :modelValue="cfg.text.padding"
      :min="0"
      :max="400"
      unit="px"
      @update:modelValue="(v) => (cfg.text.padding = Number(v))"
    />
    <ParamField
      label="孤寡行保护"
      :modelValue="cfg.text.minOrphanLines"
      :min="1"
      :max="5"
      unit="行"
      @update:modelValue="(v) => (cfg.text.minOrphanLines = Number(v))"
    />

    <div class="field-hint">
      「区边距」是文字区到画布边缘的距离；使用圆角卡片蒙版时，背景图会在该边距之外露出。
    </div>
  </ParamSection>
</template>
