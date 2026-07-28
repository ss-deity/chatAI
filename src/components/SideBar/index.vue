<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'

interface ChatItem {
  id: string
  name: string
}

interface UserInfo {
  id: string
  uid: string
  username: string
  nickname: string
  avatar: string
}

const props = defineProps<{
  activeId: string
  conversations: ChatItem[]
  user: UserInfo | null
  activeView?: 'chat' | 'files'
}>()

const emit = defineEmits<{
  select: [id: string]
  newChat: []
  logout: []
  openSettings: []
  openFileManager: []
  delete: [id: string]
}>()

const isFold = ref(false)
const chatList = computed(() => props.conversations)
const showUserMenu = ref(false)
const activeMenuId = ref('')

// 退出确认弹窗
const showLogoutDialog = ref(false)
const logoutLoading = ref(false)

// 删除会话确认弹窗
const showDeleteDialog = ref(false)
const pendingDeleteItem = ref<ChatItem | null>(null)

function handleNewChat() {
  emit('newChat')
}

function handleOpenFileManager() {
  emit('openFileManager')
}

function handleSelect(id: string) {
  emit('select', id)
}

function toggleFold() {
  isFold.value = !isFold.value
}

function toggleUserMenu() {
  showUserMenu.value = !showUserMenu.value
}

function toggleItemMenu(id: string, e: MouseEvent) {
  e.stopPropagation()
  activeMenuId.value = activeMenuId.value === id ? '' : id
}

function handleDeleteChat(item: ChatItem, e: MouseEvent) {
  e.stopPropagation()
  activeMenuId.value = ''
  pendingDeleteItem.value = item
  showDeleteDialog.value = true
}

function cancelDelete() {
  showDeleteDialog.value = false
  pendingDeleteItem.value = null
}

function confirmDelete() {
  if (!pendingDeleteItem.value) return
  emit('delete', pendingDeleteItem.value.id)
  showDeleteDialog.value = false
  pendingDeleteItem.value = null
}

function handleGlobalClick() {
  activeMenuId.value = ''
}

onMounted(() => {
  document.addEventListener('click', handleGlobalClick)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleGlobalClick)
})

function handleLogout() {
  showUserMenu.value = false
  showLogoutDialog.value = true
}

function cancelLogout() {
  if (logoutLoading.value) return
  showLogoutDialog.value = false
}

async function confirmLogout() {
  if (logoutLoading.value) return
  logoutLoading.value = true
  try {
    await fetch('http://localhost:3000/auth/logout', { method: 'POST' })
    showLogoutDialog.value = false
    ElMessage.success('已退出登录')
    emit('logout')
  } catch {
    ElMessage.error('退出失败，请重试')
  } finally {
    logoutLoading.value = false
  }
}

function handleSettings() {
  showUserMenu.value = false
  emit('openSettings')
}
</script>

