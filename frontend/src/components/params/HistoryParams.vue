<script setup lang="ts">
/** 历史任务（N-06）：导出成功后自动存快照，一键复现当时的全部配置与内容。 */

import { useAppStore } from '../../stores/config'
import ParamSection from './ParamSection.vue'

const store = useAppStore()

function formatTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function title(entry: { book: string; channel: string; text: string }): string {
  if (entry.book) return entry.book
  if (entry.channel) return entry.channel
  const head = entry.text.trim().slice(0, 14)
  return head ? `${head}…` : '（无书名）'
}
</script>

<template>
  <ParamSection
    title="历史任务"
    :badge="store.exportHistory.length > 0 ? `${store.exportHistory.length} 条` : '空'"
    :default-open="false"
  >
    <div class="field-hint" style="margin-left: 0">
      每次导出成功后自动存档：文本、背景图、全部参数与渠道设置。换壳追投、复现爆款配置时一键恢复，无需重建。最多保留
      20 条。
    </div>

    <div v-if="store.exportHistory.length === 0" class="field-hint" style="margin-left: 0">
      暂无历史记录，完成一次导出后会出现在这里。
    </div>

    <div v-for="entry in store.exportHistory" :key="entry.id" class="his-item">
      <div class="row between" style="gap: 6px">
        <span class="his-title" :title="entry.outDir">{{ title(entry) }}</span>
        <button class="btn sm primary" type="button" @click="store.restoreHistory(entry.id)">
          复现
        </button>
        <button class="btn sm ghost" type="button" @click="store.removeHistory(entry.id)">删</button>
      </div>
      <div class="his-meta">
        {{ formatTime(entry.ts) }} · {{ entry.pages }} 张
        <span v-if="entry.sizeLabel"> · {{ entry.sizeLabel }}</span>
        <span v-if="entry.channel"> · {{ entry.channel }}</span>
      </div>
    </div>

    <button
      v-if="store.exportHistory.length > 0"
      class="btn sm ghost mt8"
      type="button"
      @click="store.clearHistory()"
    >
      清空历史
    </button>
  </ParamSection>
</template>

<style scoped>
.his-item {
  padding: 7px 8px;
  margin-bottom: 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm, 6px);
}

.his-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11.5px;
}

.his-meta {
  margin-top: 3px;
  font-size: 10.5px;
  color: var(--text-3, #8a8f99);
}
</style>
