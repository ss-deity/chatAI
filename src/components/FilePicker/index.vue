<script setup lang="ts">
/**
 * 文件夹选择器（转存目标目录）。
 * 样式与交互对齐 pc-genflow-pro 的 NetdiskFilePicker：
 * 弹窗 + 面包屑 + 单选行 + 底部确定/取消，滚动列表，骨架屏加载态。
 *
 * 差异点：
 * - 数据来源为「文件管理」接口 `/api/files`，只展示文件夹（转存只能落到文件夹里）。
 * - 单选目标目录；未勾选时以当前所处目录为目标（这样根目录也能作为转存目标）。
 * - 落地动作由父组件通过 `save` prop 提供，弹窗内部负责 loading 与成功后关闭。
 */
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'

interface FolderEntry {
  name: string
  /** 相对用户根目录的路径，如 docs/images */
  path: string
  lastModified: number
}

interface Crumb {
  name: string
  /** 相对用户根目录的路径，根目录为空串 */
  path: string
}

const props = withDefaults(
  defineProps<{
    visible: boolean
    userId: string
    /** 确认后的落地动作，入参为目标目录（相对用户根目录，根目录为空串） */
    save: (dir: string) => Promise<void>
    title?: string
    confirmText?: string
    rootName?: string
  }>(),
  {
    title: '转存到',
    confirmText: '确定',
    rootName: '我的文件',
  },
)

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'cancel'): void
}>()

const folderIcon = new URL('../../assets/file-icons/folder.svg', import.meta.url)
  .href

const crumbs = ref<Crumb[]>([{ name: props.rootName, path: '' }])
const folders = ref<FolderEntry[]>([])
const selected = ref<FolderEntry | null>(null)
const loading = ref(false)
const saving = ref(false)

/** 面包屑最多展示的层级数：超过后折叠为「首层 + ... + 末三层」 */
const MAX_CRUMBS = 4

interface DisplayCrumb {
  name: string
  /** 对应 crumbs 的真实下标；省略号为 -1 */
  index: number
  isEllipsis: boolean
}

const displayCrumbs = computed<DisplayCrumb[]>(() => {
  const all = crumbs.value
  if (all.length <= MAX_CRUMBS) {
    return all.map((c, i) => ({ name: c.name, index: i, isEllipsis: false }))
  }
  return [
    { name: all[0].name, index: 0, isEllipsis: false },
    { name: '...', index: -1, isEllipsis: true },
    ...all.slice(-3).map((c, i) => ({
      name: c.name,
      index: all.length - 3 + i,
      isEllipsis: false,
    })),
  ]
})

const currentDir = computed(() => crumbs.value[crumbs.value.length - 1].path)

/** 实际转存目标：勾选了文件夹则用它，否则用当前所处目录 */
const targetDir = computed(() => selected.value?.path ?? currentDir.value)

const targetLabel = computed(() => {
  if (selected.value) return `${props.rootName}/${selected.value.path}`
  return currentDir.value ? `${props.rootName}/${currentDir.value}` : props.rootName
})

/**
 * 加载序号：每次切换目录自增。异步返回后比对序号，
 * 已变化说明用户切到了别的目录，丢弃过期结果避免串目录。
 */
let loadToken = 0

async function loadFolders() {
  if (!props.userId) return
  loadToken += 1
  const token = loadToken
  loading.value = true
  folders.value = []
  try {
    const res = await fetch(
      `/api/files?userId=${encodeURIComponent(props.userId)}&dir=${encodeURIComponent(currentDir.value)}`,
    )
    const data = await res.json()
    if (token !== loadToken) return
    if (data.code !== 0) throw new Error(data.message || '加载失败')
    folders.value = (data.data as (FolderEntry & { isDir: boolean })[])
      .filter((entry) => entry.isDir)
      .map(({ name, path, lastModified }) => ({ name, path, lastModified }))
  } catch (e) {
    if (token !== loadToken) return
    folders.value = []
    ElMessage.error('加载文件夹失败: ' + (e as Error).message)
  } finally {
    if (token === loadToken) loading.value = false
  }
}

function openFolder(folder: FolderEntry) {
  selected.value = null
  crumbs.value.push({ name: folder.name, path: folder.path })
  loadFolders()
}

function clickCrumb(index: number) {
  if (index < 0 || index === crumbs.value.length - 1) return
  selected.value = null
  crumbs.value = crumbs.value.slice(0, index + 1)
  loadFolders()
}

function goBack() {
  if (crumbs.value.length <= 1) return
  selected.value = null
  crumbs.value.pop()
  loadFolders()
}

const isSelected = (folder: FolderEntry) => selected.value?.path === folder.path

