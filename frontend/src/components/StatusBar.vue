<script setup lang="ts">
/** 底部状态栏：排版诊断与环境状态。 */

import { computed } from 'vue'
import { useAppStore } from '../stores/config'

const store = useAppStore()

const diag = computed(() => store.diag)

const statLabel = computed(() => {
  const d = diag.value
  if (!d || d.totalPages === 0) return '无排版结果'
  const parts = [`${d.totalPages} 张`]
  parts.push(`${d.elapsedMs.toFixed(0)} ms`)
  if (d.prohibitionFixes > 0) parts.push(`禁则修正 ${d.prohibitionFixes} 次`)
  if (d.splitParagraphs > 0) parts.push(`跨页段落 ${d.splitParagraphs}`)
  return parts.join(' · ')
})

const fontLabel = computed(() => {
  const f = store.cfg.text.fontFamily
  if (!f) return '未选择字体'
  const size = diag.value?.applied.fontSize ?? store.cfg.text.fontSize
  const source = store.cfg.text.fontSource === 'user' ? '上传' : '系统'
  return `${f} · ${size}px · ${source}`
})

const pyLabel = computed(() => {
  const s = store.py
  if (!s) return '检测中'
  if (!s.available) return 'Python 未检测到'
  return `Python ${s.version || '已就绪'}`
})
</script>

<template>
  <footer class="statusbar">
    <span>{{ store.charCount }} 字</span>
    <i class="sep"></i>
    <span>{{ statLabel }}</span>
    <i class="sep"></i>
    <span :title="store.cfg.text.fontFamily">{{ fontLabel }}</span>

    <span class="spacer"></span>

    <template v-if="!store.dragDropReady">
      <span title="文件拖拽未启用，请使用工具栏的「导入背景图」与「导入文本」按钮">
        <i class="dot warn"></i>拖拽不可用
      </span>
      <i class="sep"></i>
    </template>

    <span v-if="store.cfg.constraint.enable" :title="`允许 ${store.cfg.constraint.minPages}–${store.cfg.constraint.maxPages} 张`">
      张数约束 {{ store.cfg.constraint.minPages }}–{{ store.cfg.constraint.maxPages }}
    </span>
    <i class="sep"></i>
    <span :title="store.py?.python || ''">
      <i class="dot" :class="store.py?.available ? 'ok' : 'off'"></i>{{ pyLabel }}
    </span>
    <i class="sep"></i>
    <span class="mono">v{{ store.appVersion || '0.4.0' }}</span>
  </footer>
</template>
