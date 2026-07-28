<script setup lang="ts">
import { ref, reactive, computed, nextTick, onMounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import SideBar from './components/SideBar/index.vue'
import LoginPage from './components/Login/index.vue'
import RegisterPage from './components/Register/index.vue'
import SettingsPanel from './components/Settings/index.vue'
import { fetchSSE, cancelSSE } from './utils/sse'
import type { SSEController } from './utils/sse'

// marked 配置：兼容 GFM，换行转 <br>，同步返回字符串（用于流式渲染）
marked.setOptions({
  gfm: true,
  breaks: true,
  async: false,
})

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

/**
 * 单个会话在前端的运行时状态（参考 enterprise-genclaw 的多轮实现）。
 * 每个会话独立保存自己的消息列表、loading/paused、后端 sessionId 等，
 * 切换侧边栏只切换 activeChatId，不打断任何已有的流。
 */
interface SessionState {
  messages: Message[]
  loading: boolean
  paused: boolean
  /** 后端为本次流式返回分配的 sessionId，用于 pause/resume/cancel 接口 */
  sessionId: string
  /** 当前正在被 token 追加的 assistant 消息下标；无流式时为 -1 */
  assistantIndex: number
}

type AuthPage = 'login' | 'register'

const inputText = ref('')
const chatListRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLTextAreaElement | null>(null)
const activeChatId = ref('')
const conversations = ref<ChatConversation[]>([])

/**
 * 是否处于"贴底"状态。用户手动上滑查看历史时置为 false，
 * 流式 token 追加时只有 stickToBottom 才自动滚动，避免"抽搐"。
 */
const stickToBottom = ref(true)

/** 用 rAF 合帧的调度标记，避免每个 token 都触发一次 reflow */
let scrollScheduled = false
/** 标记当前 scrollTop 是我们自己写入的，防止 scroll 事件误判为用户操作 */
let isProgrammaticScroll = false

// 登录状态
const isLoggedIn = ref(false)
const currentUser = ref<UserInfo | null>(null)
const authToken = ref('')
const authPage = ref<AuthPage>('login')

// 设置面板
const showSettings = ref(false)

/**
 * 多会话状态表：key = 真实 conversationId（数字字符串） 或 "pending_xxx"（新对话未落库前）。
 * 使用 reactive 让 Vue 感知内部字段变化。
 */
const sessionStates = reactive<Record<string, SessionState>>({})

/**
 * SSE 控制器实例不参与响应式，用普通 Map 存放，key 与 sessionStates 一致。
 */
const sessionControllers = new Map<string, SSEController>()

/** 计数器：为尚未拿到 conversationId 的新对话生成一个临时 key */
let pendingCounter = 0

// 展示层：当前活动会话的状态
const activeSession = computed<SessionState | undefined>(() =>
  activeChatId.value ? sessionStates[activeChatId.value] : undefined,
)
const messages = computed<Message[]>(() => activeSession.value?.messages ?? [])
const loading = computed<boolean>(() => activeSession.value?.loading ?? false)
const paused = computed<boolean>(() => activeSession.value?.paused ?? false)

// 检查本地存储的登录态
onMounted(() => {
  const savedData = localStorage.getItem('chatai_auth')
  if (savedData) {
    try {
      const parsed = JSON.parse(savedData)
      currentUser.value = parsed.user
      authToken.value = parsed.token
      isLoggedIn.value = true
      void refreshCurrentUser()
      void loadConversations()
    } catch {
      localStorage.removeItem('chatai_auth')
    }
  }
  // 恢复主题
  const savedTheme = localStorage.getItem('chatai_theme')
  if (savedTheme) {
    document.documentElement.setAttribute('data-theme', savedTheme)
  }
})

/**
 * 拉取数据库中的最新用户信息（头像、用户名）
 */
async function refreshCurrentUser() {
  if (!currentUser.value?.id) return
  try {
    const response = await fetch(
      `http://localhost:3000/users/${encodeURIComponent(currentUser.value.id)}`,
    )
    if (!response.ok) return
    const result = await response.json()
    if (result.code === 0 && result.data) {
      currentUser.value = result.data
      const authData = { token: authToken.value, user: result.data }
      localStorage.setItem('chatai_auth', JSON.stringify(authData))
    }
  } catch (error) {
    console.error('刷新用户信息失败', error)
  }
}

function handleAuthSuccess(data: { token: string; user: UserInfo }) {
  currentUser.value = data.user
  authToken.value = data.token
  isLoggedIn.value = true
  localStorage.setItem('chatai_auth', JSON.stringify(data))
  void loadConversations()
}

function handleLogout() {
  // 登出前中止所有正在流式的会话
  for (const [key, controller] of sessionControllers.entries()) {
    controller.abort()
    const state = sessionStates[key]
    if (state?.sessionId) {
      cancelSSE('http://localhost:3000', state.sessionId)
    }
  }
  sessionControllers.clear()
  for (const key of Object.keys(sessionStates)) {
    delete sessionStates[key]
  }

  isLoggedIn.value = false
  currentUser.value = null
  authToken.value = ''
  conversations.value = []
  activeChatId.value = ''
  localStorage.removeItem('chatai_auth')
}

function handleUpdateUser(user: UserInfo) {
  currentUser.value = user
  // 更新本地存储
  const authData = { token: authToken.value, user }
  localStorage.setItem('chatai_auth', JSON.stringify(authData))
}

function scrollToBottom(force = false) {
  if (!force && !stickToBottom.value) return
  if (scrollScheduled) return
  scrollScheduled = true
  requestAnimationFrame(() => {
    scrollScheduled = false
    const el = chatListRef.value
    if (!el) return
    isProgrammaticScroll = true
    el.scrollTop = el.scrollHeight
    // 双 rAF 后再解除，避免 scroll 事件被误判为"用户上滑"
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        isProgrammaticScroll = false
      })
    })
  })
}

