<script setup lang="ts">
import { ref, nextTick, onMounted } from 'vue'
import SideBar from './components/SideBar/index.vue'
import LoginPage from './components/Login/index.vue'
import RegisterPage from './components/Register/index.vue'
import { fetchSSE, cancelSSE } from './utils/sse'
import type { SSEController } from './utils/sse'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface ChatConversation {
  id: string
  name: string
}

interface UserInfo {
  id: string
  username: string
  avatar: string
}

type AuthPage = 'login' | 'register'

const inputText = ref('')
const messages = ref<Message[]>([])
const loading = ref(false)
const paused = ref(false)
const chatListRef = ref<HTMLElement | null>(null)
const activeChatId = ref('')
const conversations = ref<ChatConversation[]>([])

// 登录状态
const isLoggedIn = ref(false)
const currentUser = ref<UserInfo | null>(null)
const authToken = ref('')
const authPage = ref<AuthPage>('login')

// SSE 流控制
let currentSSE: SSEController | null = null
let currentSessionId = ''

// 检查本地存储的登录态
onMounted(() => {
  const savedData = localStorage.getItem('chatai_auth')
  if (savedData) {
    try {
      const parsed = JSON.parse(savedData)
      currentUser.value = parsed.user
      authToken.value = parsed.token
      isLoggedIn.value = true
      void loadConversations()
    } catch {
      localStorage.removeItem('chatai_auth')
    }
  }
})

function handleAuthSuccess(data: { token: string; user: UserInfo }) {
  currentUser.value = data.user
  authToken.value = data.token
  isLoggedIn.value = true
  localStorage.setItem('chatai_auth', JSON.stringify(data))
  void loadConversations()
}

function scrollToBottom() {
  nextTick(() => {
    if (chatListRef.value) {
      chatListRef.value.scrollTop = chatListRef.value.scrollHeight
    }
  })
}

function normalizeMessages(rawMessages: Array<{ role: string; content: string }> | undefined): Message[] {
  return (rawMessages ?? []).map((item) => ({
    role: item.role === 'assistant' ? 'assistant' : 'user',
    content: item.content ?? '',
  }))
}

async function loadConversations() {
  try {
    const response = await fetch('http://localhost:3000/conversations')
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    const data = await response.json()
    conversations.value = (data ?? []).map((item: { id: number; title: string }) => ({
      id: String(item.id),
      name: item.title || '新对话',
    }))
  } catch (error) {
    console.error('加载会话列表失败', error)
  }
}

async function loadMessages(conversationId: string) {
  try {
    const response = await fetch(`http://localhost:3000/conversations/${conversationId}/messages`)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    const data = await response.json()
    messages.value = normalizeMessages(data)
    scrollToBottom()
  } catch (error) {
    console.error('加载历史消息失败', error)
    messages.value = []
  }
}

function handleSubmit() {
  const text = inputText.value.trim()
  if (!text || loading.value) return

  messages.value.push({ role: 'user', content: text })
  inputText.value = ''
  scrollToBottom()

  loading.value = true
  paused.value = false
  messages.value.push({ role: 'assistant', content: '' })
  const msgIndex = messages.value.length - 1
  scrollToBottom()

  const requestBody: Record<string, unknown> = { message: text }
  if (activeChatId.value) {
    requestBody.conversationId = Number(activeChatId.value)
  }

  currentSSE = fetchSSE({
    url: 'http://localhost:3000/chat',
    body: requestBody,
    onSessionId(sessionId) {
      currentSessionId = sessionId
    },
    onEvent(payload) {
      if (payload.conversationId) {
        const nextConversationId = String(payload.conversationId)
        if (!activeChatId.value) {
          activeChatId.value = nextConversationId
        }
        const existing = conversations.value.find((item) => item.id === nextConversationId)
        if (!existing) {
          conversations.value.unshift({
            id: nextConversationId,
            name: text.slice(0, 50) || '新对话',
          })
        }
      }
    },
    onMessage(content) {
      messages.value[msgIndex] = {
        ...messages.value[msgIndex],
        content: messages.value[msgIndex].content + content,
      }
      scrollToBottom()
    },
    onDone() {
      loading.value = false
      paused.value = false
      currentSSE = null
      currentSessionId = ''
      scrollToBottom()
      void loadConversations()
    },
    onError(error) {
      messages.value[msgIndex] = {
        ...messages.value[msgIndex],
        content: '请求失败: ' + error.message,
      }
      loading.value = false
      paused.value = false
      currentSSE = null
      currentSessionId = ''
      scrollToBottom()
      void loadConversations()
    },
  })
}

