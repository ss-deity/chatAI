<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'

interface UserInfo {
  id: string
  uid: string
  username: string
  nickname: string
  avatar: string
}

const props = defineProps<{
  user: UserInfo | null
}>()

const emit = defineEmits<{
  close: []
  updateUser: [user: UserInfo]
}>()

const nickname = ref(props.user?.nickname || props.user?.username || '')
const uploading = ref(false)
const savingNickname = ref(false)
const theme = ref<'light' | 'dark'>(
  (document.documentElement.getAttribute('data-theme') as 'light' | 'dark') || 'light'
)

// 头像上传约束
const AVATAR_MAX_SIZE = 5 * 1024 * 1024 // 5MB
const AVATAR_ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
])
const AVATAR_ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'webp']

function isAllowedAvatar(file: File): boolean {
  const mime = (file.type || '').toLowerCase()
  if (mime && AVATAR_ALLOWED_MIME.has(mime)) return true
  // 部分系统 file.type 为空时兜底看扩展名
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return AVATAR_ALLOWED_EXT.includes(ext)
}

onMounted(() => {
  nickname.value = props.user?.nickname || props.user?.username || ''
})

async function handleAvatarChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !props.user) return

  // 客户端格式校验
  if (!isAllowedAvatar(file)) {
    ElMessage.error('仅支持 jpg / jpeg / png / webp 格式')
    input.value = ''
    return
  }

  // 客户端大小校验
  if (file.size > AVATAR_MAX_SIZE) {
    ElMessage.error('文件大小 ≤ 5MB')
    input.value = ''
    return
  }

  uploading.value = true
  try {
    const formData = new FormData()
    formData.append('file', file)

    const res = await fetch(`/api/upload/avatar/${props.user.id}`, {
      method: 'POST',
      body: formData,
    })

    // 服务端 Multer 超限时返回 413
    if (res.status === 413) {
      ElMessage.error('文件大小 ≤ 5MB')
      return
    }

    const data = await res.json().catch(() => null)

    if (data && data.code === 0 && data.data?.url) {
      emit('updateUser', { ...props.user, avatar: data.data.url })
      ElMessage.success('头像已更新')
    } else {
      ElMessage.error((data && data.message) || '头像上传失败')
    }
  } catch (err) {
    console.error('头像上传失败', err)
    ElMessage.error('头像上传失败')
  } finally {
    uploading.value = false
    input.value = ''
  }
}

