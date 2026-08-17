<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { useVirtualList } from '../../composables/useVirtualList'
import { useTransferTasks } from '../../composables/useTransferTasks'
import ImagePreview from '../ImagePreview/index.vue'
import FilePreview from '../FilePreview/index.vue'

const IMAGE_EXT_SET = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp',
  'svg',
  'ico',
  'avif',
  'jfif',
])

const TEXT_EXT_SET = new Set(['txt', 'md', 'log', 'json', 'csv'])
const PPT_EXT_SET = new Set(['ppt', 'pptx'])

function isImageFile(entry: { name: string; isDir: boolean; url?: string }): boolean {
  if (entry.isDir || !entry.url) return false
  const ext = entry.name.split('.').pop()?.toLowerCase() || ''
  return IMAGE_EXT_SET.has(ext)
}

function isTextFileEntry(entry: { name: string; isDir: boolean; url?: string }): boolean {
  if (entry.isDir || !entry.url) return false
  const ext = entry.name.split('.').pop()?.toLowerCase() || ''
  return TEXT_EXT_SET.has(ext)
}

function isPptFileEntry(entry: { name: string; isDir: boolean; url?: string }): boolean {
  if (entry.isDir || !entry.url) return false
  const ext = entry.name.split('.').pop()?.toLowerCase() || ''
  return PPT_EXT_SET.has(ext)
}

interface UserInfo {
  id: string
  uid: string
  username: string
  nickname: string
  avatar: string
}

interface FileEntry {
  name: string
  /** 相对用户根目录的路径，如 docs/a.pdf */
  path: string
  isDir: boolean
  size: number
  /** 毫秒时间戳 */
  lastModified: number
  url?: string
}

const props = defineProps<{ user: UserInfo | null }>()

const BASE = '/api'

// 文件类型图标：从 assets/file-icons 下按后缀映射
const iconModules = import.meta.glob('../../assets/file-icons/*.svg', {
  eager: true,
  import: 'default',
}) as Record<string, string>

function pickIcon(key: string): string | undefined {
  const hit = Object.entries(iconModules).find(([p]) => p.endsWith(`/${key}.svg`))
  return hit?.[1]
}

function iconFor(entry: FileEntry): string {
  if (entry.isDir) return pickIcon('folder') || ''
  const ext = entry.name.split('.').pop()?.toLowerCase() || ''
  return pickIcon(ext) || pickIcon('file-default') || ''
}

const currentDir = ref('')
const entries = ref<FileEntry[]>([])
const loading = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)

const userId = computed(() => props.user?.id || '')

/* --------------------------- 上传/下载进度 --------------------------- */

// 进度列表状态是全局单例，面板由根组件常驻渲染，这里只负责把任务丢进队列
const { uploadFiles, downloadFile } = useTransferTasks()

/** 组件是否仍挂载：上传结束时若已切走页面，就不再刷新这里的列表 */
let alive = true

/** 面包屑片段：根目录 + 各级目录名 */
const segments = computed(() =>
  currentDir.value ? currentDir.value.split('/') : [],
)

/* --------------------------- 虚拟列表 --------------------------- */

const ITEM_HEIGHT = 50
const scrollContainer = ref<HTMLElement | null>(null)
const { totalHeight, offsetY, visibleItems } = useVirtualList(
  () => entries.value,
  scrollContainer,
  { itemHeight: ITEM_HEIGHT },
)

const showList = computed(() => !loading.value && entries.value.length > 0)

/** 骨架屏行数（首屏 / 切目录时展示，样式对齐 pc-genflow-pro netdisk 的 FileList） */
const SKELETON_ROWS = 12

/* --------------------------- 图片预览 --------------------------- */

// 当前目录内所有图片文件（url 列表），预览时用于前后翻页
const imageEntries = computed(() => entries.value.filter(isImageFile))
const imageUrls = computed(() => imageEntries.value.map((e) => e.url as string))

const previewVisible = ref(false)
const previewIndex = ref(0)

function openImagePreview(entry: FileEntry) {
  const idx = imageEntries.value.findIndex((e) => e.path === entry.path)
  if (idx < 0) return
  previewIndex.value = idx
  previewVisible.value = true
}

