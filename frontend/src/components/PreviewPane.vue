<script setup lang="ts">
/**
 * 中间预览区：当前页大图 + 翻页。
 *
 * 预览用一个独立的 canvas 与 CanvasRenderer，按容器尺寸自适应显示比例；
 * 导出用的是另一个 canvas，两者互不干扰，但共享同一份 layout 与 renderCtx，
 * 保证「预览即所得」。
 */

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAppStore } from '../stores/config'
import { CanvasRenderer } from '../render/CanvasRenderer'

const store = useAppStore()

const stageRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)

let renderer: CanvasRenderer | null = null
let raf = 0
let ro: ResizeObserver | null = null

const page = computed(() => store.current)

const pageStatus = computed(() => {
  const d = store.diag
  if (!d) return null
  return d.pages[store.currentPage] ?? null
})

const statusLabel = computed(() => {
  const s = pageStatus.value
  if (!s) return ''
  const pct = Math.round(s.fillRate * 100)
  switch (s.status) {
    case 'sparse':
      return `本页较空（填充 ${pct}%）`
    case 'dense':
      return `本页较满（填充 ${pct}%）`
    case 'overflow':
      return `本页内容溢出（${pct}%）`
    default:
      return `填充 ${pct}%`
  }
})

function ensureRenderer(): CanvasRenderer | null {
  if (!canvasRef.value) return null
  if (!renderer) renderer = new CanvasRenderer(canvasRef.value)
  return renderer
}

/** 显示比例：让整页完整落在预览区内 */
function fitScale(): number {
  const stage = stageRef.value
  if (!stage) return 1
  const availW = stage.clientWidth - 48
  const availH = stage.clientHeight - 48
  const { width, height } = store.cfg.canvas
  if (availW <= 0 || availH <= 0 || width <= 0 || height <= 0) return 0.2
  return Math.min(availW / width, availH / height)
}

function render(): void {
  const r = ensureRenderer()
  const p = page.value
  const el = canvasRef.value
  if (!r || !el || !p) return

  const s = fitScale()
  r.renderPage(p, store.renderCtx, s)

  // CSS 尺寸按逻辑尺寸 × 显示比例，保持与画布像素一一对应
  el.style.width = `${Math.round(store.cfg.canvas.width * s)}px`
  el.style.height = `${Math.round(store.cfg.canvas.height * s)}px`
}

function schedule(): void {
  if (raf) cancelAnimationFrame(raf)
  raf = requestAnimationFrame(() => {
    raf = 0
    render()
  })
}

watch(
  () => [store.currentPage, store.pages, store.renderCtx],
  () => schedule(),
)

function go(delta: number): void {
  const next = store.currentPage + delta
  if (next < 0 || next >= store.totalPages) return
  store.currentPage = next
}

function onKey(e: KeyboardEvent): void {
  const target = e.target as HTMLElement | null
  // 输入框内不劫持方向键
  if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
    go(-1)
  } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
    go(1)
  }
}

onMounted(async () => {
  await nextTick()
  schedule()
  ro = new ResizeObserver(() => schedule())
  if (stageRef.value) ro.observe(stageRef.value)
  window.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => {
  if (raf) cancelAnimationFrame(raf)
  ro?.disconnect()
  window.removeEventListener('keydown', onKey)
})

defineExpose({ rerender: schedule })
</script>

<template>
  <div class="preview-inner">
    <div ref="stageRef" class="preview-stage">
      <!-- canvas 始终挂载：只用 v-show 控制显隐，避免切换状态时重建渲染器 -->
      <div v-show="store.hasContent" class="preview-canvas-host">
        <canvas ref="canvasRef"></canvas>
      </div>

      <div v-if="!store.hasContent" class="preview-empty">
        <div class="big">还没有可预览的内容</div>
        <div>在左侧导入背景图并输入文本，排版结果会实时出现在这里</div>
      </div>
    </div>

    <div v-if="store.hasContent" class="preview-nav">
      <button class="btn sm" type="button" :disabled="store.currentPage <= 0" @click="go(-1)">
        上一页
      </button>
      <span class="page-ind">
        {{ store.currentPage + 1 }} / {{ store.totalPages }}
      </span>
      <button
        class="btn sm"
        type="button"
        :disabled="store.currentPage >= store.totalPages - 1"
        @click="go(1)"
      >
        下一页
      </button>
      <span v-if="statusLabel" class="muted" style="margin-left: 10px">{{ statusLabel }}</span>
    </div>
  </div>
</template>
