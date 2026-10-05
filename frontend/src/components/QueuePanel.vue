<script setup lang="ts">
/** 批处理任务队列面板（建议项 N-01）：多本书 / 多段钩子一次性排队导出。 */

import { useAppStore } from '../stores/config'
import { useQueueStore } from '../stores/queue'

const queue = useQueueStore()
const app = useAppStore()

const statusText: Record<string, string> = {
  pending: '排队中',
  running: '执行中',
  done: '完成',
  failed: '失败',
  skipped: '跳过',
}

function statusColor(status?: string): string {
  switch (status) {
    case 'done':
      return 'var(--success, #2e9e6b)'
    case 'failed':
      return '#c0392b'
    case 'running':
      return 'var(--accent, #3a6df0)'
    default:
      return 'var(--text-3, #8a8f99)'
  }
}
</script>

<template>
  <div class="queue-panel">
    <div class="row between" style="margin-bottom: 8px">
      <strong style="font-size: 12px">任务队列</strong>
      <span style="font-size: 11px; color: var(--text-3)">
        {{ queue.enabledCount }} 条待执行
      </span>
    </div>

    <div class="row" style="margin-bottom: 8px; flex-wrap: wrap">
      <button class="btn sm" type="button" :disabled="queue.running" @click="queue.addTaskFromCurrent()">
        收当前为新任务
      </button>
      <button
        class="btn sm primary"
        type="button"
        :disabled="queue.running || queue.enabledCount === 0 || !app.cfg.export.dir"
        :title="app.cfg.export.dir ? '' : '请先在导出分区选择输出目录'"
        @click="queue.runAll()"
      >
        {{ queue.running ? '执行中…' : '依次导出全部' }}
      </button>
      <button v-if="queue.running" class="btn sm" type="button" @click="queue.cancel()">取消</button>
      <button
        v-else
        class="btn sm ghost"
        type="button"
        :disabled="queue.tasks.length === 0"
        @click="queue.clearFinished()"
      >
        清理已完成
      </button>
    </div>

    <div v-if="queue.lastError" class="notice error" style="margin-bottom: 8px">
      {{ queue.lastError }}
    </div>
    <div v-if="queue.lastSummary" class="notice info" style="margin-bottom: 8px">
      {{ queue.lastSummary }}
    </div>

    <div v-if="queue.tasks.length === 0" class="field-hint" style="margin-left: 0">
      把每本书 / 每段钩子存成一条任务，之后一键按顺序全部导出；任务书名将作为文件名 {book} 变量与子目录名。
    </div>

    <div v-for="task in queue.tasks" :key="task.id" class="queue-task">
      <div class="row between" style="gap: 6px">
        <label class="check-row" style="flex: 1; min-width: 0">
          <input v-model="task.enabled" type="checkbox" :disabled="queue.running" />
          <input
            v-model="task.name"
            type="text"
            class="queue-name"
            placeholder="书名标签"
            :disabled="queue.running && queue.activeTask?.id === task.id"
            style="flex: 1; min-width: 0"
          />
        </label>
        <button
          class="btn sm ghost"
          type="button"
          :disabled="queue.running"
          @click="queue.removeTask(task.id)"
        >
          删
        </button>
      </div>
      <div class="queue-meta">
        <span :style="{ color: statusColor(task.status) }">
          {{ statusText[task.status ?? 'pending'] }}
        </span>
        <span v-if="task.bgName">· {{ task.bgName }}</span>
        <span>· {{ task.text.length }} 字</span>
      </div>
      <div v-if="task.message" class="queue-msg">{{ task.message }}</div>
    </div>

    <div v-if="queue.running && app.exporting" class="field-hint" style="margin-left: 0">
      {{ app.exportPhase }}
    </div>
  </div>
</template>

<style scoped>
.queue-panel {
  flex: 0 0 auto;
  max-height: 42%;
  overflow-y: auto;
  padding: 10px 12px 16px;
  border-top: 1px solid var(--border);
}

.queue-task {
  padding: 7px 8px;
  margin-bottom: 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm, 6px);
  background: var(--bg-2, transparent);
}

.queue-task .check-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  margin: 0;
}

.queue-name {
  width: 100%;
  padding: 2px 6px;
  font-size: 11.5px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--panel);
  color: var(--text-1, inherit);
}

.queue-meta {
  display: flex;
  gap: 6px;
  margin-top: 4px;
  font-size: 10.5px;
  color: var(--text-3, #8a8f99);
}

.queue-msg {
  margin-top: 3px;
  font-size: 10.5px;
  color: var(--text-2, #666);
  word-break: break-all;
}
</style>
