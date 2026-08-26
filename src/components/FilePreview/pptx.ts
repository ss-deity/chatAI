/**
 * 纯浏览器端 PPTX 解析器：pptx(zip) → Slide JSON。
 *
 * 链路：JSZip 解压 → DOMParser 解析 OOXML → 归一化成与渲染无关的 JSON，
 * 交给 PptxSlide.vue 用绝对定位的 div/img 渲染。全程不依赖 LibreOffice 与后端转换。
 *
 * 关于还原度：OOXML 里 slide 上的形状经常不带位置和字体，需要顺着
 * slideLayout → slideMaster → theme 逐级回溯继承（见 resolvePlaceholder / inheritTextStyle），
 * 这里实现的是覆盖常见版式的子集：文本、图片、基础形状填充、组合、表格、背景。
 * 不支持：SmartArt、图表（渲染为占位块）、复杂 prstGeom 路径、动画、渐变角度。
 */
import JSZip from 'jszip'

/** 1 inch = 914400 EMU = 96 px */
const EMU_PER_PX = 9525
/** OOXML 字号单位是 1/100 pt；1pt = 1.333px */
const PT_TO_PX = 96 / 72

const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

export interface PptxRun {
  text: string
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  /** px */
  size: number
  color: string
  font: string
  /** 上标/下标 */
  baseline: number
}

export interface PptxParagraph {
  runs: PptxRun[]
  align: 'left' | 'center' | 'right' | 'justify'
  /** 缩进层级 0-8 */
  lvl: number
  /** 项目符号字符，null 表示无 */
  bullet: string | null
  /** 行高倍数 */
  lineHeight: number
  /** 段前距 px */
  spaceBefore: number
}

interface Box {
  x: number
  y: number
  w: number
  h: number
  /** 顺时针角度 */
  rot: number
  flipH: boolean
  flipV: boolean
}

export interface PptxShape extends Box {
  kind: 'shape'
  fill: string
  borderColor: string | null
  borderWidth: number
  /** 圆角半径 px；椭圆用 50% */
  radius: string
  paragraphs: PptxParagraph[]
  /** 垂直对齐 */
  anchor: 'flex-start' | 'center' | 'flex-end'
  padTop: number
  padRight: number
  padBottom: number
  padLeft: number
}

export interface PptxImage extends Box {
  kind: 'image'
  src: string
}

export interface PptxTableCell {
  paragraphs: PptxParagraph[]
  fill: string
  colSpan: number
  rowSpan: number
  merged: boolean
}

export interface PptxTable extends Box {
  kind: 'table'
  colWidths: number[]
  rows: { height: number; cells: PptxTableCell[] }[]
}

/** 图表/SmartArt 等暂不支持的内容，渲染成占位块 */
export interface PptxUnsupported extends Box {
  kind: 'unsupported'
  label: string
}

export type PptxElement = PptxShape | PptxImage | PptxTable | PptxUnsupported

export interface PptxSlide {
  index: number
  /** CSS background 值 */
  background: string
  elements: PptxElement[]
}

export interface PptxDeck {
  /** 画布尺寸（px） */
  width: number
  height: number
  slides: PptxSlide[]
  /** 释放图片 blob URL，组件卸载时调用 */
  dispose: () => void
}

/* --------------------------- DOM 小工具 --------------------------- */

/** 取第一个 localName 匹配的直接子元素 */
function child(el: Element | null, name: string): Element | null {
  if (!el) return null
  for (const c of Array.from(el.children)) {
    if (c.localName === name) return c
  }
  return null
}

/** 取所有 localName 匹配的直接子元素 */
function children(el: Element | null, name: string): Element[] {
  if (!el) return []
  return Array.from(el.children).filter((c) => c.localName === name)
}

/** 深度优先找第一个 localName 匹配的后代（含自身之外） */
function deep(el: Element | null, name: string): Element | null {
  if (!el) return null
  for (const c of Array.from(el.children)) {
    if (c.localName === name) return c
    const found = deep(c, name)
    if (found) return found
  }
  return null
}

/** 按路径逐级取子元素，如 path(el, 'spPr', 'xfrm', 'off') */
function path(el: Element | null, ...names: string[]): Element | null {
  let cur = el
  for (const n of names) {
    cur = child(cur, n)
    if (!cur) return null
  }
  return cur
}

/** 忽略命名空间前缀读属性 */
function attr(el: Element | null, name: string): string | null {
  if (!el) return null
  const direct = el.getAttribute(name)
  if (direct !== null) return direct
  for (const a of Array.from(el.attributes)) {
    if (a.localName === name) return a.value
  }
  return null
}

