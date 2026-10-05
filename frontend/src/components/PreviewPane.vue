<script setup lang="ts">
/**
 * 中间预览区：当前页大图 + 翻页 + 封面文本拖拽定位。
 *
 * 预览用一个独立的 canvas 与 CanvasRenderer，按容器尺寸自适应显示比例；
 * 导出用的是另一个 canvas，两者互不干扰，但共享同一份 layout 与 renderCtx，
 * 保证「预览即所得」。
 *
 * 拖拽层的铁律：**绝不在这里 measureText**。命中框直接读 core 层产出的
 * `page.coverTextBoxes`，所以拖动时的框与渲染结果永远是同一份数据
 * —— D-15 当年就是因为 UI 侧另算一套而回退的。
 */

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAppStore } from '../stores/config'
import { CanvasRenderer } from '../render/CanvasRenderer'
import { pageCanvasSize } from '../core/pageCanvas'
import type { CoverTextBox } from '../types'

const store = useAppStore()

const stageRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)

let renderer: CanvasRenderer | null = null
let raf = 0
let ro: ResizeObserver | null = null

const page = computed(() => store.current)

/** 封面页的文本包围盒（逻辑坐标，来自 core） */
const coverBoxes = computed<CoverTextBox[]>(() => {
  const p = page.value
  return p && p.kind === 'cover' ? (p.coverTextBoxes ?? []) : []
})

const isCoverPage = computed(() => page.value?.kind === 'cover')

/**
 * 当前页实际画布尺寸（逻辑像素）。
 * 封面与正文尺寸已解耦，预览适配、点击换算、吸附都得以此为准，
 * 否则画布更大的封面上点击坐标会整体偏移。
 */
const pageSize = computed(() => {
  const p = page.value
  return pageCanvasSize(store.cfg, p ? p.kind : 'content')
})

/** 拖拽命中容差（显示像素） */
const HIT_TOLERANCE = 10
/** 吸附阈值（显示像素） */
const SNAP_TOLERANCE = 8
/** 选框/参考线的显示缩放，由 render() 每次写入 */
const viewScale = ref(0.2)

interface Guide {
  axis: 'x' | 'y'
  /** 逻辑坐标 */
  pos: number
}
const guides = ref<Guide[]>([])
const dragging = ref(false)
/** 拖拽起点（逻辑坐标）与抓取偏移 */
let grabDX = 0
let grabDY = 0

const selectedId = computed(() => store.selectedCoverTextId)

/** 选中框（显示坐标）：有蒙版时用面板区域，否则用文字块 */
function toDisplay(box: CoverTextBox) {
  const s = viewScale.value
  const r = box.maskEnabled && box.panel.w > 0 ? box.panel : box
  return { left: `${r.x * s}px`, top: `${r.y * s}px`, width: `${r.w * s}px`, height: `${r.h * s}px` }
}

/** 指针事件 → 画布内逻辑坐标 */
function toLogical(e: PointerEvent): { x: number; y: number } {
  const el = canvasRef.value
  const s = viewScale.value || 1
  const rect = el?.getBoundingClientRect()
  if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 }
  return { x: (e.clientX - rect.left) / s, y: (e.clientY - rect.top) / s }
}

/**
 * 命中检测：逆序遍历（core 已按 z 升序，故逆序 = 从最上层往下找）。
 * 命中区域取「蒙版面板 ∪ 文字块」——蒙版打开时，点面板也能选中这块文本。
 */
function hitTest(lx: number, ly: number): CoverTextBox | null {
  const tol = HIT_TOLERANCE / (viewScale.value || 1)
  const boxes = coverBoxes.value
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i]
    const p = b.panel
    const inPanel =
      p.w > 0 &&
      lx >= p.x - tol &&
      lx <= p.x + p.w + tol &&
      ly >= p.y - tol &&
      ly <= p.y + p.h + tol
    const inText = lx >= b.x - tol && lx <= b.x + b.w + tol && ly >= b.y - tol && ly <= b.y + b.h + tol
    if (inPanel || inText) return b
  }
  return null
}

/**
 * 吸附计算：返回修正后的锚点与命中的参考线。
 *
 * 候选参考线：画布中线 / 三分线 / 安全边距 / 其他元素的边与中线。
 * 取距离最小的一条，避免同时贴两条线产生歧义。
 */
