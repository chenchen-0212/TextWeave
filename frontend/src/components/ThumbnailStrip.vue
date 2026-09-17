<script setup lang="ts">
/**
 * 缩略图条（F-13 分页填充率提示）。
 *
 * 每个缩略图下方叠加一条填充率进度条，标记过空 / 过满的页面。
 * 默认蒙版是铺满卡片，内容偏少的页会显得空旷，这条提示就是配套的兜底手段。
 */

import { onMounted, ref, watch } from 'vue'
import { useAppStore } from '../stores/config'
import { CanvasRenderer } from '../render/CanvasRenderer'
import { renderThumbnail } from '../render/exporters'

const store = useAppStore()

/** 缩略图渲染宽度（显示宽度 62px，用 2× 保证清晰） */
const THUMB_PX = 124

const thumbs = ref<string[]>([])
let renderer: CanvasRenderer | null = null
let timer: number | null = null

function build(): void {
  if (!renderer) renderer = new CanvasRenderer(document.createElement('canvas'))
  const pages = store.pages
  const out: string[] = []
  try {
    for (const p of pages) {
      out.push(renderThumbnail(p, store.renderCtx, renderer, THUMB_PX))
    }
  } catch {
    // 单张缩略图失败不影响整条缩略图带
  }
  thumbs.value = out
}

function schedule(delay = 280): void {
  if (timer !== null) clearTimeout(timer)
  timer = window.setTimeout(() => {
    timer = null
    build()
  }, delay)
}

watch(() => [store.pages, store.renderCtx], () => schedule())

onMounted(() => schedule(0))

function statusOf(index: number): string {
  const p = store.diag?.pages[index]
  return p ? p.status : 'normal'
}

function fillOf(index: number): number {
  const p = store.diag?.pages[index]
  if (!p) return 0
  return Math.max(3, Math.min(100, Math.round(p.fillRate * 100)))
}

function titleOf(index: number): string {
  const p = store.diag?.pages[index]
  const kind = store.pages[index]?.kind === 'cover' ? '封面' : '正文'
  if (!p) return `第 ${index + 1} 张 · ${kind}`
  return `第 ${index + 1} 张 · ${kind} · 填充 ${Math.round(p.fillRate * 100)}%`
}
</script>

<template>
  <div v-if="store.hasContent" class="thumb-strip">
    <div class="thumb-strip-head">
      <span>共 {{ store.totalPages }} 张</span>
      <span>·</span>
      <span>填充率低于 50% 的页面会标黄</span>
      <span class="grow" />
      <span v-if="store.rebuilding">排版中…</span>
    </div>

    <div class="thumb-scroll">
      <div
        v-for="(t, i) in thumbs"
        :key="i"
        class="thumb"
        :class="{ active: i === store.currentPage }"
        :title="titleOf(i)"
        @click="store.currentPage = i"
      >
        <img :src="t" :alt="`第 ${i + 1} 张`" />
        <span class="idx">{{ i + 1 }}</span>
        <div class="fill" :class="statusOf(i)">
          <i :style="{ width: fillOf(i) + '%' }"></i>
        </div>
      </div>
    </div>
  </div>
</template>
