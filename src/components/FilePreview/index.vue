<script setup lang="ts">
/**
 * 通用文件预览浮层：支持 PPT/PPTX（图片轮播）与 TXT 等文本文件。
 *
 * - PPT：调用 /api/ppt/pages 拿到分页图片 URL 列表（后端 soffice + pdftoppm 转换 + BOS 缓存），
 *   预览器提供缩略图、缩放、上一页/下一页、全屏、页码、下载原始 PPTX 的能力
 * - TXT：fetch → 文本，展示前 200KB，剩余提示下载获取完整内容
 * 弹窗风格对齐 SideBar 中的 gf-dialog，主题变量来自 assets/theme.css。
 */
import { computed, ref, watch, onUnmounted, nextTick } from 'vue'
import { ElMessage } from 'element-plus'

interface PreviewFile {
  url: string
  name?: string
  /** 'ppt' | 'txt'；不传则按扩展名自动推断 */
  type?: 'ppt' | 'txt'
}

const props = withDefaults(
  defineProps<{
    visible: boolean
    file: PreviewFile | null
  }>(),
  { file: null },
)

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
}>()

const TXT_PREVIEW_LIMIT = 200 * 1024 // 200KB

const loading = ref(false)
const errorMsg = ref('')

/* -------- TXT -------- */
const textContent = ref('')
const textTruncated = ref(false)

/* -------- PPT 图片轮播 -------- */
const pptPages = ref<string[]>([])
const currentPage = ref(0)
const scale = ref(1)
const translateX = ref(0)
const translateY = ref(0)
const isDragging = ref(false)
let dragStartX = 0
let dragStartY = 0
let dragStartTx = 0
let dragStartTy = 0

/* -------- refs -------- */
const dialogRef = ref<HTMLElement | null>(null)
const isFullscreen = ref(false)

const displayName = computed(() => {
  const raw =
    props.file?.name || (props.file?.url ? fileNameFromUrl(props.file.url) : '') || '预览'
  return raw
})

const resolvedType = computed<'ppt' | 'txt' | ''>(() => {
  if (!props.file) return ''
  if (props.file.type) return props.file.type
  const name = (props.file.name || props.file.url || '').toLowerCase()
  if (name.endsWith('.ppt') || name.endsWith('.pptx')) return 'ppt'
  if (
    name.endsWith('.txt') ||
    name.endsWith('.md') ||
    name.endsWith('.log') ||
    name.endsWith('.json') ||
    name.endsWith('.csv')
  ) return 'txt'
  return ''
})

const totalPages = computed(() => pptPages.value.length)
const currentPageUrl = computed(() => pptPages.value[currentPage.value] || '')

const imageStyle = computed(() => ({
  transform: `translate(${translateX.value}px, ${translateY.value}px) scale(${scale.value})`,
  transition: isDragging.value ? 'none' : 'transform 0.18s ease',
  cursor: scale.value > 1 ? (isDragging.value ? 'grabbing' : 'grab') : 'default',
}))

function fileNameFromUrl(url: string): string {
  try {
    const path = new URL(url, window.location.origin).pathname
    const name = path.split('/').pop() || ''
    return decodeURIComponent(name) || 'file'
  } catch {
    return 'file'
  }
}

/**
 * BOS 直链没有开 CORS，浏览器 fetch 会被拦掉；改走网关同源代理 /api/files/raw?url=
 * download=1 会附带 Content-Disposition: attachment，供下载按钮走 blob 保存。
 */
function proxyUrl(rawUrl: string, download = false): string {
  if (!rawUrl) return rawUrl
  // 已经是同源的 /api/... 直接用
  try {
    const u = new URL(rawUrl, window.location.href)
    if (u.origin === window.location.origin) return rawUrl
  } catch {
    /* keep going */
  }
  return `/api/files/raw?url=${encodeURIComponent(rawUrl)}${download ? '&download=1' : ''}`
}

function close() {
  emit('update:visible', false)
}

/* --------------------------- TXT --------------------------- */

async function loadText() {
  if (!props.file?.url) return
  loading.value = true
  errorMsg.value = ''
  textContent.value = ''
  textTruncated.value = false
  try {
    const res = await fetch(proxyUrl(props.file.url))
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()
    let sliced = blob
    if (blob.size > TXT_PREVIEW_LIMIT) {
      sliced = blob.slice(0, TXT_PREVIEW_LIMIT)
      textTruncated.value = true
    }
    textContent.value = await sliced.text()
  } catch (e) {
    errorMsg.value = (e as Error).message || '加载失败'
  } finally {
    loading.value = false
  }
}

