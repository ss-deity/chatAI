<script lang="ts">
export interface FlowchartNode {
  id: string
  label: string
  /** 节点语义，决定形状与配色 */
  type: FlowNodeType
  /** hover 时展示的补充说明 */
  description?: string
}

export interface FlowchartEdge {
  source: string
  target: string
  label?: string
}

export interface FlowchartArtifact {
  id: string
  title: string
  direction: 'TB' | 'LR'
  nodes: FlowchartNode[]
  edges: FlowchartEdge[]
}
</script>

<script setup lang="ts">
/**
 * 会话内的流程图卡片（AntV G6）。
 *
 * 服务端只给节点与连线，层级坐标由 G6 的 antv-dagre 布局在前端算：
 * 落库的产物因此与画布尺寸无关，换主题、改窗口宽度都只是重新布局一次，不用回服务端。
 *
 * 画布内滚轮默认不缩放（要按住 Ctrl），否则鼠标经过卡片时会把页面滚动吃掉——
 * 和 ChatEcharts 里禁用 dataZoom.inside 是同一个原因；放大弹窗里才放开滚轮缩放。
 */
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Graph } from '@antv/g6'
import { ElMessage } from 'element-plus'
import ChartTools, { type ChartAction } from '../ChatEcharts/ChartTools.vue'
import {
  currentFlowTheme,
  flowTokens,
  labelMaxWidth,
  radiusOf,
  shapeOf,
  sizeOf,
  type FlowNodeType,
  type FlowTheme,
} from './theme'

const props = defineProps<{ flowchart: FlowchartArtifact }>()

/** 手动缩放的步长与上下限：一次点击走 0.1，避免按钮点一下跳一大截 */
const ZOOM_STEP = 0.1
const ZOOM_MIN = 0.2
const ZOOM_MAX = 3

const boxRef = ref<HTMLDivElement | null>(null)
const zoomBoxRef = ref<HTMLDivElement | null>(null)
const zoomed = ref(false)
const theme = ref<FlowTheme>(currentFlowTheme())
/** 当前缩放比例，展示在底部条上（滚轮缩放也会同步） */
const zoomLevel = ref(1)

/** G6 实例内部对象很多，用 shallowRef 避免被 Vue 深度代理 */
const graph = shallowRef<Graph | null>(null)
const zoomGraph = shallowRef<Graph | null>(null)
let observer: ResizeObserver | null = null
let themeObserver: MutationObserver | null = null
/** 挂了 wheel 兜底监听的卡片容器，重建/卸载时要摘掉 */
let wheelGuardEl: HTMLDivElement | null = null

/**
 * 卡片高度按节点数估算：布局前拿不到实际层数，宁可给足高度，
 * 真超出时 autoFit 会整体缩放，比给矮了被裁掉更好。
 */
function canvasHeight(): number {
  const count = props.flowchart.nodes.length
  return props.flowchart.direction === 'LR'
    ? Math.min(520, Math.max(240, 140 + count * 20))
    : Math.min(560, Math.max(260, 60 + count * 52))
}

function nodeType(datum: any): FlowNodeType {
  return (datum?.data?.type as FlowNodeType) || 'process'
}

function nodeLabel(datum: any): string {
  return String(datum?.data?.label ?? '')
}