function snap(
  anchorX: number,
  anchorY: number,
  self: CoverTextBox,
): { x: number; y: number; guides: Guide[] } {
  const W = pageSize.value.width
  const H = pageSize.value.height
  const tol = SNAP_TOLERANCE / (viewScale.value || 1)
  const out: Guide[] = []

  const xCandidates: number[] = [W / 2, W / 3, (W * 2) / 3]
  const yCandidates: number[] = [H / 2, H / 3, (H * 2) / 3]

  // 自身边缘/中线作为候选目标（与其他元素对齐）
  const selfX: Record<CoverTextBox['align'], number> = {
    left: self.x,
    center: self.x + self.w / 2,
    right: self.x + self.w,
  }
  const selfY = { top: self.y, center: self.y + self.h / 2, bottom: self.y + self.h }

  for (const b of coverBoxes.value) {
    if (b.elementId === self.elementId) continue
    xCandidates.push(b.x, b.x + b.w / 2, b.x + b.w)
    yCandidates.push(b.y, b.y + b.h / 2, b.y + b.h)
    // 对方的蒙版面板边缘也是合理的对齐目标
    if (b.panel.w > 0) {
      xCandidates.push(b.panel.x, b.panel.x + b.panel.w / 2, b.panel.x + b.panel.w)
      yCandidates.push(b.panel.y, b.panel.y + b.panel.h / 2, b.panel.y + b.panel.h)
    }
  }

  const sx = selfX[self.align]
  let bestX: { d: number; v: number } | null = null
  for (const c of xCandidates) {
    const d = Math.abs(c - sx)
    if (d <= tol && (!bestX || d < bestX.d)) bestX = { d, v: c }
  }
  if (bestX) {
    // 对齐到目标线：按当前 align 反推锚点应落在的位置
    const delta = bestX.v - sx
    out.push({ axis: 'x', pos: bestX.v })
    return { x: anchorX + delta / W, y: anchorY, guides: out }
  }

  const sy = selfY.center
  let bestY: { d: number; v: number } | null = null
  for (const c of yCandidates) {
    const d = Math.abs(c - sy)
    if (d <= tol && (!bestY || d < bestY.d)) bestY = { d, v: c }
  }
  if (bestY) {
    const delta = bestY.v - sy
    out.push({ axis: 'y', pos: bestY.v })
    return { x: anchorX, y: anchorY + delta / H, guides: out }
  }

  return { x: anchorX, y: anchorY, guides: out }
}

function onPointerDown(e: PointerEvent): void {
  if (!isCoverPage.value) return
  const p = toLogical(e)
  const hit = hitTest(p.x, p.y)
  store.selectedCoverTextId = hit ? hit.elementId : ''
  if (!hit) return

  e.preventDefault()
  ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)

  const cover = store.activeCover()
  const meta = cover?.texts.find((t) => t.id === hit.elementId)
  if (!cover || !meta) return

  const W = pageSize.value.width
  const H = pageSize.value.height
  // 抓取偏移 = 指针位置 − 当前锚点（逻辑 px），保证拖动时元素不跳动
  store.beginCoverTextMove(cover.id, hit.elementId)
  grabDX = p.x - meta.x * W
  grabDY = p.y - meta.y * H
  dragging.value = true
}

function onPointerMove(e: PointerEvent): void {
  if (!dragging.value) return
  const cover = store.activeCover()
  const id = store.selectedCoverTextId
  if (!cover || !id) return

  const box = coverBoxes.value.find((b) => b.elementId === id)
  if (!box) return

  const p = toLogical(e)
  const W = pageSize.value.width
  const H = pageSize.value.height
  // 指针 → 锚点（与 layoutCoverTextBoxes 的锚点语义一致），再吸附修正
  const rawX = (p.x - grabDX) / W
  const rawY = (p.y - grabDY) / H
  const snapped = snap(rawX, rawY, box)
  guides.value = snapped.guides

  // 越界钳制：锚点限定 [0,1]；包围盒钳制由排版层兜底
  store.moveCoverText(
    cover.id,
    id,
    Math.min(1, Math.max(0, snapped.x)),
    Math.min(1, Math.max(0, snapped.y)),
  )
}

function onPointerUp(): void {
  if (!dragging.value) return
  dragging.value = false
  guides.value = []
}

