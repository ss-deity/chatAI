<script lang="ts">
export interface ChartArtifact {
  id: string
  title: string
  /** 服务端最终采用的图表类型，仅用于展示与下载文件名 */
  chartType: string
  sheetName: string
  fileName: string
  /** 完整的 ECharts option，原样交给 echarts.setOption */
  option: Record<string, unknown>
}
</script>

<script setup lang="ts">
/**
 * 会话内的 ECharts 图表卡片。
 *
 * 组件不关心图表类型：直接把服务端给的 option 交给 echarts.setOption，
 * 因此柱/线/饼/散点/雷达/漏斗/地图等任意 ECharts 图表都能渲染。
 * 这里用完整包 `echarts` 而不是按需注册，避免新增图表类型时还要回来改注册表。
 */
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import * as echarts from 'echarts'
import { ElMessage } from 'element-plus'
import ChartTools, { type ChartAction } from './ChartTools.vue'
import { normalizeOption } from './normalizeOption'
import {
  CHART_THEME_NAME,
  currentChartTheme,
  exportBackground,
  registerChartThemes,
  type ChartTheme,
} from './theme'

const props = defineProps<{ chart: ChartArtifact }>()

registerChartThemes()

const boxRef = ref<HTMLDivElement | null>(null)
const zoomBoxRef = ref<HTMLDivElement | null>(null)
const zoomed = ref(false)
/** 当前生效的图表主题，跟随 <html data-theme> */
const theme = ref<ChartTheme>(currentChartTheme())

/** echarts 实例不需要深响应，用 shallowRef 避免 Vue 代理内部大量对象 */
const instance = shallowRef<echarts.ECharts | null>(null)
const zoomInstance = shallowRef<echarts.ECharts | null>(null)
let observer: ResizeObserver | null = null
let themeObserver: MutationObserver | null = null

function mount(el: HTMLDivElement): echarts.ECharts {
  // 主题只能在 init 时指定，换主题必须销毁重建
  const chart = echarts.init(el, CHART_THEME_NAME[theme.value])
  // 统一补齐 tooltip confine、剥离写死的颜色，兼容历史落库的老 option
  chart.setOption(normalizeOption(props.chart.option, theme.value), true)
  return chart
}

function renderMain(el: HTMLDivElement | null) {
  instance.value?.dispose()
  instance.value = null
  observer?.disconnect()
  observer = null
  if (!el) return

  instance.value = mount(el)
  // 侧边栏收放、窗口缩放、消息区宽度变化都要跟着重绘
  observer = new ResizeObserver(() => instance.value?.resize())
  observer.observe(el)
}

watch(boxRef, (el) => renderMain(el), { immediate: true })

// 历史回显时同一个组件实例可能被复用到另一张图上
watch(
  () => props.chart.option,
  (option) => {
    const next = normalizeOption(option, theme.value)
    instance.value?.setOption(next, true)
    zoomInstance.value?.setOption(next, true)
  },
)

onMounted(() => {
  // Settings 面板换肤是直接改 <html data-theme>，这里监听后重建实例换色
  themeObserver = new MutationObserver(() => {
    const next = currentChartTheme()
    if (next === theme.value) return
    theme.value = next
    renderMain(boxRef.value)
    if (zoomed.value && zoomBoxRef.value) {
      zoomInstance.value?.dispose()
      zoomInstance.value = mount(zoomBoxRef.value)
    }
  })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
})

onBeforeUnmount(() => {
  observer?.disconnect()
  themeObserver?.disconnect()
  instance.value?.dispose()
  zoomInstance.value?.dispose()
})

function download() {
  const chart = zoomed.value ? zoomInstance.value : instance.value
  if (!chart) return
  try {
    const url = chart.getDataURL({
      type: 'png',
      pixelRatio: 2,
      // 画布本身是透明的，导出必须显式给底色，否则暗色下是一片透明
      backgroundColor: exportBackground(theme.value),
    })
    const a = document.createElement('a')
    a.href = url
    a.download = `${props.chart.title || props.chart.chartType}.png`
    a.click()
  } catch (err) {
    console.error('图表下载失败', err)
    ElMessage.error('图表下载失败')
  }
}

async function openZoom() {
  zoomed.value = true
  await nextTick()
  const el = zoomBoxRef.value
  if (el) zoomInstance.value = mount(el)
}

function closeZoom() {
  zoomInstance.value?.dispose()
  zoomInstance.value = null
  zoomed.value = false
}

function handleAction(action: ChartAction) {
  if (action === 'zoom') void openZoom()
  else if (action === 'download') download()
  else closeZoom()
}
</script>

<template>
  <div class="chat-echarts">
    <div ref="boxRef" class="chat-echarts__canvas"></div>
    <!-- 底部条：左侧数据来源，右侧常驻的 icon 工具（hover 才浮出文案提示） -->
    <div class="chat-echarts__bar">
      <span class="chat-echarts__source" :title="`${chart.fileName} · ${chart.sheetName}`">
        {{ chart.fileName }} · {{ chart.sheetName }}
      </span>
      <ChartTools :actions="['zoom', 'download']" @action="handleAction" />
    </div>

    <!-- 放大预览：独立实例，关闭即销毁，避免两份实例长期共存 -->
    <div v-if="zoomed" class="chat-echarts__mask" @click.self="closeZoom">
      <div class="chat-echarts__dialog">
        <div class="chat-echarts__dialog-head">
          <span class="chat-echarts__dialog-title">{{ chart.title }}</span>
          <ChartTools
            :actions="['download', 'close']"
            tip-placement="bottom"
            @action="handleAction"
          />
        </div>
        <div ref="zoomBoxRef" class="chat-echarts__canvas chat-echarts__canvas--large"></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-echarts {
  position: relative;
  margin: 10px 0;
  padding: 4px 4px 0;
  border: 1px solid var(--gf-border);
  border-radius: 10px;
  background: var(--gf-bg-panel);
  box-shadow: 0 1px 2px rgba(31, 39, 51, 0.04);
}

.chat-echarts__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 34px;
  /* 右侧留窄一些：icon 按钮自带内边距，视觉上才和左侧文字对齐 */
  padding: 0 6px 0 10px;
}

.chat-echarts__source {
  font-size: 12px;
  color: var(--gf-text-disabled);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-echarts__canvas {
  width: 100%;
  height: 320px;
}

.chat-echarts__canvas--large {
  height: min(72vh, 720px);
  margin-top: 16px;
}

.chat-echarts__mask {
  position: fixed;
  inset: 0;
  z-index: 3000;
  background: var(--gf-bg-mask);
  display: flex;
  align-items: center;
  justify-content: center;
}

.chat-echarts__dialog {
  width: min(1080px, 92vw);
  padding-bottom: 24px;
  background: var(--gf-bg-panel);
  border-radius: 10px;
  box-shadow: var(--gf-shadow-dialog);
}

.chat-echarts__dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px 10px 16px;
  border-bottom: 1px solid var(--gf-divider);
}

.chat-echarts__dialog-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--gf-text-primary);
}
</style>