function graphData() {
  return {
    nodes: props.flowchart.nodes.map((n) => ({
      id: n.id,
      data: { label: n.label, type: n.type, description: n.description },
    })),
    edges: props.flowchart.edges.map((e, i) => ({
      // 同一对节点之间可能有多条连线（如判断分支回流），id 里带下标保证唯一
      id: `${e.source}->${e.target}#${i}`,
      source: e.source,
      target: e.target,
      data: { label: e.label },
    })),
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 创建一个 G6 实例；wheelZoom=true 时滚轮直接缩放（仅放大弹窗用） */
function mount(el: HTMLDivElement, wheelZoom: boolean): Graph {
  const t = flowTokens(theme.value)

  const instance = new Graph({
    container: el,
    // 尺寸由外层 ResizeObserver 驱动，autoResize 会再监听一遍 window，重复
    autoResize: false,
    background: t.background,
    padding: 12,
    autoFit: { type: 'view', options: { when: 'always', direction: 'both' } },
    zoomRange: [ZOOM_MIN, ZOOM_MAX],
    data: graphData(),
    layout: {
      type: 'antv-dagre',
      rankdir: props.flowchart.direction,
      nodesep: 24,
      ranksep: 40,
      // 折线要用 dagre 算好的拐点，否则会斜穿过其他节点
      controlPoints: true,
    },
    node: {
      type: (d: any) => shapeOf(nodeType(d)),
      style: {
        size: (d: any) => sizeOf(nodeLabel(d), nodeType(d)),
        radius: (d: any) => radiusOf(nodeType(d)),
        fill: (d: any) => t.node[nodeType(d)].fill,
        stroke: (d: any) => t.node[nodeType(d)].stroke,
        lineWidth: 1,
        // 搜索高亮用外发光实现，基础样式必须显式给出 0 值：
        // G6 取消状态时只会回填基础样式里存在的属性，缺省的发光会残留在节点上
        shadowColor: 'transparent',
        shadowBlur: 0,
        labelText: (d: any) => nodeLabel(d),
        labelPlacement: 'center',
        labelFill: (d: any) => t.node[nodeType(d)].text,
        labelFontSize: 12,
        labelTextAlign: 'center',
        labelWordWrap: true,
        labelMaxLines: 3,
        labelMaxWidth: (d: any) => {
          const type = nodeType(d)
          return labelMaxWidth(sizeOf(nodeLabel(d), type)[0], type)
        },
      },
      // 搜索命中态：加粗描边 + 外发光，节点填充保持原样以免看不清文字
      state: {
        highlight: {
          stroke: t.highlight,
          lineWidth: 3,
          shadowColor: t.highlight,
          shadowBlur: 12,
        },
      },
    },
    edge: {
      type: 'polyline',
      style: {
        radius: 6,
        stroke: t.edge,
        lineWidth: 1.2,
        endArrow: true,
        endArrowSize: 8,
        labelText: (d: any) => String(d?.data?.label ?? ''),
        labelFill: t.edgeLabel,
        labelFontSize: 11,
        // 默认会跟着连线方向旋转，TB 布局下「是/否」会立起来，读不了
        labelAutoRotate: false,
        labelBackground: true,
        labelBackgroundFill: t.edgeLabelBg,
        labelBackgroundRadius: 3,
        labelPadding: [1, 4],
      },
    },
    behaviors: [
      'drag-canvas',
      // 滚轮缩放要按住 Ctrl，避免抢走页面滚动
      {
        type: 'zoom-canvas',
        trigger: wheelZoom ? undefined : (['Control'] as string[]),
        // G6 的 zoom-canvas 会无条件 preventDefault 画布上的 wheel，
        // 卡片里那样会把会话列表的滚动一起吃掉；这里关掉，改由 guardWheel 只拦 Ctrl+滚轮
        preventDefault: wheelZoom,
        onFinish: () => syncZoomLevel(),
      },
    ],
    plugins: [
      {
        type: 'tooltip',
        trigger: 'hover',
        // 只有带 description 的节点才浮出说明，其余 hover 不弹空框
        enable: (_e: any, items: any[]) => Boolean(items?.[0]?.data?.description),
        getContent: (_e: any, items: any[]) => {
          const data = items?.[0]?.data ?? {}
          const label = escapeHtml(String(data.label ?? ''))
          const desc = escapeHtml(String(data.description ?? ''))
          return Promise.resolve(
            `<div class="chat-flowchart__tip"><b>${label}</b><p>${desc}</p></div>`,
          )
        },
      },
    ],
  })

  // 初始化后主动整体适配一次：大图默认要能一眼看全，不能有内容被裁在视口外
  void instance.render().then(async () => {
    if (instance.destroyed) return
    await instance.fitView({ when: 'always', direction: 'both' })
    syncZoomLevel()
  })
  return instance
}

/** 当前生效的实例：放大弹窗打开时操作弹窗里的那张 */
function activeGraph(): Graph | null {
  const instance = zoomed.value ? zoomGraph.value : graph.value
  return instance && !instance.destroyed ? instance : null
}

function syncZoomLevel() {
  const instance = activeGraph()
  if (instance) zoomLevel.value = instance.getZoom()
}

/** 按固定步长缩放，并夹在 zoomRange 内 */
async function stepZoom(delta: number) {
  const instance = activeGraph()
  if (!instance) return
  const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, instance.getZoom() + delta))
  await instance.zoomTo(Number(next.toFixed(2)))
  syncZoomLevel()
}

