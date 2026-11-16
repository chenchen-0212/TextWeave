<script setup lang="ts">
/**
 * 字体选择器（F-10）。
 *
 * 列表只包含后端筛出的「覆盖常用汉字区」的字体 —— 这是为了避免用户
 * 选到纯拉丁字体后渲染出满屏方块。用户上传的字体排在前面。
 */

import { computed, ref } from 'vue'
import type { FontEntry, FontSource } from '../types'
import { useAppStore } from '../stores/config'
import { formatBytes } from '../utils/bytes'

/**
 * 默认作用于正文文字；传入 family/source/path 时改为「选择即 emit」，
 * 供封面等需要独立字体的位置复用同一套字体源。
 */
const props = defineProps<{
  family?: string
  source?: FontSource
  path?: string
}>()

const emit = defineEmits<{ (e: 'select', f: FontEntry): void }>()

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

/** 是否「跟随正文」模式（未传入目标字体时作用于正文配置） */
const followsBody = computed(() => props.family === undefined)

function isActive(f: FontEntry): boolean {
  if (followsBody.value) {
    if (cfg.text.fontSource === 'user' && f.source === 'user') return cfg.text.fontPath === f.path
    return cfg.text.fontSource === 'system' && f.source === 'system' && cfg.text.fontFamily === f.family
  }
  if (props.source === 'user') return f.source === 'user' && props.path === f.path
  return f.source === 'system' && props.family === f.family
}

function pick(f: FontEntry): void {
  if (followsBody.value) {
    store.selectFont(f.family, f.source, f.path)
    return
  }
  emit('select', f)
}

/** 上传：作用于正文的按原逻辑顺带设为正文字体；否则只把新字体交给调用方 */
async function upload(): Promise<void> {
  const entry = await store.chooseAndImportFont(followsBody.value)
  if (entry && !followsBody.value) emit('select', entry)
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
      <button class="btn sm" type="button" @click="upload">上传</button>
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
