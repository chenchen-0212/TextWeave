<script setup lang="ts">
/**
 * AI 生图日志：每次成功生成都留一条，记录 LLM 给的提示词、请求过去的生图配置
 * （不含密钥）与落盘的图片，图片可另存到用户选的目录。
 */

import { onBeforeUnmount, onMounted, ref } from 'vue'
import * as api from '../backend/api'
import { useAppStore } from '../stores/config'
import { useAIStore, type AILogEntry } from '../stores/ai'
import { base64ToBlob } from '../utils/bytes'

const ai = useAIStore()
const app = useAppStore()

const thumbs = ref<Record<string, string>>({})
const busyId = ref('')
/** 放大预览：只保留一张原图，关闭时释放 object URL */
const preview = ref<{ id: string; url: string } | null>(null)

const THUMB_WIDTH = 96

function mimeOf(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  return 'image/png'
}

/** 缩略图按需从原图缩到 96px 宽：列表里不能直接塞 1080×1920 的原图 */
async function thumbFor(path: string): Promise<string> {
  const b64 = await api.readFileBase64(path)
  if (!b64) return ''
  const bmp = await createImageBitmap(base64ToBlob(b64, mimeOf(path)))
  const w = Math.min(THUMB_WIDTH, bmp.width)
  const h = Math.max(1, Math.round((bmp.height / bmp.width) * w))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')?.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  return canvas.toDataURL('image/jpeg', 0.72)
}

onMounted(async () => {
  await ai.loadLogs()
  for (const entry of ai.logs) {
    try {
      const url = await thumbFor(entry.path)
      if (url) thumbs.value = { ...thumbs.value, [entry.id]: url }
    } catch {
      // 图片被删或格式不支持：留空占位，不影响其余条目
    }
  }
})

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || 'cover.png'
}

/** 另存为：复制一份到用户选的目录，原图仍留在配置目录里（封面还在用） */
async function saveAs(entry: AILogEntry): Promise<void> {
  if (busyId.value) return
  busyId.value = entry.id
  try {
    const dir = await api.pickOutputDir()
    if (!dir) return
    const b64 = await api.readFileBase64(entry.path)
    if (!b64) throw new Error('读取图片失败，文件可能已被删除')
    const full = await api.saveImage(dir, fileName(entry.path), b64)
    app.notify(`已保存到 ${full}`, 'success')
  } catch (e) {
    app.notify(e instanceof Error ? e.message : '保存失败', 'error')
  } finally {
    busyId.value = ''
  }
}

async function reveal(entry: AILogEntry): Promise<void> {
  try {
    await api.revealInFolder(entry.path)
  } catch {
    app.notify('无法打开文件所在目录', 'warning')
  }
}

/** 放大预览：缩略图太小看不出版式，这里读原图铺满预览层 */
async function openPreview(entry: AILogEntry): Promise<void> {
  try {
    const b64 = await api.readFileBase64(entry.path)
    if (!b64) throw new Error('读取图片失败，文件可能已被删除')
    closePreview()
    preview.value = { id: entry.id, url: URL.createObjectURL(base64ToBlob(b64, mimeOf(entry.path))) }
  } catch (e) {
    app.notify(e instanceof Error ? e.message : '打开预览失败', 'warning')
  }
}

function closePreview(): void {
  if (!preview.value) return
  URL.revokeObjectURL(preview.value.url)
  preview.value = null
}

onBeforeUnmount(closePreview)

function fmtTime(ts: number): string {
  return ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '—'
}
</script>

<template>
  <div class="ai-log">
    <div v-if="ai.logs.length === 0" class="muted" style="font-size: 12px">
      还没有生成记录。点左侧「生成封面」成功后，这里会留下提示词、请求配置和图片。
    </div>

    <template v-else>
      <div class="ai-log-head">
        <span class="muted" style="font-size: 11px">共 {{ ai.logs.length }} 条 · 最新在前</span>
        <button class="btn sm ghost" type="button" @click="ai.clearLogs()">清空日志</button>
      </div>

      <div v-for="entry in ai.logs" :key="entry.id" class="ai-log-item">
        <img
          v-if="thumbs[entry.id]"
          class="ai-log-thumb"
          :src="thumbs[entry.id]"
          alt=""
          title="点击放大预览"
          @click="openPreview(entry)"
        />
        <div v-else class="ai-log-thumb empty">无图</div>

        <div class="ai-log-body">
          <div class="ai-log-top">
            <span class="muted" style="font-size: 11px">{{ fmtTime(entry.ts) }}</span>
            <span class="grow" />
            <button
              class="btn sm"
              type="button"
              :disabled="busyId === entry.id"
              @click="saveAs(entry)"
            >
              另存为
            </button>
            <button class="btn sm ghost" type="button" @click="reveal(entry)">定位</button>
            <button class="btn sm ghost" type="button" @click="ai.removeLog(entry.id)">删除</button>
          </div>

          <div class="ai-log-meta">
            {{ entry.size }} · {{ entry.format }} · {{ entry.quality }} · {{ entry.model }}
          </div>
          <div class="ai-log-endpoint" :title="entry.endpoint">生图链接：{{ entry.endpoint }}</div>
          <div class="ai-log-prompt"><span>提示词：</span>{{ entry.prompt }}</div>
        </div>
      </div>
    </template>

    <Teleport to="body">
      <div v-if="preview" class="ai-preview" @click="closePreview">
        <img :src="preview.url" alt="" />
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.ai-log {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ai-log-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.ai-log-item {
  display: flex;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--panel-alt);
}

.ai-log-thumb {
  flex: 0 0 auto;
  width: 72px;
  height: 96px;
  border-radius: 4px;
  object-fit: cover;
  background: var(--panel-sunken);
  cursor: zoom-in;
}

.ai-log-thumb.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--text-3);
}

.ai-log-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ai-log-top {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ai-log-meta {
  font-size: 11px;
  color: var(--text-2);
}

.ai-log-endpoint {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 11px;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-log-prompt {
  font-size: 12px;
  line-height: 1.55;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
}
.ai-log-prompt span{
  color: #000;
  font-weight: 800;
}

.ai-preview {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.82);
  cursor: zoom-out;
}

.ai-preview img {
  max-width: 92vw;
  max-height: 92vh;
  border-radius: 6px;
  box-shadow: var(--shadow-lg);
}
</style>