/**
 * 消息区滚动监听：判断用户是否仍在底部（40px 容差），
 * 用来决定后续 token 追加时是否要跟随滚动。
 */
function handleChatScroll() {
  if (isProgrammaticScroll) return
  const el = chatListRef.value
  if (!el) return
  const threshold = 40
  stickToBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight <= threshold
}

/**
 * 输入框根据内容自动增高，避免换行后内容被裁掉。
 */
function autoResizeInput() {
  const el = inputRef.value
  if (!el) return
  el.style.height = 'auto'
  const next = Math.min(el.scrollHeight, 200)
  el.style.height = next + 'px'
}

// 切换会话或用户手动输入时都要重排高度
watch(inputText, () => {
  nextTick(autoResizeInput)
})
watch(activeChatId, () => {
  stickToBottom.value = true
  nextTick(() => {
    autoResizeInput()
    scrollToBottom(true)
  })
})

/**
 * 将 assistant 的 markdown 文本渲染为安全的 HTML。
 * 使用同步的 marked.parse + DOMPurify 净化，配合流式 token 追加即可实现打字机效果。
 */
function renderMarkdown(content: string): string {
  if (!content) return ''
  try {
    const html = marked.parse(content) as string
    return DOMPurify.sanitize(html, {
      ADD_ATTR: ['target', 'rel'],
    })
  } catch (err) {
    console.error('markdown 渲染失败', err)
    return DOMPurify.sanitize(content)
  }
}

function normalizeMessages(rawMessages: Array<{ role: string; content: string }> | undefined): Message[] {
  return (rawMessages ?? []).map((item) => ({
    role: item.role === 'assistant' ? 'assistant' : 'user',
    content: item.content ?? '',
  }))
}

/**
 * 确保指定 key 存在一个 SessionState（不覆盖已存在的）
 */
function ensureSession(key: string): SessionState {
  if (!sessionStates[key]) {
    sessionStates[key] = {
      messages: [],
      loading: false,
      paused: false,
      sessionId: '',
      assistantIndex: -1,
    }
  }
  return sessionStates[key]
}

