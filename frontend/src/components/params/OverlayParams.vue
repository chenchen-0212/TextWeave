<script setup lang="ts">
/** 引导元素图层（N-03）：二维码 / logo / 水印 / CTA 文字条，全页位置一致叠加。 */

import { useAppStore } from '../../stores/config'
import { OVERLAY_ANCHORS } from '../../types'
import ParamField from '../ui/ParamField.vue'
import ParamSection from './ParamSection.vue'

const store = useAppStore()
const cfg = store.cfg

function onAnchorChange(id: string, v: string): void {
  const item = cfg.overlay.items.find((it) => it.id === id)
  if (item) item.anchor = v as (typeof OVERLAY_ANCHORS)[number]['value']
}

function kindLabel(kind: string): string {
  return kind === 'text' ? '文字条' : '图片'
}
</script>

<template>
  <ParamSection
    title="引导元素"
    :badge="cfg.overlay.items.length > 0 ? `${cfg.overlay.items.length} 个` : '无'"
    :default-open="false"
  >
    <div class="field-hint" style="margin-left: 0">
      每页自动叠加引导元素（二维码、账号水印、「点击下方链接」等），全系列位置像素级一致，导出即成品、无需二次加工。随模板一起保存。
    </div>

    <div class="row" style="margin-bottom: 8px">
      <button class="btn sm" type="button" @click="store.addOverlayText()">+ 文字条</button>
      <button class="btn sm" type="button" @click="store.addOverlayImage()">+ 图片</button>
    </div>

    <div v-if="cfg.overlay.items.length === 0" class="field-hint" style="margin-left: 0">
      尚未添加引导元素。
    </div>

    <div v-for="item in cfg.overlay.items" :key="item.id" class="ovl-item">
      <div class="row between">
        <label class="check-row" style="flex: 1">
          <input v-model="item.enabled" type="checkbox" />
          <span style="font-size: 11.5px">
            {{ kindLabel(item.kind) }} · {{ item.kind === 'text' ? item.text || '（空）' : item.name || '未选图' }}
          </span>
        </label>
        <button class="btn sm ghost" type="button" @click="store.removeOverlay(item.id)">删</button>
      </div>

      <template v-if="item.kind === 'text'">
        <ParamField
          label="文字"
          type="text"
          :modelValue="item.text"
          placeholder="例：点击下方链接看后续"
          @update:modelValue="(v) => (item.text = String(v))"
        />
        <ParamField
          label="字号"
          :modelValue="item.fontSize"
          :min="10"
          :max="200"
          unit="px"
          @update:modelValue="(v) => (item.fontSize = Number(v))"
        />
        <ParamField
          label="文字颜色"
          type="color"
          :modelValue="item.color"
          @update:modelValue="(v) => (item.color = String(v))"
        />
        <ParamField
          label="底条"
          type="check"
          :modelValue="Boolean(item.barColor)"
          @update:modelValue="(v) => (item.barColor = v ? '#000000' : '')"
        />
        <template v-if="item.barColor">
          <ParamField
            label="底条颜色"
            type="color"
            :modelValue="item.barColor"
            @update:modelValue="(v) => (item.barColor = String(v))"
          />
          <ParamField
            label="底条浓度"
            :modelValue="item.barAlpha"
            :min="0"
            :max="1"
            :step="0.05"
            @update:modelValue="(v) => (item.barAlpha = Number(v))"
          />
        </template>
      </template>

      <template v-else>
        <div class="field-hint" style="margin-left: 0">
          图片：{{ item.path || '未选择' }}（路径不参与分享）
        </div>
        <ParamField
          label="显示高度"
          :modelValue="item.height"
          :min="16"
          :max="1000"
          unit="px"
          @update:modelValue="(v) => (item.height = Number(v))"
        />
        <ParamField
          label="不透明度"
          :modelValue="item.opacity"
          :min="0"
          :max="1"
          :step="0.05"
          @update:modelValue="(v) => (item.opacity = Number(v))"
        />
      </template>

      <ParamField
        label="位置"
        type="select"
        :modelValue="item.anchor"
        :options="[...OVERLAY_ANCHORS]"
        @update:modelValue="(v) => onAnchorChange(item.id, String(v))"
      />

      <ParamField
        label="水平边距"
        :modelValue="item.marginX"
        :min="0"
        :max="2000"
        unit="px"
        @update:modelValue="(v) => (item.marginX = Number(v))"
      />
      <ParamField
        label="垂直边距"
        :modelValue="item.marginY"
        :min="0"
        :max="2000"
        unit="px"
        @update:modelValue="(v) => (item.marginY = Number(v))"
      />
      <ParamField
        label="封面也显示"
        type="check"
        :modelValue="item.onCover"
        @update:modelValue="(v) => (item.onCover = Boolean(v))"
      />
    </div>
  </ParamSection>
</template>

<style scoped>
.ovl-item {
  padding: 8px;
  margin-bottom: 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm, 6px);
}
</style>
