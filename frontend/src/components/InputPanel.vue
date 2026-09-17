<script setup lang="ts">
/**
 * 左侧输入区：背景图 + 文本。
 *
 * 输入区实时给出「字数 / 预计张数」，让用户在写作阶段就建立对产出量的预期。
 * 文件拖拽由 App.vue 的全局 OnFileDrop 统一处理（能拿到真实文件路径），
 * 这里的 @dragover.prevent 只用于阻止浏览器直接把文件当页面打开。
 */

import { computed } from 'vue'
import { useAppStore } from '../stores/config'
import { formatBytes } from '../utils/bytes'

const store = useAppStore()

const bgMeta = computed(() => {
  const info = store.bgInfo
  if (!info) return ''
  return `${info.width} × ${info.height} · ${info.aspect} · ${formatBytes(info.bytes)}`
})

const pageHint = computed(() => {
  if (store.charCount === 0) return '输入文本后自动计算张数'
  if (store.rebuilding) return '正在排版…'
  if (!store.hasContent) return '尚未生成有效页面'
  const n = store.totalPages
  const covers = store.enabledCoverCount
  const suffix = covers > 0 ? `（含封面 ${covers} 张）` : ''
  return `预计 ${n} 张${suffix}`
})
</script>

<template>
  <div class="pane-scroll">
    <!-- 背景图 -->
    <div class="input-block">
      <div class="input-block-title">
        <span>背景图</span>
        <span v-if="store.bgName" class="grow" />
        <button
          v-if="store.bgName"
          class="btn sm ghost"
          type="button"
          @click="store.clearBackground()"
        >
          移除
        </button>
      </div>

      <div class="bg-drop" @click="store.chooseBackground()" @dragover.prevent @drop.prevent>
        <img v-if="store.bgPreviewUrl" :src="store.bgPreviewUrl" alt="背景图预览" />
        <div v-else class="placeholder">
          {{ store.dragDropReady ? '点击选择或拖入背景图' : '点击选择背景图' }}<br />
          <span style="font-size: 11px">PNG / JPG / WebP / BMP / GIF</span>
        </div>
      </div>

      <div v-if="bgMeta" class="bg-meta">
        <span class="name" :title="store.bgPath">{{ store.bgName }}</span>
        <span>{{ bgMeta }}</span>
      </div>

      <div v-if="store.bgError" class="notice error mt8">{{ store.bgError }}</div>
    </div>

    <!-- 文本 -->
    <div class="input-block">
      <div class="input-block-title">
        <span>文本</span>
        <span class="grow" />
        <button class="btn sm ghost" type="button" @click="store.importTextFile()">
          导入 txt
        </button>
        <button
          v-if="store.text"
          class="btn sm ghost"
          type="button"
          @click="store.text = ''"
        >
          清空
        </button>
      </div>

      <div class="text-area-wrap">
        <textarea
          v-model="store.text"
          class="content-input"
          :placeholder="
            store.dragDropReady
              ? '在此粘贴或输入正文，也可以把 .txt / .md 文件直接拖进来。\n\n空行分隔段落；段落过长时会自动按句末标点拆分，保证不断句。'
              : '在此粘贴或输入正文，或用上方「导入 txt」按钮载入文件。\n\n空行分隔段落；段落过长时会自动按句末标点拆分，保证不断句。'
          "
          spellcheck="false"
          @dragover.prevent
          @drop.prevent
        ></textarea>
      </div>

      <div class="input-stats">
        <span>{{ store.charCount }} 字</span>
        <span>·</span>
        <span class="strong">{{ pageHint }}</span>
      </div>
    </div>
  </div>
</template>
