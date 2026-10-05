<script setup lang="ts">
/**
 * 封面管理分区：批量创建、排序、启停、编辑、预览跳转。
 *
 * 每张封面都是一份完整的配置（文字 + 版式 + 背景 + 蒙版），
 * 因此既可以做成风格完全不同的多张封面，也可以复制后微调做系列。
 */

import { computed } from 'vue'
import { useAppStore } from '../../stores/config'
import { MAX_COVERS } from '../../types'
import CoverEditor from './CoverEditor.vue'
import ParamSection from './ParamSection.vue'

const store = useAppStore()
const cfg = store.cfg

const covers = computed(() => cfg.cover.items)
const enabledCount = computed(() => covers.value.filter((c) => c.enabled).length)
const active = computed(() => store.activeCover())

const badge = computed(() => {
  const total = covers.value.length
  if (total === 0) return '无'
  return enabledCount.value === total ? `${total} 张` : `${enabledCount.value}/${total} 张`
})

const canAdd = computed(() => covers.value.length < MAX_COVERS)

/** 第 i 张封面在输出序列里的页序号（用于跳转预览） */
function coverPageIndex(id: string): number {
  return store.pages.findIndex((p) => p.kind === 'cover' && p.coverId === id)
}

/** 选中某张封面，并把预览跳到它 */
function select(id: string): void {
  store.setActiveCover(id)
  const idx = coverPageIndex(id)
  if (idx >= 0) store.currentPage = idx
}

function coverLabel(index: number, id: string): string {
  const c = covers.value[index]
  void id
  // v0.4.0：标题下沉为文本元素，取首个非空文本
  const title = c?.texts?.map((t) => t.text?.trim()).find(Boolean)
  return title || `封面 ${index + 1}`
}

function hasOwnBg(id: string): boolean {
  const c = covers.value.find((it) => it.id === id)
  return Boolean(c && c.background.useOwn && c.background.path)
}
</script>

<template>
  <ParamSection title="封面" :badge="badge">
    <div class="row mb8">
      <button
        class="btn sm primary grow"
        type="button"
        :disabled="!canAdd"
        @click="store.addCover()"
      >
        ＋ 新增封面
      </button>
      <button
        class="btn sm"
        type="button"
        :disabled="!canAdd || !active"
        title="复制当前封面（含背景与蒙版设置）"
        @click="active && store.duplicateCover(active.id)"
      >
        复制当前
      </button>
    </div>

    <div class="cover-list">
      <div
        v-for="(c, i) in covers"
        :key="c.id"
        class="cover-row"
        :class="{ active: c.id === cfg.cover.activeId, off: !c.enabled }"
        @click="select(c.id)"
      >
        <input
          class="cover-check"
          type="checkbox"
          :checked="c.enabled"
          :title="c.enabled ? '参与输出' : '已停用'"
          @click.stop
          @change="store.toggleCover(c.id)"
        />
        <span class="cover-index">{{ i + 1 }}</span>
        <span class="cover-title" :title="coverLabel(i, c.id)">{{ coverLabel(i, c.id) }}</span>
        <span class="cover-tag" :class="{ own: hasOwnBg(c.id) }">
          {{ hasOwnBg(c.id) ? '专属背景' : '沿用正文' }}
        </span>
        <span class="cover-actions" @click.stop>
          <button
            class="btn sm ghost"
            type="button"
            :disabled="i === 0"
            title="上移"
            @click="store.moveCover(c.id, -1)"
          >
            ↑
          </button>
          <button
            class="btn sm ghost"
            type="button"
            :disabled="i === covers.length - 1"
            title="下移"
            @click="store.moveCover(c.id, 1)"
          >
            ↓
          </button>
          <button
            class="btn sm ghost"
            type="button"
            :disabled="!canAdd"
            title="复制"
            @click="store.duplicateCover(c.id)"
          >
            ⧉
          </button>
          <button
            class="btn sm ghost danger"
            type="button"
            :disabled="covers.length <= 1"
            title="删除"
            @click="store.removeCover(c.id)"
          >
            ✕
          </button>
        </span>
      </div>
    </div>

    <div v-if="enabledCount < covers.length" class="field-hint" style="margin-left: 0">
      已停用的封面不会出现在输出序列中。
    </div>

    <!-- 当前封面的编辑区。key 绑定 id，切换封面时重建表单避免残留状态 -->
    <CoverEditor v-if="active" :key="active.id" :cover="active" />
  </ParamSection>
</template>