const pageStatus = computed(() => {
  const d = store.diag
  if (!d) return null
  return d.pages[store.currentPage] ?? null
})

const overlapCount = computed(() => coverBoxes.value.filter((b) => b.overlapped).length)

const statusLabel = computed(() => {
  const s = pageStatus.value
  const parts: string[] = []
  if (s) {
    const pct = Math.round(s.fillRate * 100)
    switch (s.status) {
      case 'sparse':
        parts.push(`本页较空（填充 ${pct}%）`)
        break
      case 'dense':
        parts.push(`本页较满（填充 ${pct}%）`)
        break
      case 'overflow':
        parts.push(`本页内容溢出（${pct}%）`)
        break
      default:
        parts.push(`填充 ${pct}%`)
    }
  }
  if (overlapCount.value > 0) parts.push(`文本重叠 ${overlapCount.value} 处`)
  return parts.join(' · ')
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
  const { width, height } = pageSize.value
  if (availW <= 0 || availH <= 0 || width <= 0 || height <= 0) return 0.2
  return Math.min(availW / width, availH / height)
}

function render(): void {
  const r = ensureRenderer()
  const p = page.value
  const el = canvasRef.value
  if (!r || !el || !p) return

  const s = fitScale()
  viewScale.value = s
  r.renderPage(p, store.renderCtx, s)

  // CSS 尺寸按逻辑尺寸 × 显示比例，保持与画布像素一一对应
  el.style.width = `${Math.round(pageSize.value.width * s)}px`
  el.style.height = `${Math.round(pageSize.value.height * s)}px`
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

// 切换页面时清空选中，避免高亮落在别的封面上
watch(
  () => store.currentPage,
  () => {
    if (!isCoverPage.value) store.selectedCoverTextId = ''
  },
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

  // 方向键微调选中的封面文本
  if (isCoverPage.value && store.selectedCoverTextId) {
    const step = e.shiftKey ? 10 : 1
    const map: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const delta = map[e.key]
    if (delta) {
      const cover = store.activeCover()
      if (cover) {
        e.preventDefault()
        store.nudgeCoverText(cover.id, store.selectedCoverTextId, delta[0], delta[1])
        return
      }
    }
  }

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

        <!-- 封面文本拖拽层：命中框 / 选框 / 吸附参考线，全部基于 core 的 coverTextBoxes -->
        <div
          v-if="isCoverPage && coverBoxes.length > 0"
          class="cover-drag-layer"
          :class="{ grabbing: dragging }"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
        >
          <div
            v-for="b in coverBoxes"
            :key="b.elementId"
            class="cover-hit"
            :class="{ sel: b.elementId === selectedId, warn: b.overlapped }"
            :style="toDisplay(b)"
          ></div>
          <div
            v-for="(g, i) in guides"
            :key="i"
            class="cover-guide"
            :class="g.axis"
            :style="
              g.axis === 'x'
                ? { left: `${g.pos * viewScale}px` }
                : { top: `${g.pos * viewScale}px` }
            "
          ></div>
        </div>

        <div v-if="isCoverPage && coverBoxes.length === 0" class="cover-drag-empty">
          该封面暂无文本 · 在右侧「封面」分区添加
        </div>
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
      <button
        v-if="isCoverPage && store.coverTextUndo"
        class="btn sm ghost"
        type="button"
        style="margin-left: 10px"
        @click="store.undoCoverTextMove()"
      >
        撤销移动
      </button>
    </div>
  </div>
</template>

<style scoped>
.cover-drag-layer {
  position: absolute;
  inset: 0;
  touch-action: none;
  cursor: default;
}

.cover-drag-layer.grabbing {
  cursor: grabbing;
}

.cover-hit {
  position: absolute;
  border: 1px dashed transparent;
  border-radius: 2px;
  cursor: grab;
}

.cover-hit.sel {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.cover-hit.warn {
  border-color: #d9822b;
}

.cover-guide {
  position: absolute;
  background: #ff3d8a;
  pointer-events: none;
}

.cover-guide.x {
  top: 0;
  bottom: 0;
  width: 1px;
}

.cover-guide.y {
  left: 0;
  right: 0;
  height: 1px;
}

.cover-drag-empty {
  position: absolute;
  left: 50%;
  bottom: 12px;
  transform: translateX(-50%);
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 11px;
  pointer-events: none;
}
</style>