async function loadConversations() {
  if (!currentUser.value?.id) {
    conversations.value = []
    return
  }
  try {
    const response = await fetch(
      `http://localhost:3000/conversations?userId=${encodeURIComponent(currentUser.value.id)}`,
    )
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

/**
 * 中止指定会话的流（若在流），并清理其控制器与后端 sessionId
 */
function abortSessionStream(key: string) {
  const state = sessionStates[key]
  const controller = sessionControllers.get(key)
  controller?.abort()
  if (state?.sessionId) {
    cancelSSE('http://localhost:3000', state.sessionId)
  }
  sessionControllers.delete(key)
  if (state) {
    state.loading = false
    state.paused = false
    state.sessionId = ''
    state.assistantIndex = -1
  }
}

async function handleDeleteChat(id: string) {
  try {
    const response = await fetch(`http://localhost:3000/conversations/${id}`, {
      method: 'DELETE',
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    const data = await response.json()
    if (data.code !== 0) {
      throw new Error(data.message || '删除失败')
    }
    conversations.value = conversations.value.filter((item) => item.id !== id)

    // 若该会话正在流式，先中止它
    if (sessionStates[id]?.loading) {
      abortSessionStream(id)
    }
    // 清空会话本地状态
    delete sessionStates[id]

    // 若删除的是当前打开会话，回到"新对话"状态
    if (activeChatId.value === id) {
      activeChatId.value = ''
    }
    ElMessage.success('已删除会话')
  } catch (error) {
    ElMessage.error('删除失败: ' + (error as Error).message)
  }
}

async function loadMessages(conversationId: string) {
  const state = ensureSession(conversationId)
  try {
    const response = await fetch(`http://localhost:3000/conversations/${conversationId}/messages`)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    const data = await response.json()
    state.messages = normalizeMessages(data)
    stickToBottom.value = true
    scrollToBottom(true)
  } catch (error) {
    console.error('加载历史消息失败', error)
    state.messages = []
  }
}

function handleSubmit() {
  const text = inputText.value.trim()
  if (!text) return

  // 决定这次提交所属会话 key：已选会话则用其 id，否则生成一个 pending key（新对话尚未落库）
  let key = activeChatId.value
  const isNew = !key
  if (isNew) {
    key = `pending_${++pendingCounter}_${Date.now()}`
    activeChatId.value = key
  }

  const state = ensureSession(key)
  // 当前会话已经在流式生成，避免重复提交（其他会话仍可以并发）
  if (state.loading) return

  state.messages.push({ role: 'user', content: text })
  inputText.value = ''
  state.messages.push({ role: 'assistant', content: '' })
  state.assistantIndex = state.messages.length - 1
  state.loading = true
  state.paused = false
  // 用户主动发送，视为想跟随最新回复
  stickToBottom.value = true
  scrollToBottom(true)

  const requestBody: Record<string, unknown> = { message: text }
  // 只有落库过的会话（key 是真实数字 id）才带 conversationId
  if (!isNew && key && !key.startsWith('pending_')) {
    requestBody.conversationId = Number(key)
  }
  if (currentUser.value?.id) {
    requestBody.userId = Number(currentUser.value.id)
  }

  // 用闭包变量跟踪当前会话 key，收到真实 conversationId 时会重命名
  let currentKey = key

  const controller = fetchSSE({
    url: 'http://localhost:3000/chat',
    body: requestBody,
    onSessionId(sessionId) {
      const s = sessionStates[currentKey]
      if (s) s.sessionId = sessionId
    },
    onEvent(payload) {
      if (!payload.conversationId) return
      const nextId = String(payload.conversationId)
      // 首次拿到真实 conversationId：把 pending_xxx 重命名为该 id
      if (currentKey !== nextId) {
        const s = sessionStates[currentKey]
        const c = sessionControllers.get(currentKey)
        if (s) {
          sessionStates[nextId] = s
          delete sessionStates[currentKey]
        }
        if (c) {
          sessionControllers.set(nextId, c)
          sessionControllers.delete(currentKey)
        }
        if (activeChatId.value === currentKey) {
          activeChatId.value = nextId
        }
        currentKey = nextId
      }
      // 侧边栏若没有这条会话，插入到顶部
      const existing = conversations.value.find((it) => it.id === nextId)
      if (!existing) {
        conversations.value.unshift({
          id: nextId,
          name: text.slice(0, 50) || '新对话',
        })
      }
    },
    onMessage(content) {
      const s = sessionStates[currentKey]
      if (!s) return
      const idx = s.assistantIndex
      if (idx < 0 || idx >= s.messages.length) return
      s.messages[idx] = {
        ...s.messages[idx],
        content: s.messages[idx].content + content,
      }
      // 只有当用户仍在查看这个会话时才自动滚动
      if (activeChatId.value === currentKey) scrollToBottom()
    },
    onDone() {
      const s = sessionStates[currentKey]
      if (s) {
        s.loading = false
        s.paused = false
        s.sessionId = ''
        s.assistantIndex = -1
      }
      sessionControllers.delete(currentKey)
      if (activeChatId.value === currentKey) scrollToBottom()
      void loadConversations()
    },
    onError(error) {
      const s = sessionStates[currentKey]
      if (s) {
        const idx = s.assistantIndex
        if (idx >= 0 && idx < s.messages.length) {
          s.messages[idx] = {
            ...s.messages[idx],
            content: '请求失败: ' + error.message,
          }
        }
        s.loading = false
        s.paused = false
        s.sessionId = ''
        s.assistantIndex = -1
      }
      sessionControllers.delete(currentKey)
      void loadConversations()
    },
  })

  sessionControllers.set(key, controller)
}

function handlePause() {
  const state = activeSession.value
  const controller = activeChatId.value ? sessionControllers.get(activeChatId.value) : null
  if (!state?.loading || state.paused) return
  controller?.pause()
  state.paused = true
}

function handleResume() {
  const state = activeSession.value
  const controller = activeChatId.value ? sessionControllers.get(activeChatId.value) : null
  if (!state?.paused) return
  controller?.resume()
  state.paused = false
}

function handleStop() {
  const key = activeChatId.value
  const state = activeSession.value
  if (!key || !state?.loading) return
  abortSessionStream(key)
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSubmit()
  }
}

/**
 * "新建对话"：仅切换视图到"空白新对话"状态。已有会话（若在流式）继续在后台流式，不做任何中止。
 */
function handleNewChat() {
  activeChatId.value = ''
  inputText.value = ''
}

/**
 * 切换到某个已有会话：仅切换 activeChatId，不影响其他会话的流。
 * 首次进入某会话时从服务端加载历史消息；已在内存中的（含仍在流式的）直接沿用现有状态。
 */
async function handleSelectChat(id: string) {
  activeChatId.value = id
  inputText.value = ''
  if (!sessionStates[id]) {
    await loadMessages(id)
  } else {
    stickToBottom.value = true
    scrollToBottom(true)
  }
}
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
      :user="currentUser"
      @new-chat="handleNewChat"
      @select="handleSelectChat"
      @delete="handleDeleteChat"
      @logout="handleLogout"
      @open-settings="showSettings = true"
    />

    <!-- 设置面板 -->
    <SettingsPanel
      v-if="showSettings"
      :user="currentUser"
      @close="showSettings = false"
      @update-user="handleUpdateUser"
    />
    <div class="main-container">
      <div class="chat-wrapper" :class="{ 'has-work': messages.length > 0 }">
        <!-- 消息列表 -->
        <div
          v-if="messages.length > 0"
          ref="chatListRef"
          class="message-list"
          @scroll.passive="handleChatScroll"
        >
          <template v-for="(msg, idx) in messages" :key="idx">
            <div
              v-if="!(loading && msg.role === 'assistant' && msg.content === '')"
              class="message-item"
              :class="msg.role"
            >
              <div
                v-if="msg.role === 'assistant'"
                class="message-bubble markdown-body"
                v-html="renderMarkdown(msg.content)"
              ></div>
              <div v-else class="message-bubble">{{ msg.content }}</div>
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
              ref="inputRef"
              v-model="inputText"
              class="chat-input"
              placeholder="描述您的问题"
              rows="1"
              @keydown="handleKeyDown"
              @input="autoResizeInput"
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
  background: var(--gf-bg-page);
  color: var(--gf-text-primary);
  transition: background-color 0.2s ease, color 0.2s ease;
}
</style>

<style scoped>
.chat-container {
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--gf-bg-page);
}

.main-container {
  position: relative;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  min-width: 480px;
  background: var(--gf-bg-page);
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
  background: var(--gf-bubble-user-bg);
  color: var(--gf-bubble-user-text);
}

.message-item.assistant .message-bubble {
  background: var(--gf-bubble-assistant-bg);
  color: var(--gf-bubble-assistant-text);
}

.message-bubble.thinking {
  color: var(--gf-text-tertiary);
  font-style: italic;
}

/* Markdown 富文本样式 */
.markdown-body {
  white-space: normal;
}

.markdown-body :deep(p) {
  margin: 0 0 8px;
}

.markdown-body :deep(p:last-child) {
  margin-bottom: 0;
}

.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4),
.markdown-body :deep(h5),
.markdown-body :deep(h6) {
  margin: 12px 0 8px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--gf-text-primary);
}

