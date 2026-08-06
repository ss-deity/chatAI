<script setup lang="ts">
/**
 * 上传 / 下载进度列表（样式与交互参考 pc-genflow-pro netdisk 的 UploadManager）：
 * 右下角浮层，可折叠、可关闭，逐项展示文件名、状态文案与进度条，支持单项/全部取消。
 */
import { computed, ref, watch } from 'vue'
import type { TransferTask } from '../../composables/useTransferTasks'

const props = defineProps<{
  visible: boolean
  tasks: TransferTask[]
}>()

const emit = defineEmits<{
  (e: 'cancel', id: string): void
  (e: 'cancel-all'): void
  (e: 'close'): void
}>()

// 文件类型图标：与文件列表共用 assets/file-icons 下的映射
const iconModules = import.meta.glob('../../assets/file-icons/*.svg', {
  eager: true,
  import: 'default',
}) as Record<string, string>

function pickIcon(key: string): string | undefined {
  const hit = Object.entries(iconModules).find(([p]) => p.endsWith(`/${key}.svg`))
  return hit?.[1]
}

function iconFor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return pickIcon(ext) || pickIcon('file-default') || ''
}

const collapsed = ref(false)

// 折叠后再有新任务入列时主动展开，避免面板一直保持收起看不到进度
watch(
  () => props.tasks.length,
  (count, prev) => {
    if (count > (prev ?? 0)) collapsed.value = false
  },
)
watch(
  () => props.visible,
  (visible) => {
    if (visible) collapsed.value = false
  },
)

const activeCount = computed(
  () => props.tasks.filter((t) => t.status === 'active' || t.status === 'pending').length,
)
const doneCount = computed(() => props.tasks.filter((t) => t.status === 'done').length)
const allSettled = computed(
  () => props.tasks.length > 0 && activeCount.value === 0,
)
const titleText = computed(() =>
  allSettled.value
    ? `已完成 ${doneCount.value} 个文件的传输`
    : `传输中 ${doneCount.value}/${props.tasks.length}`,
)

function formatSize(bytes: number): string {
  if (!bytes) return '0B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i += 1
  }
  return `${value.toFixed(i === 0 ? 0 : 1)}${units[i]}`
}

function percent(task: TransferTask): number {
  if (task.status === 'done') return 100
  if (!task.total) return 0
  // 完成前封顶 99%：字节传完后服务端还有落盘/写 BOS 阶段，过早显示 100% 会“到顶又停住”
  return Math.min(99, Math.round((task.loaded / task.total) * 100))
}

function statusText(task: TransferTask): string {
  const verb = task.kind === 'upload' ? '上传' : '下载'
  switch (task.status) {
    case 'pending':
      return '排队中'
    case 'active':
      return `${verb}中 ${formatSize(task.loaded)}/${formatSize(task.total)}`
    case 'done':
      return `${verb}完成 ${formatSize(task.total)}`
    case 'canceled':
      return `已取消${verb}`
    default:
      return task.errorMessage ? `${verb}失败：${task.errorMessage}` : `${verb}失败`
  }
}

/* --------------------------- 关闭确认 --------------------------- */

const confirmVisible = ref(false)
/** 待确认取消的单项 id；为 null 表示确认后取消全部并关闭面板 */
const pendingCancelId = ref<string | null>(null)

function handleClose() {
  // 还有进行中的任务时先确认，避免误关导致传输中断
  if (activeCount.value > 0) {
    pendingCancelId.value = null
    confirmVisible.value = true
    return
  }
  emit('close')
}

function handleCancelItem(task: TransferTask) {
  if (task.status === 'active') {
    pendingCancelId.value = task.id
    confirmVisible.value = true
    return
  }
  emit('cancel', task.id)
}

function reconsider() {
  confirmVisible.value = false
  pendingCancelId.value = null
}