/* --------------------------- PPT --------------------------- */

async function loadPptPages() {
  if (!props.file?.url) return
  loading.value = true
  errorMsg.value = ''
  pptPages.value = []
  currentPage.value = 0
  resetTransform()
  try {
    const res = await fetch(
      `/api/ppt/pages?url=${encodeURIComponent(props.file.url)}`,
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = (await res.json()) as {
      code: number
      message: string
      data: { pages: string[]; total: number } | null
    }
    if (body.code !== 0 || !body.data) {
      throw new Error(body.message || '预览生成失败')
    }
    pptPages.value = body.data.pages || []
    if (pptPages.value.length === 0) {
      throw new Error('未拿到任何页面')
    }
  } catch (e) {
    errorMsg.value = (e as Error).message || '加载失败'
  } finally {
    loading.value = false
  }
}

function goToPage(idx: number) {
  if (idx < 0 || idx >= totalPages.value) return
  currentPage.value = idx
  resetTransform()
  // 缩略图区域滚动到当前项
  nextTick(() => {
    const el = document.querySelector<HTMLElement>(
      `.fp-thumb[data-idx="${idx}"]`,
    )
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  })
}

function handlePrev() {
  if (currentPage.value > 0) goToPage(currentPage.value - 1)
}

function handleNext() {
  if (currentPage.value < totalPages.value - 1) goToPage(currentPage.value + 1)
}

function zoomIn() {
  scale.value = Math.min(scale.value + 0.2, 5)
}

function zoomOut() {
  const next = Math.max(scale.value - 0.2, 0.4)
  scale.value = next
  if (next <= 1) {
    translateX.value = 0
    translateY.value = 0
  }
}

function fitScale() {
  scale.value = 1
  translateX.value = 0
  translateY.value = 0
}

function resetTransform() {
  scale.value = 1
  translateX.value = 0
  translateY.value = 0
}

function handleWheel(e: WheelEvent) {
  if (resolvedType.value !== 'ppt') return
  e.preventDefault()
  if (e.deltaY < 0) zoomIn()
  else zoomOut()
}

function handleMouseDown(e: MouseEvent) {
  if (resolvedType.value !== 'ppt') return
  if (scale.value <= 1) return
  if (e.button !== 0) return
  e.preventDefault()
  isDragging.value = true
  dragStartX = e.clientX
  dragStartY = e.clientY
  dragStartTx = translateX.value
  dragStartTy = translateY.value
  const move = (ev: MouseEvent) => {
    if (!isDragging.value) return
    translateX.value = dragStartTx + (ev.clientX - dragStartX)
    translateY.value = dragStartTy + (ev.clientY - dragStartY)
  }
  const up = () => {
    isDragging.value = false
    document.removeEventListener('mousemove', move)
    document.removeEventListener('mouseup', up)
  }
  document.addEventListener('mousemove', move)
  document.addEventListener('mouseup', up)
}

async function toggleFullscreen() {
  const el = dialogRef.value
  if (!el) return
  try {
    if (!document.fullscreenElement) {
      await el.requestFullscreen()
    } else {
      await document.exitFullscreen()
    }
  } catch (e) {
    ElMessage.warning('浏览器拒绝了全屏请求')
  }
}

function onFullscreenChange() {
  isFullscreen.value = !!document.fullscreenElement
}

/* --------------------------- 下载 --------------------------- */

async function handleDownload() {
  if (!props.file?.url) return
  const url = props.file.url
  const filename = displayName.value
  try {
    // 走同源代理，避免 BOS 未开 CORS 导致 fetch 失败
    const res = await fetch(proxyUrl(url, true))
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()
    const objUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    setTimeout(() => {
      document.body.removeChild(a)
      URL.revokeObjectURL(objUrl)
    }, 400)
  } catch {
    window.open(url, '_blank', 'noopener')
    ElMessage.warning('已在新标签页打开文件')
  }
}

/* --------------------------- 键盘 --------------------------- */

function handleKeyDown(e: KeyboardEvent) {
  if (!props.visible) return
  if (e.key === 'Escape') {
    // 全屏时优先由浏览器接管 Esc（会自动退出全屏）
    if (!document.fullscreenElement) close()
    return
  }
  if (resolvedType.value !== 'ppt') return
  if (e.key === 'ArrowLeft') {
    e.preventDefault()
    handlePrev()
  } else if (e.key === 'ArrowRight') {
    e.preventDefault()
    handleNext()
  } else if (e.key === '+' || e.key === '=') {
    e.preventDefault()
    zoomIn()
  } else if (e.key === '-' || e.key === '_') {
    e.preventDefault()
    zoomOut()
  } else if (e.key.toLowerCase() === 'f') {
    e.preventDefault()
    toggleFullscreen()
  }
}

watch(
  () => props.visible,
  (v) => {
    if (v) {
      document.body.style.overflow = 'hidden'
      document.addEventListener('keydown', handleKeyDown)
      document.addEventListener('fullscreenchange', onFullscreenChange)
      if (resolvedType.value === 'txt') loadText()
      else if (resolvedType.value === 'ppt') loadPptPages()
    } else {
      document.body.style.overflow = ''
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {})
      }
      // 清理
      textContent.value = ''
      errorMsg.value = ''
      textTruncated.value = false
      pptPages.value = []
      currentPage.value = 0
      resetTransform()
    }
  },
)

