<script setup lang="ts">
import { ref } from 'vue'

interface LoginUser {
  id: string
  username: string
  avatar: string
}

const emit = defineEmits<{
  login: [data: { token: string; user: LoginUser }]
  goRegister: []
}>()

const username = ref('')
const password = ref('')
const loading = ref(false)
const errorMsg = ref('')

async function handleLogin() {
  const user = username.value.trim()
  const pass = password.value.trim()

  if (!user || !pass) {
    errorMsg.value = '请输入账号和密码'
    return
  }

  loading.value = true
  errorMsg.value = ''

  try {
    const res = await fetch('http://localhost:3000/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass }),
    })

    const data = await res.json()

    if (data.code !== 0) {
      errorMsg.value = data.message || '登录失败'
      return
    }

    emit('login', data.data)
  } catch (e) {
    errorMsg.value = '网络错误: ' + (e as Error).message
  } finally {
    loading.value = false
  }
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    handleLogin()
  }
}
</script>

<template>
  <div class="login-overlay">
    <div class="login-container">
      <div class="login-card">
        <h2 class="login-title">ChatAI</h2>
        <p class="login-subtitle">登录以开始使用</p>

        <div class="login-form">
          <div class="form-item">
            <input
              v-model="username"
              type="text"
              class="form-input"
              placeholder="请输入账号"
              autocomplete="username"
              @keydown="handleKeyDown"
            />
          </div>
          <div class="form-item">
            <input
              v-model="password"
              type="password"
              class="form-input"
              placeholder="请输入密码"
              autocomplete="current-password"
              @keydown="handleKeyDown"
            />
          </div>

          <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>

          <button
            class="login-btn"
            :class="{ loading }"
            :disabled="loading"
            @click="handleLogin"
          >
            {{ loading ? '登录中...' : '登录' }}
          </button>

          <div class="switch-link">
            还没有账号？<span class="link" @click="$emit('goRegister')">立即注册</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  background: #f5f7fb;
}

.login-container {
  width: 100%;
  max-width: 400px;
  padding: 0 24px;
}

.login-card {
  background: #fff;
  border-radius: 12px;
  padding: 48px 36px;
  box-shadow: 0 0 30px 0 rgba(0, 0, 0, 0.08);
}

.login-title {
  margin: 0 0 8px;
  font-size: 24px;
  font-weight: 600;
  color: #030b1a;
  text-align: center;
}

.login-subtitle {
  margin: 0 0 32px;
  font-size: 14px;
  color: #8c8c8c;
  text-align: center;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-item {
  width: 100%;
}

.form-input {
  width: 100%;
  height: 48px;
  padding: 0 16px;
  border: 1px solid #e4e9f1;
  border-radius: 10px;
  font-size: 14px;
  color: #030b1a;
  background: #f5f7fb;
  outline: none;
  transition: border-color 0.2s;
  box-sizing: border-box;
}

.form-input:focus {
  border-color: #1677ff;
  background: #fff;
}

.form-input::placeholder {
  color: #bfbfbf;
}

.error-msg {
  font-size: 13px;
  color: #e64340;
  text-align: center;
}

.login-btn {
  width: 100%;
  height: 48px;
  border: none;
  border-radius: 10px;
  background: #030b1a;
  color: #fff;
  font-size: 16px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.2s;
  margin-top: 8px;
}

.login-btn:hover:not(.loading) {
  opacity: 0.9;
}

.login-btn.loading {
  opacity: 0.5;
  cursor: not-allowed;
}

.switch-link {
  text-align: center;
  font-size: 13px;
  color: #8c8c8c;
  margin-top: 4px;
}

.link {
  color: #1677ff;
  cursor: pointer;
}

.link:hover {
  text-decoration: underline;
}
</style>
