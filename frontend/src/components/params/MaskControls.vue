<script setup lang="ts">
/**
 * 蒙版参数控件（三种形态共用）。
 *
 * 正文蒙版与封面蒙版都复用它，避免两处维护同一套表单。
 */

import { computed } from 'vue'
import type { CardMask, GradientMask, MaskConfig, MaskType, VeilMask } from '../../types'
import ParamField from '../ui/ParamField.vue'

const props = withDefaults(
  defineProps<{
    mask: MaskConfig
    /** 是否显示顶部形态切换器（封面可以只调参数不换形态） */
    showTypeSwitch?: boolean
  }>(),
  { showTypeSwitch: true },
)

const emit = defineEmits<{ (e: 'type-change', t: MaskType): void }>()

const MASK_TYPES: { value: MaskType; label: string }[] = [
  { value: 'card', label: '圆角卡片' },
  { value: 'veil', label: '全图遮罩' },
  { value: 'gradient', label: '渐变遮罩' },
]

const card = computed<CardMask | null>(() =>
  props.mask.type === 'card' ? (props.mask as CardMask) : null,
)
const veil = computed<VeilMask | null>(() =>
  props.mask.type === 'veil' ? (props.mask as VeilMask) : null,
)
const grad = computed<GradientMask | null>(() =>
  props.mask.type === 'gradient' ? (props.mask as GradientMask) : null,
)

const POSITIONS = [
  { value: 'stretchToFill', label: '铺满（推荐）' },
  { value: 'center', label: '居中' },
  { value: 'top', label: '靠上' },
  { value: 'bottom', label: '靠下' },
  { value: 'custom', label: '自定义（只动蒙版）' },
]

/** 自定义矩形的比例值 ↔ 界面百分数 */
function pct(v: number | undefined, def: number): number {
  return Math.round((v ?? def) * 100)
}

const DIRECTIONS = [
  { value: 'bottom', label: '底部' },
  { value: 'top', label: '顶部' },
  { value: 'both', label: '上下' },
]

function patch(key: string, value: unknown): void {
  ;(props.mask as unknown as Record<string, unknown>)[key] = value
}

const fillLabel = computed(() => (card.value?.position === 'stretchToFill' ? '卡片内边距' : '卡片内边距'))
</script>

<template>
  <div>
    <div v-if="showTypeSwitch" class="field">
      <div class="field-label">蒙版形态</div>
      <div class="field-control">
        <div class="seg full">
          <button
            v-for="t in MASK_TYPES"
            :key="t.value"
            type="button"
            :class="{ active: mask.type === t.value }"
            @click="emit('type-change', t.value)"
          >
            {{ t.label }}
          </button>
        </div>
      </div>
    </div>

    <!-- 形态 A：圆角卡片 -->
    <template v-if="card">
      <ParamField
        label="卡片颜色"
        type="color"
        :modelValue="card.color"
        @update:modelValue="(v) => patch('color', v)"
      />
      <ParamField
        label="不透明度"
        :modelValue="card.alpha"
        :min="0"
        :max="1"
        :step="0.01"
        :decimals="2"
        @update:modelValue="(v) => patch('alpha', v)"
      />
      <ParamField
        label="圆角半径"
        :modelValue="card.radius"
        :min="0"
        :max="200"
        unit="px"
        @update:modelValue="(v) => patch('radius', v)"
      />
      <ParamField
        label="卡片内边距"
        :modelValue="card.pad"
        :min="0"
        :max="400"
        unit="px"
        @update:modelValue="(v) => patch('pad', v)"
      />
      <ParamField
        label="毛玻璃"
        :modelValue="card.blur"
        :min="0"
        :max="40"
        unit="px"
        @update:modelValue="(v) => patch('blur', v)"
      />
      <ParamField
        label="卡片位置"
        type="select"
        :modelValue="card.position"
        :options="POSITIONS"
        @update:modelValue="(v) => patch('position', v)"
      />
      <template v-if="card.position === 'custom'">
        <ParamField
          label="左"
          :modelValue="pct(card.cx, 0.1)"
          :min="0"
          :max="100"
          unit="%"
          @update:modelValue="(v) => patch('cx', Number(v) / 100)"
        />
        <ParamField
          label="上"
          :modelValue="pct(card.cy, 0.1)"
          :min="0"
          :max="100"
          unit="%"
          @update:modelValue="(v) => patch('cy', Number(v) / 100)"
        />
        <ParamField
          label="宽"
          :modelValue="pct(card.cw, 0.8)"
          :min="1"
          :max="100"
          unit="%"
          @update:modelValue="(v) => patch('cw', Number(v) / 100)"
        />
        <ParamField
          label="高"
          :modelValue="pct(card.ch, 0.8)"
          :min="1"
          :max="100"
          unit="%"
          @update:modelValue="(v) => patch('ch', Number(v) / 100)"
        />
        <div class="field-hint">
          自定义位置只改变蒙版的绘制区域，文字排版、字号与分页完全不受影响。
        </div>
      </template>
      <div v-else class="field-hint">
        铺满模式下卡片每一页位置尺寸完全一致，系列一致性最强；其余定位会随内容高度变化。
      </div>
    </template>

    <!-- 形态 B：全图遮罩 -->
    <template v-if="veil">
      <ParamField
        label="遮罩颜色"
        type="color"
        :modelValue="veil.color"
        @update:modelValue="(v) => patch('color', v)"
      />
      <ParamField
        label="遮罩浓度"
        :modelValue="veil.alpha"
        :min="0"
        :max="1"
        :step="0.01"
        :decimals="2"
        @update:modelValue="(v) => patch('alpha', v)"
      />
      <ParamField
        label="顶部加深"
        :modelValue="veil.topBoost"
        :min="0"
        :max="1"
        :step="0.01"
        :decimals="2"
        @update:modelValue="(v) => patch('topBoost', v)"
      />
      <ParamField
        label="底部加深"
        :modelValue="veil.bottomBoost"
        :min="0"
        :max="1"
        :step="0.01"
        :decimals="2"
        @update:modelValue="(v) => patch('bottomBoost', v)"
      />
    </template>

    <!-- 形态 C：渐变遮罩 -->
    <template v-if="grad">
      <ParamField
        label="渐变方向"
        type="select"
        :modelValue="grad.direction"
        :options="DIRECTIONS"
        @update:modelValue="(v) => patch('direction', v)"
      />
      <ParamField
        label="遮罩颜色"
        type="color"
        :modelValue="grad.color"
        @update:modelValue="(v) => patch('color', v)"
      />
      <ParamField
        label="最大浓度"
        :modelValue="grad.maxAlpha"
        :min="0"
        :max="1"
        :step="0.01"
        :decimals="2"
        @update:modelValue="(v) => patch('maxAlpha', v)"
      />
      <ParamField
        label="满强度位置"
        :modelValue="grad.solidRatio"
        :min="0"
        :max="0.9"
        :step="0.01"
        :decimals="2"
        @update:modelValue="(v) => patch('solidRatio', v)"
      />
      <ParamField
        label="透明起始"
        :modelValue="grad.transparentRatio"
        :min="0.05"
        :max="0.95"
        :step="0.01"
        :decimals="2"
        @update:modelValue="(v) => patch('transparentRatio', v)"
      />
      <div class="field-hint">
        「透明起始」决定可用文字区高度：文字只能落在被遮罩覆盖的区域，改这个值会触发重新分页。
      </div>
    </template>
  </div>
</template>
