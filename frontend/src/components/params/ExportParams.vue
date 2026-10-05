<script setup lang="ts">
/** 导出参数与操作（D-14：默认逐张落盘）。 */

import { computed } from 'vue'
import { useAppStore } from '../../stores/config'
import { extForFormat, renderFilenameTemplate, renderSubfolder } from '../../utils/filename'
import { CHANNEL_SIZES, MAX_EXPORT_SIZES } from '../../types'
import ParamField from '../ui/ParamField.vue'
import ParamSection from './ParamSection.vue'

const store = useAppStore()
const cfg = store.cfg

/** 文件名模板的实时预览（用前三个序号示意） */
const preview = computed(() => {
  const ext = extForFormat(cfg.canvas.format)
  const total = Math.max(1, store.totalPages)
  const names: string[] = []
  for (let i = 1; i <= Math.min(3, total); i++) {
    names.push(
      renderFilenameTemplate(cfg.export.filenameTemplate, {
        index: i,
        total,
        title: store.primaryCoverTitle,
        date: new Date(),
        pad: cfg.export.pad,
        book: cfg.export.book,
        channel: cfg.channel.name,
        size: cfg.channel.sizes[0]?.label,
      }) + `.${ext}`,
    )
  }
  return names.length > 0 ? names.join('  ·  ') : ''
})

/** 子目录效果预览 */
const subfolderPreview = computed(() => {
  const sub = renderSubfolder(cfg.channel.subfolderPattern, {
    book: cfg.export.book,
    channel: cfg.channel.name,
    size: cfg.channel.sizes[0]?.label,
    date: new Date(),
  })
  return sub ? `${cfg.export.dir || '<输出目录>'}/${sub}/` : cfg.export.dir || '<输出目录>'
})

const progressPercent = computed(() => {
  if (store.exportTotal <= 0) return 0
  return Math.round((store.exportDone / store.exportTotal) * 100)
})

const badge = computed(() => (cfg.export.dir ? '已设置目录' : '未设置目录'))

function isSizeChecked(id: string): boolean {
  return cfg.channel.sizes.some((s) => s.id === id)
}

function toggleSize(id: string, checked: boolean): void {
  const list = cfg.channel.sizes
  if (checked) {
    if (list.some((s) => s.id === id)) return
    const hit = CHANNEL_SIZES.find((s) => s.id === id)
    if (hit && list.length < MAX_EXPORT_SIZES) list.push({ ...hit })
  } else {
    cfg.channel.sizes = list.filter((s) => s.id !== id)
  }
}
</script>

<template>
  <ParamSection title="导出" :badge="badge" :default-open="false">
    <ParamField
      label="输出目录"
      type="text"
      :modelValue="cfg.export.dir"
      placeholder="尚未选择"
      @update:modelValue="(v) => (cfg.export.dir = String(v))"
    />
    <div class="field">
      <div class="field-label"></div>
      <div class="field-control">
        <button class="btn sm" type="button" @click="store.chooseOutputDir()">选择目录</button>
        <button
          class="btn sm ghost"
          type="button"
          :disabled="!cfg.export.dir"
          @click="store.showInFolder && store.showInFolder(cfg.export.dir)"
        >
          打开
        </button>
      </div>
    </div>

    <ParamField
      label="书名标签"
      type="text"
      :modelValue="cfg.export.book"
      placeholder="例：断桥残雪"
      @update:modelValue="(v) => (cfg.export.book = String(v))"
    />
    <ParamField
      label="渠道标签"
      type="text"
      :modelValue="cfg.channel.name"
      placeholder="例：抖音信息流"
      @update:modelValue="(v) => (cfg.channel.name = String(v))"
    />
    <ParamField
      label="子目录模板"
      type="text"
      :modelValue="cfg.channel.subfolderPattern"
      placeholder="{book}/{channel}"
      @update:modelValue="(v) => (cfg.channel.subfolderPattern = String(v))"
    />
    <div class="field-hint">
      按 / 分层自动建子目录，空段丢弃；留空则直接输出到根目录。当前效果：{{ subfolderPreview }}
    </div>

    <ParamField
      label="文件名模板"
      type="text"
      :modelValue="cfg.export.filenameTemplate"
      placeholder="{index}"
      @update:modelValue="(v) => (cfg.export.filenameTemplate = String(v))"
    />
    <ParamField
      label="序号位数"
      :modelValue="cfg.export.pad"
      :min="1"
      :max="5"
      unit="位"
      @update:modelValue="(v) => (cfg.export.pad = Number(v))"
    />
    <div v-if="preview" class="field-hint">预览：{{ preview }}</div>

    <ParamField
      label="同时打包 ZIP"
      type="check"
      :modelValue="cfg.export.alsoZip"
      @update:modelValue="(v) => (cfg.export.alsoZip = Boolean(v))"
    />

    <div class="field-hint">
      支持变量：{index} 序号、{total} 总张数、{title} 封面标题、{date} 日期、{book} 书名、{channel} 渠道、{size} 尺寸。默认逐张落盘，中断后已导出的文件仍然可用。
    </div>

    <div class="field-stack">
      <div class="field-label wide">多尺寸导出</div>
      <label v-for="size in CHANNEL_SIZES" :key="size.id" class="check-row">
        <input
          type="checkbox"
          :checked="isSizeChecked(size.id)"
          @change="toggleSize(size.id, ($event.target as HTMLInputElement).checked)"
        />
        <span>{{ size.label }}（{{ size.width }}×{{ size.height }}）</span>
      </label>
      <div class="field-hint" style="margin-left: 0">
        勾选后一次导出多个渠道尺寸；每种尺寸按自身画布独立重排，张数可以不同。
      </div>
    </div>

    <div class="field-hint">
      渠道标签与多尺寸选择会随「存为模板」一起保存，形成渠道模板包（含视觉参数），可直接分享给团队。
    </div>

    <div v-if="store.exporting" class="mt8">
      <div class="row between" style="font-size: 11px; color: var(--text-2)">
        <span>{{ store.exportPhase }}</span>
        <span>{{ progressPercent }}%</span>
      </div>
      <div class="progress"><i :style="{ width: progressPercent + '%' }"></i></div>
      <button class="btn sm mt8" type="button" @click="store.cancelExport()">取消</button>
    </div>

    <div v-if="store.exportError" class="notice error mt8">{{ store.exportError }}</div>
    <div v-if="store.exportSuccess" class="notice success mt8">{{ store.exportSuccess }}</div>

    <div class="row mt12">
      <button
        class="btn primary grow"
        type="button"
        :disabled="store.exporting || !store.hasContent"
        @click="store.runExport()"
      >
        导出全部（{{ store.totalPages }} 张）
      </button>
      <button
        class="btn"
        type="button"
        :disabled="store.exporting || !store.hasContent"
        @click="store.runExportCurrent()"
      >
        仅当前页
      </button>
    </div>
    <button
      class="btn primary grow mt8"
      type="button"
      :disabled="store.exporting || !store.hasContent || cfg.channel.sizes.length === 0"
      @click="store.runExportMultiSize()"
    >
      多尺寸导出（{{ cfg.channel.sizes.length }} 组）
    </button>
  </ParamSection>
</template>