function num(v: string | null, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function emu(v: string | null): number {
  return num(v) / EMU_PER_PX
}

function isTrue(v: string | null): boolean {
  return v === '1' || v === 'true'
}

/* --------------------------- 颜色 --------------------------- */

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return [
    parseInt(full.slice(0, 2), 16) || 0,
    parseInt(full.slice(2, 4), 16) || 0,
    parseInt(full.slice(4, 6), 16) || 0,
  ]
}

function rgbToHex(r: number, g: number, b: number): string {
  const to = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

/** RGB → HSL，用于 lumMod / lumOff 亮度变换 */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
  else if (max === gn) h = ((bn - rn) / d + 2) / 6
  else h = ((rn - gn) / d + 4) / 6
  return [h, s, l]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hue = (t: number) => {
    let tt = t
    if (tt < 0) tt += 1
    if (tt > 1) tt -= 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }
  return [hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255]
}

/** 预设色名里最常见的一批（prstClr / sysClr 兜底用） */
const PRESET_COLORS: Record<string, string> = {
  black: '#000000',
  white: '#FFFFFF',
  red: '#FF0000',
  green: '#008000',
  blue: '#0000FF',
  yellow: '#FFFF00',
  gray: '#808080',
  grey: '#808080',
  darkGray: '#A9A9A9',
  lightGray: '#D3D3D3',
  orange: '#FFA500',
  purple: '#800080',
  windowText: '#000000',
  window: '#FFFFFF',
}

interface ThemeCtx {
  /** accent1 / dk1 / lt1 ... → hex */
  scheme: Record<string, string>
  /** master 的 clrMap：bg1 → lt1 之类 */
  clrMap: Record<string, string>
  majorFont: string
  minorFont: string
}

/**
 * 解析一个颜色容器（solidFill / fgClr / 直接是 srgbClr 的父节点）。
 * 处理 schemeClr 的 clrMap 映射与 lumMod/lumOff/shade/tint/alpha 变换。
 */
