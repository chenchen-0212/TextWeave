<script setup lang="ts">
/**
 * 通用参数控件。
 *
 * 用单一组件覆盖 slider / number / color / select / text / check 六种形态，
 * 避免为每种控件重复写一套 label + 布局 + 事件转发。
 */

import { computed } from 'vue'

type FieldType = 'slider' | 'number' | 'color' | 'select' | 'text' | 'check'

interface Option {
  value: string | number
  label: string
}

const props = withDefaults(
  defineProps<{
    label: string
    modelValue: number | string | boolean
    type?: FieldType
    min?: number
    max?: number
    step?: number
    unit?: string
    decimals?: number
    options?: Option[]
    placeholder?: string
    disabled?: boolean
    /** slider 模式下是否在右侧显示读数 */
    showValue?: boolean
  }>(),
  {
    type: 'slider',
    min: 0,
    max: 100,
    step: 1,
    unit: '',
    decimals: 0,
    options: () => [],
    placeholder: '',
    disabled: false,
    showValue: true,
  },
)

const emit = defineEmits<{
  (e: 'update:modelValue', v: number | string | boolean): void
}>()

const numValue = computed(() => Number(props.modelValue) || 0)

const sliderPercent = computed(() => {
  const span = props.max - props.min
  if (span <= 0) return 0
  return Math.max(0, Math.min(100, ((numValue.value - props.min) / span) * 100))
})

const displayValue = computed(() => {
  const v = numValue.value
  const fixed = props.decimals > 0 ? v.toFixed(props.decimals) : String(Math.round(v))
  return props.unit ? `${fixed}${props.unit}` : fixed
})

function onSlider(e: Event): void {
  emit('update:modelValue', Number((e.target as HTMLInputElement).value))
}

function onNumber(e: Event): void {
  const raw = (e.target as HTMLInputElement).value
  const v = raw === '' ? props.min : Number(raw)
  emit('update:modelValue', Number.isNaN(v) ? props.min : v)
}

function onColor(e: Event): void {
  emit('update:modelValue', (e.target as HTMLInputElement).value)
}

function onText(e: Event): void {
  emit('update:modelValue', (e.target as HTMLInputElement).value)
}

function onSelect(e: Event): void {
  const raw = (e.target as HTMLSelectElement).value
  // 选项值为数字时保持数字类型，避免下游收到字符串
  const matched = props.options.find((o) => String(o.value) === raw)
  emit('update:modelValue', matched ? matched.value : raw)
}

function onCheck(e: Event): void {
  emit('update:modelValue', (e.target as HTMLInputElement).checked)
}
</script>

<template>
  <!-- 勾选项单独一行，不占 label 宽度 -->
  <label v-if="type === 'check'" class="check-row">
    <input type="checkbox" :checked="Boolean(modelValue)" :disabled="disabled" @change="onCheck" />
    <span>{{ label }}</span>
  </label>

  <div v-else class="field">
    <div class="field-label" :title="label">{{ label }}</div>
    <div class="field-control">
      <!-- 滑块 + 精确输入 -->
      <template v-if="type === 'slider'">
        <div class="slider-row">
          <input
            type="range"
            :min="min"
            :max="max"
            :step="step"
            :value="numValue"
            :disabled="disabled"
            :style="{ '--p': sliderPercent + '%' }"
            @input="onSlider"
          />
          <input
            v-if="showValue"
            class="num-inline"
            type="number"
            :min="min"
            :max="max"
            :step="step"
            :value="numValue"
            :disabled="disabled"
            @change="onNumber"
          />
        </div>
        <span v-if="!showValue" class="num-value">{{ displayValue }}</span>
      </template>

      <template v-else-if="type === 'number'">
        <input
          type="number"
          :min="min"
          :max="max"
          :step="step"
          :value="numValue"
          :disabled="disabled"
          @change="onNumber"
        />
        <span v-if="unit" class="num-value">{{ unit }}</span>
      </template>

      <template v-else-if="type === 'color'">
        <input
          type="color"
          :value="String(modelValue)"
          :disabled="disabled"
          @input="onColor"
        />
        <input
          type="text"
          class="mono"
          :value="String(modelValue)"
          :disabled="disabled"
          @change="onText"
        />
      </template>

      <template v-else-if="type === 'select'">
        <select :value="String(modelValue)" :disabled="disabled" @change="onSelect">
          <option v-for="o in options" :key="String(o.value)" :value="String(o.value)">
            {{ o.label }}
          </option>
        </select>
      </template>

      <template v-else>
        <input
          type="text"
          :value="String(modelValue)"
          :placeholder="placeholder"
          :disabled="disabled"
          @input="onText"
        />
      </template>
    </div>
  </div>
</template>

<style scoped>
.num-inline {
  flex: 0 0 auto;
  width: 54px;
  height: 24px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
</style>