<template>
  <div class="sidebar" :class="{ fold: isFold }">
    <!-- 展开状态 -->
    <div v-if="!isFold" class="sidebar-unfold">
      <div class="sidebar-header">
        <span class="sidebar-title">ChatAI</span>
        <button class="fold-btn" @click="toggleFold" title="收起">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 12L6 8L10 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>

      <div class="new-chat-btn" @click="handleNewChat">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8 3V13M3 8H13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <span>新建对话</span>
      </div>

      <div
        class="nav-entry"
        :class="{ active: props.activeView === 'files' }"
        @click="handleOpenFileManager"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M1.5 4.5a1 1 0 011-1h3.2a1 1 0 01.7.3l1 1a1 1 0 00.7.3h4.2a1 1 0 011 1v6.1a1 1 0 01-1 1h-11a1 1 0 01-1-1V4.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
        </svg>
        <span>文件管理</span>
      </div>

      <div class="history-list">
        <div v-if="chatList.length === 0" class="empty-state">
          暂无对话记录
        </div>
        <div
          v-for="item in chatList"
          :key="item.id"
          class="history-item"
          :class="{ active: props.activeId === item.id, 'menu-open': activeMenuId === item.id }"
          @click="handleSelect(item.id)"
        >
          <span class="history-item-title">{{ item.name }}</span>
          <button
            class="history-item-more"
            :class="{ visible: activeMenuId === item.id }"
            title="更多操作"
            @click="(e) => toggleItemMenu(item.id, e)"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="3" cy="8" r="1.3" fill="currentColor"/>
              <circle cx="8" cy="8" r="1.3" fill="currentColor"/>
              <circle cx="13" cy="8" r="1.3" fill="currentColor"/>
            </svg>
          </button>
          <div v-if="activeMenuId === item.id" class="history-item-menu" @click.stop>
            <div class="history-item-menu-btn danger" @click="(e) => handleDeleteChat(item, e)">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M2.5 4h11M6 4V2.5a1 1 0 011-1h2a1 1 0 011 1V4M12.5 4l-.6 8.6a1.5 1.5 0 01-1.5 1.4H5.6a1.5 1.5 0 01-1.5-1.4L3.5 4M6.5 7v4M9.5 7v4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span>删除</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 底部用户区域 -->
      <div class="user-area">
        <div class="user-entry" @click="toggleUserMenu">
          <div class="user-avatar">
            <img v-if="props.user?.avatar" :src="props.user.avatar" alt="avatar" />
            <svg v-else width="24" height="24" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="8" r="4" fill="#bfbfbf"/>
              <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" fill="#bfbfbf"/>
            </svg>
          </div>
          <span class="user-name">{{ props.user?.nickname || props.user?.username || '用户' }}</span>
        </div>

        <!-- 弹出菜单 -->
        <div v-if="showUserMenu" class="user-menu">
          <div class="user-menu-item" @click="handleSettings">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 10a2 2 0 100-4 2 2 0 000 4z" stroke="currentColor" stroke-width="1.2"/>
              <path d="M13.7 6.5l-.7-.4a5.2 5.2 0 000-1.2l.7-.4a.5.5 0 00.2-.6l-.5-.9a.5.5 0 00-.6-.2l-.7.3a5 5 0 00-1-.6V2a.5.5 0 00-.5-.5h-1a.5.5 0 00-.5.5v.5a5 5 0 00-1 .6l-.7-.3a.5.5 0 00-.6.2l-.5.9a.5.5 0 00.2.6l.7.4a5.2 5.2 0 000 1.2l-.7.4a.5.5 0 00-.2.6l.5.9a.5.5 0 00.6.2l.7-.3a5 5 0 001 .6V14a.5.5 0 00.5.5h1a.5.5 0 00.5-.5v-.5a5 5 0 001-.6l.7.3a.5.5 0 00.6-.2l.5-.9a.5.5 0 00-.2-.6l-.7-.4a5.2 5.2 0 000-1.2l.7-.4a.5.5 0 00.2-.6l-.5-.9a.5.5 0 00-.6-.2l-.7.3" stroke="currentColor" stroke-width="1.2"/>
            </svg>
            <span>设置</span>
          </div>
          <div class="user-menu-divider"></div>
          <div class="user-menu-item logout" @click="handleLogout">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M6 2H4a2 2 0 00-2 2v8a2 2 0 002 2h2M10.5 11.5L14 8l-3.5-3.5M14 8H6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span>退出登录</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 折叠状态 -->
    <div v-else class="sidebar-fold">
      <button class="unfold-btn" @click="toggleFold" title="展开">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M6 4L10 8L6 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <button class="new-chat-icon" @click="handleNewChat" title="新建对话">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8 3V13M3 8H13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
      <button
        class="new-chat-icon"
        :class="{ active: props.activeView === 'files' }"
        title="文件管理"
        @click="handleOpenFileManager"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M1.5 4.5a1 1 0 011-1h3.2a1 1 0 01.7.3l1 1a1 1 0 00.7.3h4.2a1 1 0 011 1v6.1a1 1 0 01-1 1h-11a1 1 0 01-1-1V4.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
        </svg>
      </button>
      <div class="fold-spacer"></div>
      <div class="fold-user-avatar" @click="toggleUserMenu" title="用户">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="8" r="4" fill="#bfbfbf"/>
          <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" fill="#bfbfbf"/>
        </svg>
      </div>
    </div>

    <!-- 退出登录确认弹窗（pc-genflow-pro 风格） -->
    <Teleport to="body">
      <transition name="gf-dialog">
        <div
          v-if="showLogoutDialog"
          class="gf-dialog-mask"
          @click.self="cancelLogout"
        >
          <div class="gf-dialog">
            <div class="gf-dialog-header">
              <h3 class="gf-dialog-title">退出登录</h3>
              <button class="gf-dialog-close" :disabled="logoutLoading" @click="cancelLogout">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
              </button>
            </div>
            <div class="gf-dialog-body">
              确定要退出当前账号吗？退出后需要重新登录。
            </div>
            <div class="gf-dialog-footer">
              <button
                class="gf-btn gf-btn-plain"
                :disabled="logoutLoading"
                @click="cancelLogout"
              >
                取消
              </button>
              <button
                class="gf-btn gf-btn-primary"
                :class="{ loading: logoutLoading }"
                :disabled="logoutLoading"
                @click="confirmLogout"
              >
                {{ logoutLoading ? '退出中...' : '确认退出' }}
              </button>
            </div>
          </div>
        </div>
      </transition>
    </Teleport>

    <!-- 删除会话确认弹窗（与退出弹窗同风格） -->
    <Teleport to="body">
      <transition name="gf-dialog">
        <div
          v-if="showDeleteDialog"
          class="gf-dialog-mask"
          @click.self="cancelDelete"
        >
          <div class="gf-dialog">
            <div class="gf-dialog-header">
              <h3 class="gf-dialog-title">删除对话</h3>
              <button class="gf-dialog-close" @click="cancelDelete">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
              </button>
            </div>
            <div class="gf-dialog-body">
              确定要删除对话
              <span class="gf-dialog-highlight">「{{ pendingDeleteItem?.name }}」</span>
              吗？该操作无法撤销。
            </div>
            <div class="gf-dialog-footer">
              <button class="gf-btn gf-btn-plain" @click="cancelDelete">取消</button>
              <button class="gf-btn gf-btn-danger" @click="confirmDelete">删除</button>
            </div>
          </div>
        </div>
      </transition>
    </Teleport>
  </div>
