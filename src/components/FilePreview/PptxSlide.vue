<script setup lang="ts">
/**
 * 单页 PPTX 渲染：把解析好的 Slide JSON 画成绝对定位的 div / img。
 *
 * 画布固定为 pptx 原始尺寸（px），缩放交给父组件用 CSS transform scale，
 * 这样文字、图片、间距会整体等比缩放，不需要在这里重算任何尺寸。
 * 文本一律走模板插值渲染，不用 v-html，避免 pptx 内容导致 XSS。
 */
import type { PptxSlide, PptxElement, PptxParagraph, PptxShape } from './pptx'

const props = defineProps<{
  slide: PptxSlide
  width: number
  height: number
}>()

/** 中文环境下的字体兜底链 */
const FONT_FALLBACK =
  '"PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", "Heiti SC", sans-serif'

function boxStyle(el: PptxElement): Record<string, string> {
  const style: Record<string, string> = {
    left: `${el.x}px`,
    top: `${el.y}px`,
    width: `${el.w}px`,
    height: `${el.h}px`,
  }
  const transforms: string[] = []
  if (el.rot) transforms.push(`rotate(${el.rot}deg)`)
  if (el.flipH) transforms.push('scaleX(-1)')
  if (el.flipV) transforms.push('scaleY(-1)')
  if (transforms.length) style.transform = transforms.join(' ')
  return style
}

function shapeStyle(el: PptxShape): Record<string, string> {
  const style = boxStyle(el)
  style.background = el.fill
  style.borderRadius = el.radius
  style.justifyContent = el.anchor
  style.padding = `${el.padTop}px ${el.padRight}px ${el.padBottom}px ${el.padLeft}px`
  if (el.borderColor) {
    style.border = `${el.borderWidth}px solid ${el.borderColor}`
  }
  return style
}

function paragraphStyle(p: PptxParagraph): Record<string, string> {
  return {
    textAlign: p.align,
    lineHeight: String(p.lineHeight),
    marginTop: p.spaceBefore ? `${p.spaceBefore}px` : '0',
    paddingLeft: p.lvl ? `${p.lvl * 24}px` : '0',
  }
}

function runStyle(run: PptxParagraph['runs'][number]): Record<string, string> {
  const decorations: string[] = []
  if (run.underline) decorations.push('underline')
  if (run.strike) decorations.push('line-through')
  const style: Record<string, string> = {
    fontSize: `${run.size}px`,
    color: run.color,
    fontWeight: run.bold ? '700' : '400',
    fontStyle: run.italic ? 'italic' : 'normal',
    fontFamily: run.font ? `"${run.font}", ${FONT_FALLBACK}` : FONT_FALLBACK,
  }
  if (decorations.length) style.textDecoration = decorations.join(' ')
  if (run.baseline > 0) style.verticalAlign = 'super'
  else if (run.baseline < 0) style.verticalAlign = 'sub'
  return style
}

/** 项目符号字号跟随该段第一个 run */
function bulletStyle(p: PptxParagraph): Record<string, string> {
  const first = p.runs[0]
  return {
    fontSize: `${(first?.size ?? 16) * 0.9}px`,
    color: first?.color ?? '#000',
  }
}

function isEmptyParagraph(p: PptxParagraph): boolean {
  return p.runs.every((r) => !r.text)
}
</script>

<template>
  <div
    class="pptx-slide"
    :style="{
      width: `${props.width}px`,
      height: `${props.height}px`,
      background: props.slide.background,
    }"
  >
    <template v-for="(el, i) in props.slide.elements" :key="i">
      <!-- 图片 -->
      <img
        v-if="el.kind === 'image'"
        class="pptx-el pptx-img"
        :style="boxStyle(el)"
        :src="el.src"
        alt=""
        draggable="false"
      />

      <!-- 文本 / 形状 -->
      <div v-else-if="el.kind === 'shape'" class="pptx-el pptx-shape" :style="shapeStyle(el)">
        <div
          v-for="(p, pi) in el.paragraphs"
          :key="pi"
          class="pptx-p"
          :style="paragraphStyle(p)"
        >
          <template v-if="isEmptyParagraph(p)">&nbsp;</template>
          <template v-else>
            <span v-if="p.bullet" class="pptx-bullet" :style="bulletStyle(p)">{{
              p.bullet === '#' ? `${pi + 1}.` : p.bullet
            }}</span
            ><span v-for="(run, ri) in p.runs" :key="ri" :style="runStyle(run)">{{
              run.text
            }}</span>
          </template>
        </div>
      </div>

      <!-- 表格 -->
      <div v-else-if="el.kind === 'table'" class="pptx-el pptx-table-wrap" :style="boxStyle(el)">
        <table class="pptx-table">
          <colgroup>
            <col v-for="(w, ci) in el.colWidths" :key="ci" :style="{ width: `${w}px` }" />
          </colgroup>
          <tbody>
            <tr v-for="(row, ri) in el.rows" :key="ri" :style="{ height: `${row.height}px` }">
              <template v-for="(cell, ci) in row.cells" :key="ci">
                <td
                  v-if="!cell.merged"
                  :colspan="cell.colSpan > 1 ? cell.colSpan : undefined"
                  :rowspan="cell.rowSpan > 1 ? cell.rowSpan : undefined"
                  :style="{ background: cell.fill }"
                >
                  <div
                    v-for="(p, pi) in cell.paragraphs"
                    :key="pi"
                    class="pptx-p"
                    :style="paragraphStyle(p)"
                  >
                    <span v-for="(run, ri2) in p.runs" :key="ri2" :style="runStyle(run)">{{
                      run.text
                    }}</span>
                  </div>
                </td>
              </template>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 图表等暂不支持的内容 -->
      <div v-else class="pptx-el pptx-unsupported" :style="boxStyle(el)">
        {{ el.label }}暂不支持渲染
      </div>
    </template>
  </div>
</template>

<style scoped>
.pptx-slide {
  position: relative;
  overflow: hidden;
  /* transform-origin 由使用方决定（主视图居中缩放、缩略图左上角缩放） */
  flex: none;
}

.pptx-el {
  position: absolute;
  box-sizing: border-box;
}

.pptx-img {
  object-fit: contain;
  user-select: none;
}

.pptx-shape {
  display: flex;
  flex-direction: column;
  /* 文本溢出形状时不裁掉，和 PowerPoint 的表现一致 */
  overflow: visible;
}

.pptx-p {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.pptx-bullet {
  margin-right: 6px;
}

.pptx-table-wrap {
  overflow: hidden;
}

.pptx-table {
  width: 100%;
  height: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

.pptx-table td {
  border: 1px solid rgba(0, 0, 0, 0.18);
  padding: 4px 8px;
  vertical-align: middle;
  overflow: hidden;
}

.pptx-unsupported {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed rgba(0, 0, 0, 0.25);
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.03);
  color: rgba(0, 0, 0, 0.45);
  font-size: 13px;
}
</style>
