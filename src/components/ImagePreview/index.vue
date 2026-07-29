<script setup lang="ts">
/**
 * 通用图片预览浮层（Teleport 到 body）。
 * - 支持缩放/旋转/拖拽/上一张/下一张/滚轮缩放/键盘快捷键
 * - v-model:visible 控制显隐；images + initial-index 决定内容
 * - 由 ImageCard 与 FileManager 共同复用，保证会话与文件列表预览体验一致
 */
import { computed, ref, watch, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'

const props = withDefaults(
  defineProps<{
    visible: boolean
    images: string[]
    initialIndex?: number
  }>(),
  { initialIndex: 0 },
)

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
}>()

const currentIndex = ref(props.initialIndex)
const scale = ref(1)
const rotate = ref(0)
const translateX = ref(0)
const translateY = ref(0)
const isDragging = ref(false)

let startX = 0
let startY = 0
let startTranslateX = 0
let startTranslateY = 0

const previewSrc = computed(() => props.images[currentIndex.value] || '')
const imageStyle = computed(() => ({
  transform: `translate(${translateX.value}px, ${translateY.value}px) scale(${scale.value}) rotate(${rotate.value}deg)`,
  transition: isDragging.value ? 'none' : 'transform 0.2s ease',
}))

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

function resetTransform() {
  scale.value = 1
  rotate.value = 0
  translateX.value = 0
  translateY.value = 0
}

function close() {
  emit('update:visible', false)
}

function zoomIn() {
  scale.value = Math.min(scale.value + 0.2, 5)
}

function zoomOut() {
  scale.value = Math.max(scale.value - 0.2, 0.2)
}

function rotateLeft() {
  rotate.value -= 90
}

function rotateRight() {
  rotate.value += 90
}

function handlePrev() {
  if (props.images.length < 2) return
  currentIndex.value =
    currentIndex.value > 0 ? currentIndex.value - 1 : props.images.length - 1
  resetTransform()
}

function handleNext() {
  if (props.images.length < 2) return
  currentIndex.value =
    currentIndex.value < props.images.length - 1 ? currentIndex.value + 1 : 0
  resetTransform()
}

function handleWheel(e: WheelEvent) {
  e.preventDefault()
  if (e.deltaY < 0) zoomIn()
  else zoomOut()
}

function handleMouseDown(e: MouseEvent) {
  if (e.button !== 0) return
  e.preventDefault()
  isDragging.value = true
  startX = e.clientX
  startY = e.clientY
  startTranslateX = translateX.value
  startTranslateY = translateY.value

  const moveHandler = (ev: MouseEvent) => {
    if (!isDragging.value) return
    translateX.value = startTranslateX + (ev.clientX - startX)
    translateY.value = startTranslateY + (ev.clientY - startY)
  }
  const upHandler = () => {
    isDragging.value = false
    document.removeEventListener('mousemove', moveHandler)
    document.removeEventListener('mouseup', upHandler)
  }
  document.addEventListener('mousemove', moveHandler)
  document.addEventListener('mouseup', upHandler)
}

function handleKeyDown(e: KeyboardEvent) {
  if (!props.visible) return
  if (e.key === 'Escape') {
    close()
    return
  }
  if (e.key === 'ArrowLeft') {
    handlePrev()
    return
  }
  if (e.key === 'ArrowRight') {
    handleNext()
    return
  }
  if (e.shiftKey) {
    const k = e.key.toLowerCase()
    if (k === 'arrowup') {
      e.preventDefault()
      zoomIn()
    } else if (k === 'arrowdown') {
      e.preventDefault()
      zoomOut()
    } else if (k === 'r') {
      e.preventDefault()
      rotateRight()
    }
  }
}

watch(
  () => props.visible,
  (v) => {
    if (v) {
      currentIndex.value = Math.min(
        Math.max(0, props.initialIndex),
        Math.max(0, props.images.length - 1),
      )
      resetTransform()
      document.body.style.overflow = 'hidden'
      document.addEventListener('keydown', handleKeyDown)
    } else {
      document.body.style.overflow = ''
      document.removeEventListener('keydown', handleKeyDown)
    }
  },
)