/** 点击行：已选中则取消选中，未选中则进入下一级 */
function handleRowClick(folder: FolderEntry) {
  if (isSelected(folder)) {
    selected.value = null
    return
  }
  openFolder(folder)
}

function toggleSelect(folder: FolderEntry) {
  selected.value = isSelected(folder) ? null : folder
}

async function handleConfirm() {
  if (saving.value) return
  saving.value = true
  try {
    await props.save(targetDir.value)
    close()
  } catch (e) {
    // 失败保留弹窗，便于换目录重试
    ElMessage.error('转存失败: ' + (e as Error).message)
  } finally {
    saving.value = false
  }
}

function handleCancel() {
  emit('cancel')
  close()
}

function close() {
  emit('update:visible', false)
}

function formatTime(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// 打开时重置到根目录
watch(
  () => props.visible,
  (v) => {
    if (!v) return
    crumbs.value = [{ name: props.rootName, path: '' }]
    selected.value = null
    loadFolders()
  },
  { immediate: true },
)
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="fp-overlay" @click.self="handleCancel">
      <div class="fp-modal" role="dialog" aria-modal="true">
        <header class="fp-header">
          <h3 class="fp-title">{{ title }}</h3>
          <button class="fp-close" type="button" aria-label="关闭" @click="handleCancel">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
          </button>
        </header>
        <p class="fp-subtitle">将转存到：{{ targetLabel }}</p>

        <nav class="fp-breadcrumb">
          <span v-show="crumbs.length > 1" class="fp-breadcrumb-back" @click="goBack">返回上一级</span>
          <template v-for="(item, i) in displayCrumbs" :key="item.isEllipsis ? `ellipsis-${i}` : item.index">
            <span v-if="i !== 0 && !displayCrumbs[i - 1].isEllipsis" class="fp-breadcrumb-sep">/</span>
            <span v-if="item.isEllipsis" class="fp-breadcrumb-ellipsis">{{ item.name }}</span>
            <span
              v-else
              class="fp-breadcrumb-item"
              :class="{ 'is-last': item.index === crumbs.length - 1 }"
              @click="clickCrumb(item.index)"
            >{{ item.name }}</span>
          </template>
        </nav>

        <div class="fp-list">
          <div v-if="loading" class="fp-skeleton">
            <div v-for="n in 7" :key="n" class="fp-skeleton-row">
              <span class="fp-skeleton-check"></span>
              <span class="fp-skeleton-name"></span>
              <span class="fp-skeleton-date"></span>
            </div>
          </div>
          <div v-else-if="folders.length === 0" class="fp-status">
            当前目录下没有文件夹
          </div>
          <template v-else>
            <div
              v-for="folder in folders"
              :key="folder.path"
              class="fp-row"
              :class="{ 'is-selected': isSelected(folder) }"
              @click="handleRowClick(folder)"
            >
              <label class="fp-checkbox" @click.stop>
                <input
                  type="radio"
                  :checked="isSelected(folder)"
                  @change="toggleSelect(folder)"
                />
                <span class="fp-checkbox-box"></span>
              </label>
              <div class="fp-row-main">
                <img class="fp-row-icon" :src="folderIcon" alt="" />
                <span class="fp-row-name" :title="folder.name">{{ folder.name }}</span>
              </div>
              <span class="fp-row-date">{{ formatTime(folder.lastModified) }}</span>
            </div>
          </template>
        </div>

        <footer class="fp-footer">
          <button class="fp-btn fp-btn-cancel" type="button" @click="handleCancel">取消</button>
          <button
            class="fp-btn fp-btn-confirm"
            type="button"
            :disabled="saving"
            @click="handleConfirm"
          >{{ saving ? '转存中...' : confirmText }}</button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.fp-overlay {
  position: fixed;
  inset: 0;
  background: var(--gf-bg-mask);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2200;
}

.fp-modal {
  width: 640px;
  height: 520px;
  background: var(--gf-bg-panel);
  border-radius: 16px;
  padding: 20px 0 20px 20px;
  display: flex;
  flex-direction: column;
  box-shadow: var(--gf-shadow-dialog);
  box-sizing: border-box;
}

.fp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.fp-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--gf-text-primary);
}

.fp-close {
  border: none;
  background: none;
  padding: 4px;
  margin-right: 20px;
  cursor: pointer;
  display: inline-flex;
  color: var(--gf-text-tertiary);
}

.fp-close:hover {
  color: var(--gf-text-primary);
}

