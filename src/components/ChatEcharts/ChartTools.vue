<script lang="ts">
export type ChartAction = 'zoom' | 'zoomIn' | 'zoomOut' | 'fit' | 'download' | 'close'
</script>

<script setup lang="ts">
/**
 * 图表卡片的 icon 工具条。
 *
 * 图标风格与 ImageCard 的下载/转存按钮保持一致（16px 线性 svg + currentColor），
 * 文案改成 hover 时浮出的气泡提示，常态只留图标，不占视觉重量。
 * 卡片底部条与放大弹窗头部共用这一个组件，图标只写一份。
 */
defineProps<{
  actions: ChartAction[]
  /** 气泡方向：默认向上；位于容器顶部（如弹窗头）时用 bottom，避免气泡飘到容器外 */
  tipPlacement?: 'top' | 'bottom'
}>()

const emit = defineEmits<{ (e: 'action', action: ChartAction): void }>()

const TIPS: Record<ChartAction, string> = {
  zoom: '放大预览',
  zoomIn: '放大',
  zoomOut: '缩小',
  fit: '适应画布',
  download: '下载为图片',
  close: '关闭',
}
</script>

<template>
  <div class="chart-tools" :class="`chart-tools--tip-${tipPlacement || 'top'}`">
    <button
      v-for="action in actions"
      :key="action"
      class="chart-tools__btn"
      type="button"
      :data-tip="TIPS[action]"
      :aria-label="TIPS[action]"
      @click.stop="emit('action', action)"
    >
      <!-- 放大预览：四角向外的扩张箭头 -->
      <svg v-if="action === 'zoom'" width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path
          d="M9.4 2.6h4v4M6.6 13.4h-4v-4M13.4 2.6l-4.6 4.6M2.6 13.4l4.6-4.6"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <!-- 按步长放大：放大镜 + 加号 -->
      <svg v-else-if="action === 'zoomIn'" width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.3" />
        <path
          d="M10.4 10.4L14 14M7 5.2v3.6M5.2 7h3.6"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linecap="round"
        />
      </svg>
      <!-- 按步长缩小：放大镜 + 减号 -->
      <svg v-else-if="action === 'zoomOut'" width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.3" />
        <path
          d="M10.4 10.4L14 14M5.2 7h3.6"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linecap="round"
        />
      </svg>
      <!-- 适应画布：四角向内收 -->
      <svg v-else-if="action === 'fit'" width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path
          d="M2.6 6.2v-3.6h3.6M13.4 6.2v-3.6h-3.6M2.6 9.8v3.6h3.6M13.4 9.8v3.6h-3.6"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <!-- 下载：与 ImageCard 的下载图标一致 -->
      <svg v-else-if="action === 'download'" width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path
          d="M4 6.7l4 4 4-4M8 10.7V2"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path
          d="M2.7 10v.7A2.3 2.3 0 005 13h6a2.3 2.3 0 002.3-2.3V10"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linecap="round"
        />
      </svg>
      <!-- 关闭 -->
      <svg v-else width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path
          d="M4 4l8 8M12 4l-8 8"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linecap="round"
        />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.chart-tools {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.chart-tools__btn {
  position: relative;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--gf-text-tertiary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease, color 0.15s ease;
}

.chart-tools__btn:hover {
  background: var(--gf-bg-elevated-hover);
  color: var(--gf-primary);
}

/* 气泡提示：纯 CSS 实现，避免为两个按钮引入组件库的 tooltip */
.chart-tools__btn::after {
  content: attr(data-tip);
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  padding: 3px 8px;
  border-radius: 4px;
  background: var(--gf-tooltip-bg);
  color: var(--gf-tooltip-text);
  font-size: 12px;
  line-height: 18px;
  white-space: nowrap;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.15s ease;
  pointer-events: none;
  z-index: 10;
}

.chart-tools--tip-top .chart-tools__btn::after {
  bottom: calc(100% + 6px);
}

.chart-tools--tip-bottom .chart-tools__btn::after {
  top: calc(100% + 6px);
}

.chart-tools__btn:hover::after {
  opacity: 1;
  visibility: visible;
}
</style>
