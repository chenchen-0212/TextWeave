<script setup lang="ts">
/**
 * 文本级蒙版参数控件（v0.5.0）。
 *
 * 与正文/封面底衬的 `MaskControls` 分开：文本蒙版是贴合文字块的局部面板，
 * 没有 position（铺满/居中/靠上）语义，也不支持毛玻璃；
 * 内边距拆成 **水平 padX / 垂直 padY** 两组独立参数。
 */

import { computed } from 'vue'
import type { CoverTextMask } from '../../types'
import { COVER_TEXT_MASK_TYPES, COVER_TEXT_PAD_MAX, COVER_TEXT_PAD_MIN } from '../../types'
import ParamField from '../ui/ParamField.vue'

const props = defineProps<{ mask: CoverTextMask }>()
const emit = defineEmits<{ (e: 'type-change', t: CoverTextMask['type']): void }>()

const DIRECTIONS = [
  { value: 'bottom', label: '底部' },
  { value: 'top', label: '顶部' },
  { value: 'both', label: '上下' },
]

const card = computed(() => (props.mask.type === 'card' ? props.mask : null))
const veil = computed(() => (props.mask.type === 'veil' ? props.mask : null))
const grad = computed(() => (props.mask.type === 'gradient' ? props.mask : null))

function patch(key: string, value: unknown): void {
  ;(props.mask as unknown as Record<string, unknown>)[key] = value
}
</script>

<template>
  <div>
    <div class="field">
      <div class="field-label">蒙版形态</div>
      <div class="field-control">
        <div class="seg full">
          <button
            v-for="t in COVER_TEXT_MASK_TYPES"
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

    <!-- 卡片：内边距拆水平 / 垂直两项 -->
    <template v-if="card">
      <ParamField
        label="卡片颜色"
        type="color"
        :modelValue="card.color"
        @update:modelValue="(v) => patch('color', String(v))"
      />
      <ParamField
        label="不透明度"
        :modelValue="card.alpha"
        :min="0"
        :max="1"
        :step="0.01"
        :decimals="2"
        @update:modelValue="(v) => patch('alpha', Number(v))"
      />
      <ParamField
        label="圆角半径"
        :modelValue="card.radius"
        :min="0"
        :max="200"
        unit="px"
        @update:modelValue="(v) => patch('radius', Number(v))"
      />
      <ParamField
        label="水平内边距"
        :modelValue="card.padX"
        :min="COVER_TEXT_PAD_MIN"
        :max="COVER_TEXT_PAD_MAX"
        unit="px"
        @update:modelValue="(v) => patch('padX', Number(v))"
      />
      <ParamField
        label="垂直内边距"
        :modelValue="card.padY"
        :min="COVER_TEXT_PAD_MIN"
        :max="COVER_TEXT_PAD_MAX"
        unit="px"
        @update:modelValue="(v) => patch('padY', Number(v))"
      />
      <div class="field-hint">
        水平内边距作用于左右两侧，垂直内边距作用于上下两侧；两项相等时与旧版单一内边距效果一致。
      </div>
      <div class="row" style="margin-top: -4px">
        <button
          class="btn sm ghost"
          type="button"
          title="把水平内边距复制到垂直内边距"
          @click="patch('padY', card.padX)"
        >
          水平 → 垂直
        </button>
        <button
          class="btn sm ghost"
          title="把垂直内边距复制到水平内边距"
          @click="patch('padX', card.padY)"
        >
          垂直 → 水平
        </button>
        <button class="btn sm ghost" title="恢复默认内边距" @click="patch('padX', 28), patch('padY', 28)">
          重置
        </button>
      </div>
    </template>

    <!-- 纯色遮罩：覆盖整块文字区域，无内边距 -->
    <template v-else-if="veil">
      <ParamField
        label="遮罩颜色"
        type="color"
        :modelValue="veil.color"
        @update:modelValue="(v) => patch('color', String(v))"
      />
      <ParamField
        label="不透明度"
        :modelValue="veil.alpha"
        :min="0"
        :max="1"
        :step="0.01"
        :decimals="2"
        @update:modelValue="(v) => patch('alpha', Number(v))"
      />
      <div class="field-hint">纯色遮罩贴合文字块本身，不产生内边距。</div>
    </template>

    <!-- 渐变遮罩 -->
    <template v-else-if="grad">
      <ParamField
        label="渐变颜色"
        type="color"
        :modelValue="grad.color"
        @update:modelValue="(v) => patch('color', String(v))"
      />
      <ParamField
        label="最大浓度"
        :modelValue="grad.maxAlpha"
        :min="0"
        :max="1"
        :step="0.01"
        :decimals="2"
        @update:modelValue="(v) => patch('maxAlpha', Number(v))"
      />
      <ParamField
        label="渐变方向"
        type="select"
        :modelValue="grad.direction"
        :options="DIRECTIONS"
        @update:modelValue="(v) => patch('direction', v)"
      />
      <ParamField
        label="实色比例"
        :modelValue="grad.solidRatio"
        :min="0"
        :max="0.95"
        :step="0.01"
        :decimals="2"
        @update:modelValue="(v) => patch('solidRatio', Number(v))"
      />
      <ParamField
        label="透明位置"
        :modelValue="grad.transparentRatio"
        :min="0.01"
        :max="0.99"
        :step="0.01"
        :decimals="2"
        @update:modelValue="(v) => patch('transparentRatio', Number(v))"
      />
    </template>
  </div>
</template>