async function handleNicknameSave() {
  const name = nickname.value.trim()
  if (!props.user) return
  const current = props.user.nickname || props.user.username
  // 未变化或空则不请求
  if (!name || name === current) {
    nickname.value = current
    return
  }
  if (savingNickname.value) return

  savingNickname.value = true
  try {
    const res = await fetch(`/api/users/${props.user.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: name }),
    })
    const data = await res.json()
    if (data.code !== 0 || !data.data) {
      ElMessage.error(data.message || '名称更新失败')
      nickname.value = current
      return
    }
    emit('updateUser', data.data)
    nickname.value = data.data.nickname || data.data.username
    ElMessage.success('名称已更新')
  } catch (err) {
    console.error('名称更新失败', err)
    ElMessage.error('名称更新失败')
    nickname.value = current
  } finally {
    savingNickname.value = false
  }
}

function selectTheme(t: 'light' | 'dark') {
  theme.value = t
  document.documentElement.setAttribute('data-theme', t)
  localStorage.setItem('chatai_theme', t)
}
</script>

<template>
  <div class="settings-overlay" @click.self="$emit('close')">
    <div class="settings-dialog">
      <div class="settings-header">
        <span class="settings-title">设置</span>
        <button class="close-btn" @click="$emit('close')">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
      </div>

      <div class="settings-body">
        <div class="settings-section-title">常规设置</div>

        <!-- 头像 -->
        <div class="setting-row">
          <span class="setting-label">头像</span>
          <div class="setting-content">
            <label class="avatar-upload" :class="{ uploading }">
              <div class="avatar-preview">
                <img v-if="props.user?.avatar" :src="props.user.avatar" alt="avatar" />
                <svg v-else width="40" height="40" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="8" r="4" fill="#bfbfbf"/>
                  <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" fill="#bfbfbf"/>
                </svg>
              </div>
              <div class="avatar-hover">
                <svg v-if="!uploading" width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M11.3 2.7a1 1 0 011.4 0l.6.6a1 1 0 010 1.4L5.6 12.4l-2.4.6.6-2.4 7.5-7.9z" stroke="#fff" stroke-width="1.2"/>
                </svg>
                <svg v-else width="16" height="16" viewBox="0 0 16 16" fill="none" class="spin">
                  <circle cx="8" cy="8" r="6" stroke="#fff" stroke-width="2" stroke-dasharray="28" stroke-dashoffset="8" stroke-linecap="round"/>
                </svg>
              </div>
              <input type="file" accept="image/jpeg,image/png,image/webp" hidden @change="handleAvatarChange" />
            </label>
          </div>
        </div>

        <!-- 名称 -->
        <div class="setting-row">
          <span class="setting-label">名称</span>
          <div class="setting-content">
            <input
              v-model="nickname"
              class="nickname-input"
              maxlength="20"
              placeholder="请输入名称"
              @blur="handleNicknameSave"
              @keydown.enter="handleNicknameSave"
            />
          </div>
        </div>

        <!-- 账号（登录用，只读） -->
        <div class="setting-row">
          <span class="setting-label">账号</span>
          <div class="setting-content">
            <span class="account-text">{{ props.user?.username || '-' }}</span>
          </div>
        </div>

        <!-- 外观 -->
        <div class="setting-row theme-row">
          <span class="setting-label">外观</span>
          <div class="setting-content">
            <div class="theme-picker">
              <div
                class="theme-card"
                :class="{ active: theme === 'light' }"
                @click="selectTheme('light')"
              >
                <div class="theme-preview light-preview"></div>
                <span class="theme-name">浅色</span>
              </div>
              <div
                class="theme-card"
                :class="{ active: theme === 'dark' }"
                @click="selectTheme('dark')"
              >
                <div class="theme-preview dark-preview"></div>
                <span class="theme-name">深色</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: grid;
  place-items: center;
  background: var(--gf-bg-mask);
  backdrop-filter: blur(4px);
}

.settings-dialog {
  width: min(92vw, 520px);
  max-height: min(90vh, 600px);
  background: var(--gf-bg-panel);
  border: 1px solid var(--gf-border);
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: var(--gf-shadow-dialog);
  color: var(--gf-text-primary);
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px 16px;
  flex-shrink: 0;
}

.settings-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--gf-text-primary);
}

.close-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--gf-text-secondary);
  transition: background 0.15s, color 0.15s;
}

.close-btn:hover {
  background: var(--gf-bg-elevated);
  color: var(--gf-text-primary);
}

.settings-body {
  padding: 0 24px 24px;
  overflow-y: auto;
  flex: 1;
}

.settings-section-title {
  font-size: 13px;
  color: var(--gf-text-tertiary);
  margin-bottom: 16px;
}

.setting-row {
  display: flex;
  align-items: center;
  padding: 14px 0;
  border-bottom: 1px solid var(--gf-divider);
}

.setting-row:first-of-type {
  border-top: 1px solid var(--gf-divider);
}

.setting-label {
  width: 60px;
  font-size: 14px;
  color: var(--gf-text-regular);
  flex-shrink: 0;
}

.setting-content {
  flex: 1;
}

/* 头像上传 */
.avatar-upload {
  position: relative;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  overflow: hidden;
  cursor: pointer;
  display: block;
}

.avatar-upload.uploading {
  pointer-events: none;
  opacity: 0.7;
}

.avatar-upload.uploading .avatar-hover {
  opacity: 1;
}

.avatar-preview {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--gf-bg-elevated);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.avatar-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-hover {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.15s;
  border-radius: 50%;
}

.avatar-upload:hover .avatar-hover {
  opacity: 1;
}

.spin {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* 名称输入 */
.nickname-input {
  width: 220px;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--gf-border-strong);
  background: var(--gf-bg-input);
  border-radius: 8px;
  font-size: 14px;
  color: var(--gf-text-primary);
  outline: none;
  transition: border-color 0.2s, background-color 0.2s;
  box-sizing: border-box;
}

.nickname-input:focus {
  border-color: var(--gf-primary);
  background: var(--gf-bg-panel);
}

.account-text {
  display: inline-block;
  padding: 6px 0;
  font-size: 14px;
  color: var(--gf-text-secondary);
  user-select: text;
}

/* 主题选择 */
.theme-row {
  align-items: flex-start;
}

.theme-row .setting-label {
  margin-top: 12px;
}

.theme-picker {
  display: grid;
  grid-template-columns: repeat(2, 120px);
  gap: 12px;
}

.theme-card {
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.theme-preview {
  width: 120px;
  height: 80px;
  border-radius: 8px;
  border: 2px solid transparent;
  transition: border-color 0.15s;
}

.light-preview {
  background: linear-gradient(135deg, #fff 40%, #f5f7fa 100%);
  border-color: #e4e9f1;
}

.dark-preview {
  background: linear-gradient(135deg, #1a2540 40%, #16213e 100%);
  border-color: #2c3a52;
}

.theme-card.active .theme-preview {
  border-color: var(--gf-primary);
  box-shadow: 0 0 0 3px var(--gf-primary-bg);
}

.theme-name {
  font-size: 13px;
  color: var(--gf-text-secondary);
}

.theme-card.active .theme-name {
  color: var(--gf-primary);
  font-weight: 500;
}
</style>
