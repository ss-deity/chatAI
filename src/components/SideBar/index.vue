<script setup lang="ts">
import { computed, ref } from 'vue'

interface ChatItem {
  id: string
  name: string
}

const props = defineProps<{
  activeId: string
  conversations: ChatItem[]
}>()

const emit = defineEmits<{
  select: [id: string]
  newChat: []
}>()

const isFold = ref(false)
const chatList = computed(() => props.conversations)

function handleNewChat() {
  emit('newChat')
}

function handleSelect(id: string) {
  emit('select', id)
}

function toggleFold() {
  isFold.value = !isFold.value
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

      <div class="history-list">
        <div v-if="chatList.length === 0" class="empty-state">
          暂无对话记录
        </div>
        <div
          v-for="item in chatList"
          :key="item.id"
          class="history-item"
          :class="{ active: props.activeId === item.id }"
          @click="handleSelect(item.id)"
        >
          <span class="history-item-title">{{ item.name }}</span>
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
    </div>
  </div>
</template>

<style scoped>
.sidebar {
  height: 100vh;
  background: #fff;
  border-right: 1px solid #ebeef5;
  flex-shrink: 0;
  transition: width 0.2s ease;
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
  color: #030b1a;
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
  color: #666;
  transition: background 0.15s;
}

.fold-btn:hover,
.unfold-btn:hover,
.new-chat-icon:hover {
  background: #f5f7fa;
  color: #333;
}

.new-chat-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 12px;
  border-radius: 8px;
  background: #f5f7fa;
  cursor: pointer;
  font-size: 14px;
  color: #333;
  margin-bottom: 16px;
  transition: background 0.15s;
}

.new-chat-btn:hover {
  background: #ebeef5;
}

.new-chat-btn:active {
  background: #dcdfe6;
}

.history-list {
  flex: 1;
  overflow-y: auto;
}

.empty-state {
  text-align: center;
  color: #a2abbd;
  font-size: 13px;
  margin-top: 40px;
}

.history-item {
  display: flex;
  align-items: center;
  height: 40px;
  padding: 0 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}

.history-item:hover {
  background: #f5f7fa;
}

.history-item.active {
  background: #f5f7fa;
}

.history-item.active .history-item-title {
  color: #258aff;
}

.history-item-title {
  font-size: 14px;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}

/* 折叠状态 */
.sidebar-fold {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 16px;
  gap: 8px;
}
</style>
