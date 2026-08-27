import * as echarts from 'echarts'

/**
 * ECharts 主题（light / dark）。
 *
 * 图表是 canvas 绘制的，拿不到 CSS 变量，只能在 JS 层按主题给一套颜色。
 * 这里注册成 ECharts 主题而不是逐项塞进 option：option 里显式写的颜色优先级
 * 高于主题，服务端一旦写死颜色就锁死了一种配色；把颜色全部交给主题，
 * 同一份落库的 option 在两种主题下都能正确渲染。
 *
 * 色值与 src/assets/theme.css 的 --gf-* 变量保持一致。
 */

export type ChartTheme = 'light' | 'dark'

/** 注册到 echarts 的主题名 */
export const CHART_THEME_NAME: Record<ChartTheme, string> = {
  light: 'chatai-light',
  dark: 'chatai-dark',
}

interface ThemeTokens {
  /** 系列调色板 */
  palette: string[]
  /** 标题文字 */
  title: string
  /** 图例、数值标签文字 */
  legend: string
  /** 坐标轴刻度文字 */
  label: string
  /** 网格分割线 */
  split: string
  /** 坐标轴线 */
  axis: string
  /** 卡片底色：饼图/漏斗的扇区描边要和底色一致才有留白效果 */
  surface: string
  /** tooltip 浮层 */
  tooltipBg: string
  tooltipBorder: string
  tooltipText: string
  /** 导出 PNG 时的背景色（透明背景导出会变成黑块） */
  exportBg: string
}

const TOKENS: Record<ChartTheme, ThemeTokens> = {
  light: {
    palette: [
      '#5b8ff9',
      '#5ad8a6',
      '#5d7092',
      '#f6bd16',
      '#6dc8ec',
      '#945fb9',
      '#ff9845',
      '#1e9493',
      '#ff99c3',
    ],
    title: '#1f2733',
    legend: '#606a78',
    label: '#8a94a6',
    split: '#eef0f4',
    axis: '#dfe3ea',
    surface: '#ffffff',
    tooltipBg: 'rgba(50, 50, 50, 0.88)',
    tooltipBorder: 'transparent',
    tooltipText: '#ffffff',
    exportBg: '#ffffff',
  },
  dark: {
    // 深色底上要更亮一档，否则 #5d7092 这类中性色会糊进背景
    palette: [
      '#6ba1ff',
      '#5ad8a6',
      '#8ea0c0',
      '#f6bd16',
      '#6dc8ec',
      '#b184d8',
      '#ff9845',
      '#3bb3b1',
      '#ff99c3',
    ],
    title: '#f1f5f9',
    legend: '#cbd5e1',
    label: '#94a3b8',
    split: '#2c3a52',
    axis: '#3a4a68',
    surface: '#16213e',
    tooltipBg: 'rgba(15, 23, 42, 0.94)',
    tooltipBorder: '#3a4a68',
    tooltipText: '#e2e8f0',
    exportBg: '#16213e',
  },
}

function buildTheme(t: ThemeTokens): Record<string, any> {
  const axis = {
    axisLine: { lineStyle: { color: t.axis } },
    axisTick: { lineStyle: { color: t.axis } },
    axisLabel: { color: t.label },
    splitLine: { lineStyle: { color: t.split, type: 'dashed' } },
    splitArea: { show: false },
  }

  return {
    color: t.palette,
    // 画布本身透明，直接透出卡片底色，跟随 --gf-bg-panel 变化
    backgroundColor: 'transparent',
    textStyle: { color: t.legend, fontSize: 12 },
    title: { textStyle: { color: t.title, fontSize: 13, fontWeight: 600 } },
    categoryAxis: { ...axis, nameTextStyle: { color: t.label, fontSize: 11 } },
    valueAxis: { ...axis, nameTextStyle: { color: t.label, fontSize: 11 } },
    logAxis: axis,
    timeAxis: axis,
    legend: {
      textStyle: { color: t.legend, fontSize: 12 },
      inactiveColor: t.label,
      pageTextStyle: { color: t.label },
      pageIconColor: t.legend,
      pageIconInactiveColor: t.split,
    },
    tooltip: {
      backgroundColor: t.tooltipBg,
      borderColor: t.tooltipBorder,
      borderWidth: t.tooltipBorder === 'transparent' ? 0 : 1,
      padding: [6, 10],
      extraCssText: 'box-shadow: 0 2px 8px rgba(0, 0, 0, 0.16);',
      textStyle: { color: t.tooltipText, fontSize: 12 },
      axisPointer: {
        lineStyle: { color: t.axis },
        crossStyle: { color: t.axis },
        label: { backgroundColor: t.label, color: t.surface },
      },
    },
    dataZoom: {
      borderColor: t.split,
      backgroundColor: 'transparent',
      fillerColor: 'rgba(107, 161, 255, 0.16)',
      handleStyle: { color: t.axis, borderColor: t.axis },
      moveHandleStyle: { color: t.axis },
      dataBackground: {
        lineStyle: { color: t.split },
        areaStyle: { color: t.split },
      },
      textStyle: { color: t.label },
    },
    bar: { label: { color: t.legend } },
    line: { label: { color: t.legend } },
    // 扇区之间的留白靠和底色同色的描边实现
    pie: {
      itemStyle: { borderColor: t.surface, borderWidth: 2 },
      label: { color: t.legend },
      labelLine: { lineStyle: { color: t.axis } },
    },
    funnel: {
      itemStyle: { borderColor: t.surface, borderWidth: 1 },
      label: { color: t.tooltipText },
    },
    radar: {
      axisName: { color: t.label },
      axisLine: { lineStyle: { color: t.split } },
      splitLine: { lineStyle: { color: t.split } },
      splitArea: { show: false },
    },
  }
}

let registered = false

/** 幂等注册两套主题；组件挂载前调用 */
export function registerChartThemes(): void {
  if (registered) return
  echarts.registerTheme(CHART_THEME_NAME.light, buildTheme(TOKENS.light))
  echarts.registerTheme(CHART_THEME_NAME.dark, buildTheme(TOKENS.dark))
  registered = true
}

/** 读取当前页面主题（Settings 面板写在 <html data-theme> 上） */
export function currentChartTheme(): ChartTheme {
  return document.documentElement.getAttribute('data-theme') === 'dark'
    ? 'dark'
    : 'light'
}

/**
 * radar 组件（option.radar）的颜色不走 series 主题，
 * 需要在 setOption 前按主题补上。
 */
export function radarStyle(theme: ChartTheme): Record<string, any> {
  const t = TOKENS[theme]
  return {
    axisName: { color: t.label, fontSize: 12 },
    axisLine: { lineStyle: { color: t.split } },
    splitLine: { lineStyle: { color: t.split } },
    splitArea: { show: false },
  }
}

/** 导出 PNG 用的背景色 */
export function exportBackground(theme: ChartTheme): string {
  return TOKENS[theme].exportBg
}
