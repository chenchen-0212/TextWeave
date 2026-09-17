<script setup lang="ts">
/**
 * 模板分区：保存 / 列表 / 应用 / 分享 / 导入导出。
 *
 * 交互设计要点：
 *  - 保存与导入都收在「展开式内联面板」里，不弹模态框，避免打断调参节奏；
 *  - 分享码生成后直接落在可编辑文本域中，复制失败时用户仍可手动全选复制；
 *  - 所有失败路径都有明确文案，不出现「点了没反应」。
 */

import { computed, onMounted, ref, watch } from 'vue'
import type { MaskType } from '../../types'
import { useTemplateStore } from '../../stores/templates'
import { useAppStore } from '../../stores/config'
import { suggestCoverTitle } from '../../core/splitter'
import ParamSection from './ParamSection.vue'

const tpl = useTemplateStore()
const app = useAppStore()

// ---------------------------------------------------------------- 本地界面状态

const showSave = ref(false)
const saveName = ref('')

const showImport = ref(false)
const importText = ref('')
const applyOnImport = ref(true)

const renamingId = ref('')
const renameValue = ref('')

const fileInput = ref<HTMLInputElement | null>(null)

const MASK_LABEL: Record<MaskType, string> = {
  card: '圆角卡片',
  veil: '全图遮罩',
  gradient: '渐变遮罩',
}

const badge = computed(() => (tpl.count > 0 ? `${tpl.count} 个` : '空'))

const importPlaceholder = computed(
  () =>
    '粘贴分享码（TW1- 开头）或模板 JSON 内容…',
)

onMounted(() => {
  tpl.load()
})

// 提示信息自动消失，避免长期占据面板空间
let noticeTimer: number | null = null
watch(
  () => tpl.noticeText,
  (v) => {
    if (noticeTimer !== null) clearTimeout(noticeTimer)
    if (!v) return
    noticeTimer = window.setTimeout(() => tpl.clearNotice(), 6000)
  },
)

// ---------------------------------------------------------------- 保存

function openSave(): void {
  // 默认名优先取主封面标题，其次取正文首句，都没有就留空
  const guess = app.primaryCoverTitle || suggestCoverTitle(app.text, 14) || ''
  saveName.value = guess
  showSave.value = true
}

function commitSave(): void {
  const created = tpl.saveCurrent(saveName.value)
  if (created) {
    showSave.value = false
    saveName.value = ''
  }
}

function cancelSave(): void {
  showSave.value = false
  saveName.value = ''
}

// ---------------------------------------------------------------- 重命名

function startRename(id: string, current: string): void {
  renamingId.value = id
  renameValue.value = current
}

function commitRename(): void {
  if (!renamingId.value) return
  const ok = tpl.rename(renamingId.value, renameValue.value)
  if (ok) {
    renamingId.value = ''
    renameValue.value = ''
  }
}

function cancelRename(): void {
  renamingId.value = ''
  renameValue.value = ''
}

// ---------------------------------------------------------------- 导入

function submitImport(applyNow: boolean): void {
  const text = importText.value.trim()
  if (!text) return
  const ok = tpl.importFromText(text, applyNow)
  if (ok) {
    importText.value = ''
    showImport.value = false
  }
}

async function pasteFromClipboard(): Promise<void> {
  if (!navigator.clipboard?.readText) {
    tpl.setNotice('当前环境不支持直接读取剪贴板，请手动粘贴（Ctrl+V）', 'info')
    return
  }
  try {
    const text = await navigator.clipboard.readText()
    if (!text.trim()) {
      tpl.setNotice('剪贴板是空的', 'info')
      return
    }
    importText.value = text
    tpl.clearNotice()
  } catch {
    // 读取剪贴板需要用户授权，被拒绝时给出可操作的替代方案
    tpl.setNotice('读取剪贴板被拒绝，请在下方文本框手动粘贴（Ctrl+V）', 'error')
  }
}

function pickFile(): void {
  fileInput.value?.click()
}

async function onFilePicked(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // 允许重复选择同一个文件
  if (!file) return
  const ok = await tpl.importFromFile(file, applyOnImport.value)
  if (ok) showImport.value = false
}

// ---------------------------------------------------------------- 展示辅助

function formatTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function maskLabel(m: MaskType): string {
  return MASK_LABEL[m] ?? m
}
</script>

