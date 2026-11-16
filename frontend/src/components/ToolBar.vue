<script setup lang="ts">
/** 顶部工具栏。 */

import { computed, ref } from 'vue'
import { useAppStore } from '../stores/config'
import { useQueueStore } from '../stores/queue'
import { useTemplateStore } from '../stores/templates'
import HistoryPanel from './HistoryPanel.vue'
import ModalDialog from './ModalDialog.vue'
import QueuePanel from './QueuePanel.vue'

const store = useAppStore()
const queue = useQueueStore()
const tpl = useTemplateStore()

/** 当前打开的弹窗；同一时间只开一个 */
const openPanel = ref<'history' | 'queue' | null>(null)

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
      <button class="btn" type="button" @click="openPanel = 'history'">
        历史记录<span v-if="store.exportHistory.length" class="tb-badge">{{
          store.exportHistory.length
        }}</span>
      </button>
      <button class="btn" type="button" @click="openPanel = 'queue'">
        任务队列<span v-if="queue.tasks.length" class="tb-badge">{{ queue.enabledCount }}</span>
      </button>
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

    <ModalDialog
      v-if="openPanel === 'history'"
      title="历史记录"
      :subtitle="`${store.exportHistory.length} 条 · 导出成功后自动存档`"
      @close="openPanel = null"
    >
      <HistoryPanel @restored="openPanel = null" />
    </ModalDialog>

    <ModalDialog
      v-else-if="openPanel === 'queue'"
      title="任务队列"
      :subtitle="`${queue.enabledCount} 条待执行 · 导出成功后自动移入历史记录`"
      @close="openPanel = null"
    >
      <QueuePanel @applied="openPanel = null" />
    </ModalDialog>
  </header>
</template>

<style scoped>
.tb-badge {
  margin-left: 5px;
  padding: 0 5px;
  border-radius: 8px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 10px;
  line-height: 15px;
  font-variant-numeric: tabular-nums;
}
</style>