/* --------------------------- 文件预览（PPT / TXT） --------------------------- */

const filePreviewVisible = ref(false)
const filePreviewFile = ref<{ url: string; name?: string; type?: 'ppt' | 'txt' } | null>(null)

function openFilePreviewEntry(entry: FileEntry, type: 'ppt' | 'txt') {
  if (!entry.url) return
  filePreviewFile.value = { url: entry.url, name: entry.name, type }
  filePreviewVisible.value = true
}

async function loadList() {
  if (!userId.value) return
  loading.value = true
  // 先清空再拉取：切目录时直接过渡到骨架屏，避免旧目录内容停留造成错位
  entries.value = []
  closeRowMenu()
  try {
    const res = await fetch(
      `${BASE}/files?userId=${encodeURIComponent(userId.value)}&dir=${encodeURIComponent(currentDir.value)}`,
    )
    const data = await res.json()
    if (data.code !== 0) throw new Error(data.message || '加载失败')
    entries.value = data.data as FileEntry[]
    if (scrollContainer.value) scrollContainer.value.scrollTop = 0
  } catch (e) {
    ElMessage.error('加载文件列表失败: ' + (e as Error).message)
    entries.value = []
  } finally {
    loading.value = false
  }
}

function enterFolder(entry: FileEntry) {
  if (!entry.isDir) return
  currentDir.value = entry.path
  loadList()
}

function goToCrumb(index: number) {
  // index === -1 表示根目录
  currentDir.value = index < 0 ? '' : segments.value.slice(0, index + 1).join('/')
  loadList()
}

/* --------------------------- 行内更多菜单 --------------------------- */

const MENU_WIDTH = 160
const MENU_PADDING = 8
const MENU_ITEM_HEIGHT = 32
const MENU_GAP = 4

const activeMenuPath = ref<string | null>(null)
const menuTarget = ref<FileEntry | null>(null)
const menuStyle = ref<Record<string, string>>({})
let closeTimer: ReturnType<typeof setTimeout> | null = null

function cancelCloseTimer() {
  if (closeTimer) {
    clearTimeout(closeTimer)
    closeTimer = null
  }
}

function openRowMenu(entry: FileEntry, ev: MouseEvent) {
  cancelCloseTimer()
  const trigger = ev.currentTarget as HTMLElement
  const rect = trigger.getBoundingClientRect()
  // 文件多一项「下载」，菜单高度不同，翻转判断要按实际项数算
  const itemCount = entry.isDir ? 2 : 3
  const menuHeight = MENU_PADDING + itemCount * MENU_ITEM_HEIGHT
  const openUpward = window.innerHeight - rect.bottom < menuHeight + MENU_GAP
  menuStyle.value = {
    left: `${rect.right - MENU_WIDTH}px`,
    ...(openUpward
      ? { bottom: `${window.innerHeight - rect.top + MENU_GAP}px` }
      : { top: `${rect.bottom + MENU_GAP}px` }),
  }
  menuTarget.value = entry
  activeMenuPath.value = entry.path
}

function closeRowMenu() {
  cancelCloseTimer()
  activeMenuPath.value = null
  menuTarget.value = null
}

function scheduleCloseMenu() {
  cancelCloseTimer()
  closeTimer = setTimeout(closeRowMenu, 120)
}

function handleRenameFromMenu() {
  const target = menuTarget.value
  closeRowMenu()
  if (target) openRename(target)
}

/** 下载：交给传输队列，进度在右下角进度列表里展示 */
function handleDownloadFromMenu() {
  const target = menuTarget.value
  closeRowMenu()
  if (!target || target.isDir) return
  downloadFile(target, userId.value)
}

function handleDeleteFromMenu() {
  const target = menuTarget.value
  closeRowMenu()
  if (target) openDelete(target)
}

/* ------------------------------ 上传 ------------------------------ */

function triggerUpload() {
  fileInputRef.value?.click()
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!files.length || !userId.value) return

  // 逐个文件建任务入队，进度在右下角进度列表里展示
  uploadFiles(files, { userId: userId.value, dir: currentDir.value }, (ok) => {
    if (ok > 0) {
      ElMessage.success(`成功上传 ${ok} 个文件`)
      if (alive) loadList()
    }
  })
}

