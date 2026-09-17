<script setup lang="ts">
/** 顶部工具栏。 */

import { computed } from 'vue'
import { useAppStore } from '../stores/config'
import { useTemplateStore } from '../stores/templates'

const store = useAppStore()
const tpl = useTemplateStore()

const exportLabel = computed(() =>
  store.totalPages > 0 ? `导出全部（${store.totalPages} 张）` : '导出全部',
)

/**
 * 一键存为模板。
 * 走快捷路径用自动命名（优先封面标题）；需要自定义名称时去右侧「模板」分区。
 */
function quickSaveTemplate(): void {
  const title = store.primaryCoverTitle
  const name = title || `模板 ${new Date().toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })}`
  tpl.saveCurrent(name)
}
</script>

<template>
  <header class="toolbar">
    <div class="toolbar-brand">
      <h1>文织</h1>
      <span>TextWeave</span>
    </div>

    <div class="toolbar-group">
      <button class="btn" type="button" @click="store.chooseBackground()">导入背景图</button>
      <button class="btn" type="button" @click="store.importTextFile()">导入文本</button>
    </div>

    <div class="toolbar-spacer"></div>

    <div class="toolbar-group">
      <span v-if="store.rebuilding" class="muted" style="font-size: 11px">排版中…</span>
      <button
        class="btn"
        type="button"
        title="按当前参数快速存为一个模板，可在右侧「模板」分区中改名或分享"
        @click="quickSaveTemplate"
      >
        存为模板
      </button>
      <button
        class="btn"
        type="button"
        :disabled="store.exporting || !store.hasContent"
        @click="store.runExportCurrent()"
      >
        导出当前页
      </button>
      <button
        class="btn primary"
        type="button"
        :disabled="store.exporting || !store.hasContent"
        @click="store.runExport()"
      >
        {{ store.exporting ? store.exportPhase : exportLabel }}
      </button>
      <button class="btn ghost" type="button" title="恢复默认参数" @click="store.resetConfig()">
        重置
      </button>
    </div>
  </header>
</template>
