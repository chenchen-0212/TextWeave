<script setup lang="ts">
/**
 * 文织 TextWeave · 应用外壳
 *
 * 三栏布局：左侧输入 → 中间预览 → 右侧参数。
 * 参数与输入的任何变更都会触发防抖重排，界面组件只消费布局结果。
 */

import { onBeforeUnmount, onMounted } from 'vue'
import { useAppStore } from './stores/config'
import * as api from './backend/api'

import ToolBar from './components/ToolBar.vue'
import StatusBar from './components/StatusBar.vue'
import InputPanel from './components/InputPanel.vue'
import PreviewPane from './components/PreviewPane.vue'
import ThumbnailStrip from './components/ThumbnailStrip.vue'

import CanvasParams from './components/params/CanvasParams.vue'
import BackgroundParams from './components/params/BackgroundParams.vue'
import MaskParams from './components/params/MaskParams.vue'
import TextParams from './components/params/TextParams.vue'
import ConstraintParams from './components/params/ConstraintParams.vue'
import CoverParams from './components/params/CoverParams.vue'
import ExportParams from './components/params/ExportParams.vue'
import TemplateParams from './components/params/TemplateParams.vue'

const store = useAppStore()

const IMAGE_EXT = /\.(png|jpe?g|webp|bmp|gif)$/i
const TEXT_EXT = /\.(txt|md|markdown|text)$/i

/**
 * 全局文件拖拽导入。
 *
 * 用 Wails 的 OnFileDrop 而非 HTML5 drop 事件：浏览器安全模型下拿不到真实
 * 文件路径，而渲染背景图必须要有路径。拖到窗口任意位置都会触发。
 *
 * 分流规则：
 *   1. 落点在标了 data-drop="cover-bg" 的区域 → 设为当前封面的专属背景图
 *   2. 图片 → 正文背景图
 *   3. 文本 → 正文
 */
function onFilesDropped(x: number, y: number, paths: string[]): void {
  const coverZone = hitCoverZone(x, y)
  const coverId = store.cfg.cover.activeId

  for (const p of paths) {
    if (coverZone && store.activeCover() && IMAGE_EXT.test(p)) {
      void store.setCoverBackground(coverId, p)
      continue
    }
    if (IMAGE_EXT.test(p)) {
      void store.dropBackground(p)
    } else if (TEXT_EXT.test(p)) {
      void store.dropTextFile(p)
    }
  }
}

/** 判断拖拽落点是否在封面背景图投放区内 */
function hitCoverZone(x: number, y: number): boolean {
  try {
    const el = document.elementFromPoint(x, y) as HTMLElement | null
    return Boolean(el?.closest('[data-drop="cover-bg"]'))
  } catch {
    return false
  }
}

onMounted(() => {
  void store.init()
  // 以 Go 侧注入的开关为准判断拖放是否真的可用，注册结果会反映到状态栏
  void api.registerFileDrop(onFilesDropped).then((ok) => {
    store.dragDropReady = ok
  })
})

onBeforeUnmount(() => {
  api.unregisterFileDrop()
})
</script>

<template>
  <div class="app-shell">
    <ToolBar />

    <div class="app-body">
      <!-- 左：输入 -->
      <div class="pane">
        <InputPanel />
      </div>

      <!-- 中：预览 + 缩略图条 -->
      <div class="pane preview-pane">
        <PreviewPane />
        <ThumbnailStrip />
      </div>

      <!-- 右：参数面板 -->
      <div class="pane">
        <div class="pane-scroll">
          <CanvasParams />
          <BackgroundParams />
          <MaskParams />
          <TextParams />
          <ConstraintParams />
          <CoverParams />
          <ExportParams />
          <TemplateParams />
        </div>
      </div>
    </div>

    <StatusBar />
  </div>
</template>
