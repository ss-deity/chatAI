<script setup lang="ts">
import { ref, nextTick } from 'vue'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const inputText = ref('')
const messages = ref<Message[]>([])
const loading = ref(false)
const chatListRef = ref<HTMLElement | null>(null)

function scrollToBottom() {
  nextTick(() => {
    if (chatListRef.value) {
      chatListRef.value.scrollTop = chatListRef.value.scrollHeight
    }
  })
}

async function handleSubmit() {
  const text = inputText.value.trim()
  if (!text || loading.value) return

  messages.value.push({ role: 'user', content: text })
  inputText.value = ''
  scrollToBottom()

  loading.value = true
  try {
    const res = await fetch('http://localhost:3000/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    })
    const reply = await res.text()
    messages.value.push({ role: 'assistant', content: reply })
  } catch (e) {
    messages.value.push({ role: 'assistant', content: '请求失败: ' + (e as Error).message })
  } finally {
    loading.value = false
    scrollToBottom()
  }
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSubmit()
  }
}
</script>

<template>
  <div class="chat-container">
    <div class="main-container">
      <div class="chat-wrapper" :class="{ 'has-work': messages.length > 0 }">
        <!-- 消息列表 -->
        <div v-if="messages.length > 0" ref="chatListRef" class="message-list">
          <div
            v-for="(msg, idx) in messages"
            :key="idx"
            class="message-item"
            :class="msg.role"
          >
            <div class="message-bubble">{{ msg.content }}</div>
          </div>
          <div v-if="loading" class="message-item assistant">
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
              <button
                class="send-btn"
                :class="{ disabled: !inputText.trim() || loading }"
                :disabled="!inputText.trim() || loading"
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

<style scoped>
.chat-container {
  display: flex;
  width: 100vw;
  height: 100vh;
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

.footer-ai-tips {
  display: flex;
  justify-content: center;
  font-size: 12px;
  line-height: 16px;
  color: #a2abbd;
  margin: 8px 0 12px;
}
</style>

