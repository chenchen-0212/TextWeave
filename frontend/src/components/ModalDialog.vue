<script setup lang="ts">
/** 通用弹窗外壳：遮罩、标题、关闭；Esc 与点击遮罩均可关闭。 */

import { onBeforeUnmount, onMounted } from 'vue'

defineProps<{ title: string; subtitle?: string }>()
const emit = defineEmits<{ close: [] }>()

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div class="modal-mask" @click.self="emit('close')">
      <div class="modal-panel" role="dialog" aria-modal="true" :aria-label="title">
        <div class="modal-head">
          <strong>{{ title }}</strong>
          <span v-if="subtitle" class="modal-sub">{{ subtitle }}</span>
          <button class="btn sm ghost" type="button" @click="emit('close')">关闭</button>
        </div>
        <div class="modal-body">
          <slot />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(16, 24, 40, 0.38);
}

.modal-panel {
  display: flex;
  flex-direction: column;
  width: min(620px, 100%);
  max-height: 100%;
  background: var(--panel);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.modal-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 14px;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}

.modal-sub {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.modal-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 14px 16px;
}
</style>