/* --------------------------- 新建文件夹 --------------------------- */

const showNewFolder = ref(false)
const newFolderName = ref('')
const newFolderLoading = ref(false)

function openNewFolder() {
  newFolderName.value = ''
  showNewFolder.value = true
}

async function confirmNewFolder() {
  const name = newFolderName.value.trim()
  if (!name) {
    ElMessage.warning('请输入文件夹名称')
    return
  }
  newFolderLoading.value = true
  try {
    const res = await fetch(`${BASE}/files/folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: userId.value, dir: currentDir.value, name }),
    })
    const data = await res.json()
    if (data.code !== 0) throw new Error(data.message || '创建失败')
    ElMessage.success('文件夹已创建')
    showNewFolder.value = false
    loadList()
  } catch (e) {
    ElMessage.error('创建文件夹失败: ' + (e as Error).message)
  } finally {
    newFolderLoading.value = false
  }
}

/* ----------------------------- 重命名 ----------------------------- */

const showRename = ref(false)
const renameTarget = ref<FileEntry | null>(null)
const renameValue = ref('')
const renameLoading = ref(false)
const renameInputRef = ref<HTMLInputElement | null>(null)

/**
 * 主文件名的长度（不含扩展名），用于打开弹窗时只选中这一段。
 * 文件夹、无扩展名、以及 `.gitignore` 这类以点开头的隐藏文件都返回整个名称长度。
 */
function stemLength(name: string, isDir: boolean): number {
  if (isDir) return name.length
  const dot = name.lastIndexOf('.')
  return dot > 0 ? dot : name.length
}

function openRename(entry: FileEntry) {
  renameTarget.value = entry
  renameValue.value = entry.name
  showRename.value = true
  // 弹窗渲染完成后聚焦，并只选中扩展名之前的部分，方便直接改名
  void nextTick(() => {
    const el = renameInputRef.value
    if (!el) return
    el.focus()
    el.setSelectionRange(0, stemLength(entry.name, entry.isDir))
  })
}

async function confirmRename() {
  const target = renameTarget.value
  const newName = renameValue.value.trim()
  if (!target) return
  if (!newName) {
    ElMessage.warning('请输入新名称')
    return
  }
  if (newName === target.name) {
    showRename.value = false
    return
  }
  renameLoading.value = true
  try {
    const res = await fetch(`${BASE}/files/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: userId.value,
        path: target.path,
        newName,
        isDir: target.isDir,
      }),
    })
    const data = await res.json()
    if (data.code !== 0) throw new Error(data.message || '重命名失败')
    ElMessage.success('已重命名')
    showRename.value = false
    loadList()
  } catch (e) {
    ElMessage.error('重命名失败: ' + (e as Error).message)
  } finally {
    renameLoading.value = false
  }
}

/* ------------------------------ 删除 ------------------------------ */

const showDelete = ref(false)
const deleteTarget = ref<FileEntry | null>(null)
const deleteLoading = ref(false)

function openDelete(entry: FileEntry) {
  deleteTarget.value = entry
  showDelete.value = true
}

async function confirmDelete() {
  const target = deleteTarget.value
  if (!target) return
  deleteLoading.value = true
  try {
    const res = await fetch(`${BASE}/files`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: userId.value,
        path: target.path,
        isDir: target.isDir,
      }),
    })
    const data = await res.json()
    if (data.code !== 0) throw new Error(data.message || '删除失败')
    ElMessage.success('已删除')
    showDelete.value = false
    loadList()
  } catch (e) {
    ElMessage.error('删除失败: ' + (e as Error).message)
  } finally {
    deleteLoading.value = false
  }
}

/* ---------------------------- 格式化 ---------------------------- */

function formatSize(bytes: number, isDir: boolean): string {
  if (isDir) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i += 1
  }
  return `${value.toFixed(i === 0 ? 0 : 2)}${units[i]}`
}