function colorFrom(container: Element | null, theme: ThemeCtx): string | null {
  if (!container) return null
  const node =
    child(container, 'srgbClr') ||
    child(container, 'schemeClr') ||
    child(container, 'sysClr') ||
    child(container, 'prstClr') ||
    child(container, 'scrgbClr')
  if (!node) return null

  let hex: string
  switch (node.localName) {
    case 'srgbClr':
      hex = `#${attr(node, 'val') || '000000'}`
      break
    case 'schemeClr': {
      const raw = attr(node, 'val') || 'tx1'
      // clrMap 把 bg1/tx1/bg2/tx2 映射到 lt1/dk1/lt2/dk2
      const mapped = theme.clrMap[raw] || raw
      hex = theme.scheme[mapped] || theme.scheme[raw] || '#000000'
      break
    }
    case 'sysClr': {
      const last = attr(node, 'lastClr')
      hex = last ? `#${last}` : PRESET_COLORS[attr(node, 'val') || ''] || '#000000'
      break
    }
    case 'prstClr':
      hex = PRESET_COLORS[attr(node, 'val') || ''] || '#000000'
      break
    default: {
      // scrgbClr 用百分比表示
      const r = num(attr(node, 'r')) / 100000
      const g = num(attr(node, 'g')) / 100000
      const b = num(attr(node, 'b')) / 100000
      hex = rgbToHex(r * 255, g * 255, b * 255)
    }
  }

  let [r, g, b] = hexToRgb(hex)

  const pct = (name: string): number | null => {
    const el = child(node, name)
    if (!el) return null
    return num(attr(el, 'val')) / 100000
  }

  const lumMod = pct('lumMod')
  const lumOff = pct('lumOff')
  if (lumMod !== null || lumOff !== null) {
    let [h, s, l] = rgbToHsl(r, g, b)
    if (lumMod !== null) l *= lumMod
    if (lumOff !== null) l += lumOff
    ;[r, g, b] = hslToRgb(h, s, clamp(l, 0, 1))
  }

  const shade = pct('shade')
  if (shade !== null) {
    r *= shade
    g *= shade
    b *= shade
  }
  const tint = pct('tint')
  if (tint !== null) {
    r = r * tint + 255 * (1 - tint)
    g = g * tint + 255 * (1 - tint)
    b = b * tint + 255 * (1 - tint)
  }

  const alpha = pct('alpha')
  if (alpha !== null && alpha < 1) {
    return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha.toFixed(3)})`
  }
  return rgbToHex(r, g, b)
}

/* --------------------------- zip / rels --------------------------- */

class Pkg {
  private zip: JSZip
  private xmlCache = new Map<string, Document | null>()
  private relsCache = new Map<string, Map<string, string>>()

  constructor(zip: JSZip) {
    this.zip = zip
  }

  async xml(p: string): Promise<Document | null> {
    if (this.xmlCache.has(p)) return this.xmlCache.get(p)!
    const f = this.zip.file(p)
    let doc: Document | null = null
    if (f) {
      const text = await f.async('string')
      const parsed = new DOMParser().parseFromString(text, 'application/xml')
      doc = parsed.querySelector('parsererror') ? null : parsed
    }
    this.xmlCache.set(p, doc)
    return doc
  }

  binary(p: string): Promise<Uint8Array> | null {
    const f = this.zip.file(p)
    return f ? f.async('uint8array') : null
  }

  /** 读某个 part 的 rels：rId → 绝对路径（或外部 URL） */
  async rels(partPath: string): Promise<Map<string, string>> {
    if (this.relsCache.has(partPath)) return this.relsCache.get(partPath)!
    const slash = partPath.lastIndexOf('/')
    const dir = slash === -1 ? '' : partPath.slice(0, slash)
    const file = slash === -1 ? partPath : partPath.slice(slash + 1)
    const relPath = `${dir}/_rels/${file}.rels`
    const map = new Map<string, string>()
    const doc = await this.xml(relPath)
    if (doc) {
      for (const rel of Array.from(doc.getElementsByTagName('Relationship'))) {
        const id = rel.getAttribute('Id')
        const target = rel.getAttribute('Target')
        if (!id || !target) continue
        map.set(
          id,
          rel.getAttribute('TargetMode') === 'External'
            ? target
            : resolveRelPath(dir, target),
        )
      }
    }
    this.relsCache.set(partPath, map)
    return map
  }
}

/** 把 rels 里的相对 Target 解析成 zip 内的绝对路径 */
function resolveRelPath(baseDir: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const segs = baseDir ? baseDir.split('/') : []
  for (const seg of target.split('/')) {
    if (seg === '.' || seg === '') continue
    if (seg === '..') segs.pop()
    else segs.push(seg)
  }
  return segs.join('/')
}

/* --------------------------- theme --------------------------- */

const SCHEME_KEYS = [
  'dk1',
  'lt1',
  'dk2',
  'lt2',
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
  'hlink',
  'folHlink',
]

function parseTheme(themeDoc: Document | null, masterDoc: Document | null): ThemeCtx {
  const scheme: Record<string, string> = {}
  const themeEl = themeDoc?.documentElement || null
  const clrScheme = deep(themeEl, 'clrScheme')
  for (const key of SCHEME_KEYS) {
    const node = child(clrScheme, key)
    const c = colorFrom(node, {
      scheme: {},
      clrMap: {},
      majorFont: '',
      minorFont: '',
    })
    if (c) scheme[key] = c
  }
  // 常见别名：tx1/bg1 在没有 clrMap 时的兜底
  scheme.tx1 = scheme.tx1 || scheme.dk1 || '#000000'
  scheme.bg1 = scheme.bg1 || scheme.lt1 || '#FFFFFF'
  scheme.tx2 = scheme.tx2 || scheme.dk2 || '#000000'
  scheme.bg2 = scheme.bg2 || scheme.lt2 || '#FFFFFF'

  const fontScheme = deep(themeEl, 'fontScheme')
  const fontOf = (which: 'majorFont' | 'minorFont'): string => {
    const f = child(fontScheme, which)
    const latin = attr(child(f, 'latin'), 'typeface') || ''
    const ea = attr(child(f, 'ea'), 'typeface') || ''
    return [latin, ea].filter(Boolean).join(', ')
  }

  const clrMap: Record<string, string> = {}
  const clrMapEl = deep(masterDoc?.documentElement || null, 'clrMap')
  if (clrMapEl) {
    for (const a of Array.from(clrMapEl.attributes)) {
      clrMap[a.localName] = a.value
    }
  }

  return {
    scheme,
    clrMap,
    majorFont: fontOf('majorFont'),
    minorFont: fontOf('minorFont'),
  }
}

/* --------------------------- 占位符继承 --------------------------- */

interface PlaceholderRef {
  type: string
  idx: string
}

function placeholderOf(sp: Element): PlaceholderRef | null {
  const ph = deep(child(sp, 'nvSpPr'), 'ph')
  if (!ph) return null
  return { type: attr(ph, 'type') || 'body', idx: attr(ph, 'idx') || '' }
}

/** 建 layout/master 里的占位符索引，供 slide 上缺属性的形状回溯 */
function buildPhMap(doc: Document | null): Map<string, Element> {
  const map = new Map<string, Element>()
  const tree = deep(doc?.documentElement || null, 'spTree')
  if (!tree) return map
  for (const sp of children(tree, 'sp')) {
    const ph = placeholderOf(sp)
    if (!ph) continue
    if (ph.idx) map.set(`idx:${ph.idx}`, sp)
    if (!map.has(`type:${ph.type}`)) map.set(`type:${ph.type}`, sp)
  }
  return map
}

/** title 与 ctrTitle、body 与 subTitle 在继承时可互相兜底 */
function phAliases(type: string): string[] {
  if (type === 'title' || type === 'ctrTitle') return ['title', 'ctrTitle']
  if (type === 'subTitle') return ['subTitle', 'body']
  if (type === 'body') return ['body', 'subTitle']
  return [type]
}

function lookupPh(
  maps: Map<string, Element>[],
  ph: PlaceholderRef | null,
): Element[] {
  if (!ph) return []
  const found: Element[] = []
  for (const map of maps) {
    let hit = ph.idx ? map.get(`idx:${ph.idx}`) : undefined
    if (!hit) {
      for (const t of phAliases(ph.type)) {
        hit = map.get(`type:${t}`)
        if (hit) break
      }
    }
    if (hit) found.push(hit)
  }
  return found
}

/* --------------------------- 几何 --------------------------- */

/** 组合形状的坐标变换：把子元素的内部坐标映射到外部画布 */
interface Transform {
  offX: number
  offY: number
  scaleX: number
  scaleY: number
}

const IDENTITY: Transform = { offX: 0, offY: 0, scaleX: 1, scaleY: 1 }

function applyTransform(box: Box, t: Transform): Box {
  return {
    ...box,
    x: t.offX + box.x * t.scaleX,
    y: t.offY + box.y * t.scaleY,
    w: box.w * t.scaleX,
    h: box.h * t.scaleY,
  }
}

/** 从 spPr/xfrm 读位置，读不到返回 null 交给占位符继承 */
function boxFromXfrm(xfrm: Element | null): Box | null {
  if (!xfrm) return null
  const off = child(xfrm, 'off')
  const ext = child(xfrm, 'ext')
  if (!off || !ext) return null
  return {
    x: emu(attr(off, 'x')),
    y: emu(attr(off, 'y')),
    w: emu(attr(ext, 'cx')),
    h: emu(attr(ext, 'cy')),
    rot: num(attr(xfrm, 'rot')) / 60000,
    flipH: isTrue(attr(xfrm, 'flipH')),
    flipV: isTrue(attr(xfrm, 'flipV')),
  }
}

/* --------------------------- 文本 --------------------------- */

const BULLET_CHARS = ['•', '◦', '▪', '·', '–']

interface TextStyleDefaults {
  size: number
  color: string
  font: string
  bold: boolean
}

/**
 * 从 master 的 txStyles（titleStyle/bodyStyle/otherStyle）取某一层级的默认字号/颜色。
 * slide 上的 run 绝大多数不写 sz，全靠这里兜底。
 */
function inheritTextStyle(
  masterDoc: Document | null,
  phType: string,
  lvl: number,
  theme: ThemeCtx,
): TextStyleDefaults {
  const isTitle = phType === 'title' || phType === 'ctrTitle'
  const styleName = isTitle ? 'titleStyle' : phType === 'body' || phType === 'subTitle' ? 'bodyStyle' : 'otherStyle'
  const txStyles = deep(masterDoc?.documentElement || null, 'txStyles')
  const style = child(txStyles, styleName) || child(txStyles, 'bodyStyle')
  const lvlPr = child(style, `lvl${lvl + 1}pPr`) || child(style, 'lvl1pPr')
  const defRPr = child(lvlPr, 'defRPr')

  const size = num(attr(defRPr, 'sz'), isTitle ? 4400 : 1800) / 100
  const color = colorFrom(child(defRPr, 'solidFill'), theme) || '#000000'
  const latin = attr(child(defRPr, 'latin'), 'typeface') || ''
  return {
    size: size * PT_TO_PX,
    color,
    font: resolveFontName(latin, theme) || (isTitle ? theme.majorFont : theme.minorFont),
    bold: isTrue(attr(defRPr, 'b')),
  }
}

/** +mj-lt / +mn-ea 这类 theme 字体引用要换成真实字体名 */
function resolveFontName(typeface: string, theme: ThemeCtx): string {
  if (!typeface) return ''
  if (typeface.startsWith('+mj')) return theme.majorFont
  if (typeface.startsWith('+mn')) return theme.minorFont
  return typeface
}

/** 解析 txBody → 段落列表 */
function parseParagraphs(
  txBody: Element | null,
  defaults: TextStyleDefaults,
  theme: ThemeCtx,
): PptxParagraph[] {
  if (!txBody) return []
  const out: PptxParagraph[] = []

  // normAutofit 会让 PowerPoint 自动缩小字号，这里按比例还原
  const fontScale = num(attr(deep(txBody, 'normAutofit'), 'fontScale'), 100000)
  const scale = fontScale > 1000 ? fontScale / 100000 : 1

  for (const p of children(txBody, 'p')) {
    const pPr = child(p, 'pPr')
    const lvl = num(attr(pPr, 'lvl'))
    const algnRaw = attr(pPr, 'algn')
    const align: PptxParagraph['align'] =
      algnRaw === 'ctr'
        ? 'center'
        : algnRaw === 'r'
          ? 'right'
          : algnRaw === 'just'
            ? 'justify'
            : 'left'

    // buNone 显式关闭项目符号；buChar 指定字符；默认层级 >0 才给符号
    let bullet: string | null = null
    if (pPr && !child(pPr, 'buNone')) {
      const buChar = child(pPr, 'buChar')
      const buAutoNum = child(pPr, 'buAutoNum')
      if (buChar) bullet = attr(buChar, 'char') || '•'
      else if (buAutoNum) bullet = '#'
      else if (lvl > 0) bullet = BULLET_CHARS[Math.min(lvl, BULLET_CHARS.length - 1)]
    }

    const lnSpc = child(pPr, 'lnSpc')
    const spcPct = num(attr(child(lnSpc, 'spcPct'), 'val'), 0)
    const lineHeight = spcPct > 0 ? spcPct / 100000 : 1.2

    const spcBef = child(pPr, 'spcBef')
    const spcBefPts = num(attr(child(spcBef, 'spcPts'), 'val'), 0) / 100

    const runs: PptxRun[] = []
    // a:r 是文本段，a:br 是软换行，a:fld 是域（页码等）
    for (const node of Array.from(p.children)) {
      if (node.localName === 'br') {
        runs.push({ ...emptyRun(defaults), text: '\n' })
        continue
      }
      if (node.localName !== 'r' && node.localName !== 'fld') continue
      const t = child(node, 't')
      const text = t?.textContent ?? ''
      if (!text) continue
      const rPr = child(node, 'rPr')
      const latin = attr(child(rPr, 'latin'), 'typeface') || ''
      const ea = attr(child(rPr, 'ea'), 'typeface') || ''
      const fontRaw = resolveFontName(latin, theme) || resolveFontName(ea, theme)
      const szAttr = attr(rPr, 'sz')
      runs.push({
        text,
        bold: rPr ? isTrue(attr(rPr, 'b')) : defaults.bold,
        italic: isTrue(attr(rPr, 'i')),
        underline: (attr(rPr, 'u') || 'none') !== 'none',
        strike: (attr(rPr, 'strike') || 'noStrike') !== 'noStrike',
        size: (szAttr ? (num(szAttr) / 100) * PT_TO_PX : defaults.size) * scale,
        color: colorFrom(child(rPr, 'solidFill'), theme) || defaults.color,
        font: fontRaw || defaults.font,
        baseline: num(attr(rPr, 'baseline')) / 1000,
      })
    }

    // 空段落也要占一行高度
    if (runs.length === 0) {
      runs.push({ ...emptyRun(defaults), text: '' })
    }

    out.push({ runs, align, lvl, bullet, lineHeight, spaceBefore: spcBefPts * PT_TO_PX })
  }

  // 整个 txBody 一个字都没有时不生成文本层
  if (out.every((p) => p.runs.every((r) => !r.text.trim()))) return []
  return out
}

function emptyRun(d: TextStyleDefaults): PptxRun {
  return {
    text: '',
    bold: d.bold,
    italic: false,
    underline: false,
    strike: false,
    size: d.size,
    color: d.color,
    font: d.font,
    baseline: 0,
  }
}

/* --------------------------- 形状 --------------------------- */

/** prstGeom 只区分几种影响外观的：椭圆、圆角矩形，其余按矩形处理 */
function radiusOf(spPr: Element | null): string {
  const prst = attr(child(spPr, 'prstGeom'), 'prst') || ''
  if (prst === 'ellipse' || prst === 'circle') return '50%'
  if (prst.startsWith('roundRect') || prst === 'round2SameRect') return '12px'
  return '0'
}

interface SlideCtx {
  pkg: Pkg
  theme: ThemeCtx
  masterDoc: Document | null
  /** layout → master 的占位符索引，按优先级排列 */
  phMaps: Map<string, Element>[]
  /** 当前 slide 的 rels */
  rels: Map<string, string>
  imgCache: Map<string, string>
  blobUrls: string[]
}

async function imageSrc(ctx: SlideCtx, embedId: string | null): Promise<string> {
  if (!embedId) return ''
  const target = ctx.rels.get(embedId)
  if (!target) return ''
  if (/^https?:/i.test(target)) return target
  const cached = ctx.imgCache.get(target)
  if (cached) return cached
  const bin = ctx.pkg.binary(target)
  if (!bin) return ''
  const bytes = await bin
  const ext = target.split('.').pop()?.toLowerCase() || 'png'
  const mime =
    ext === 'svg'
      ? 'image/svg+xml'
      : ext === 'jpg' || ext === 'jpeg'
        ? 'image/jpeg'
        : ext === 'gif'
          ? 'image/gif'
          : ext === 'bmp'
            ? 'image/bmp'
            : ext === 'webp'
              ? 'image/webp'
              : 'image/png'
  // wmf/emf 浏览器无法解码，跳过而不是渲染成碎图
  if (ext === 'wmf' || ext === 'emf') return ''
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }))
  ctx.imgCache.set(target, url)
  ctx.blobUrls.push(url)
  return url
}

/** 解析填充：solidFill / gradFill（取首个 stop）/ noFill */
function fillOf(spPr: Element | null, theme: ThemeCtx): string {
  if (!spPr) return 'transparent'
  if (child(spPr, 'noFill')) return 'transparent'
  const solid = colorFrom(child(spPr, 'solidFill'), theme)
  if (solid) return solid
  const grad = child(spPr, 'gradFill')
  if (grad) {
    const stops = children(child(grad, 'gsLst'), 'gs')
      .map((gs) => ({ pos: num(attr(gs, 'pos')) / 1000, color: colorFrom(gs, theme) }))
      .filter((s) => s.color)
    if (stops.length >= 2) {
      const lin = child(grad, 'lin')
      const deg = num(attr(lin, 'ang')) / 60000 + 90
      return `linear-gradient(${deg}deg, ${stops.map((s) => `${s.color} ${s.pos}%`).join(', ')})`
    }
    if (stops.length === 1) return stops[0].color!
  }
  return 'transparent'
}

async function parseSp(sp: Element, ctx: SlideCtx, t: Transform): Promise<PptxShape | null> {
  const spPr = child(sp, 'spPr')
  const ph = placeholderOf(sp)
  const inherited = lookupPh(ctx.phMaps, ph)

  // 位置：自身 → layout → master
  let box = boxFromXfrm(child(spPr, 'xfrm'))
  if (!box) {
    for (const src of inherited) {
      box = boxFromXfrm(path(src, 'spPr', 'xfrm'))
      if (box) break
    }
  }
  if (!box) return null

  const txBody = child(sp, 'txBody')
  const defaults = inheritTextStyle(ctx.masterDoc, ph?.type || 'other', 0, ctx.theme)

  // 占位符自身若在 layout 上定义了 defRPr（常见于模板改过字号），优先用它
  for (const src of inherited) {
    const lvl1 = deep(path(src, 'txBody', 'lstStyle'), 'defRPr')
    const sz = attr(lvl1, 'sz')
    if (sz) defaults.size = (num(sz) / 100) * PT_TO_PX
    const c = colorFrom(child(lvl1, 'solidFill'), ctx.theme)
    if (c) defaults.color = c
  }

  const paragraphs = parseParagraphs(txBody, defaults, ctx.theme)

  // 占位符没有填充色时不要给背景，否则会盖住母版
  let fill = fillOf(spPr, ctx.theme)
  if (fill === 'transparent' && !child(spPr, 'noFill') && !ph) {
    // 非占位符形状且未声明填充：按 theme 的 lt1 兜底会太脏，这里保持透明
    fill = 'transparent'
  }

  const ln = child(spPr, 'ln')
  const borderColor = ln && !child(ln, 'noFill') ? colorFrom(child(ln, 'solidFill'), ctx.theme) : null
  const borderWidth = borderColor ? Math.max(emu(attr(ln, 'w')), 1) : 0

  const bodyPr = child(txBody, 'bodyPr')
  const anchorRaw = attr(bodyPr, 'anchor')
  const anchor: PptxShape['anchor'] =
    anchorRaw === 'ctr' ? 'center' : anchorRaw === 'b' ? 'flex-end' : 'flex-start'

  const insDefault = { l: 91440, t: 45720, r: 91440, b: 45720 }
  const padLeft = emu(attr(bodyPr, 'lIns') ?? String(insDefault.l))
  const padTop = emu(attr(bodyPr, 'tIns') ?? String(insDefault.t))
  const padRight = emu(attr(bodyPr, 'rIns') ?? String(insDefault.r))
  const padBottom = emu(attr(bodyPr, 'bIns') ?? String(insDefault.b))

  // 纯装饰性空形状（无文本无填充无边框）直接丢掉，减少 DOM
  if (paragraphs.length === 0 && fill === 'transparent' && !borderColor) return null

  return {
    kind: 'shape',
    ...applyTransform(box, t),
    fill,
    borderColor,
    borderWidth,
    radius: radiusOf(spPr),
    paragraphs,
    anchor,
    padLeft,
    padTop,
    padRight,
    padBottom,
  }
}

async function parsePic(pic: Element, ctx: SlideCtx, t: Transform): Promise<PptxImage | null> {
  const box = boxFromXfrm(path(pic, 'spPr', 'xfrm'))
  if (!box) return null
  const embed = attr(deep(child(pic, 'blipFill'), 'blip'), 'embed')
  const src = await imageSrc(ctx, embed)
  if (!src) return null
  return { kind: 'image', ...applyTransform(box, t), src }
}

async function parseGraphicFrame(
  frame: Element,
  ctx: SlideCtx,
  t: Transform,
): Promise<PptxElement | null> {
  const box = boxFromXfrm(child(frame, 'xfrm'))
  if (!box) return null
  const outer = applyTransform(box, t)

  const tbl = deep(frame, 'tbl')
  if (tbl) {
    const grid = child(tbl, 'tblGrid')
    const colWidths = children(grid, 'gridCol').map((c) => emu(attr(c, 'w')))
    const rows = children(tbl, 'tr').map((tr) => {
      const cells: PptxTableCell[] = children(tr, 'tc').map((tc) => {
        const tcPr = child(tc, 'tcPr')
        const defaults = inheritTextStyle(ctx.masterDoc, 'other', 0, ctx.theme)
        return {
          paragraphs: parseParagraphs(child(tc, 'txBody'), defaults, ctx.theme),
          fill: fillOf(tcPr, ctx.theme),
          colSpan: num(attr(tc, 'gridSpan'), 1),
          rowSpan: num(attr(tc, 'rowSpan'), 1),
          merged: attr(tc, 'hMerge') === '1' || attr(tc, 'vMerge') === '1',
        }
      })
      return { height: emu(attr(tr, 'h')), cells }
    })
    return { kind: 'table', ...outer, colWidths, rows }
  }

  if (deep(frame, 'chart')) {
    return { kind: 'unsupported', ...outer, label: '图表' }
  }
  if (deep(frame, 'graphicData')) {
    return { kind: 'unsupported', ...outer, label: '图形' }
  }
  return null
}

/** 遍历形状节点列表，grpSp 递归时叠加坐标变换 */
async function walkNodes(
  nodes: Element[],
  ctx: SlideCtx,
  t: Transform,
  out: PptxElement[],
): Promise<void> {
  for (const node of nodes) {
    switch (node.localName) {
      case 'sp':
      case 'cxnSp': {
        const shape = await parseSp(node, ctx, t)
        if (shape) out.push(shape)
        break
      }
      case 'pic': {
        const img = await parsePic(node, ctx, t)
        if (img) out.push(img)
        break
      }
      case 'graphicFrame': {
        const el = await parseGraphicFrame(node, ctx, t)
        if (el) out.push(el)
        break
      }
      case 'grpSp': {
        // 组合内部使用 chOff/chExt 坐标系，需要换算到外部 off/ext
        const xfrm = path(node, 'grpSpPr', 'xfrm')
        const off = child(xfrm, 'off')
        const ext = child(xfrm, 'ext')
        const chOff = child(xfrm, 'chOff')
        const chExt = child(xfrm, 'chExt')
        let next = t
        if (off && ext && chOff && chExt) {
          const cw = emu(attr(chExt, 'cx')) || 1
          const ch = emu(attr(chExt, 'cy')) || 1
          const sx = emu(attr(ext, 'cx')) / cw
          const sy = emu(attr(ext, 'cy')) / ch
          next = {
            offX: t.offX + (emu(attr(off, 'x')) - emu(attr(chOff, 'x')) * sx) * t.scaleX,
            offY: t.offY + (emu(attr(off, 'y')) - emu(attr(chOff, 'y')) * sy) * t.scaleY,
            scaleX: t.scaleX * sx,
            scaleY: t.scaleY * sy,
          }
        }
        await walkNodes(Array.from(node.children), ctx, next, out)
        break
      }
      default:
        break
    }
  }
}

/* --------------------------- 背景 --------------------------- */

async function backgroundOf(
  docs: (Document | null)[],
  ctx: SlideCtx,
  relsList: Map<string, string>[],
): Promise<string> {
  for (const [i, doc] of docs.entries()) {
    const bg = deep(doc?.documentElement || null, 'bg')
    if (!bg) continue
    const bgPr = child(bg, 'bgPr')
    if (bgPr) {
      const blip = deep(child(bgPr, 'blipFill'), 'blip')
      if (blip) {
        const saved = ctx.rels
        ctx.rels = relsList[i] || saved
        const src = await imageSrc(ctx, attr(blip, 'embed'))
        ctx.rels = saved
        if (src) return `#fff url("${src}") center / cover no-repeat`
      }
      const fill = fillOf(bgPr, ctx.theme)
      if (fill !== 'transparent') return fill
    }
    // bgRef 指向 theme 的 fillStyleLst，这里只取它的颜色
    const bgRef = child(bg, 'bgRef')
    if (bgRef) {
      const c = colorFrom(bgRef, ctx.theme)
      if (c) return c
    }
  }
  return '#FFFFFF'
}

