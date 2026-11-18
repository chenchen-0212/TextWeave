<script setup lang="ts">
/** AI 供应商配置表单：文本模型（出提示词）+ 生图模型（出图）。 */

import { QUALITY_OPTIONS, useAIStore } from '../stores/ai'
import ParamField from './ui/ParamField.vue'

const ai:any = useAIStore()
const emit = defineEmits<{ saved: [] }>()

async function save(): Promise<void> {
  await ai.save()
  if (!ai.lastError) emit('saved')
}
</script>

<template>
  <div class="field-stack">
    <div class="field-label">文本模型 · 生成生图提示词</div>
    <ParamField
      label="基础 URL"
      type="text"
      :modelValue="ai.config.llm.baseUrl"
      placeholder="https://api.deepseek.com/v1"
      @update:modelValue="(v:any) => (ai.config.llm.baseUrl = String(v))"
    />
    <ParamField
      label="API Key"
      type="text"
      :modelValue="ai.config.llm.apiKey"
      placeholder="sk-..."
      @update:modelValue="(v) => (ai.config.llm.apiKey = String(v))"
    />
    <ParamField
      label="模型名称"
      type="text"
      :modelValue="ai.config.llm.model"
      placeholder="deepseek-chat"
      @update:modelValue="(v) => (ai.config.llm.model = String(v))"
    />
    <ParamField
      label="上下文长度"
      type="number"
      :modelValue="ai.config.llm.contextLength"
      :min="1000"
      :max="128000"
      :step="1000"
      unit="tokens"
      @update:modelValue="(v) => (ai.config.llm.contextLength = Number(v))"
    />
    <div class="field">
      <div class="field-label">系统提示词</div>
      <div class="field-control">
        <textarea
          v-model="ai.config.llm.systemPrompt"
          class="ai-prompt"
          rows="4"
          spellcheck="false"
        ></textarea>
      </div>
    </div>

    <div class="field-label" style="margin-top: 14px">生图模型</div>
    <ParamField
      label="请求地址"
      type="text"
      :modelValue="ai.config.image.baseUrl"
      placeholder="https://api.example.com/v1/images/generations"
      @update:modelValue="(v) => (ai.config.image.baseUrl = String(v))"
    />
    <ParamField
      label="API Key"
      type="text"
      :modelValue="ai.config.image.apiKey"
      placeholder="sk-..."
      @update:modelValue="(v) => (ai.config.image.apiKey = String(v))"
    />
    <ParamField
      label="模型名称"
      type="text"
      :modelValue="ai.config.image.model"
      placeholder="gpt-image-2.6-flare"
      @update:modelValue="(v) => (ai.config.image.model = String(v))"
    />
    <ParamField
      label="画质"
      type="select"
      :modelValue="ai.config.image.quality"
      :options="QUALITY_OPTIONS"
      @update:modelValue="(v) => (ai.config.image.quality = String(v))"
    />

    <div class="field-hint">
      输出尺寸与格式取右侧「画布」配置。请求地址要填完整的端点（含 /images/generations
      这类后缀），程序不会自动拼接。配置只保存在本机 ai.json，不随模板或分享码外发；
      导出的文件带 API Key，别随手传给他人。
    </div>

    <div class="row">
      <button class="btn primary grow" type="button" :disabled="ai.saving" @click="save">
        {{ ai.saving ? '保存中…' : '保存配置' }}
      </button>
      <button
        class="btn"
        type="button"
        title="导出为 .json 文件（含 API Key）"
        @click="ai.exportConfig()"
      >
        导出
      </button>
      <button class="btn" type="button" title="从 .json 文件导入并立即生效" @click="ai.importConfig()">
        导入
      </button>
    </div>
  </div>
</template>

<style scoped>
.ai-prompt {
  width: 100%;
  min-height: 72px;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--bg-2, #1b1e23);
  color: inherit;
  font: inherit;
  font-size: 12px;
  line-height: 1.55;
  resize: vertical;
  color: #999
}
</style>