function formatTime(ts: number): string {
  if (!ts) return '-'
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

onMounted(loadList)
onBeforeUnmount(() => {
  alive = false
  cancelCloseTimer()
})
</script>

<template>
  <div class="file-manager">
    <!-- 顶部：面包屑 + 操作 -->
    <div class="fm-header">
      <div class="fm-breadcrumb">
        <span class="crumb" :class="{ current: segments.length === 0 }" @click="goToCrumb(-1)">
          我的文件
        </span>
        <template v-for="(seg, idx) in segments" :key="idx">
          <span class="crumb-sep">/</span>
          <span
            class="crumb"
            :class="{ current: idx === segments.length - 1 }"
            @click="goToCrumb(idx)"
          >{{ seg }}</span>
        </template>
      </div>

      <div class="fm-actions">
        <!-- 新建文件夹：描边次按钮（对齐 pc-genflow-pro TeamFileActionButton secondary） -->
        <div class="fm-action-btn secondary" @click="openNewFolder">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <span>新建文件夹</span>
        </div>
        <!-- 上传文件：反色主按钮（对齐 TeamFileActionButton primary） -->
        <div class="fm-action-btn primary" @click="triggerUpload">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 10.5V3M8 3L5 6M8 3l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M3 11v1.5a1 1 0 001 1h8a1 1 0 001-1V11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <span>上传文件</span>
        </div>
        <input
          ref="fileInputRef"
          type="file"
          multiple
          class="fm-file-input"
          @change="onFileChange"
        />
      </div>
    </div>

    <!-- 列表容器 -->
    <div class="fm-list">
      <!-- 表头 -->
      <div class="fm-list-head">
        <div class="col-name">名称</div>
        <div class="col-size">大小</div>
        <div class="col-time">修改时间</div>
        <div class="col-ops">操作</div>
      </div>

      <!-- 空态 -->
      <div v-if="!loading && entries.length === 0" class="fm-empty">当前文件夹为空</div>

      <!-- 滚动区：加载中在同一容器内展示骨架屏，加载完成后展示虚拟列表 -->
      <div
        v-show="loading || showList"
        ref="scrollContainer"
        class="fm-list-scroll"
        @scroll="closeRowMenu"
      >
        <!-- 骨架屏：行高/列宽与真实行一致，避免加载完成后跳动 -->
        <template v-if="loading">
          <div v-for="n in SKELETON_ROWS" :key="n" class="fm-skeleton-row">
            <div class="col-name">
              <span class="fm-sk-block" style="width: 24px; flex-shrink: 0"></span>
              <span class="fm-sk-block" style="width: 50%"></span>
            </div>
            <div class="col-size"><span class="fm-sk-block" style="width: 66.67%"></span></div>
            <div class="col-time"><span class="fm-sk-block" style="width: 66.67%"></span></div>
            <div class="col-ops"><span class="fm-sk-block" style="width: 50%"></span></div>
          </div>
        </template>

        <div v-show="showList" class="fm-virtual-phantom" :style="{ height: `${totalHeight}px` }">
          <div :style="{ transform: `translateY(${offsetY}px)` }">
            <div
              v-for="{ item } in visibleItems"
              :key="item.path"
              class="fm-row"
              :class="{ 'is-dir': item.isDir, 'is-image': isImageFile(item) }"
              @dblclick="item.isDir
                ? enterFolder(item)
                : isImageFile(item)
                  ? openImagePreview(item)
                  : isPptFileEntry(item)
                    ? openFilePreviewEntry(item, 'ppt')
                    : isTextFileEntry(item)
                      ? openFilePreviewEntry(item, 'txt')
                      : undefined"
            >
              <div class="col-name">
                <img :src="iconFor(item)" class="fm-icon" alt="" />
                <span
                  v-if="item.isDir"
                  class="fm-name link"
                  :title="item.name"
                  @click="enterFolder(item)"
                >{{ item.name }}</span>
                <span
                  v-else-if="isImageFile(item)"
                  class="fm-name link"
                  :title="item.name"
                  @click="openImagePreview(item)"
                >{{ item.name }}</span>
                <span
                  v-else-if="isPptFileEntry(item)"
                  class="fm-name link"
                  :title="item.name"
                  @click="openFilePreviewEntry(item, 'ppt')"
                >{{ item.name }}</span>
                <span
                  v-else-if="isTextFileEntry(item)"
                  class="fm-name link"
                  :title="item.name"
                  @click="openFilePreviewEntry(item, 'txt')"
                >{{ item.name }}</span>
                <a
                  v-else-if="item.url"
                  class="fm-name link"
                  :href="item.url"
                  target="_blank"
                  rel="noopener"
                  :title="item.name"
                >{{ item.name }}</a>
                <span v-else class="fm-name" :title="item.name">{{ item.name }}</span>
              </div>
              <div class="col-size">{{ formatSize(item.size, item.isDir) }}</div>
              <div class="col-time">{{ formatTime(item.lastModified) }}</div>
              <div class="col-ops">
                <div
                  class="fm-more-hit"
                  @mouseenter="openRowMenu(item, $event)"
                  @mouseleave="scheduleCloseMenu"
                  @click.stop="openRowMenu(item, $event)"
                >
                  <div class="fm-more" :class="{ active: activeMenuPath === item.path }" title="更多操作">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <circle cx="3" cy="8" r="1.3" fill="currentColor"/>
                      <circle cx="8" cy="8" r="1.3" fill="currentColor"/>
                      <circle cx="13" cy="8" r="1.3" fill="currentColor"/>
                    </svg>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 图片预览浮层：与会话中的 ImageCard 共用同一预览器 -->
    <ImagePreview
      v-model:visible="previewVisible"
      :images="imageUrls"
      :initial-index="previewIndex"
    />

    <!-- PPT / 文本文件预览浮层 -->
    <FilePreview
      v-model:visible="filePreviewVisible"
      :file="filePreviewFile"
    />

    <!-- 行内更多操作菜单（Teleport 到 body，fixed 定位，避免被虚拟列表 transform 裁剪） -->
    <Teleport to="body">
      <div
        v-if="activeMenuPath"
        class="fm-row-menu"
        :style="menuStyle"
        @mouseenter="cancelCloseTimer"
        @mouseleave="scheduleCloseMenu"
      >
        <div class="fm-row-menu-item" v-if="!menuTarget?.isDir" @click="handleDownloadFromMenu">下载</div>
        <div class="fm-row-menu-item" @click="handleRenameFromMenu">重命名</div>
        <div class="fm-row-menu-item danger" @click="handleDeleteFromMenu">删除</div>
      </div>
    </Teleport>

    <!-- 新建文件夹弹窗 -->
    <Teleport to="body">
      <transition name="gf-dialog">
        <div v-if="showNewFolder" class="gf-dialog-mask" @click.self="showNewFolder = false">
          <div class="gf-dialog">
            <div class="gf-dialog-header">
              <h3 class="gf-dialog-title">新建文件夹</h3>
              <button class="gf-dialog-close" @click="showNewFolder = false">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
              </button>
            </div>
            <div class="gf-dialog-body">
              <input
                v-model="newFolderName"
                class="fm-input"
                placeholder="请输入文件夹名称"
                @keydown.enter="confirmNewFolder"
              />
            </div>
            <div class="gf-dialog-footer">
              <button class="gf-btn gf-btn-plain" @click="showNewFolder = false">取消</button>
              <button
                class="gf-btn gf-btn-primary"
                :disabled="newFolderLoading"
                @click="confirmNewFolder"
              >{{ newFolderLoading ? '创建中...' : '确定' }}</button>
            </div>
          </div>
        </div>
      </transition>
    </Teleport>

    <!-- 重命名弹窗 -->
    <Teleport to="body">
      <transition name="gf-dialog">
        <div v-if="showRename" class="gf-dialog-mask" @click.self="showRename = false">
          <div class="gf-dialog">
            <div class="gf-dialog-header">
              <h3 class="gf-dialog-title">重命名</h3>
              <button class="gf-dialog-close" @click="showRename = false">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
              </button>
            </div>
            <div class="gf-dialog-body">
              <input
                ref="renameInputRef"
                v-model="renameValue"
                class="fm-input"
                placeholder="请输入新名称"
                @keydown.enter="confirmRename"
              />
            </div>
            <div class="gf-dialog-footer">
              <button class="gf-btn gf-btn-plain" @click="showRename = false">取消</button>
              <button
                class="gf-btn gf-btn-primary"
                :disabled="renameLoading"
                @click="confirmRename"
              >{{ renameLoading ? '保存中...' : '确定' }}</button>
            </div>
          </div>
        </div>
      </transition>
    </Teleport>

    <!-- 删除确认弹窗 -->
    <Teleport to="body">
      <transition name="gf-dialog">
        <div v-if="showDelete" class="gf-dialog-mask" @click.self="showDelete = false">
          <div class="gf-dialog">
            <div class="gf-dialog-header">
              <h3 class="gf-dialog-title">删除{{ deleteTarget?.isDir ? '文件夹' : '文件' }}</h3>
              <button class="gf-dialog-close" @click="showDelete = false">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
              </button>
            </div>
            <div class="gf-dialog-body">
              确定要删除
              <span class="gf-dialog-highlight">「{{ deleteTarget?.name }}」</span>
              吗？{{ deleteTarget?.isDir ? '文件夹内的所有内容都会被删除，' : '' }}该操作无法撤销。
            </div>
            <div class="gf-dialog-footer">
              <button class="gf-btn gf-btn-plain" @click="showDelete = false">取消</button>
              <button
                class="gf-btn gf-btn-primary"
                :disabled="deleteLoading"
                @click="confirmDelete"
              >{{ deleteLoading ? '删除中...' : '删除' }}</button>
            </div>
          </div>
        </div>
      </transition>
    </Teleport>
  </div>
</template>

<style scoped>
.file-manager {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-width: 480px;
  height: 100%;
  background: var(--gf-bg-page);
  overflow: hidden;
}

.fm-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 32px 16px;
  flex-shrink: 0;
}

