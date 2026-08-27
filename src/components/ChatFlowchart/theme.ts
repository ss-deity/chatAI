/**
 * 流程图（G6）的配色与取尺寸逻辑。
 *
 * G6 画在 canvas 上，拿不到 CSS 变量，所以和 ChatEcharts 一样在 JS 层按主题给一套色值，
 * 色值对齐 src/assets/theme.css 的 --gf-* 变量。
 *
 * 节点采用「浅底 + 同色描边 + 深色文字」，只有 start/end 用实色填充：
 * 整块实色铺满在会话流里视觉过重，浅底更贴合现有卡片风格。
 */

export type FlowTheme = 'light' | 'dark'

export type FlowNodeType = 'start' | 'end' | 'process' | 'decision' | 'io'

interface NodePalette {
  fill: string
  stroke: string
  text: string
}

interface FlowTokens {
  node: Record<FlowNodeType, NodePalette>
  /** 连线与箭头 */
  edge: string
  /** 连线文案 */
  edgeLabel: string
  /** 连线文案的底色（压住连线，避免文字和线重叠） */
  edgeLabelBg: string
  /** 导出 PNG 与画布底色（透明背景导出会变成黑块） */
  background: string
}

const TOKENS: Record<FlowTheme, FlowTokens> = {
  light: {
    node: {
      start: { fill: '#5b8ff9', stroke: '#5b8ff9', text: '#ffffff' },
      end: { fill: '#5d7092', stroke: '#5d7092', text: '#ffffff' },
      process: { fill: '#f2f6ff', stroke: '#a8c4fb', text: '#1f2733' },
      decision: { fill: '#fff7e6', stroke: '#f6bd16', text: '#7a4f01' },
      io: { fill: '#eefaf4', stroke: '#5ad8a6', text: '#12503a' },
    },
    edge: '#b6bfcc',
    edgeLabel: '#606a78',
    edgeLabelBg: '#ffffff',
    background: '#ffffff',
  },
  dark: {
    node: {
      start: { fill: '#3f6fd1', stroke: '#6ba1ff', text: '#f1f5f9' },
      end: { fill: '#47536b', stroke: '#8ea0c0', text: '#f1f5f9' },
      process: { fill: '#1e2b47', stroke: '#3f6fd1', text: '#e2e8f0' },
      decision: { fill: '#3a2f16', stroke: '#c9971a', text: '#f4d68a' },
      io: { fill: '#153429', stroke: '#3bb3b1', text: '#a7e9cd' },
    },
    edge: '#4a5a78',
    edgeLabel: '#94a3b8',
    edgeLabelBg: '#16213e',
    background: '#16213e',
  },
}

export function flowTokens(theme: FlowTheme): FlowTokens {
  return TOKENS[theme]
}

/** 读取当前页面主题（Settings 面板写在 <html data-theme> 上） */
export function currentFlowTheme(): FlowTheme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
}

/** G6 内置节点形状：菱形表示判断，其余都用矩形（start/end 靠大圆角做成胶囊） */
export function shapeOf(type: FlowNodeType): 'rect' | 'diamond' {
  return type === 'decision' ? 'diamond' : 'rect'
}

export function radiusOf(type: FlowNodeType): number {
  if (type === 'start' || type === 'end') return 18
  return 6
}

const LABEL_FONT = '12px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
let measureCtx: CanvasRenderingContext2D | null = null

function measure(text: string): number {
  if (!measureCtx) {
    measureCtx = document.createElement('canvas').getContext('2d')
    if (measureCtx) measureCtx.font = LABEL_FONT
  }
  // 拿不到 canvas 上下文时按中文全宽估算，宁可宽一点也不要压字
  return measureCtx ? measureCtx.measureText(text).width : text.length * 12
}

/**
 * 按文案长度算节点尺寸。
 *
 * G6 的内置节点不会跟着 label 自适应，尺寸给小了文字就会溢出到形状外；
 * 这里先量出文字宽度再反推宽高，并把超宽的文案折行（菱形内可用宽度只有一半，单独放大）。
 */
export function sizeOf(label: string, type: FlowNodeType): [number, number] {
  const text = measure(label)
  if (type === 'decision') {
    const width = Math.min(240, Math.max(120, text * 0.9 + 56))
    const lines = Math.max(1, Math.ceil(text / (width * 0.52)))
    return [width, Math.max(64, lines * 18 + 40)]
  }
  const width = Math.min(220, Math.max(96, text + 28))
  const lines = Math.max(1, Math.ceil(text / (width - 24)))
  return [width, Math.max(36, lines * 18 + 18)]
}

/** 节点内文案的折行宽度：留出左右内边距，菱形还要再收窄 */
export function labelMaxWidth(width: number, type: FlowNodeType): number {
  return type === 'decision' ? width * 0.56 : width - 20
}