onUnmounted(() => {
  document.body.style.overflow = ''
  document.removeEventListener('keydown', handleKeyDown)
  document.removeEventListener('fullscreenchange', onFullscreenChange)
})
</script>

<template>
  <Teleport to="body">
    <transition name="fp-dialog">
      <div v-if="visible" class="fp-dialog-mask" @click.self="close">
        <div
          ref="dialogRef"
          class="fp-dialog"
          :class="{ 'is-ppt': resolvedType === 'ppt', 'is-fullscreen': isFullscreen }"
          role="dialog"
          aria-modal="true"
        >
          <div class="fp-dialog-header">
            <h3 class="fp-dialog-title" :title="displayName">{{ displayName }}</h3>
            <div class="fp-header-actions">
              <span
                v-if="resolvedType === 'ppt' && totalPages > 0"
                class="fp-page-indicator"
              >{{ currentPage + 1 }} / {{ totalPages }}</span>
              <button
                v-if="resolvedType === 'ppt'"
                class="fp-icon-btn"
                :title="isFullscreen ? '退出全屏 (F)' : '全屏 (F)'"
                @click="toggleFullscreen"
              >
                <svg v-if="!isFullscreen" width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <svg v-else width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
              <button class="fp-icon-btn" title="关闭 (Esc)" @click="close">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
              </button>
            </div>
          </div>

          <div class="fp-dialog-body">
            <!-- PPT：缩略图 + 主视图 -->
            <template v-if="resolvedType === 'ppt'">
              <div v-if="loading" class="fp-center fp-loading">
                <span class="fp-spinner" />
                <span>正在生成预览，PPT 首次预览较慢，请稍候…</span>
              </div>
              <div v-else-if="errorMsg" class="fp-center fp-empty-error">
                <div>预览失败：{{ errorMsg }}</div>
                <button class="gf-btn gf-btn-plain fp-retry" @click="loadPptPages">重试</button>
              </div>
              <div v-else class="fp-ppt-layout">
                <!-- 缩略图 -->
                <div class="fp-thumbs">
                  <div
                    v-for="(u, i) in pptPages"
                    :key="i"
                    class="fp-thumb"
                    :class="{ active: i === currentPage }"
                    :data-idx="i"
                    @click="goToPage(i)"
                  >
                    <img :src="u" alt="" draggable="false" />
                    <span class="fp-thumb-num">{{ i + 1 }}</span>
                  </div>
                </div>
                <!-- 主视图 -->
                <div
                  class="fp-stage"
                  @wheel.prevent="handleWheel"
                  @mousedown="handleMouseDown"
                >
                  <button
                    v-if="totalPages > 1"
                    class="fp-nav-btn fp-nav-prev"
                    :disabled="currentPage === 0"
                    title="上一页 (←)"
                    @click.stop="handlePrev"
                  >
                    <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                      <path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </button>
                  <button
                    v-if="totalPages > 1"
                    class="fp-nav-btn fp-nav-next"
                    :disabled="currentPage === totalPages - 1"
                    title="下一页 (→)"
                    @click.stop="handleNext"
                  >
                    <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                      <path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </button>
                  <div class="fp-stage-inner">
                    <img
                      v-if="currentPageUrl"
                      :src="currentPageUrl"
                      class="fp-page-img"
                      :style="imageStyle"
                      alt=""
                      draggable="false"
                    />
                  </div>
                </div>
              </div>
            </template>

            <!-- TXT / 文本类 -->
            <template v-else-if="resolvedType === 'txt'">
              <div v-if="loading" class="fp-center">加载中…</div>
              <div v-else-if="errorMsg" class="fp-center fp-empty-error">
                加载失败：{{ errorMsg }}
              </div>
              <template v-else>
                <div v-if="textTruncated" class="fp-notice">
                  文件较大，仅预览前 200KB。完整内容请点击「下载」查看。
                </div>
                <pre class="fp-text">{{ textContent }}</pre>
              </template>
            </template>

            <div v-else class="fp-center">暂不支持该文件类型的预览</div>
          </div>

          <div class="fp-dialog-footer">
            <!-- PPT：左侧提供缩放控件 -->
            <div v-if="resolvedType === 'ppt' && pptPages.length > 0" class="fp-toolbar-left">
              <button class="fp-icon-btn" title="缩小 (-)" @click="zoomOut">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.4"/>
                  <path d="M11 11l3 3M5 7h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
                </svg>
              </button>
              <span class="fp-zoom-label">{{ Math.round(scale * 100) }}%</span>
              <button class="fp-icon-btn" title="放大 (+)" @click="zoomIn">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.4"/>
                  <path d="M11 11l3 3M5 7h4M7 5v4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
                </svg>
              </button>
              <button class="fp-icon-btn" title="重置" @click="fitScale">1:1</button>
            </div>
            <div class="fp-toolbar-right">
              <button class="gf-btn gf-btn-plain" @click="close">关闭</button>
              <button class="gf-btn gf-btn-primary" @click="handleDownload">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="margin-right: 4px; vertical-align: -2px;">
                  <path d="M4 6.7l4 4 4-4M8 10.7V2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M2.7 10v.7A2.3 2.3 0 005 13h6a2.3 2.3 0 002.3-2.3V10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
                </svg>
                下载
              </button>
            </div>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.fp-dialog-mask {
  position: fixed;
  inset: 0;
  z-index: 2100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--gf-bg-mask);
  backdrop-filter: blur(2px);
}