.fm-breadcrumb {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 15px;
  min-width: 0;
  overflow: hidden;
}

.crumb {
  color: var(--gf-text-secondary);
  cursor: pointer;
  white-space: nowrap;
  transition: color 0.15s;
}

.crumb:hover {
  color: var(--gf-primary);
}

.crumb.current {
  color: var(--gf-text-primary);
  font-weight: 600;
  cursor: default;
}

.crumb-sep {
  color: var(--gf-text-disabled);
}

.fm-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

/* 操作按钮：对齐 pc-genflow-pro TeamFileActionButton（h-36 rounded-10 px-4 gap-2 text-sm） */
.fm-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 36px;
  padding: 0 16px;
  border-radius: 10px;
  font-size: 14px;
  cursor: pointer;
  white-space: nowrap;
  box-sizing: border-box;
  transition: background 0.15s, border-color 0.15s, color 0.15s, opacity 0.15s;
}

.fm-action-btn.secondary {
  border: 1px solid var(--gf-border-strong);
  color: var(--gf-text-regular);
  background: transparent;
}

.fm-action-btn.secondary:hover {
  background: var(--gf-bg-elevated);
}

.fm-action-btn.primary {
  background: var(--gf-accent);
  color: var(--gf-bg-panel);
  font-weight: 500;
  border: 1px solid var(--gf-accent);
}