</template>

<style scoped>
.sidebar {
  height: 100%;
  background: var(--gf-bg-panel);
  border-right: 1px solid var(--gf-border);
  flex-shrink: 0;
  transition: width 0.2s ease, background-color 0.2s ease, border-color 0.2s ease;
  display: flex;
  flex-direction: column;
}

.sidebar:not(.fold) {
  width: 268px;
}

.sidebar.fold {
  width: 48px;
}

.sidebar-unfold {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 16px 12px;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  padding: 0 4px;
}

.sidebar-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--gf-text-primary);
}

.fold-btn,
.unfold-btn,
.new-chat-icon {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--gf-text-secondary);
  transition: background 0.15s, color 0.15s;
}

.fold-btn:hover,
.unfold-btn:hover,
.new-chat-icon:hover {
  background: var(--gf-bg-elevated);
  color: var(--gf-text-primary);
}

.new-chat-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 12px;
  border-radius: 8px;
  background: var(--gf-bg-elevated);
  cursor: pointer;
  font-size: 14px;
  color: var(--gf-text-regular);
  margin-bottom: 16px;
  transition: background 0.15s;
}

.new-chat-btn:hover {
  background: var(--gf-bg-elevated-hover);
}

.new-chat-btn:active {
  background: var(--gf-bg-elevated-hover);
}

.nav-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 12px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  color: var(--gf-text-regular);
  margin-bottom: 8px;
  transition: background 0.15s, color 0.15s;
}

.nav-entry:hover {
  background: var(--gf-bg-elevated);
}

.nav-entry.active {
  background: var(--gf-bg-elevated);
  color: var(--gf-primary);
}

.new-chat-icon.active {
  background: var(--gf-bg-elevated);
  color: var(--gf-primary);
}

.history-list {
  flex: 1;
  overflow-y: auto;
}

.empty-state {
  text-align: center;
  color: var(--gf-text-disabled);
  font-size: 13px;
  margin-top: 40px;
}

.history-item {
  position: relative;
  display: flex;
  align-items: center;
  height: 40px;
  padding: 0 8px 0 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}

.history-item:hover {
  background: var(--gf-bg-elevated);
}

.history-item.active,
.history-item.menu-open {
  background: var(--gf-bg-elevated);
}

.history-item.active .history-item-title {
  color: var(--gf-primary);
}

.history-item-title {
  flex: 1;
  font-size: 14px;
  color: var(--gf-text-regular);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.history-item-more {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  margin-left: 4px;
  padding: 0;
  border: none;
  background: transparent;
  border-radius: 6px;
  color: var(--gf-text-tertiary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.15s, background 0.15s, color 0.15s;
}

.history-item:hover .history-item-more,
.history-item-more.visible {
  opacity: 1;
}

.history-item-more:hover {
  background: var(--gf-bg-elevated-hover);
  color: var(--gf-text-primary);
}

.history-item-menu {
  position: absolute;
  top: calc(100% - 4px);
  right: 8px;
  min-width: 140px;
  background: var(--gf-bg-panel);
  border: 1px solid var(--gf-border);
  border-radius: 10px;
  box-shadow: var(--gf-shadow-menu);
  padding: 4px;
  z-index: 50;
}

.history-item-menu-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 10px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--gf-text-regular);
  cursor: pointer;
  transition: background 0.15s;
}

.history-item-menu-btn:hover {
  background: var(--gf-bg-elevated);
}

.history-item-menu-btn.danger {
  color: var(--gf-danger);
}

.history-item-menu-btn.danger:hover {
  background: var(--gf-danger-bg);
}