.fp-dialog {
  width: min(960px, calc(100vw - 32px));
  height: min(640px, calc(100vh - 48px));
  background: var(--gf-bg-panel);
  border-radius: 16px;
  box-shadow: var(--gf-shadow-dialog);
  border: 1px solid var(--gf-border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--gf-text-primary);
  box-sizing: border-box;
}

.fp-dialog.is-ppt {
  width: min(1200px, calc(100vw - 32px));
  height: min(760px, calc(100vh - 48px));
}

.fp-dialog.is-fullscreen {
  width: 100vw !important;
  height: 100vh !important;
  border-radius: 0;
  border: none;
}

.fp-dialog-header {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--gf-divider);
}

.fp-dialog-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--gf-text-primary);
  line-height: 22px;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fp-header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.fp-page-indicator {
  font-size: 13px;
  color: var(--gf-text-secondary);
  padding: 0 8px;
  user-select: none;
}

.fp-icon-btn {
  min-width: 30px;
  height: 30px;
  padding: 0 8px;
  border: none;
  background: transparent;
  border-radius: 8px;
  color: var(--gf-text-secondary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
  font-size: 12px;
  font-family: inherit;
}

.fp-icon-btn:hover:not(:disabled) {
  background: var(--gf-bg-elevated);
  color: var(--gf-text-primary);
}

.fp-icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.fp-dialog-body {
  flex: 1;
  min-height: 0;
  padding: 0;
  background: var(--gf-bg-page);
  position: relative;
  display: flex;
  flex-direction: column;
}

/* PPT 布局：缩略图 + 主视图 */
.fp-ppt-layout {
  flex: 1;
  min-height: 0;
  display: flex;
}

.fp-thumbs {
  flex: none;
  width: 160px;
  overflow-y: auto;
  padding: 12px;
  gap: 10px;
  display: flex;
  flex-direction: column;
  background: var(--gf-bg-panel);
  border-right: 1px solid var(--gf-divider);
}

.fp-thumb {
  position: relative;
  cursor: pointer;
  border-radius: 6px;
  overflow: hidden;
  border: 2px solid transparent;
  background: var(--gf-bg-elevated);
  transition: border-color 0.15s;
  flex-shrink: 0;
}

.fp-thumb img {
  width: 100%;
  display: block;
  aspect-ratio: 16 / 9;
  object-fit: contain;
  background: #fff;
}

.fp-thumb:hover {
  border-color: var(--gf-border-strong);
}

.fp-thumb.active {
  border-color: var(--gf-primary);
}

.fp-thumb-num {
  position: absolute;
  bottom: 4px;
  right: 6px;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 11px;
  line-height: 16px;
}

.fp-stage {
  flex: 1;
  min-width: 0;
  position: relative;
  background: var(--gf-bg-page);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.fp-stage-inner {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.fp-page-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  user-select: none;
  pointer-events: none;
  display: block;
  background: #fff;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
}

.fp-nav-btn {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.42);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 5;
  transition: background 0.15s;
}

.fp-nav-btn:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.68);
}