async function fitAll() {
  const instance = activeGraph()
  if (!instance) return
  await instance.fitView({ when: 'always', direction: 'both' })
  syncZoomLevel()
}

/**
 * 卡片内滚轮的兜底策略：
 * Ctrl+滚轮是画布缩放手势，阻止浏览器整页缩放；不带 Ctrl 的滚轮不拦，
 * 事件继续冒泡给会话列表滚动（G6 自己的 preventDefault 已在 mount 里关掉）。
 */
function guardWheel(e: WheelEvent) {
  if (e.ctrlKey) e.preventDefault()
}

function renderMain(el: HTMLDivElement | null) {
  graph.value?.destroy()
  graph.value = null
  observer?.disconnect()
  observer = null
  if (wheelGuardEl) {
    wheelGuardEl.removeEventListener('wheel', guardWheel)
    wheelGuardEl = null
  }
  if (!el) return

  graph.value = mount(el, false)
  el.addEventListener('wheel', guardWheel, { passive: false })
  wheelGuardEl = el
  // 侧边栏收放、窗口缩放都要重新适配画布
  observer = new ResizeObserver(() => {
    const instance = graph.value
    if (!instance || instance.destroyed) return
    instance.resize()
    void instance.fitView({ when: 'always', direction: 'both' }).then(() => syncZoomLevel())
  })
  observer.observe(el)
}

watch(boxRef, (el) => renderMain(el), { immediate: true })

// 历史回显时同一个组件实例可能被复用到另一张流程图上
watch(
  () => props.flowchart,
  () => renderMain(boxRef.value),
)