.markdown-body :deep(h1) { font-size: 20px; }
.markdown-body :deep(h2) { font-size: 18px; }
.markdown-body :deep(h3) { font-size: 16px; }
.markdown-body :deep(h4) { font-size: 15px; }
.markdown-body :deep(h5),
.markdown-body :deep(h6) { font-size: 14px; }

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  padding-left: 1.4em;
  margin: 4px 0 8px;
}

.markdown-body :deep(li) {
  margin: 2px 0;
}

.markdown-body :deep(a) {
  color: var(--gf-primary);
  text-decoration: none;
}

.markdown-body :deep(a:hover) {
  text-decoration: underline;
}

.markdown-body :deep(strong) {
  font-weight: 600;
  color: var(--gf-text-primary);
}

.markdown-body :deep(em) {
  font-style: italic;
}

.markdown-body :deep(blockquote) {
  margin: 8px 0;
  padding: 4px 12px;
  border-left: 3px solid var(--gf-border-strong);
  color: var(--gf-text-secondary);
  background: var(--gf-bg-elevated);
  border-radius: 0 6px 6px 0;
}

.markdown-body :deep(hr) {
  border: none;
  border-top: 1px solid var(--gf-divider);
  margin: 12px 0;
}

.markdown-body :deep(code) {
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--gf-bg-elevated-hover);
  color: var(--gf-danger);
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 0.9em;
}

