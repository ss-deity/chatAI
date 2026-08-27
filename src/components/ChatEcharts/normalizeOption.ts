import { radarStyle, type ChartTheme } from './theme'

/**
 * 渲染前对 ECharts option 做一层收口，参考 enterprise-ai-chat-components 的
 * checkChartExcelChartsOption：
 *
 * 1. tooltip 强制 confine —— 图表卡片有 overflow 限制，浮层一旦溢出容器就会被裁掉。
 * 2. 服务端没给 tooltip 时，按 series 类型智能选 axis / item 触发方式。
 * 3. legend 统一 scroll，系列多时不会把绘图区挤没。
 * 4. 剥离早期版本写死在 option 里的颜色，让 echarts 主题（light / dark）能接管配色。
 * 5. radar 组件的颜色不走 series 主题，按当前主题补上。
 */

type AnyOption = Record<string, any>

/** 直角坐标系类图表：hover 整条轴更好读数 */
const AXIS_TRIGGER_TYPES = new Set([
  'bar',
  'line',
  'scatter',
  'effectScatter',
  'candlestick',
  'radar',
  'pictorialBar',
])

/** 非直角坐标系图表：只能按单个数据项触发 */
const ITEM_TRIGGER_TYPES = new Set([
  'pie',
  'funnel',
  'gauge',
  'sankey',
  'treemap',
  'boxplot',
  'heatmap',
  'themeRiver',
  'wordCloud',
  'sunburst',
  'map',
  'graph',
  'parallel',
])

function isObj(v: unknown): v is Record<string, any> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function defaultTooltip(trigger: 'axis' | 'item'): AnyOption {
  return {
    trigger,
    confine: true,
    axisPointer: trigger === 'axis' ? { type: 'cross' } : undefined,
  }
}

function smartTrigger(types: string[]): 'axis' | 'item' {
  if (types.some((t) => AXIS_TRIGGER_TYPES.has(t))) return 'axis'
  if (types.some((t) => ITEM_TRIGGER_TYPES.has(t))) return 'item'
  return 'item'
}

/** 按路径删除一个字段，中途缺层直接跳过 */
function omitAt(root: AnyOption, path: string[]): void {
  let cur: any = root
  for (let i = 0; i < path.length - 1; i++) {
    cur = cur?.[path[i]]
    if (!isObj(cur)) return
  }
  if (isObj(cur)) delete cur[path[path.length - 1]]
}

/**
 * 历史会话里落库的 option 是「颜色写死」版本（当时还没有暗色主题）。
 * option 里的颜色优先级高于 echarts 主题，不删掉的话切到暗色仍是浅色文字/网格。
 * 这里只删已知会被主题接管的那几个位置，不做递归扫描，避免误删数据里的颜色。
 */
const THEME_OWNED_PATHS: string[][] = [
  ['color'],
  ['backgroundColor'],
  ['textStyle', 'color'],
  ['title', 'textStyle', 'color'],
  ['legend', 'textStyle', 'color'],
  ['tooltip', 'backgroundColor'],
  ['tooltip', 'borderColor'],
  ['tooltip', 'extraCssText'],
  ['tooltip', 'textStyle', 'color'],
  ['tooltip', 'axisPointer', 'crossStyle', 'color'],
  ['tooltip', 'axisPointer', 'label', 'backgroundColor'],
]

const AXIS_OWNED_PATHS: string[][] = [
  ['axisLine', 'lineStyle', 'color'],
  ['axisTick', 'lineStyle', 'color'],
  ['axisLabel', 'color'],
  ['nameTextStyle', 'color'],
  ['splitLine', 'lineStyle', 'color'],
]

const SERIES_OWNED_PATHS: string[][] = [
  ['label', 'color'],
  ['itemStyle', 'borderColor'],
  ['labelLine', 'lineStyle', 'color'],
]

function stripThemeColors(option: AnyOption): void {
  THEME_OWNED_PATHS.forEach((p) => omitAt(option, p))
  for (const key of ['xAxis', 'yAxis'] as const) {
    const axes = Array.isArray(option[key]) ? option[key] : [option[key]]
    axes.filter(isObj).forEach((a: AnyOption) => {
      AXIS_OWNED_PATHS.forEach((p) => omitAt(a, p))
    })
  }
  if (Array.isArray(option.series)) {
    option.series.filter(isObj).forEach((s: AnyOption) => {
      SERIES_OWNED_PATHS.forEach((p) => omitAt(s, p))
    })
  }
}

/** 深拷贝：option 可能来自消息对象，不能就地改坏 */
function clone(option: AnyOption): AnyOption {
  return JSON.parse(JSON.stringify(option))
}

/**
 * 去掉滚轮缩放：`dataZoom: { type: 'inside' }` 会拦下图表区域内的滚轮事件去缩放坐标轴，
 * 鼠标划过图表时页面就滚不动了。可见的 slider 滑块保留，它不劫持任何手势。
 * 服务端已不再输出 inside，这里是给历史会话里落库的老 option 兜底。
 */
function disableZoomInteraction(option: AnyOption): void {
  if (Array.isArray(option.dataZoom)) {
    const kept = option.dataZoom.filter(
      (z: AnyOption) => !isObj(z) || z.type !== 'inside',
    )
    if (kept.length) option.dataZoom = kept
    else delete option.dataZoom
  } else if (isObj(option.dataZoom) && option.dataZoom.type === 'inside') {
    delete option.dataZoom
  }
}

/**
 * 收口坐标轴名：
 * - 类目轴（月份/地区这类）的轴名一律去掉。轴名只能挂在轴末端或中间：末端会和最后一个
 *   类目标签抢位置、被容器裁成半个字；中间又会压在斜排标签上。类目值本身已经自明。
 * - 数值轴的轴名保留但换个落位：x 轴放下方居中，y 轴放顶端，都不挤占右侧。
 * 服务端已按这个规则输出，这里是给历史会话里落库的老 option 兜底。
 */
function normalizeAxisNames(option: AnyOption): void {
  for (const key of ['xAxis', 'yAxis'] as const) {
    const axes = Array.isArray(option[key]) ? option[key] : [option[key]]
    axes.filter(isObj).forEach((axis: AnyOption) => {
      if (axis.type === 'category') {
        delete axis.name
        delete axis.nameLocation
        delete axis.nameGap
        delete axis.nameTextStyle
        return
      }
      if (!axis.name) return
      if (key === 'xAxis') {
        axis.nameLocation = 'middle'
        axis.nameGap = 26
      } else {
        axis.nameLocation = 'end'
        delete axis.nameGap
      }
    })
  }
}

export function normalizeOption(
  option: AnyOption,
  theme: ChartTheme,
): AnyOption {
  const next = clone(option)
  stripThemeColors(next)
  disableZoomInteraction(next)
  normalizeAxisNames(next)

  if (isObj(next.radar)) {
    next.radar = { ...next.radar, ...radarStyle(theme) }
  }

  if (!Array.isArray(next.series)) return next

  const types = Array.from(
    new Set(next.series.map((s: AnyOption) => s?.type).filter(Boolean)),
  ) as string[]

  // 已有 tooltip 只补 confine，保留服务端写好的 formatter
  next.tooltip = isObj(next.tooltip)
    ? { ...next.tooltip, confine: true }
    : defaultTooltip(smartTrigger(types))

  if (isObj(next.legend)) {
    next.legend = { type: 'scroll', ...next.legend }
  }
  return next
}