onMounted(() => {
  // Settings 面板换肤是直接改 html 的 data-theme，配色写在实例上，只能重建
  themeObserver = new MutationObserver(() => {
    const next = currentFlowTheme()
    if (next === theme.value) return
    theme.value = next
    renderMain(boxRef.value)
    if (zoomed.value && zoomBoxRef.value) {
      zoomGraph.value?.destroy()
      zoomGraph.value = mount(zoomBoxRef.value, true)
      // 换肤是重建实例，搜索高亮状态要在新实例上重放一次
      highlightedIds = []
      void runSearch()
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
  wheelGuardEl?.removeEventListener('wheel', guardWheel)
  wheelGuardEl = null
  graph.value?.destroy()
  zoomGraph.value?.destroy()
})

async function download() {
  const instance = zoomed.value ? zoomGraph.value : graph.value
  if (!instance) return
  try {
    // overall：导出整张图，而不是视口里能看见的那部分
    const url = await instance.toDataURL({ mode: 'overall', type: 'image/png' })
    const a = document.createElement('a')
    a.href = url
    a.download = `${props.flowchart.title || '流程图'}.png`
    a.click()
  } catch (err) {
    console.error('流程图下载失败', err)
    ElMessage.error('流程图下载失败')
  }
}

async function openZoom() {
  zoomed.value = true
  await nextTick()
  const el = zoomBoxRef.value
  if (el) zoomGraph.value = mount(el, true)
}

function closeZoom() {
  zoomGraph.value?.destroy()
  zoomGraph.value = null
  zoomed.value = false
  // 弹窗是独立实例，关闭即销毁，搜索态跟着清掉
  keyword.value = ''
  matchedIds.value = []
  highlightedIds = []
  syncZoomLevel()
}

/* --------------------------- 弹窗内节点搜索 --------------------------- */

/** 搜索关键字（实时生效，纯前端匹配，不回服务端） */
const keyword = ref('')
/** 当前命中的节点 id，按流程图里的原始顺序 */
const matchedIds = ref<string[]>([])
/** 上一次高亮的节点，换关键字时要先把它们的状态清掉 */
let highlightedIds: string[] = []

/**
 * 模糊匹配：节点标签与说明都参与，忽略大小写与首尾空白，
 * 命中规则是「包含关键字」，不做分词/拼音，保证结果可预期。
 */
function matchNodes(text: string): string[] {
  const kw = text.trim().toLowerCase()
  if (!kw) return []
  return props.flowchart.nodes
    .filter((n) => `${n.label} ${n.description ?? ''}`.toLowerCase().includes(kw))
    .map((n) => n.id)
}

/** 命中节点描边高亮，并把第一个命中节点移到视口正中 */
async function runSearch() {
  const instance = zoomGraph.value
  if (!instance || instance.destroyed) return
  const ids = matchNodes(keyword.value)
  matchedIds.value = ids
  const states: Record<string, string[]> = {}
  for (const id of highlightedIds) states[id] = []
  for (const id of ids) states[id] = ['highlight']
  highlightedIds = ids
  try {
    if (Object.keys(states).length) await instance.setElementState(states)
    if (ids.length) {
      await instance.focusElement(ids[0], { duration: 300, easing: 'ease-in-out' })
      syncZoomLevel()
    }
  } catch (err) {
    // 首帧渲染还没结束时状态设置会失败，下一次输入会重放，不用打扰用户
    console.error('流程图搜索高亮失败', err)
  }
}

watch(keyword, () => void runSearch())

function clearSearch() {
  keyword.value = ''
}

function handleAction(action: ChartAction) {
  if (action === 'zoom') void openZoom()
  else if (action === 'download') void download()
  else if (action === 'zoomIn') void stepZoom(ZOOM_STEP)
  else if (action === 'zoomOut') void stepZoom(-ZOOM_STEP)
  else if (action === 'fit') void fitAll()
  else closeZoom()
}
</script>

<template>
  <div class="chat-flowchart">
    <div ref="boxRef" class="chat-flowchart__canvas" :style="{ height: `${canvasHeight()}px` }"></div>
    <!-- 底部条：左侧标题与规模，右侧与图表卡片一致的 icon 工具 -->
    <div class="chat-flowchart__bar">
      <span class="chat-flowchart__source" :title="flowchart.title">
        {{ flowchart.title }} · {{ flowchart.nodes.length }} 个节点
      </span>
      <div class="chat-flowchart__actions">
        <span class="chat-flowchart__zoom">{{ Math.round(zoomLevel * 100) }}%</span>
        <ChartTools
          :actions="['zoomOut', 'zoomIn', 'fit', 'zoom', 'download']"
          @action="handleAction"
        />
      </div>
    </div>

    <!-- 放大预览：独立实例，关闭即销毁 -->
    <div v-if="zoomed" class="chat-flowchart__mask" @click.self="closeZoom">
      <div class="chat-flowchart__dialog">
        <div class="chat-flowchart__dialog-head">
          <span class="chat-flowchart__dialog-title">{{ flowchart.title }}</span>
          <div class="chat-flowchart__actions">
            <span class="chat-flowchart__zoom">{{ Math.round(zoomLevel * 100) }}%</span>
            <ChartTools
              :actions="['zoomOut', 'zoomIn', 'fit', 'download', 'close']"
              tip-placement="bottom"
              @action="handleAction"
            />
          </div>
        </div>
        <!-- 节点搜索：输入即匹配，命中节点高亮并居中 -->
        <div class="chat-flowchart__search">
          <div class="chat-flowchart__search-box">
            <svg class="chat-flowchart__search-icon" width="14" height="14" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="4.6" stroke="currentColor" stroke-width="1.3"/>
              <path d="M10.4 10.4L14 14" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
            </svg>
            <input
              v-model="keyword"
              class="chat-flowchart__search-input"
              placeholder="搜索节点名称或说明"
            />
            <button
              v-if="keyword"
              class="chat-flowchart__search-clear"
              title="清空"
              @click="clearSearch"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
              </svg>
            </button>
          </div>
          <span v-if="keyword" class="chat-flowchart__search-count">
            {{ matchedIds.length ? `命中 ${matchedIds.length} 个节点` : '无匹配节点' }}
          </span>
        </div>
        <div ref="zoomBoxRef" class="chat-flowchart__canvas chat-flowchart__canvas--large"></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-flowchart {
  position: relative;
  margin: 10px 0;
  padding: 4px 4px 0;
  border: 1px solid var(--gf-border);
  border-radius: 10px;
  background: var(--gf-bg-panel);
  box-shadow: 0 1px 2px rgba(31, 39, 51, 0.04);
}

.chat-flowchart__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 34px;
  padding: 0 6px 0 10px;
}

.chat-flowchart__source {
  font-size: 12px;
  color: var(--gf-text-disabled);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-flowchart__actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.chat-flowchart__zoom {
  min-width: 38px;
  text-align: right;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--gf-text-disabled);
}

.chat-flowchart__canvas {
  width: 100%;
  /* G6 的 canvas 绝对定位铺满容器，容器必须自己撑出高度 */
  position: relative;
  overflow: hidden;
  border-radius: 8px;
}

.chat-flowchart__canvas--large {
  height: min(72vh, 720px);
  margin-top: 12px;
}

.chat-flowchart__mask {
  position: fixed;
  inset: 0;
  z-index: 3000;
  background: var(--gf-bg-mask);
  display: flex;
  align-items: center;
  justify-content: center;
}

.chat-flowchart__dialog {
  width: min(1080px, 92vw);
  padding-bottom: 24px;
  background: var(--gf-bg-panel);
  border-radius: 10px;
  box-shadow: var(--gf-shadow-dialog);
}

.chat-flowchart__dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px 10px 16px;
  border-bottom: 1px solid var(--gf-divider);
}

.chat-flowchart__dialog-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--gf-text-primary);
}

