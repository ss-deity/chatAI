/**
 * 输入框插入模板节点类型定义（抄自 enterprise-genclaw 的 customInput/inputTemplates.ts）
 *
 * - text : 纯文本
 * - com  : Vue 组件（通过已注册的 vcRenderer 名称引用）
 * - el   : 原生 DOM 元素（仅展示用，不可编辑）
 */

export type TextTemplateNode = {
  type: 'text'
  text: string
}

export type ComTemplateNode = {
  type: 'com'
  /** 与 registerVcRenderer 注册时使用的 name 保持一致 */
  name: string
  /** 组件初始状态，插入时写入 data-vc-state，仅插入瞬间生效 */
  init?: Record<string, unknown>
}

export type ElTemplateNode = {
  type: 'el'
  /** 标签名，默认 span */
  el?: string
  /** 展示文字 */
  text: string
  /** 提交时取的业务值，存到 data-el-val */
  val: string
  /** 附加 class */
  class?: string
}

export type InputTemplateNode = TextTemplateNode | ComTemplateNode | ElTemplateNode

/** 定时任务模板 */
export const TIMING_TEMPLATE: InputTemplateNode[] = [
  { type: 'text', text: '设置 ' },
  { type: 'com', name: 'TimeCom', init: { freq: 'daily', time: '10:00' } },
  { type: 'text', text: ' 的自动定时任务，任务内容是：' },
]

/** 事件触发任务模板 */
export const EVENT_TEMPLATE: InputTemplateNode[] = [
  { type: 'text', text: '在 ' },
  { type: 'com', name: 'SelectFile' },
  { type: 'text', text: ' 中，如果' },
  {
    type: 'el',
    el: 'span',
    text: '「有新增文件」',
    val: '有新增文件',
    class: 'wp-chat-input-temp-span',
  },
  { type: 'text', text: '时，执行' },
  {
    type: 'el',
    el: 'span',
    text: '「通知给我」',
    val: '通知给我',
    class: 'wp-chat-input-temp-span',
  },
  { type: 'text', text: '操作' },
]

/** 任务 key -> 模板 */
export const AUTO_TASK_TEMPLATE_MAP: Record<string, InputTemplateNode[]> = {
  timing: TIMING_TEMPLATE,
  event: EVENT_TEMPLATE,
}
