/**
 * 输入框 @ 菜单的 HTML 模板（供 tribute 插件的 menuItemTemplate / noMatchTemplate 等使用）。
 *
 * 结构参考 enterprise-ai-assistant 的 constants/customInput.ts，
 * 类名统一用 chat-mention 前缀，样式写在 index.vue 的全局样式里。
 */
import type { MentionFile } from './mentionFiles'

/** tribute 会把这些字符串塞进 innerHTML，文件名是用户可控内容，必须转义 */
function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatSize(bytes: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** 单个候选项：缩略图 + 文件名 + 目录/大小 */
export function menuItemTemplate(item: { original: MentionFile }): string {
  const f = item.original
  const meta = [f.dir ? `/${f.dir}` : '根目录', formatSize(f.size)]
    .filter(Boolean)
    .join(' · ')
  return `<div class="chat-mention__item">
      <img class="chat-mention__thumb" src="${escapeHtml(f.url)}" alt="" />
      <div class="chat-mention__detail">
        <span class="chat-mention__name">${escapeHtml(f.name)}</span>
        <span class="chat-mention__meta">${escapeHtml(meta)}</span>
      </div>
    </div>`
}

/** 无匹配结果 */
export function noMatchTemplate(): string {
  return `<div class="chat-mention__empty">未找到相关图片</div>`
}

/** 异步加载中 */
export function loadingItemTemplate(): string {
  return `<div class="chat-mention__loading">加载中...</div>`
}

/**
 * 选中后回填到输入框的内容。
 * 输入框是 contenteditable，回显成不可编辑的 chip：
 * - `contenteditable="false"` 让它整块选中/删除，和自动化任务模板里的 chip 行为一致
 * - `data-mention-url` 用于和 pendingAttachments 对应，chip 被删掉时移除附件
 * - `data-text-val` 是提交时取的文本值，buildFullMessage 会读它
 */
export function selectTemplate(item?: { original: MentionFile }): string {
  if (!item) return ''
  const f = item.original
  return (
    `<span contenteditable="false" class="chat-mention__chip"` +
    ` data-mention-url="${escapeHtml(f.url)}"` +
    ` data-text-val="${escapeHtml(f.name)}"` +
    `>@${escapeHtml(f.name)}</span>`
  )
}