.fm-action-btn.primary:hover {
  opacity: 0.9;
}

.fm-action-btn.disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.fm-file-input {
  display: none;
}

/* 列表 */
.fm-list {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  margin: 0 24px 24px;
  min-height: 0;
}

.fm-list-head {
  display: flex;
  align-items: center;
  height: 24px;
  padding: 0 16px;
  font-size: 12px;
  color: var(--gf-text-tertiary);
  flex-shrink: 0;
}

.fm-list-scroll {
  flex: 1 1 auto;
  margin-top: 12px;
  min-height: 0;
  overflow-y: auto;
}

.fm-virtual-phantom {
  position: relative;
  width: 100%;
}

/* 列宽（对齐参考：名称主列 + 大小/时间/操作） */
.col-name {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 52%;
  min-width: 0;
  padding-right: 16px;
}

.col-size {
  width: 15%;
  flex-shrink: 0;
  padding: 0 12px;
}

.col-time {
  width: 23%;
  min-width: 140px;
  flex-shrink: 0;
  padding: 0 12px;
}

.col-ops {
  width: 10%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-left: 16px;
}

/* 行：h-44 + mb-6 = 50（与 ITEM_HEIGHT 一致） */
.fm-row {
  display: flex;
  align-items: center;
  height: 44px;
  margin-bottom: 6px;
  padding: 0 16px;
  border-radius: 8px;
  font-size: 14px;
  color: var(--gf-text-regular);
  cursor: default;
  transition: background 0.15s;
}