function handlePause() {
  if (!loading.value || paused.value) return
  currentSSE?.pause()
  paused.value = true
}

function handleResume() {
  if (!paused.value) return
  currentSSE?.resume()
  paused.value = false
}

function handleStop() {
  if (!loading.value) return
  currentSSE?.abort()
  if (currentSessionId) {
    cancelSSE('http://localhost:3000', currentSessionId)
  }
  loading.value = false
  paused.value = false
  currentSSE = null
  currentSessionId = ''
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSubmit()
  }
}

function handleNewChat() {
  if (loading.value) {
    handleStop()
  }
  messages.value = []
  activeChatId.value = ''
  inputText.value = ''
}

function handleSelectChat(id: string) {
  if (loading.value) {
    handleStop()
  }
  activeChatId.value = id
  void loadMessages(id)
}

onMounted(() => {
  // 登录态已在上方 onMounted 处理
})
</script>

<template>
  <!-- 未登录：显示登录或注册页 -->
  <LoginPage
    v-if="!isLoggedIn && authPage === 'login'"
    @login="handleAuthSuccess"
    @go-register="authPage = 'register'"
  />
  <RegisterPage
    v-else-if="!isLoggedIn && authPage === 'register'"
    @register="handleAuthSuccess"
    @go-login="authPage = 'login'"
  />

  <!-- 已登录：显示主界面 -->
  <div v-else class="chat-container">
    <SideBar
      :active-id="activeChatId"
      :conversations="conversations"
      @new-chat="handleNewChat"
      @select="handleSelectChat"
    />
    <div class="main-container">
      <div class="chat-wrapper" :class="{ 'has-work': messages.length > 0 }">
        <!-- 消息列表 -->
        <div v-if="messages.length > 0" ref="chatListRef" class="message-list">
          <template v-for="(msg, idx) in messages" :key="idx">
            <div
              v-if="!(loading && msg.role === 'assistant' && msg.content === '')"
              class="message-item"
              :class="msg.role"
            >
              <div class="message-bubble">{{ msg.content }}</div>
            </div>
          </template>
          <div v-if="loading && messages[messages.length - 1]?.content === ''" class="message-item assistant">
            <div class="message-bubble thinking">思考中...</div>
          </div>
        </div>

        <!-- 输入区域 -->
        <div class="chat-input-area">
          <div class="chat-input-wrapper">
            <textarea
              v-model="inputText"
              class="chat-input"
              placeholder="描述您的问题"
              rows="1"
              @keydown="handleKeyDown"
            ></textarea>
            <div class="chat-operate">
              <!-- 生成中：暂停 + 终止 -->
              <template v-if="loading && !paused">
                <button class="ctrl-btn pause-btn" title="暂停生成" @click="handlePause">
                  <svg width="16" height="16" viewBox="0 0 1024 1024" fill="none">
                    <path d="M512 66.56a445.44 445.44 0 1 0 0 890.88 445.44 445.44 0 0 0 0-890.88z M138.24 512a373.76 373.76 0 1 1 747.52 0 373.76 373.76 0 0 1-747.52 0z m230.4-153.6a25.6 25.6 0 0 0-25.6 25.6v256a25.6 25.6 0 0 0 25.6 25.6h51.2a25.6 25.6 0 0 0 25.6-25.6v-256a25.6 25.6 0 0 0-25.6-25.6h-51.2z m204.8 0a25.6 25.6 0 0 0-25.6 25.6v256a25.6 25.6 0 0 0 25.6 25.6h51.2a25.6 25.6 0 0 0 25.6-25.6v-256a25.6 25.6 0 0 0-25.6-25.6h-51.2z" fill="currentColor"/>
                  </svg>
                  <span>暂停</span>
                </button>
                <button class="ctrl-btn stop-btn" title="终止生成" @click="handleStop">
                  <svg width="16" height="16" viewBox="0 0 1024 1024" fill="none">
                    <path d="M512 66.56a445.44 445.44 0 1 0 0 890.88 445.44 445.44 0 0 0 0-890.88z M138.24 512a373.76 373.76 0 1 1 747.52 0 373.76 373.76 0 0 1-747.52 0z m245.76-153.6a25.6 25.6 0 0 0-25.6 25.6v256a25.6 25.6 0 0 0 25.6 25.6h256a25.6 25.6 0 0 0 25.6-25.6v-256a25.6 25.6 0 0 0-25.6-25.6h-256z" fill="currentColor"/>
                  </svg>
                  <span>终止</span>
                </button>
              </template>

              <!-- 暂停中：继续 + 终止 -->
              <template v-else-if="paused">
                <button class="ctrl-btn resume-btn" title="继续生成" @click="handleResume">
                  <svg width="16" height="16" viewBox="0 0 1024 1024" fill="none">
                    <path d="M512 66.56a445.44 445.44 0 1 0 0 890.88 445.44 445.44 0 0 0 0-890.88z M138.24 512a373.76 373.76 0 1 1 747.52 0 373.76 373.76 0 0 1-747.52 0z m256-179.2a25.6 25.6 0 0 0-25.6 25.6v307.2a25.6 25.6 0 0 0 38.4 22.19l256-153.6a25.6 25.6 0 0 0 0-44.38l-256-153.6a25.6 25.6 0 0 0-12.8-3.41z" fill="currentColor"/>
                  </svg>
                  <span>继续</span>
                </button>
                <button class="ctrl-btn stop-btn" title="终止生成" @click="handleStop">
                  <svg width="16" height="16" viewBox="0 0 1024 1024" fill="none">
                    <path d="M512 66.56a445.44 445.44 0 1 0 0 890.88 445.44 445.44 0 0 0 0-890.88z M138.24 512a373.76 373.76 0 1 1 747.52 0 373.76 373.76 0 0 1-747.52 0z m245.76-153.6a25.6 25.6 0 0 0-25.6 25.6v256a25.6 25.6 0 0 0 25.6 25.6h256a25.6 25.6 0 0 0 25.6-25.6v-256a25.6 25.6 0 0 0-25.6-25.6h-256z" fill="currentColor"/>
                  </svg>
                  <span>终止</span>
                </button>
              </template>

              <!-- 空闲：发送按钮 -->
              <button
                v-else
                class="send-btn"
                :class="{ disabled: !inputText.trim() }"
                :disabled="!inputText.trim()"
                @click="handleSubmit"
              >
                发送
              </button>
            </div>
          </div>
          <div v-if="messages.length > 0" class="footer-ai-tips">
            内容由AI生成，请仔细甄别
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
html, body, #app {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
</style>

