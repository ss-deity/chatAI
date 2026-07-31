<script setup lang="ts">
/**
 * 会话图片渲染组件。
 * - hover 图片时右下角出现下载、转存按钮
 * - 点击图片打开预览浮层（复用 ImagePreview 组件）
 * - 转存：选择「文件管理」中的目标文件夹后，由服务端把图片写入该目录
 */
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import ImagePreview from '../ImagePreview/index.vue'
import FilePicker from '../FilePicker/index.vue'

const props = defineProps<{ images: string[]; userId?: string }>()

const hoverIndex = ref(-1)
const previewVisible = ref(false)
const previewIndex = ref(0)
const pickerVisible = ref(false)
const savingUrl = ref('')

function fileNameFromUrl(url: string): string {
  try {
    const path = new URL(url, window.location.origin).pathname
    const name = path.split('/').pop() || ''
    return name || `image_${Date.now()}.png`
  } catch {
    return `image_${Date.now()}.png`
  }
}

async function download(url: string) {
  try {
    const res = await fetch(url, { mode: 'cors' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()
    const objUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objUrl
    a.download = fileNameFromUrl(url)
    a.target = '_blank'
    document.body.appendChild(a)
    a.click()
    setTimeout(() => {
      document.body.removeChild(a)
      URL.revokeObjectURL(objUrl)
    }, 400)
  } catch {
    window.open(url, '_blank')
    ElMessage.warning('已在新标签页打开图片，可右键保存')
  }
}

function openPreview(index: number) {
  previewIndex.value = index
  previewVisible.value = true
}

function openPicker(url: string) {
  if (!props.userId) {
    ElMessage.warning('请先登录后再转存')
    return
  }
  savingUrl.value = url
  pickerVisible.value = true
}

/** 由 FilePicker 在点击确定时调用：dir 为目标目录（相对根目录，根目录为空串） */
async function saveToDir(dir: string) {
  const res = await fetch('/api/files/save-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: Number(props.userId),
      url: savingUrl.value,
      dir,
    }),
  })
  const data = await res.json()
  if (data.code !== 0) throw new Error(data.message || '转存失败')
  ElMessage.success(`已转存到「${dir || '我的文件'}」`)
}
</script>

<template>
  <div class="image-card">
    <div
      v-for="(url, index) in images"
      :key="index"
      class="image-card-item"
      @mouseenter="hoverIndex = index"
      @mouseleave="hoverIndex = -1"
      @click="openPreview(index)"
    >
      <img class="image-card-img" :src="url" alt="" />
      <div v-show="hoverIndex === index" class="image-card-tools">
        <button class="image-card-tool" title="转存到文件管理" @click.stop="openPicker(url)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M1.8 4.2A1.4 1.4 0 013.2 2.8h2.4l1.2 1.4h5A1.4 1.4 0 0113.2 5.6v5.6a1.4 1.4 0 01-1.4 1.4H3.2a1.4 1.4 0 01-1.4-1.4V4.2z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
            <path d="M7.5 6.6v3.4M7.5 10l-1.5-1.5M7.5 10L9 8.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <button class="image-card-tool" title="下载" @click.stop="download(url)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M4 6.7l4 4 4-4M8 10.7V2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M2.7 10v.7A2.3 2.3 0 005 13h6a2.3 2.3 0 002.3-2.3V10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    </div>

    <ImagePreview
      v-model:visible="previewVisible"
      :images="images"
      :initial-index="previewIndex"
    />

    <FilePicker
      v-if="userId"
      v-model:visible="pickerVisible"
      :user-id="userId"
      :save="saveToDir"
      confirm-text="转存"
    />
  </div>
</template>

<style scoped>
.image-card {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 2px;
}

.image-card-item {
  position: relative;
  cursor: pointer;
}

.image-card-img {
  max-width: 100%;
  max-height: 360px;
  width: auto;
  height: auto;
  object-fit: contain;
  border-radius: 8px;
  display: block;
}

.image-card-tools {
  position: absolute;
  right: 8px;
  bottom: 8px;
  display: flex;
  gap: 8px;
}

.image-card-tool {
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 6px;
  background: rgba(85, 94, 111, 0.55);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}

.image-card-tool:hover {
  background: rgba(85, 94, 111, 0.8);
}
</style>
