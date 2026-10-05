<script setup lang="ts">
/**
 * 单张封面的编辑器。
 *
 * 分四组：文字内容 / 版式 / 背景图 / 蒙版。
 * 背景图组是整个功能的核心 —— 支持为这张封面单独指定一张底图，
 * 并对它做尺寸（缩放）、位置、透明度与叠加效果（混合模式 + 单色层）的调整。
 */

import { computed, ref, watch } from 'vue'
import type { CoverItem, MaskType } from '../../types'
import { BLEND_MODES, defaultCoverTextMask, defaultMaskOfType } from '../../types'
import { useAppStore } from '../../stores/config'
import MaskControls from './MaskControls.vue'
import ParamField from '../ui/ParamField.vue'

const props = defineProps<{ cover: CoverItem }>()

const store = useAppStore()
const cfg = store.cfg

/** 文本级蒙版切换形态：基于文本默认参数重建，避免残留上一个形态的字段 */
function defaultCoverTextMaskOf(type: MaskType) {
  const base = defaultCoverTextMask()
  return type === 'card' ? base : defaultMaskOfType(type)
}

const WEIGHTS = [
  { value: 400, label: '常规 400' },
  { value: 500, label: '中等 500' },
  { value: 700, label: '加粗 700' },
]

const ALIGNS = [
  { value: 'left', label: '左对齐' },
  { value: 'center', label: '居中' },
  { value: 'right', label: '右对齐' },
]

const LAYOUTS = [
  { value: 'center', label: '居中' },
  { value: 'top', label: '靠上' },
  { value: 'bottom', label: '靠下' },
]

const FILLS = [
  { value: 'cover', label: '填充裁剪' },
  { value: 'contain', label: '完整显示' },
  { value: 'stretch', label: '拉伸' },
]

// ---------------------------------------------------------------- 赋值辅助

function setCover(key: string, value: unknown): void {
  ;(props.cover as unknown as Record<string, unknown>)[key] = value
}

function setBg(key: string, value: unknown): void {
  ;(props.cover.background as unknown as Record<string, unknown>)[key] = value
}

// ---------------------------------------------------------------- 背景预览

const previewRef = ref<HTMLCanvasElement | null>(null)

/** 把已解码的位图缩略画到小画布上，避免为预览再生成一次 object URL。 */
function drawPreview(): void {
  const canvas = previewRef.value
  if (!canvas) return
  const src = store.coverImages.get(props.cover.background.path)

  const w = 140
  const h = 78
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.clearRect(0, 0, w, h)
  if (!src) {
    ctx.fillStyle = '#e6e8ec'
    ctx.fillRect(0, 0, w, h)
    return
  }

  // 按 cover 方式铺满预览框
  const scale = Math.max(w / src.width, h / src.height)
  const dw = src.width * scale
  const dh = src.height * scale
  ctx.drawImage(src.image, (w - dw) / 2, (h - dh) / 2, dw, dh)
}

watch(
  () => [props.cover.background.path, store.coverImages],
  () => drawPreview(),
  { immediate: true },
)

// ---------------------------------------------------------------- 操作

const picking = ref(false)

async function chooseBackground(): Promise<void> {
  picking.value = true
  try {
    await store.pickCoverBackground(props.cover.id)
  } finally {
    picking.value = false
  }
}

function clearBackground(): void {
  store.clearCoverBackground(props.cover.id)
}

/**
 * 切换封面蒙版的形态。
 * 直接重建成该形态的标准默认值，避免残留上一个形态的字段导致渲染异常。
 */
function onMaskTypeChange(type: MaskType): void {
  const defaults: Record<MaskType, Record<string, unknown>> = {
    card: {
      color: '#000000',
      alpha: 0.65,
      radius: 24,
      pad: 48,
      blur: 0,
      position: 'stretchToFill',
    },
    veil: { color: '#000000', alpha: 0.4, topBoost: 0, bottomBoost: 0 },
    gradient: {
      direction: 'bottom',
      color: '#000000',
      maxAlpha: 0.85,
      solidRatio: 0.1,
      transparentRatio: 0.4,
    },
  }
  setCover('mask', { type, ...defaults[type] })
}

const hasImage = computed(() => {
  const bg = props.cover.background
  return bg.useOwn && Boolean(bg.path) && store.coverImages.has(bg.path)
})
</script>