<style scoped>
.chat-container {
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.main-container {
  position: relative;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  min-width: 480px;
}

.chat-wrapper {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  justify-content: center;
}

.chat-wrapper.has-work {
  justify-content: flex-start;
}

.message-list {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 24px 0;
  width: calc(100% - 40px);
  max-width: 800px;
  margin: 0 auto;
}

.message-item {
  margin-bottom: 16px;
  display: flex;
}

.message-item.user {
  justify-content: flex-end;
}

.message-item.assistant {
  justify-content: flex-start;
}

.message-bubble {
  max-width: 70%;
  padding: 10px 16px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.message-item.user .message-bubble {
  background: #1677ff;
  color: #fff;
}

.message-item.assistant .message-bubble {
  background: #f0f2f5;
  color: #333;
}

.message-bubble.thinking {
  color: #999;
  font-style: italic;
}

.chat-input-area {
  padding-top: 12px;
  flex-shrink: 0;
  margin: 0 auto;
  width: calc(100% - 40px);
  max-width: 800px;
}

.chat-input-wrapper {
  border: 1px solid #d9d9d9;
  border-radius: 12px;
  padding: 12px 16px;
  background: #fff;
  transition: border-color 0.2s;
}

.chat-input-wrapper:focus-within {
  border-color: #1677ff;
}

.chat-input {
  width: 100%;
  border: none;
  outline: none;
  resize: none;
  font-size: 14px;
  line-height: 1.6;
  min-height: 24px;
  max-height: 120px;
  font-family: inherit;
  background: transparent;
}

.chat-operate {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  padding-top: 10px;
}

.send-btn {
  width: 60px;
  height: 32px;
  border-radius: 8px;
  border: none;
  background: #1677ff;
  color: #fff;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.2s;
}

.send-btn:hover:not(.disabled) {
  background: #4096ff;
}

.send-btn.disabled {
  background: #d9d9d9;
  cursor: not-allowed;
}

.ctrl-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid #e4e9f1;
  background: #f5f7fa;
  color: #333;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.15s;
}

.ctrl-btn:hover {
  background: #ebeef5;
}

.ctrl-btn:active {
  background: #dcdfe6;
}

.ctrl-btn svg {
  width: 16px;
  height: 16px;
}

.stop-btn {
  color: #e64340;
  border-color: #fde2e2;
}

.stop-btn:hover {
  background: #fef0f0;
}

.resume-btn {
  color: #1677ff;
  border-color: #d6e8ff;
}

.resume-btn:hover {
  background: #ecf5ff;
}

.footer-ai-tips {
  display: flex;
  justify-content: center;
  font-size: 12px;
  line-height: 16px;
  color: #a2abbd;
  margin: 8px 0 12px;
}
</style>