onUnmounted(() => {
  document.body.style.overflow = ''
  document.removeEventListener('keydown', handleKeyDown)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="image-preview-mask" @click.self="close">
      <div class="preview-container" @click.stop>
        <!-- 关闭 -->
        <button class="preview-btn close-btn" title="关闭" @click="close">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
            <path d="M4 4l8 8M12 4L4 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
        </button>

        <!-- 前一张/下一张 -->
        <button
          v-if="images.length > 1"
          class="preview-btn nav-btn nav-prev"
          title="上一张"
          @click.stop="handlePrev"
        >
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <button
          v-if="images.length > 1"
          class="preview-btn nav-btn nav-next"
          title="下一张"
          @click.stop="handleNext"
        >
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
            <path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>

        <!-- 图片区域 -->
        <div
          class="image-view-area"
          @mousedown="handleMouseDown"
          @wheel.prevent="handleWheel"
        >
          <div class="image-wrapper" :style="imageStyle">
            <img :src="previewSrc" alt="preview" draggable="false" />
          </div>
        </div>

        <!-- 底部工具栏 -->
        <div class="preview-toolbar">
          <button class="tool-item" title="放大" @click.stop="zoomIn">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.4"/>
              <path d="M11 11l3 3M5 7h4M7 5v4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            </svg>
          </button>
          <button class="tool-item" title="缩小" @click.stop="zoomOut">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.4"/>
              <path d="M11 11l3 3M5 7h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            </svg>
          </button>
          <button class="tool-item" title="向左旋转" @click.stop="rotateLeft">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
              <path d="M3.5 8a4.5 4.5 0 108-2.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
              <path d="M11.5 3v2.7H8.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <button class="tool-item" title="向右旋转" @click.stop="rotateRight">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
              <path d="M12.5 8a4.5 4.5 0 11-8-2.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
              <path d="M4.5 3v2.7h2.7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <button class="tool-item" title="下载当前图片" @click.stop="download(previewSrc)">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
              <path d="M4 6.7l4 4 4-4M8 10.7V2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M2.7 10v.7A2.3 2.3 0 005 13h6a2.3 2.3 0 002.3-2.3V10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            </svg>
          </button>
          <span v-if="images.length > 1" class="preview-counter">
            {{ currentIndex + 1 }} / {{ images.length }}
          </span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style>
.image-preview-mask {
  position: fixed;
  inset: 0;
  z-index: 2100;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  user-select: none;
}

.preview-container {
  position: relative;
  width: min(890px, calc(100vw - 48px));
  height: min(600px, calc(100vh - 48px));
  background: #1f1f1f;
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.preview-btn {
  border: none;
  cursor: pointer;
  color: #fff;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}

.preview-btn:hover {
  background: rgba(0, 0, 0, 0.7);
}

.close-btn {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  z-index: 20;
}

.nav-btn {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 40px;
  height: 40px;
  border-radius: 50%;
  z-index: 20;
}

.nav-prev {
  left: 12px;
}

.nav-next {
  right: 12px;
}

.image-view-area {
  flex: 1;
  overflow: hidden;
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  background: #000;
  cursor: grab;
}

.image-view-area:active {
  cursor: grabbing;
}

.image-wrapper {
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
}

.image-wrapper img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  pointer-events: none;
  display: block;
}

.preview-toolbar {
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.55), rgba(0, 0, 0, 0.15));
  padding: 0 16px;
}

.preview-toolbar .tool-item {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, transform 0.15s;
}

.preview-toolbar .tool-item:hover {
  background: rgba(255, 255, 255, 0.15);
  transform: scale(1.05);
}

.preview-counter {
  color: #fff;
  font-size: 13px;
  margin-left: 8px;
  min-width: 44px;
  text-align: center;
}
</style>
