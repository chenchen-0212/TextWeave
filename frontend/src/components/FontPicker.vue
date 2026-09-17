<script setup lang="ts">
/**
 * 字体选择器（F-10）。
 *
 * 列表只包含后端筛出的「覆盖常用汉字区」的字体 —— 这是为了避免用户
 * 选到纯拉丁字体后渲染出满屏方块。用户上传的字体排在前面。
 */

import { computed, ref } from 'vue'
import type { FontEntry } from '../types'
import { useAppStore } from '../stores/config'
import { formatBytes } from '../utils/bytes'

const store = useAppStore()
const cfg = store.cfg

const keyword = ref('')

const filtered = computed<FontEntry[]>(() => {
  const k = keyword.value.trim().toLowerCase()
  const list = store.fonts
  const arr = k ? list.filter((f) => f.family.toLowerCase().includes(k)) : list
  // 列表可能很长（Windows 上可达上百个），只渲染前 150 个保证滚动流畅
  return arr.slice(0, 150)
})

const totalLabel = computed(() => {
  const total = store.fonts.length
  if (store.fontsLoading) return '正在扫描系统字体…'
  if (total === 0) return '未找到支持中文的字体'
  return `共 ${total} 个支持中文的字体`
})

function isActive(f: FontEntry): boolean {
  if (cfg.text.fontSource === 'user' && f.source === 'user') return cfg.text.fontPath === f.path
  return cfg.text.fontSource === 'system' && f.source === 'system' && cfg.text.fontFamily === f.family
}

function pick(f: FontEntry): void {
  store.selectFont(f.family, f.source, f.path)
}

async function removeFont(f: FontEntry, ev: Event): Promise<void> {
  ev.stopPropagation()
  await store.deleteFont(f.path)
}
</script>

<template>
  <div class="font-picker">
    <div class="row mb8">
      <input
        v-model="keyword"
        type="text"
        placeholder="搜索字体…"
        class="grow"
      />
      <button class="btn sm" type="button" @click="store.chooseAndImportFont()">上传</button>
    </div>

    <div class="font-list">
      <div v-if="filtered.length === 0" class="font-item muted">
        <span class="fam">{{ totalLabel }}</span>
      </div>
      <div
        v-for="f in filtered"
        :key="f.path + f.family"
        class="font-item"
        :class="{ active: isActive(f) }"
        :title="`${f.family}\n${f.path}\n${formatBytes(f.bytes)}`"
        @click="pick(f)"
      >
        <span class="fam" :style="{ fontFamily: `'${f.family}'` }">{{ f.family }}</span>
        <span v-if="f.source === 'user'" class="tag user">已上传</span>
        <span v-if="!f.verified" class="tag" title="该格式无法在导入时校验字形覆盖">未校验</span>
        <button
          v-if="f.source === 'user'"
          class="btn sm ghost"
          type="button"
          title="移除该字体"
          @click="removeFont(f, $event)"
        >
          ✕
        </button>
      </div>
    </div>

    <div class="field-hint" style="margin-left: 0; margin-top: 7px">
      {{ totalLabel }}。应用不内置字体，使用系统已安装字体；跨机器保持一致请上传字体文件。
    </div>
  </div>
</template>