function confirmCancel() {
  confirmVisible.value = false
  if (pendingCancelId.value) {
    emit('cancel', pendingCancelId.value)
    pendingCancelId.value = null
    return
  }
  emit('cancel-all')
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="tp-panel">
      <header class="tp-header">
        <h3 class="tp-title">{{ titleText }}</h3>
        <div class="tp-actions">
          <button
            class="tp-icon-btn"
            type="button"
            :title="collapsed ? '展开' : '收起'"
            @click="collapsed = !collapsed"
          >
            <svg
              class="tp-chevron"
              :class="{ 'is-collapsed': collapsed }"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
            >
              <path
                d="M5 8.5l7 7 7-7"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
          <button class="tp-icon-btn" type="button" title="关闭" @click="handleClose">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            </svg>
          </button>
        </div>
      </header>

      <ul v-show="!collapsed" class="tp-list">
        <li v-if="tasks.length === 0" class="tp-empty">暂无传输任务</li>
        <li v-for="task in tasks" :key="task.id" class="tp-row">
          <img class="tp-row__icon" :src="iconFor(task.name)" :alt="task.name" />
          <div class="tp-row__body">
            <div class="tp-row__top">
              <div class="tp-row__main">
                <div class="tp-row__name" :title="task.name">{{ task.name }}</div>
                <div class="tp-row__status" :class="{ 'is-error': task.status === 'error' }">
                  {{ statusText(task) }}
                </div>
              </div>
              <button
                class="tp-row__cancel"
                type="button"
                :title="task.status === 'active' || task.status === 'pending' ? '取消' : '移除'"
                @click="handleCancelItem(task)"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                </svg>
              </button>
            </div>
            <div v-if="task.status === 'active' || task.status === 'pending'" class="tp-row__bar">
              <span class="tp-row__bar-fill" :style="{ width: percent(task) + '%' }" />
            </div>
          </div>
        </li>
      </ul>
    </div>

    <!-- 取消确认（沿用项目内 gf-dialog 弹窗样式） -->
    <transition name="gf-dialog">
      <div v-if="confirmVisible" class="gf-dialog-mask" @click.self="reconsider">
        <div class="gf-dialog">
          <div class="gf-dialog-header">
            <h3 class="gf-dialog-title">确认取消传输？</h3>
            <button class="gf-dialog-close" @click="reconsider">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
              </svg>
            </button>
          </div>
          <div class="gf-dialog-body">取消后已传输的部分不会保留，需要重新发起。</div>
          <div class="gf-dialog-footer">
            <button class="gf-btn gf-btn-plain" @click="reconsider">继续传输</button>
            <button class="gf-btn gf-btn-primary" @click="confirmCancel">确认取消</button>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.tp-panel {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 2200;
  width: 380px;
  max-width: calc(100vw - 32px);
  box-sizing: border-box;
  padding: 20px 16px 20px 20px;
  background: var(--gf-bg-panel);
  border: 1px solid var(--gf-border);
  border-radius: 16px;
  box-shadow: var(--gf-shadow-card);
}

.tp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.tp-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--gf-text-primary);
}

.tp-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.tp-icon-btn {
  border: none;
  background: none;
  padding: 0;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--gf-text-primary);
  transition: background 0.15s;
}

.tp-icon-btn:hover {
  background: var(--gf-bg-elevated);
}

.tp-chevron {
  transition: transform 0.2s;
}

.tp-chevron.is-collapsed {
  transform: rotate(180deg);
}

.tp-list {
  list-style: none;
  margin: 8px -14px 0 0;
  /* 右侧留白让每行的取消按钮与头部关闭按钮竖直对齐 */
  padding-right: 16px;
  max-height: 320px;
  overflow-y: auto;
}

.tp-list::-webkit-scrollbar {
  width: 4px;
}

.tp-list::-webkit-scrollbar-track {
  background: transparent;
}

.tp-list::-webkit-scrollbar-thumb {
  background-color: var(--gf-scrollbar-thumb);
  border-radius: 999px;
}

.tp-empty {
  text-align: center;
  color: var(--gf-text-disabled);
  font-size: 14px;
  padding: 32px 0;
}

.tp-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 12px 0;
}

.tp-row__icon {
  width: 28px;
  height: 28px;
  object-fit: contain;
  flex-shrink: 0;
}

.tp-row__body {
  flex: 1;
  min-width: 0;
}

.tp-row__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.tp-row__main {
  flex: 1;
  min-width: 0;
}

.tp-row__name {
  font-size: 14px;
  color: var(--gf-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tp-row__status {
  margin-top: 4px;
  font-size: 12px;
  color: var(--gf-text-tertiary);
}

.tp-row__status.is-error {
  color: var(--gf-danger);
}

.tp-row__bar {
  margin-top: 8px;
  height: 2px;
  border-radius: 2px;
  background: var(--gf-bg-elevated-hover);
  overflow: hidden;
}

.tp-row__bar-fill {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: var(--gf-accent);
  transition: width 0.2s;
}

.tp-row__cancel {
  border: none;
  background: none;
  padding: 4px;
  cursor: pointer;
  display: inline-flex;
  align-self: center;
  flex-shrink: 0;
  border-radius: 8px;
  color: var(--gf-text-secondary);
  transition: background 0.15s, color 0.15s;
}

.tp-row__cancel:hover {
  background: var(--gf-bg-elevated);
  color: var(--gf-text-primary);
}
</style>