/* 节点搜索条：输入框样式对齐弹窗里的 gf-rename-input（高度收窄一档） */
.chat-flowchart__search {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px 16px 0;
}

/* 只占弹窗宽度的约四分之一：搜索词都很短，铺满整行反而空 */
.chat-flowchart__search-box {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 260px;
  max-width: 100%;
  padding: 0 10px;
  height: 34px;
  border: 1px solid var(--gf-border-strong);
  border-radius: 10px;
  background: var(--gf-bg-panel);
  box-sizing: border-box;
}

.chat-flowchart__search-box:focus-within {
  border-color: var(--gf-primary);
}

.chat-flowchart__search-icon {
  flex-shrink: 0;
  color: var(--gf-text-tertiary);
}

.chat-flowchart__search-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: none;
  outline: none;
  background: transparent;
  font-size: 13px;
  font-family: inherit;
  color: var(--gf-text-primary);
}

.chat-flowchart__search-input::placeholder {
  color: var(--gf-text-disabled);
}

.chat-flowchart__search-clear {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--gf-text-tertiary);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.chat-flowchart__search-clear:hover {
  background: var(--gf-bg-elevated);
  color: var(--gf-text-primary);
}

.chat-flowchart__search-count {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--gf-text-tertiary);
}
</style>

<style>
/* tooltip 插件的浮层挂在画布容器里，scoped 选择器命中不到 */
.chat-flowchart__tip {
  max-width: 260px;
  font-size: 12px;
  line-height: 18px;
  color: var(--gf-text-primary);
}

.chat-flowchart__tip p {
  margin: 4px 0 0;
  color: var(--gf-text-tertiary);
}
</style>
