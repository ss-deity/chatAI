<script lang="ts">
export interface ToolCall {
  id: string
  name: string
  /** running=正在执行，done=执行完成，failed=执行中断（会话报错时置为该态） */
  status: 'running' | 'done' | 'failed'
}
</script>

<script setup lang="ts">
/**
 * 工具调用状态展示。
 * 样式与交互参考 enterprise-ai-chat-components 的 WpGenflowRobotToolCallInfo：
 * 左侧状态图标（执行中为渐变环旋转，完成为对勾），右侧固定文案「工具调用：<工具名>」。
 */
import succeedIcon from '../../assets/tool/succeed-icon.svg'

defineProps<{ tools: ToolCall[] }>()

/** 每个实例独立的渐变 id，避免多个 loading 共存时 id 冲突 */
const gradientId = `tool-call-spin-${Math.random().toString(36).slice(2, 11)}`
</script>

<template>
  <div v-if="tools.length" class="tool-call-info">
    <div
      v-for="(item, index) in tools"
      :key="`${item.id}-${index}`"
      class="tool-call-info__item"
    >
      <span class="tool-call-info__status">
        <!-- 执行完成 -->
        <img
          v-if="item.status === 'done'"
          class="tool-call-info__icon"
          :src="succeedIcon"
          alt=""
        />
        <!-- 执行中断 -->
        <svg
          v-else-if="item.status === 'failed'"
          class="tool-call-info__icon"
          viewBox="0 0 16 16"
          fill="none"
        >
          <circle cx="8" cy="8" r="6.6" stroke="#e64340" stroke-width="1.4" />
          <path
            d="M8 4.8v4M8 10.9v.5"
            stroke="#e64340"
            stroke-width="1.5"
            stroke-linecap="round"
          />
        </svg>
        <!-- 正在执行：线性渐变环 + 旋转动画 -->
        <div
          v-else
          class="tool-call-info__icon tool-call-info__icon--loading"
        >
          <svg
            width="100%"
            height="100%"
            viewBox="0 0 200 200"
            preserveAspectRatio="xMidYMid meet"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <linearGradient :id="gradientId" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color: #818999; stop-opacity: 1"></stop>
                <stop offset="100%" style="stop-color: #818999; stop-opacity: 0"></stop>
              </linearGradient>
            </defs>
            <circle
              cx="100"
              cy="100"
              r="80"
              :stroke="`url(#${gradientId})`"
              stroke-width="10"
              fill="none"
            ></circle>
          </svg>
        </div>
      </span>
      <span class="tool-call-info__text">工具调用：{{ item.name }}</span>
      <span v-if="item.status === 'failed'" class="tool-call-info__failed">已中断</span>
    </div>
  </div>
</template>

<style scoped>
.tool-call-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 400;
  color: #495366;
}

.tool-call-info__item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
}

.tool-call-info__text {
  color: #606a78;
}

.tool-call-info__failed {
  color: var(--gf-danger, #e64340);
  font-size: 12px;
}

.tool-call-info__status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #818999;
  font-size: 12px;
}

.tool-call-info__icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.tool-call-info__icon--loading {
  display: inline-block;
  animation: tool-call-info-spin 1s linear infinite;
}

@keyframes tool-call-info-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
