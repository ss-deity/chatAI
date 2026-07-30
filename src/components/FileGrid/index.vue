<script setup lang="ts">
/**
 * 附件网格：横向排列的缩略图卡片，支持 uploading / success / failed 三态。
 * - 输入区顶部：可删除（closable）
 * - 历史消息回显：只读（closable=false）
 * 图片点击可预览（复用 ImagePreview）；非图片点击打开原文件。
 */
import { computed, ref } from 'vue'
import type { Attachment } from '../../utils/uploadFile'
import ImagePreview from '../ImagePreview/index.vue'

const props = withDefaults(
  defineProps<{
    files: Attachment[]
    closable?: boolean
  }>(),
  { closable: true },
)

const emit = defineEmits<{
  (e: 'remove', uid: string): void
}>()

/** 用于扩展名文字标记 */
function extLabel(name: string): string {
  const idx = name.lastIndexOf('.')
  return (idx >= 0 ? name.slice(idx + 1) : name).toUpperCase().slice(0, 4)
}

function isImage(a: Attachment): boolean {
  return a.type.startsWith('image/')
}

/** 缩略图 src：优先本地对象 URL（上传中），完成后用远端 url */
function thumbSrc(a: Attachment): string {
  return a.thumbnail || a.url || ''
}

/** ---------- 预览浮层 ---------- */
const previewVisible = ref(false)
const previewIndex = ref(0)

const previewImages = computed(() =>
  props.files.filter(isImage).map((a) => a.url || a.thumbnail).filter(Boolean) as string[],
)

function handleClick(a: Attachment) {
  if (isImage(a)) {
    const list = props.files.filter(isImage)
    const idx = list.findIndex((it) => it.uid === a.uid)
    if (idx < 0) return
    previewIndex.value = idx
    previewVisible.value = true
    return
  }
  if (a.url) window.open(a.url, '_blank', 'noopener')
}
</script>

<template>
  <div v-if="files.length" class="file-grid">
    <div
      v-for="file in files"
      :key="file.uid"
      class="file-grid-item"
      :class="{
        'is-image': isImage(file),
        'is-uploading': file.status === 'uploading',
        'is-failed': file.status === 'failed',
      }"
      :title="file.name"
      @click="handleClick(file)"
    >
      <!-- 图片：缩略图；非图片：文件卡 -->
      <img
        v-if="isImage(file) && thumbSrc(file)"
        class="file-grid-thumb"
        :src="thumbSrc(file)"
        alt=""
      />
      <div v-else class="file-grid-doc">
        <span class="file-grid-doc-ext">{{ extLabel(file.name) }}</span>
        <span class="file-grid-doc-name">{{ file.name }}</span>
      </div>

      <!-- 状态遮罩 -->
      <div v-if="file.status === 'uploading'" class="file-grid-mask">
        <span class="loader" />
      </div>
      <div v-else-if="file.status === 'failed'" class="file-grid-mask failed">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="#fff" stroke-width="1.6"/>
          <path d="M12 7v6M12 16.5v.5" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
        <span class="failed-text">上传失败</span>
      </div>

      <!-- 关闭按钮 -->
      <button
        v-if="closable"
        class="file-grid-close"
        title="移除"
        @click.stop="emit('remove', file.uid)"
      >
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
          <path d="M4 4l8 8M12 4L4 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
      </button>
    </div>

    <ImagePreview
      v-model:visible="previewVisible"
      :images="previewImages"
      :initial-index="previewIndex"
    />
  </div>
</template>

<style scoped>
.file-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 8px 4px;
}

.file-grid-item {
  position: relative;
  width: 64px;
  height: 64px;
  border-radius: 8px;
  overflow: hidden;
  background: var(--gf-bg-elevated);
  border: 1px solid var(--gf-border);
  cursor: pointer;
  flex-shrink: 0;
  transition: border-color 0.15s;
}

.file-grid-item:hover {
  border-color: var(--gf-primary);
}

.file-grid-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.file-grid-doc {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 6px 4px;
  box-sizing: border-box;
  color: var(--gf-text-secondary);
}

.file-grid-doc-ext {
  font-size: 12px;
  font-weight: 600;
  color: var(--gf-primary);
  letter-spacing: 0.3px;
}

.file-grid-doc-name {
  font-size: 10px;
  line-height: 1.2;
  max-width: 56px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  white-space: normal;
  color: var(--gf-text-tertiary);
  text-align: center;
}

.file-grid-mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 4px;
  color: #fff;
}

.file-grid-mask.failed {
  background: rgba(220, 60, 60, 0.55);
}

.failed-text {
  font-size: 10px;
  line-height: 1;
}

.loader {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: #fff;
  animation: file-grid-spin 0.8s linear infinite;
}

@keyframes file-grid-spin {
  to {
    transform: rotate(360deg);
  }
}

.file-grid-close {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  cursor: pointer;
  display: none;
  align-items: center;
  justify-content: center;
  padding: 0;
  z-index: 2;
}

.file-grid-item:hover .file-grid-close {
  display: flex;
}

.file-grid-close:hover {
  background: rgba(0, 0, 0, 0.8);
}
</style>