.fp-nav-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.fp-nav-prev {
  left: 12px;
}

.fp-nav-next {
  right: 12px;
}

/* 加载/错误占位 */
.fp-center {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--gf-text-tertiary);
  font-size: 14px;
  gap: 10px;
  flex-direction: column;
}

.fp-loading {
  color: var(--gf-text-secondary);
}

.fp-empty-error {
  color: var(--gf-danger);
}

.fp-retry {
  margin-top: 4px;
}

.fp-spinner {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2.5px solid var(--gf-border);
  border-top-color: var(--gf-primary);
  animation: fp-spin 0.8s linear infinite;
}

@keyframes fp-spin {
  to { transform: rotate(360deg); }
}

.fp-notice {
  padding: 8px 16px;
  font-size: 12px;
  color: var(--gf-text-secondary);
  background: var(--gf-primary-bg);
  border-bottom: 1px solid var(--gf-divider);
}

.fp-text {
  flex: 1;
  margin: 0;
  padding: 16px 20px;
  overflow: auto;
  font-family: 'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace;
  font-size: 13px;
  line-height: 1.6;
  color: var(--gf-text-primary);
  background: var(--gf-bg-panel);
  white-space: pre-wrap;
  word-break: break-word;
}

.fp-dialog-footer {
  flex: none;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-top: 1px solid var(--gf-divider);
  background: var(--gf-bg-panel);
}

.fp-toolbar-left,
.fp-toolbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.fp-toolbar-right {
  margin-left: auto;
}

.fp-zoom-label {
  font-size: 12px;
  color: var(--gf-text-tertiary);
  min-width: 42px;
  text-align: center;
  user-select: none;
}

/* 通用按钮：与 gf-dialog 保持一致 */
.gf-btn {
  min-width: 76px;
  height: 36px;
  padding: 0 16px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, opacity 0.15s, border-color 0.15s, color 0.15s;
  border: 1px solid transparent;
  box-sizing: border-box;
  font-family: inherit;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.gf-btn-plain {
  background: var(--gf-bg-panel);
  border-color: var(--gf-border-strong);
  color: var(--gf-text-secondary);
}

.gf-btn-plain:hover {
  background: var(--gf-bg-elevated);
  border-color: var(--gf-border-strong);
  color: var(--gf-text-primary);
}

.gf-btn-primary {
  background: var(--gf-accent);
  color: var(--gf-bg-panel);
  border-color: var(--gf-accent);
}

.gf-btn-primary:hover {
  background: var(--gf-accent-hover);
  border-color: var(--gf-accent-hover);
}

/* 过渡动画 */
.fp-dialog-enter-active,
.fp-dialog-leave-active {
  transition: opacity 0.18s ease;
}

.fp-dialog-enter-active .fp-dialog,
.fp-dialog-leave-active .fp-dialog {
  transition: transform 0.18s ease, opacity 0.18s ease;
}

.fp-dialog-enter-from,
.fp-dialog-leave-to {
  opacity: 0;
}

.fp-dialog-enter-from .fp-dialog,
.fp-dialog-leave-to .fp-dialog {
  opacity: 0;
  transform: translateY(-8px) scale(0.98);
}
</style>