.fm-row:hover {
  background: var(--gf-bg-elevated);
}

.fm-row.is-dir {
  cursor: pointer;
}

.fm-row.is-image {
  cursor: pointer;
}

.fm-icon {
  width: 25px;
  height: 25px;
  flex-shrink: 0;
}

.fm-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  color: var(--gf-text-primary);
  text-decoration: none;
}

.fm-name.link {
  cursor: pointer;
}

.fm-name.link:hover {
  color: var(--gf-primary);
}

.col-size,
.col-time {
  color: var(--gf-text-secondary);
  font-size: 12px;
}

/* 更多操作：hover 行时显示，hover 命中区加大更易触发 */
.fm-more-hit {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  height: 44px;
}

.fm-more {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--gf-text-tertiary);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, background 0.15s, color 0.15s;
}

.fm-row:hover .fm-more,
.fm-more.active {
  opacity: 1;
}

.fm-more:hover,
.fm-more.active {
  background: var(--gf-bg-elevated-hover);
  color: var(--gf-text-primary);
}

.fm-empty {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--gf-text-disabled);
  font-size: 14px;
}

/* 骨架屏：与 pc-genflow-pro team/components/file 的 TeamFileList 一致，
   色块为「底色 + 扫光叠加层」两层，1.6s 从左到右循环平移 */
.fm-skeleton-row {
  display: flex;
  align-items: center;
  height: 44px;
  margin-bottom: 6px;
  padding: 0 16px;
  border-radius: 8px;
}

.fm-sk-block {
  position: relative;
  display: block;
  height: 24px;
  border-radius: 8px;
  overflow: hidden;
  /* 底色要和文件管理页背景（--gf-bg-page）拉开对比，否则骨架屏看不见 */
  background: linear-gradient(90deg, var(--gf-bg-elevated-hover), transparent);
}

.fm-sk-block::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, var(--gf-bg-panel) 50%, transparent);
  animation: fm-skeleton-shimmer 1.6s ease-in-out infinite;
}

@keyframes fm-skeleton-shimmer {
  0% {
    transform: translateX(-100%);
  }

  100% {
    transform: translateX(100%);
  }
}

.fm-input {
  width: 100%;
  height: 40px;
  padding: 0 12px;
  border: 1px solid var(--gf-border-strong);
  border-radius: 10px;
  font-size: 14px;
  color: var(--gf-text-primary);
  background: var(--gf-bg-panel);
  box-sizing: border-box;
  outline: none;
  font-family: inherit;
}

.fm-input:focus {
  border-color: var(--gf-primary);
}
</style>

<!-- 行内更多菜单：Teleport 到 body，需非 scoped 样式（对齐 TeamFileRowMenu：w-160 rounded-10 border shadow，项 h-32 rounded-8） -->
<style>
.fm-row-menu {
  position: fixed;
  z-index: 2100;
  width: 160px;
  padding: 4px;
  background: var(--gf-bg-panel);
  border: 1px solid var(--gf-border);
  border-radius: 10px;
  box-shadow: var(--gf-shadow-menu);
}

.fm-row-menu-item {
  display: flex;
  align-items: center;
  height: 32px;
  padding: 0 8px;
  border-radius: 8px;
  font-size: 13px;
  color: var(--gf-text-regular);
  cursor: pointer;
  transition: background 0.15s;
}

.fm-row-menu-item:hover {
  background: var(--gf-bg-elevated);
}

.fm-row-menu-item.danger {
  color: var(--gf-danger);
}

.fm-row-menu-item.danger:hover {
  background: var(--gf-danger-bg);
}
</style>