/* --------------------------- 入口 --------------------------- */

/**
 * 解析 pptx 二进制 → Slide JSON。
 * 页序按 presentation.xml 的 sldIdLst 取，不能按 slideN.xml 的文件名排序
 * （删改页后文件名序号与实际播放顺序会不一致）。
 */
export async function parsePptx(data: ArrayBuffer): Promise<PptxDeck> {
  const zip = await JSZip.loadAsync(data)
  const pkg = new Pkg(zip)

  const presPath = 'ppt/presentation.xml'
  const presDoc = await pkg.xml(presPath)
  if (!presDoc) throw new Error('不是有效的 pptx 文件')

  const sldSz = deep(presDoc.documentElement, 'sldSz')
  const width = emu(attr(sldSz, 'cx')) || 960
  const height = emu(attr(sldSz, 'cy')) || 540

  const presRels = await pkg.rels(presPath)
  const slidePaths: string[] = []
  for (const sldId of children(deep(presDoc.documentElement, 'sldIdLst'), 'sldId')) {
    const rid = sldId.getAttributeNS(REL_NS, 'id') || attr(sldId, 'id')
    const target = rid ? presRels.get(rid) : undefined
    if (target) slidePaths.push(target)
  }
  // 兜底：sldIdLst 缺失时按文件名排序
  if (slidePaths.length === 0) {
    slidePaths.push(
      ...Object.keys(zip.files)
        .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
        .sort(
          (a, b) =>
            Number(a.match(/(\d+)\.xml$/)?.[1] || 0) -
            Number(b.match(/(\d+)\.xml$/)?.[1] || 0),
        ),
    )
  }
  if (slidePaths.length === 0) throw new Error('未从该文件中解析出任何页面')

  const blobUrls: string[] = []
  const imgCache = new Map<string, string>()
  const slides: PptxSlide[] = []

  for (const [i, slidePath] of slidePaths.entries()) {
    const slideDoc = await pkg.xml(slidePath)
    if (!slideDoc) continue

    const slideRels = await pkg.rels(slidePath)
    // slide → layout → master → theme
    const layoutPath = [...slideRels.values()].find((v) => v.includes('slideLayouts/'))
    const layoutDoc = layoutPath ? await pkg.xml(layoutPath) : null
    const layoutRels = layoutPath ? await pkg.rels(layoutPath) : new Map<string, string>()
    const masterPath = [...layoutRels.values()].find((v) => v.includes('slideMasters/'))
    const masterDoc = masterPath ? await pkg.xml(masterPath) : null
    const masterRels = masterPath ? await pkg.rels(masterPath) : new Map<string, string>()
    const themePath = [...masterRels.values()].find((v) => v.includes('theme/'))
    const themeDoc = themePath ? await pkg.xml(themePath) : null

    const theme = parseTheme(themeDoc, masterDoc)
    const ctx: SlideCtx = {
      pkg,
      theme,
      masterDoc,
      phMaps: [buildPhMap(layoutDoc), buildPhMap(masterDoc)],
      rels: slideRels,
      imgCache,
      blobUrls,
    }

    const background = await backgroundOf(
      [slideDoc, layoutDoc, masterDoc],
      ctx,
      [slideRels, layoutRels, masterRels],
    )

    const elements: PptxElement[] = []
    // 母版和版式上的静态装饰（背景图形、logo、色块）也要画，否则页面会显得很空。
    // 但要跳过占位符——占位符的内容由 slide 自己提供。
    for (const [doc, rels] of [
      [masterDoc, masterRels],
      [layoutDoc, layoutRels],
    ] as [Document | null, Map<string, string>][]) {
      const tree = deep(doc?.documentElement || null, 'spTree')
      if (!tree) continue
      const staticNodes = Array.from(tree.children).filter(
        (n) => !(n.localName === 'sp' && placeholderOf(n)),
      )
      ctx.rels = rels
      await walkNodes(staticNodes, ctx, IDENTITY, elements)
    }

    ctx.rels = slideRels
    const slideTree = deep(slideDoc.documentElement, 'spTree')
    if (slideTree) await walkNodes(Array.from(slideTree.children), ctx, IDENTITY, elements)

    slides.push({ index: i + 1, background, elements })
  }

  return {
    width,
    height,
    slides,
    dispose: () => {
      for (const u of blobUrls) URL.revokeObjectURL(u)
      blobUrls.length = 0
    },
  }
}