.fp-subtitle {
  margin: 6px 20px 0 0;
  font-size: 12px;
  color: var(--gf-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fp-breadcrumb {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7.5px;
  margin-top: 20px;
  font-size: 14px;
  color: var(--gf-text-secondary);
}

.fp-breadcrumb-back {
  cursor: pointer;
}

.fp-breadcrumb-back::after {
  content: '/';
  color: var(--gf-border-strong);
  margin-left: 7.5px;
}

.fp-breadcrumb-sep {
  color: var(--gf-border-strong);
}

.fp-breadcrumb-ellipsis {
  cursor: default;
}

.fp-breadcrumb-item {
  cursor: pointer;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fp-breadcrumb-item:hover {
  color: var(--gf-primary);
}

.fp-breadcrumb-item.is-last {
  color: var(--gf-text-primary);
  font-weight: 600;
  cursor: default;
  pointer-events: none;
}

.fp-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  margin-top: 12px;
  margin-left: -8px;
  padding-right: 10px;
  border-right: 2px solid transparent;
}

.fp-list::-webkit-scrollbar {
  width: 4px;
}

.fp-list::-webkit-scrollbar-track {
  background: transparent;
}

.fp-list::-webkit-scrollbar-thumb {
  background: var(--gf-scrollbar-thumb);
  border-radius: 3px;
}

.fp-list::-webkit-scrollbar-thumb:hover {
  background: var(--gf-scrollbar-thumb-hover);
}

.fp-status {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--gf-text-disabled);
  font-size: 14px;
}

.fp-row {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 44px;
  padding: 0 8px;
  margin-top: 6px;
  border-radius: 10px;
  cursor: pointer;
}

.fp-row:hover,
.fp-row.is-selected {
  background: var(--gf-bg-elevated);
}

.fp-row-main {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  margin-right: 20px;
}

.fp-row-icon {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  object-fit: contain;
}

.fp-row-name {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  color: var(--gf-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fp-row-date {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--gf-text-tertiary);
  font-variant-numeric: tabular-nums;
}

/* 自定义单选框（对齐参考实现的勾选样式） */
.fp-checkbox {
  display: inline-flex;
  position: relative;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  cursor: pointer;
}

.fp-checkbox input {
  position: absolute;
  opacity: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  cursor: pointer;
}

.fp-checkbox-box {
  width: 16px;
  height: 16px;
  border: 1.5px solid var(--gf-border-strong);
  border-radius: 50%;
  box-sizing: border-box;
  transition: all 0.15s;
}

.fp-checkbox input:checked + .fp-checkbox-box {
  background: var(--gf-accent);
  border-color: var(--gf-accent);
  position: relative;
}

.fp-checkbox input:checked + .fp-checkbox-box::after {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--gf-bg-panel);
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none'%3E%3Cpath d='M5 12l4.5 4.5L19 7' stroke='%23000' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none'%3E%3Cpath d='M5 12l4.5 4.5L19 7' stroke='%23000' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  mask-repeat: no-repeat;
  -webkit-mask-repeat: no-repeat;
  mask-position: center;
  -webkit-mask-position: center;
}

.fp-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 16px;
  margin-right: 20px;
}

.fp-btn {
  height: 36px;
  padding: 0 24px;
  border-radius: 10px;
  border: none;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s, opacity 0.15s;
}

.fp-btn-cancel {
  background: var(--gf-bg-panel);
  border: 1px solid var(--gf-border-strong);
  color: var(--gf-text-secondary);
}

.fp-btn-cancel:hover {
  background: var(--gf-bg-elevated);
}

.fp-btn-confirm {
  background: var(--gf-accent);
  color: var(--gf-bg-panel);
}

.fp-btn-confirm:hover {
  opacity: 0.9;
}

.fp-btn-confirm:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* 骨架屏 */
.fp-skeleton {
  padding: 8px 0;
}

.fp-skeleton-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 8px;
}

.fp-skeleton-check {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--gf-bg-elevated-hover);
  flex-shrink: 0;
}

.fp-skeleton-name {
  flex: 1;
  height: 16px;
  border-radius: 8px;
  background: linear-gradient(90deg, var(--gf-bg-elevated-hover), transparent);
  position: relative;
  overflow: hidden;
}

.fp-skeleton-date {
  width: 110px;
  height: 16px;
  border-radius: 8px;
  background: linear-gradient(90deg, var(--gf-bg-elevated-hover), transparent);
  flex-shrink: 0;
  position: relative;
  overflow: hidden;
}

.fp-skeleton-name::after,
.fp-skeleton-date::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, var(--gf-bg-panel) 50%, transparent);
  opacity: 0.6;
  animation: fp-shimmer 1.6s ease-in-out infinite;
}

@keyframes fp-shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
</style>
