<script setup lang="ts">
import { ref } from 'vue'

interface RegisterUser {
  id: string
  username: string
  avatar: string
}

const emit = defineEmits<{
  register: [data: { token: string; user: RegisterUser }]
  goLogin: []
}>()

const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const loading = ref(false)
const errorMsg = ref('')

async function handleRegister() {
  const user = username.value.trim()
  const pass = password.value.trim()
  const confirmPass = confirmPassword.value.trim()

  if (!user || !pass) {
    errorMsg.value = '请输入账号和密码'
    return
  }

  if (pass !== confirmPass) {
    errorMsg.value = '两次密码输入不一致'
    return
  }

  if (pass.length < 6) {
    errorMsg.value = '密码长度不能少于6位'
    return
  }

  loading.value = true
  errorMsg.value = ''

  try {
    const res = await fetch('http://localhost:3000/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass }),
    })

    const data = await res.json()

    if (data.code !== 0) {
      errorMsg.value = data.message || '注册失败'
      return
    }

    emit('register', data.data)
  } catch (e) {
    errorMsg.value = '网络错误: ' + (e as Error).message
  } finally {
    loading.value = false
  }
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    handleRegister()
  }
}
</script>

<template>
  <div class="register-overlay">
    <div class="register-container">
      <div class="register-card">
        <h2 class="register-title">ChatAI</h2>
        <p class="register-subtitle">注册新账号</p>

        <div class="register-form">
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
              placeholder="请输入密码（至少6位）"
              autocomplete="new-password"
              @keydown="handleKeyDown"
            />
          </div>
          <div class="form-item">
            <input
              v-model="confirmPassword"
              type="password"
              class="form-input"
              placeholder="请确认密码"
              autocomplete="new-password"
              @keydown="handleKeyDown"
            />
          </div>

          <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>

          <button
            class="register-btn"
            :class="{ loading }"
            :disabled="loading"
            @click="handleRegister"
          >
            {{ loading ? '注册中...' : '注册' }}
          </button>

          <div class="switch-link">
            已有账号？<span class="link" @click="$emit('goLogin')">返回登录</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.register-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  background: #f5f7fb;
}

.register-container {
  width: 100%;
  max-width: 400px;
  padding: 0 24px;
}

.register-card {
  background: #fff;
  border-radius: 12px;
  padding: 48px 36px;
  box-shadow: 0 0 30px 0 rgba(0, 0, 0, 0.08);
}

.register-title {
  margin: 0 0 8px;
  font-size: 24px;
  font-weight: 600;
  color: #030b1a;
  text-align: center;
}

.register-subtitle {
  margin: 0 0 32px;
  font-size: 14px;
  color: #8c8c8c;
  text-align: center;
}

.register-form {
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

.register-btn {
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

.register-btn:hover:not(.loading) {
  opacity: 0.9;
}

.register-btn.loading {
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