.markdown-body :deep(pre) {
  margin: 8px 0;
  padding: 12px 14px;
  border-radius: 8px;
  background: var(--gf-code-bg, #0f172a);
  color: var(--gf-code-text, #e2e8f0);
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.55;
}

.markdown-body :deep(pre code) {
  padding: 0;
  background: transparent;
  color: inherit;
  font-size: inherit;
}

.markdown-body :deep(table) {
  border-collapse: collapse;
  margin: 8px 0;
  font-size: 13px;
  width: 100%;
}

.markdown-body :deep(th),
.markdown-body :deep(td) {
  padding: 6px 10px;
  border: 1px solid var(--gf-border);
  text-align: left;
}

.markdown-body :deep(th) {
  background: var(--gf-bg-elevated);
  font-weight: 600;
}

.markdown-body :deep(img) {
  max-width: 100%;
  border-radius: 6px;
}

.chat-input-area {
  padding-top: 12px;
  flex-shrink: 0;
  margin: 0 auto;
  width: calc(100% - 40px);
  max-width: 800px;
}

.chat-input-wrapper {
  border: 1px solid var(--gf-border-strong);
  border-radius: 12px;
  padding: 12px 16px;
  background: var(--gf-bg-panel);
  transition: border-color 0.2s, background-color 0.2s;
}

.chat-input-wrapper:focus-within {
  border-color: var(--gf-primary);
}

.chat-input {
  width: 100%;
  border: none;
  outline: none;
  resize: none;
  font-size: 14px;
  line-height: 1.6;
  min-height: 24px;
  max-height: 200px;
  overflow-y: auto;
  font-family: inherit;
  background: transparent;
  color: var(--gf-text-primary);
  box-sizing: border-box;
  display: block;
}

.chat-input::placeholder {
  color: var(--gf-text-placeholder);
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
  background: var(--gf-primary);
  color: var(--gf-primary-inverse);
  font-size: 14px;
  cursor: pointer;
  transition: background 0.2s;
}

.send-btn:hover:not(.disabled) {
  background: var(--gf-primary-hover);
}

.send-btn.disabled {
  background: var(--gf-border-strong);
  color: var(--gf-text-tertiary);
  cursor: not-allowed;
}

.ctrl-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--gf-border-strong);
  background: var(--gf-bg-elevated);
  color: var(--gf-text-regular);
  font-size: 14px;
  cursor: pointer;
  transition: background 0.15s;
}

.ctrl-btn:hover {
  background: var(--gf-bg-elevated-hover);
}

.ctrl-btn:active {
  background: var(--gf-bg-elevated-hover);
}

.ctrl-btn svg {
  width: 16px;
  height: 16px;
}

.stop-btn {
  color: var(--gf-danger);
  border-color: var(--gf-danger-border);
}

.stop-btn:hover {
  background: var(--gf-danger-bg);
}

.resume-btn {
  color: var(--gf-primary);
  border-color: var(--gf-primary-bg);
}

.resume-btn:hover {
  background: var(--gf-primary-bg);
}

.footer-ai-tips {
  display: flex;
  justify-content: center;
  font-size: 12px;
  line-height: 16px;
  color: var(--gf-text-disabled);
  margin: 8px 0 12px;
}
</style>