<template>
  <div class="cover-editor">
    <!-- 文本元素（副标题能力已下线；位置可直接在预览画布上拖拽） -->
    <div class="cover-group-title">文本元素</div>
    <div class="field-hint" style="margin-left: 0; margin-top: 0">
      在中间预览的封面页上可直接拖动文本定位；拖动时会吸附到中线、三分线与安全边距。
    </div>

    <div
      v-for="(el, i) in cover.texts"
      :key="el.id"
      class="ctext-item"
      :class="{ sel: store.selectedCoverTextId === el.id, off: !el.enabled }"
      @click="store.selectedCoverTextId = el.id"
    >
      <div class="row between">
        <label class="check-row" style="flex: 1">
          <input v-model="el.enabled" type="checkbox" @click.stop />
          <span style="font-size: 11.5px">文本 {{ i + 1 }}</span>
        </label>
        <span class="ctext-pos mono">{{
          el.placed ? `已定位 ${Math.round(el.x * 100)}% / ${Math.round(el.y * 100)}%` : '自动版式'
        }}</span>
        <button
          class="btn sm ghost"
          type="button"
          :disabled="cover.texts.length <= 1"
          title="删除该文本元素"
          @click.stop="store.removeCoverText(cover.id, el.id)"
        >
          删
        </button>
      </div>

      <input
        v-model="el.text"
        type="text"
        placeholder="文本内容（留空则不输出）"
        class="mb8"
      />
      <div v-if="!el.text.trim()" class="field-hint" style="margin-left: 0">
        空文本不会输出，但仍可保留位置。
      </div>

      <ParamField
        label="字号"
        :modelValue="el.fontSize"
        :min="16"
        :max="300"
        unit="px"
        @update:modelValue="(v) => (el.fontSize = Number(v))"
      />
      <ParamField
        label="字重"
        type="select"
        :modelValue="el.fontWeight"
        :options="WEIGHTS"
        @update:modelValue="(v) => (el.fontWeight = Number(v) as 300 | 400 | 500 | 700)"
      />
      <ParamField
        label="对齐"
        type="select"
        :modelValue="el.align"
        :options="ALIGNS"
        @update:modelValue="(v) => (el.align = String(v) as 'left' | 'center' | 'right')"
      />
      <ParamField
        label="颜色"
        type="color"
        :modelValue="el.color || cfg.text.color"
        @update:modelValue="(v) => (el.color = String(v))"
      />
      <div class="field-hint">
        留空跟随正文颜色。
        <button v-if="el.color" class="btn sm ghost" type="button" @click="el.color = ''">
          恢复跟随
        </button>
      </div>
      <ParamField
        label="换行宽度"
        :modelValue="el.widthRatio"
        :min="0.2"
        :max="1"
        :step="0.02"
        :decimals="2"
        @update:modelValue="(v) => (el.widthRatio = Number(v))"
      />

      <!-- 文本级蒙版：挂载在该文本图层上，与封面底蒙版互不干扰 -->
      <div class="cover-group-sub">该文本的蒙版</div>
      <ParamField
        label="启用蒙版"
        type="check"
        :modelValue="el.maskEnabled"
        @update:modelValue="(v) => store.toggleCoverTextMask(cover.id, el.id)"
      />
      <template v-if="el.maskEnabled">
        <MaskControls
          :mask="el.mask"
          :show-type-switch="true"
          @type-change="(t) => (el.mask = defaultCoverTextMaskOf(t))"
        />
        <div class="field-hint">
          蒙版面板贴合这块文字（外扩 {{ el.mask.type === 'card' ? el.mask.pad : 0 }}px），
          显示范围由它自己决定，与封面底蒙版无关。
        </div>
      </template>

      <div class="row" style="margin-top: 6px">
        <span class="ctext-pos" style="margin: 0">层级</span>
        <button
          class="btn sm ghost"
          type="button"
          :disabled="i === cover.texts.length - 1"
          title="上移一层（盖在上面）"
          @click="store.moveCoverTextLayer(cover.id, el.id, 1)"
        >
          上移
        </button>
        <button
          class="btn sm ghost"
          type="button"
          :disabled="i === 0"
          title="下移一层"
          @click="store.moveCoverTextLayer(cover.id, el.id, -1)"
        >
          下移
        </button>
        <span class="ctext-pos">z={{ el.z }}</span>
      </div>

      <div class="row" style="margin-top: 4px">
        <button
          class="btn sm ghost"
          type="button"
          :disabled="!el.placed"
          title="交还给自动版式（居中/靠上/靠下）"
          @click="store.resetCoverTextAuto(cover.id, el.id)"
        >
          恢复自动版式
        </button>
        <button
          class="btn sm ghost"
          type="button"
          :disabled="!store.coverTextUndo"
          title="撤销最近一次拖拽"
          @click="store.undoCoverTextMove()"
        >
          撤销移动
        </button>
      </div>
    </div>

    <div class="row mt8">
      <button class="btn sm" type="button" @click="store.addCoverText(cover.id)">＋ 添加文本</button>
      <button
        class="btn sm ghost"
        type="button"
        :disabled="cover.texts.length < 2"
        title="把全部文本按顺序均分到纵向区间"
        @click="store.distributeCoverTexts(cover.id)"
      >
        垂直均分
      </button>
    </div>

    <!-- 版式 -->
    <div class="cover-group-title">版式</div>
    <ParamField
      label="自动版式"
      type="select"
      :modelValue="cover.layout"
      :options="LAYOUTS"
      @update:modelValue="(v) => setCover('layout', v)"
    />
    <div class="field-hint">仅对未拖拽定位（自动版式）的文本生效。</div>

    <!-- 背景图 -->
    <div class="cover-group-title">背景图</div>
    <div class="field">
      <div class="field-label">背景来源</div>
      <div class="field-control">
        <div class="seg full">
          <button
            type="button"
            :class="{ active: !cover.background.useOwn }"
            @click="setCover('background', { ...cover.background, useOwn: false })"
          >
            沿用正文
          </button>
          <button
            type="button"
            :class="{ active: cover.background.useOwn }"
            @click="setCover('background', { ...cover.background, useOwn: true })"
          >
            专属背景
          </button>
        </div>
      </div>
    </div>

    <template v-if="cover.background.useOwn">
      <div
        class="cover-bg-drop"
        data-drop="cover-bg"
        :class="{ empty: !hasImage }"
        title="点击选择图片，或把图片直接拖到这里"
        @click="chooseBackground"
        @dragover.prevent
        @drop.prevent
      >
        <canvas ref="previewRef" class="cover-bg-canvas" :style="{ display: hasImage ? 'block' : 'none' }"></canvas>
        <div v-if="!hasImage" class="cover-bg-placeholder">
          <span v-if="picking">正在载入…</span>
          <span v-else>点击选择或拖入图片</span>
        </div>
      </div>

      <div class="row wrap mt8">
        <span class="cover-bg-name" :title="cover.background.name">
          {{ cover.background.name || '未选择图片' }}
        </span>
        <span class="grow"></span>
        <button class="btn sm" type="button" @click="chooseBackground">更换</button>
        <button class="btn sm ghost" type="button" @click="clearBackground">清除</button>
      </div>

      <div v-if="store.coverBackgroundError" class="notice error mt8">
        {{ store.coverBackgroundError }}
      </div>

      <div class="cover-group-sub">尺寸与位置</div>
      <ParamField
        label="填满方式"
        type="select"
        :modelValue="cover.background.fit"
        :options="FILLS"
        @update:modelValue="(v) => setBg('fit', v)"
      />
      <ParamField
        label="缩放"
        :modelValue="cover.background.scale"
        :min="0.1"
        :max="5"
        :step="0.01"
        :decimals="2"
        unit="×"
        @update:modelValue="(v) => setBg('scale', Number(v))"
      />
      <ParamField
        label="水平位置"
        :modelValue="cover.background.offsetX"
        :min="-1"
        :max="1"
        :step="0.01"
        :decimals="2"
        @update:modelValue="(v) => setBg('offsetX', Number(v))"
      />
      <ParamField
        label="垂直位置"
        :modelValue="cover.background.offsetY"
        :min="-1"
        :max="1"
        :step="0.01"
        :decimals="2"
        @update:modelValue="(v) => setBg('offsetY', Number(v))"
      />

      <div class="cover-group-sub">透明度与叠加</div>
      <ParamField
        label="不透明度"
        :modelValue="cover.background.opacity"
        :min="0"
        :max="1"
        :step="0.01"
        :decimals="2"
        :disabled="cover.background.blendMode === 'standalone'"
        @update:modelValue="(v) => setBg('opacity', Number(v))"
      />
      <ParamField
        label="叠加模式"
        type="select"
        :modelValue="cover.background.blendMode"
        :options="BLEND_MODES.map((m) => ({ value: m.value, label: m.label }))"
        @update:modelValue="(v) => setBg('blendMode', v)"
      />
      <div class="field-hint">
        叠加模式决定封面图与正文背景如何混合。把不透明度调到 0.5 上下配合「正片叠底」或「着色」，
        可以做出双曝与统一色调的效果；选「独立（不叠加）」时封面按自身原样整张铺画，
        正文背景不参与合成（无正文背景时也照常显示）。
      </div>
      <ParamField
        label="叠加色"
        type="color"
        :modelValue="cover.background.tintColor"
        @update:modelValue="(v) => setBg('tintColor', v)"
      />
      <ParamField
        label="叠加浓度"
        :modelValue="cover.background.tintAlpha"
        :min="0"
        :max="1"
        :step="0.01"
        :decimals="2"
        @update:modelValue="(v) => setBg('tintAlpha', Number(v))"
      />

      <div class="cover-group-sub">画质调整</div>
      <ParamField
        label="亮度"
        :modelValue="cover.background.brightness"
        :min="0.3"
        :max="2"
        :step="0.01"
        :decimals="2"
        @update:modelValue="(v) => setBg('brightness', Number(v))"
      />
      <ParamField
        label="对比度"
        :modelValue="cover.background.contrast"
        :min="0.3"
        :max="2"
        :step="0.01"
        :decimals="2"
        @update:modelValue="(v) => setBg('contrast', Number(v))"
      />
      <ParamField
        label="饱和度"
        :modelValue="cover.background.saturate"
        :min="0"
        :max="2"
        :step="0.01"
        :decimals="2"
        @update:modelValue="(v) => setBg('saturate', Number(v))"
      />
      <ParamField
        label="模糊"
        :modelValue="cover.background.blur"
        :min="0"
        :max="40"
        unit="px"
        @update:modelValue="(v) => setBg('blur', Number(v))"
      />
      <ParamField
        label="暗角"
        :modelValue="cover.background.vignette"
        :min="0"
        :max="1"
        :step="0.01"
        :decimals="2"
        @update:modelValue="(v) => setBg('vignette', Number(v))"
      />
    </template>

    <div v-else class="field-hint">
      当前封面与正文共用同一张背景图。选「专属背景」可为本张封面单独指定底图并调整取景。
    </div>

    <!-- 封面底蒙版：整页背景层，与每个文本自己的蒙版互不干扰 -->
    <div class="cover-group-title">封面底蒙版（整页）</div>
    <ParamField
      label="独立底蒙版"
      type="check"
      :modelValue="cover.useOwnMask"
      @update:modelValue="(v) => setCover('useOwnMask', Boolean(v))"
    />
    <MaskControls
      v-if="cover.useOwnMask"
      :mask="cover.mask"
      :show-type-switch="true"
      @type-change="onMaskTypeChange"
    />
    <div v-else class="field-hint">
      当前沿用正文蒙版作为整页底衬。封面上每块文字还可以各自挂载蒙版（见上方「该文本的蒙版」）。
    </div>
  </div>
</template>

<style scoped>
.cover-editor {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}

.cover-group-title {
  margin: 14px 0 8px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-2);
  letter-spacing: 0.3px;
}

.cover-group-title:first-child {
  margin-top: 0;
}

.cover-group-sub {
  margin: 12px 0 7px;
  font-size: 10.5px;
  color: var(--text-3);
}

.ctext-item {
  padding: 8px;
  margin-bottom: 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm, 6px);
}

.ctext-item.sel {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.ctext-item.off {
  opacity: 0.55;
}

.ctext-pos {
  font-size: 10px;
  color: var(--text-3);
  margin-right: 4px;
}

.cover-bg-drop {
  position: relative;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--panel-alt);
  cursor: pointer;
  overflow: hidden;
  transition: border-color 0.14s, background 0.14s;
}

.cover-bg-drop:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.cover-bg-canvas {
  display: block;
  width: 100%;
}

.cover-bg-placeholder {
  height: 78px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-3);
  font-size: 11.5px;
}

.cover-bg-name {
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--text-2);
}
</style>
