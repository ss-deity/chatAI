<script setup lang="ts">
/**
 * 会话等待指示器。
 * 交互参考 pc-genflow-pro 的等待样式：一个旋转的渐变环 + 一句状态文案，
 * 等待时间偏长时补一个已等待秒数，避免用户以为接口挂了。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 状态文案 */
    label?: string
    /** 本次生成的开始时间戳，用于计算已等待时长 */
    startAt?: number
    /** 超过多少秒才显示已等待时长 */
    hintAfter?: number
  }>(),
  { label: '正在思考', hintAfter: 5 },
)

const seconds = ref(0)
let timer: number | undefined

function tick() {
  seconds.value = props.startAt
    ? Math.floor((Date.now() - props.startAt) / 1000)
    : 0
}

function start() {
  stop()
  tick()
  timer = window.setInterval(tick, 1000)
}

function stop() {
  if (timer) {
    clearInterval(timer)
    timer = undefined
  }
}

watch(() => props.startAt, start, { immediate: true })
onBeforeUnmount(stop)

/** 等待偏久才显示秒数：短等待时冒出计时反而让人焦虑 */
const elapsed = computed(() =>
  seconds.value >= props.hintAfter ? `已等待 ${seconds.value}s` : '',
)
</script>

<template>
  <div class="chat-loading">
    <span class="chat-loading__ring">
      <svg width="100%" height="100%" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="chat-loading-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color: #818999; stop-opacity: 1"></stop>
            <stop offset="100%" style="stop-color: #818999; stop-opacity: 0"></stop>
          </linearGradient>
        </defs>
        <circle
          cx="100"
          cy="100"
          r="80"
          stroke="url(#chat-loading-gradient)"
          stroke-width="12"
          fill="none"
        ></circle>
      </svg>
    </span>
    <span class="chat-loading__text">{{ label }}</span>
    <span v-if="elapsed" class="chat-loading__elapsed">{{ elapsed }}</span>
  </div>
</template>

<style scoped>
.chat-loading {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #606a78;
}

.chat-loading__ring {
  display: inline-block;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  animation: chat-loading-spin 1s linear infinite;
}

.chat-loading__text {
  animation: chat-loading-breath 1.6s ease-in-out infinite;
}

.chat-loading__elapsed {
  color: #a1a1aa;
  font-size: 12px;
}

@keyframes chat-loading-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@keyframes chat-loading-breath {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
}
</style>