/* 底部用户区域 */
.user-area {
  flex-shrink: 0;
  position: relative;
  border-top: 1px solid var(--gf-border);
  padding-top: 12px;
  margin-top: 12px;
}

.user-entry {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s;
}

.user-entry:hover {
  background: var(--gf-bg-elevated);
}

.user-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--gf-bg-elevated);
}

.user-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.user-name {
  font-size: 14px;
  color: var(--gf-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 弹出菜单 */
.user-menu {
  position: absolute;
  bottom: 100%;
  left: 8px;
  margin-bottom: 8px;
  width: 180px;
  background: var(--gf-bg-panel);
  border: 1px solid var(--gf-border);
  border-radius: 12px;
  box-shadow: var(--gf-shadow-menu);
  padding: 4px;
  z-index: 100;
}

.user-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 12px;
  border-radius: 8px;
  font-size: 14px;
  color: var(--gf-text-regular);
  cursor: pointer;
  transition: background 0.15s;
}

.user-menu-item:hover {
  background: var(--gf-bg-elevated);
}

.user-menu-item.logout {
  color: var(--gf-danger);
}

.user-menu-item.logout:hover {
  background: var(--gf-danger-bg);
}

.user-menu-divider {
  height: 1px;
  background: var(--gf-divider);
  margin: 4px 8px;
}

/* 折叠状态 */
.sidebar-fold {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 16px;
  gap: 8px;
  height: 100%;
}

.fold-spacer {
  flex: 1;
}

.fold-user-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--gf-bg-elevated);
  cursor: pointer;
  margin-bottom: 16px;
  transition: background 0.15s;
  color: var(--gf-text-tertiary);
}

.fold-user-avatar:hover {
  background: var(--gf-bg-elevated-hover);
}
</style>

<!-- 弹窗使用 Teleport 到 body，需要非 scoped 样式 -->
<style>
.gf-dialog-mask {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--gf-bg-mask);
  backdrop-filter: blur(2px);
}

.gf-dialog {
  width: 420px;
  max-width: calc(100vw - 32px);
  background: var(--gf-bg-panel);
  border-radius: 16px;
  box-shadow: var(--gf-shadow-dialog);
  padding: 24px 24px 20px;
  box-sizing: border-box;
  font-family: inherit;
  color: var(--gf-text-primary);
  border: 1px solid var(--gf-border);
}

.gf-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.gf-dialog-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--gf-text-primary);
  line-height: 24px;
}

.gf-dialog-close {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  border-radius: 8px;
  color: var(--gf-text-tertiary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}

.gf-dialog-close:hover:not(:disabled) {
  background: var(--gf-bg-elevated);
  color: var(--gf-text-primary);
}

.gf-dialog-close:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.gf-dialog-body {
  font-size: 14px;
  line-height: 22px;
  color: var(--gf-text-secondary);
  padding: 4px 0 24px;
}

.gf-dialog-footer {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
}

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
}

.gf-btn:disabled {
  cursor: not-allowed;
}

.gf-btn-plain {
  background: var(--gf-bg-panel);
  border-color: var(--gf-border-strong);
  color: var(--gf-text-secondary);
}

.gf-btn-plain:hover:not(:disabled) {
  background: var(--gf-bg-elevated);
  border-color: var(--gf-border-strong);
  color: var(--gf-text-primary);
}

.gf-btn-primary {
  background: var(--gf-accent);
  color: var(--gf-bg-panel);
  border-color: var(--gf-accent);
}

.gf-btn-primary:hover:not(:disabled) {
  background: var(--gf-accent-hover);
  border-color: var(--gf-accent-hover);
}

.gf-btn-primary.loading,
.gf-btn-primary:disabled {
  opacity: 0.6;
}

.gf-btn-danger {
  background: var(--gf-danger);
  color: #fff;
  border-color: var(--gf-danger);
}

.gf-btn-danger:hover:not(:disabled) {
  background: var(--gf-danger-hover);
  border-color: var(--gf-danger-hover);
}

.gf-dialog-highlight {
  color: var(--gf-text-primary);
  font-weight: 500;
}

/* 弹窗过渡动画 */
.gf-dialog-enter-active,
.gf-dialog-leave-active {
  transition: opacity 0.18s ease;
}

.gf-dialog-enter-active .gf-dialog,
.gf-dialog-leave-active .gf-dialog {
  transition: transform 0.18s ease, opacity 0.18s ease;
}

.gf-dialog-enter-from,
.gf-dialog-leave-to {
  opacity: 0;
}

.gf-dialog-enter-from .gf-dialog,
.gf-dialog-leave-to .gf-dialog {
  opacity: 0;
  transform: translateY(-8px) scale(0.98);
}
</style>