<template>
  <ParamSection title="模板" :badge="badge">
    <!-- 提示条 -->
    <div
      v-if="tpl.noticeText"
      class="notice"
      :class="
        tpl.noticeKind === 'error' ? 'error' : tpl.noticeKind === 'success' ? 'success' : 'info'
      "
    >
      <span>{{ tpl.noticeText }}</span>
    </div>

    <!-- 保存当前配置 -->
    <button
      v-if="!showSave"
      class="btn primary"
      type="button"
      style="width: 100%"
      @click="openSave"
    >
      保存当前配置为模板
    </button>

    <div v-else class="tpl-save-form">
      <input
        v-model="saveName"
        type="text"
        placeholder="模板名称"
        maxlength="60"
        autofocus
        @keydown.enter="commitSave"
        @keydown.esc="cancelSave"
      />
      <div class="row mt8">
        <button class="btn primary sm grow" type="button" @click="commitSave">保存</button>
        <button class="btn sm" type="button" @click="cancelSave">取消</button>
      </div>
    </div>

    <!-- 模板列表 -->
    <div class="tpl-list-head">
      <span>我的模板</span>
      <span class="muted">{{ tpl.count }} / 60</span>
    </div>

    <div v-if="!tpl.hasTemplates" class="tpl-empty">
      还没有模板。调好参数后点上方按钮存一个，之后可一键套用或分享给同伴。
    </div>

    <div v-else class="tpl-list">
      <div v-for="t in tpl.items" :key="t.id" class="tpl-item">
        <!-- 重命名态 -->
        <template v-if="renamingId === t.id">
          <input
            v-model="renameValue"
            type="text"
            maxlength="60"
            @keydown.enter="commitRename"
            @keydown.esc="cancelRename"
          />
          <div class="row mt8">
            <button class="btn primary sm grow" type="button" @click="commitRename">确定</button>
            <button class="btn sm" type="button" @click="cancelRename">取消</button>
          </div>
        </template>

        <!-- 正常态 -->
        <template v-else>
          <div class="tpl-name" :title="t.name">{{ t.name }}</div>
          <div class="tpl-meta">
            {{ t.canvas.width }}×{{ t.canvas.height }} · {{ maskLabel(t.maskType) }} ·
            {{ formatTime(t.updatedAt) }}
          </div>
          <div class="tpl-actions">
            <button class="btn sm primary" type="button" @click="tpl.apply(t.id)">应用</button>
            <button class="btn sm" type="button" @click="tpl.share(t.id)">分享</button>
            <button class="btn sm ghost" type="button" @click="startRename(t.id, t.name)">
              改名
            </button>
            <button class="btn sm ghost" type="button" title="导出为 JSON 文件" @click="tpl.exportFile(t.id)">
              导出
            </button>
            <button class="btn sm ghost danger" type="button" title="删除" @click="tpl.remove(t.id)">
              删除
            </button>
          </div>
        </template>
      </div>
    </div>

    <!-- 分享输出 -->
    <div v-if="tpl.shareCode" class="share-box">
      <div class="tpl-list-head">
        <span>分享「{{ tpl.shareName }}」</span>
        <button class="btn sm ghost" type="button" @click="tpl.clearShare()">收起</button>
      </div>
      <textarea v-model="tpl.shareCode" class="share-code" readonly spellcheck="false"></textarea>
      <div class="row mt8">
        <button class="btn primary sm grow" type="button" @click="tpl.copyShare()">
          复制分享码
        </button>
        <button class="btn sm" type="button" @click="tpl.exportCurrent(tpl.shareName)">
          导出文件
        </button>
      </div>
      <div class="field-hint" style="margin-left: 0">
        共 {{ tpl.shareCodeLength }} 个字符。对方在「导入模板」里粘贴即可还原，
        字体若本机缺失会自动回退。
      </div>
    </div>

    <!-- 导入 -->
    <button
      v-if="!showImport"
      class="btn mt8"
      type="button"
      style="width: 100%"
      @click="showImport = true"
    >
      导入模板…
    </button>

    <div v-else class="tpl-import">
      <div class="tpl-list-head">
        <span>导入模板</span>
        <button class="btn sm ghost" type="button" @click="showImport = false">取消</button>
      </div>
      <textarea
        v-model="importText"
        class="share-code"
        :placeholder="importPlaceholder"
        spellcheck="false"
      ></textarea>
      <label class="check-row mt8">
        <input v-model="applyOnImport" type="checkbox" />
        <span>导入后立即应用</span>
      </label>
      <div class="row wrap">
        <button class="btn sm primary grow" type="button" :disabled="!importText.trim()" @click="submitImport(applyOnImport)">
          导入
        </button>
        <button class="btn sm" type="button" @click="pasteFromClipboard">从剪贴板</button>
        <button class="btn sm" type="button" @click="pickFile">从文件</button>
      </div>
      <div class="field-hint" style="margin-left: 0">
        支持分享码与导出的 .json 文件两种形态，会自动识别。
      </div>
    </div>

    <input
      ref="fileInput"
      type="file"
      accept=".json,application/json"
      style="display: none"
      @change="onFilePicked"
    />
  </ParamSection>
</template>
