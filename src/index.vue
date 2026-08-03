<script setup lang="ts">
import { ref, reactive, computed, nextTick, onMounted, onBeforeUnmount, watch, h, render, getCurrentInstance } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import SideBar from './components/SideBar/index.vue'
import LoginPage from './components/Login/index.vue'
import RegisterPage from './components/Register/index.vue'
import SettingsPanel from './components/Settings/index.vue'
import FileManager from './components/FileManager/index.vue'
import ModelSelect from './components/ModelSelect/index.vue'
import ImageCard from './components/ImageCard/index.vue'
import FileGrid from './components/FileGrid/index.vue'
import { DEFAULT_MODEL_TYPE, getModel } from './config/models'
import { fetchSSE, cancelSSE } from './utils/sse'
import {
  MODEL_UPLOAD_CONFIG,
  checkFileFormat,
  checkFileSize,
  checkImageResolution,
  compressImage,
  uploadToServer,
  nextAttachmentUid,
  isImageMime,
  type Attachment,
  type RemoteAttachment,
  type UploadConfig,
} from './utils/uploadFile'
import Tribute from './plugin/tribute'
import ChatInput from './components/ChatInput/index.vue'
import AutoTask from './components/AutoTask/autoTask.vue'
import TimeCom from './components/TimeCom/index.vue'
import SelectFile, { type SelectedFolder } from './components/AutoTask/selectFile.vue'
import {
  AUTO_TASK_TEMPLATE_MAP,
  type InputTemplateNode,
} from './components/AutoTask/inputTemplates'
import { selectedAutoTaskKey, clearAutoTaskSelection } from './composables/useAutoTask'
import { autoTaskMap } from './components/AutoTask/const'
import { fetchMentionImages, type MentionFile } from './utils/mentionFiles'
import {
  menuItemTemplate,
  noMatchTemplate,
  loadingItemTemplate,
  selectTemplate,
} from './utils/tributeTemplates'
import type { SSEController } from './utils/sse'

const route = useRoute()
const router = useRouter()

// marked 配置：兼容 GFM，换行转 <br>，同步返回字符串（用于流式渲染）
marked.setOptions({
  gfm: true,
  breaks: true,
  async: false,
})

interface Message {
  role: 'user' | 'assistant'
  content: string
  /** 生成的图片（如即梦图片生成），按图片组件渲染 */
  images?: string[]
  /** 用户消息附带的附件（图片/文档），发消息时随请求上传给后端 */
  attachments?: RemoteAttachment[]
}

interface ChatConversation {
  id: string
  name: string
  /** 最近活跃时间（ISO 字符串），用于侧边栏按日期分组 */
  updatedAt?: string
}

interface UserInfo {
  id: string
  uid: string
  username: string
  nickname: string
  avatar: string
}

/**
 * 单个会话在前端的运行时状态（参考 enterprise-genclaw 的多轮实现）。
 * 每个会话独立保存自己的消息列表、loading/paused、后端 sessionId 等，
 * 切换侧边栏只切换 activeChatId，不打断任何已有的流。
 */
interface SessionState {
  messages: Message[]
  loading: boolean
  paused: boolean
  /** 后端为本次流式返回分配的 sessionId，用于 pause/resume/cancel 接口 */
  sessionId: string
  /** 当前正在被 token 追加的 assistant 消息下标；无流式时为 -1 */
  assistantIndex: number
}

type AuthPage = 'login' | 'register'

const inputText = ref('')
const chatListRef = ref<HTMLElement | null>(null)
const chatInputRef = ref<InstanceType<typeof ChatInput> | null>(null)
/** ChatInput 内部的 contenteditable 元素：tribute 挂载点、模板插入与文本提取都作用于它 */
const inputRef = ref<HTMLElement | null>(null)
const activeChatId = ref('')
const conversations = ref<ChatConversation[]>([])

/** 当前选中的模型 type（默认 DeepSeek-V4），发送会话时随请求带给后端 */
const selectedModel = ref(DEFAULT_MODEL_TYPE)

/** 深度思考（reasoning）开关，默认关闭；只有支持的模型（如 DeepSeek）显示按钮 */
const deepThinking = ref(false)

/** 当前模型是否支持"深度思考" */
const supportsThinking = computed(
  () => getModel(selectedModel.value).supportsThinking === true,
)

/** 切模型时，若新模型不支持深度思考则自动关闭，避免残留状态 */
watch(selectedModel, () => {
  if (!supportsThinking.value) deepThinking.value = false
  // 切模型时：新模型不接受的附件直接丢弃并 toast
  const cfg = uploadConfig.value
  if (!cfg) {
    if (pendingAttachments.value.length) {
      pendingAttachments.value = []
      ElMessage.warning('当前模型不支持附件上传，已清空')
    }
    return
  }
  const before = pendingAttachments.value.length
  pendingAttachments.value = pendingAttachments.value.filter((a) =>
    checkFileFormat({ name: a.name, type: a.type }, cfg.fileType),
  )
  if (pendingAttachments.value.length < before) {
    ElMessage.warning('部分附件不被当前模型支持，已移除')
  }
  if (pendingAttachments.value.length > cfg.maxCount) {
    pendingAttachments.value = pendingAttachments.value.slice(0, cfg.maxCount)
    ElMessage.warning(`当前模型最多允许 ${cfg.maxCount} 个附件`)
  }
})

/* ---------- 附件上传 ---------- */

/** 待发送附件；submit 成功后清空。上传中的项会被 submit 拦截 */
const pendingAttachments = ref<Attachment[]>([])
const fileInputRef = ref<HTMLInputElement | null>(null)

/** 当前模型的上传规则，null 表示不支持上传 */
const uploadConfig = computed<UploadConfig | null>(
  () => MODEL_UPLOAD_CONFIG[selectedModel.value] ?? null,
)

const supportsUpload = computed(() => !!uploadConfig.value)

const uploadAccept = computed(() => uploadConfig.value?.fileType ?? '')

const uploadTooltip = computed(() => uploadConfig.value?.hitWord ?? '添加附件')

function pickFile() {
  if (!supportsUpload.value) return
  if (!currentUser.value?.id) {
    ElMessage.warning('请先登录再上传附件')
    return
  }
  fileInputRef.value?.click()
}

async function onFileInputChange(e: Event) {
  const input = e.target as HTMLInputElement
  const files = input.files
  if (!files || !files.length) return
  await handleFilesSelected(Array.from(files))
  // 允许连续选同一文件
  setTimeout(() => {
    if (input) input.value = ''
  }, 100)
}

/** 粘贴触发的图片上传（仅支持图片的模型下有意义） */
/** 统一入口：校验 -> 压缩 -> 上传，全流程带 UI 反馈 */
async function handleFilesSelected(rawFiles: File[]) {
  const cfg = uploadConfig.value
  if (!cfg) {
    ElMessage.warning('当前模型不支持附件上传')
    return
  }
  const userId = currentUser.value?.id
  if (!userId) {
    ElMessage.warning('请先登录再上传附件')
    return
  }

  // 1) 类型
  let arr = rawFiles.filter((f) => {
    const ok = checkFileFormat(f, cfg.fileType)
    if (!ok) ElMessage.error(`${f.name} 格式不支持`)
    return ok
  })
  // 2) 大小
  arr = arr.filter(checkFileSize)
  // 3) 图片分辨率（仅 jimeng 之类配置了 resolution 的场景）
  if (cfg.resolution) {
    const results = await Promise.all(arr.map((f) => checkImageResolution(f, cfg.resolution!)))
    arr = arr.filter((_, i) => results[i])
  }
  if (!arr.length) return
  // 4) 数量上限
  const remaining = cfg.maxCount - pendingAttachments.value.length
  if (remaining <= 0) {
    ElMessage.error(`最多只能上传 ${cfg.maxCount} 个附件`)
    return
  }
  if (arr.length > remaining) {
    ElMessage.warning(`超过数量上限，仅保留前 ${remaining} 个`)
    arr = arr.slice(0, remaining)
  }
  // 5) 图片按需压缩
  arr = await Promise.all(
    arr.map((f) => compressImage(f, cfg.maxImgCompressLimit, cfg.targetCompressMB)),
  )

  // 6) 生成本地占位并触发上传
  for (const file of arr) {
    const uid = nextAttachmentUid()
    const thumbnail = isImageMime(file.type) ? URL.createObjectURL(file) : ''
    const placeholder: Attachment = {
      uid,
      name: file.name,
      type: file.type,
      size: file.size,
      thumbnail,
      status: 'uploading',
    }
    pendingAttachments.value.push(placeholder)
    // 异步上传，成功/失败回填状态
    void uploadToServer(file, userId, 'chat')
      .then((url) => {
        const target = pendingAttachments.value.find((it) => it.uid === uid)
        if (target) {
          target.url = url
          target.status = 'success'
        }
      })
      .catch(() => {
        const target = pendingAttachments.value.find((it) => it.uid === uid)
        if (target) target.status = 'failed'
        ElMessage.error(`${file.name} 上传失败`)
      })
  }
}

function removeAttachment(uid: string) {
  mentionTokens.delete(uid)
  const idx = pendingAttachments.value.findIndex((a) => a.uid === uid)
  if (idx < 0) return
  const target = pendingAttachments.value[idx]
  // 释放本地 object URL
  if (target.thumbnail && target.thumbnail.startsWith('blob:')) {
    URL.revokeObjectURL(target.thumbnail)
  }
  pendingAttachments.value.splice(idx, 1)
}

/** 用于历史消息附件的只读展示：把 RemoteAttachment 转成 FileGrid 需要的形状 */
function toAttachmentDisplay(list: RemoteAttachment[]): Attachment[] {
  return list.map((a, i) => ({
    uid: `hist_${i}_${a.url}`,
    name: a.name,
    type: a.type,
    size: a.size,
    thumbnail: isImageMime(a.type) ? a.url : '',
    url: a.url,
    status: 'success' as const,
  }))
}

/* ---------- 输入框 @ 唤起文件管理图片（tribute 插件） ---------- */

/**
 * @ 选进来的附件：uid -> 输入框里对应 chip 的 data-mention-url。
 * 用户删掉 chip 时，据此把附件一起移除，避免"看不见却还会发出去"。
 */
const mentionTokens = new Map<string, string>()

/** tribute 实例；只在支持图片的模型下挂载 */
let tribute: Tribute<MentionFile> | null = null

/** @ 是否可用：当前模型允许上传图片才有意义 */
const mentionEnabled = computed(
  () => !!uploadConfig.value && uploadConfig.value.fileType.includes('image/'),
)

/** values 回调防抖，避免每敲一个字都打一次接口 */
let mentionTimer: ReturnType<typeof setTimeout> | null = null
function loadMentionValues(keyword: string, cb: (list: MentionFile[]) => void) {
  if (mentionTimer) clearTimeout(mentionTimer)
  mentionTimer = setTimeout(() => {
    const userId = currentUser.value?.id
    if (!userId) return cb([])
    fetchMentionImages(userId, keyword)
      .then(cb)
      .catch(() => cb([]))
  }, 200)
}

/**
 * @ 选中一张图片：文件已在 BOS 上，直接按"上传成功"的附件加入待发送列表，
 * 无需再走一次上传。
 */
function handleMentionReplaced(e: Event) {
  const detail = (e as CustomEvent).detail as { item?: { original?: MentionFile } }
  const file = detail?.item?.original
  if (!file) return
  const cfg = uploadConfig.value
  if (!cfg) return

  if (!checkFileFormat({ name: file.name, type: file.type }, cfg.fileType)) {
    ElMessage.error(`${file.name} 格式不被当前模型支持`)
    return
  }
  if (pendingAttachments.value.some((a) => a.url === file.url)) {
    return
  }
  if (pendingAttachments.value.length >= cfg.maxCount) {
    ElMessage.error(`最多只能带 ${cfg.maxCount} 个附件`)
    return
  }

  const uid = nextAttachmentUid()
  pendingAttachments.value.push({
    uid,
    name: file.name,
    type: file.type,
    size: file.size,
    thumbnail: file.url,
    url: file.url,
    status: 'success',
  })
  mentionTokens.set(uid, file.url)
}

/**
 * 输入框内容变化后校对：对应的 @ chip 被删掉时同步移除附件。
 * contenteditable 下 @ 回显是 `data-mention-url` 的 chip 节点，按节点而非文本比对。
 */
function syncMentionAttachments() {
  const el = inputRef.value
  const aliveUrls = new Set(
    el
      ? Array.from(el.querySelectorAll<HTMLElement>('[data-mention-url]')).map(
          (n) => n.dataset.mentionUrl as string,
        )
      : [],
  )
  for (const [uid, url] of [...mentionTokens.entries()]) {
    // 附件已被别处移除（如切模型时过滤），只清理记录
    if (!pendingAttachments.value.some((a) => a.uid === uid)) {
      mentionTokens.delete(uid)
      continue
    }
    if (!aliveUrls.has(url)) {
      removeAttachment(uid)
    }
  }
}

/**
 * tribute 以 capture 方式接管了 Enter，并派发 shift-enter / ctrl-enter，
 * 默认换行因此失效。ChatInput 那两个事件已通过 exclude-events 排除（否则会当成发送），
 * 这里用 execCommand 在 contenteditable 光标处插入换行，并存一次撤销快照。
 */
function insertNewlineAtCaret() {
  const el = inputRef.value
  if (!el) return
  el.focus()
  chatInputRef.value?.saveSnapshot?.()
  document.execCommand('insertLineBreak')
}

function initTribute(el: HTMLElement) {
  tribute = new Tribute<MentionFile>({
    trigger: '@',
    iframe: false,
    fixedPosition: 'top',
    autocompleteMode: false,
    requireLeadingSpace: false,
    allowSpaces: false,
    spaceSelectsMatch: false,
    menuShowMinLength: 0,
    menuItemLimit: 50,
    selectClass: 'is-selected',
    containerClass: 'chat-mention__list',
    itemClass: '',
    menuContainer: document.body,
    loadingItemTemplate: loadingItemTemplate(),
    // 服务端已按 keyword 过滤，跳过前端模糊匹配，保持后端返回顺序
    searchOpts: { pre: '', post: '', skip: true },
    lookup: 'name',
    fillAttr: 'name',
    values: loadMentionValues,
    menuItemTemplate,
    noMatchTemplate,
    selectTemplate,
  })
  tribute.attach(el)
  el.addEventListener('tribute-replaced', handleMentionReplaced)
  el.addEventListener('shift-enter', insertNewlineAtCaret)
  el.addEventListener('ctrl-enter', insertNewlineAtCaret)
}

function destroyTribute(el: HTMLElement) {
  el.removeEventListener('tribute-replaced', handleMentionReplaced)
  el.removeEventListener('shift-enter', insertNewlineAtCaret)
  el.removeEventListener('ctrl-enter', insertNewlineAtCaret)
  tribute?.detach(el)
  tribute = null
}

/**
 * 输入框元素会随登录态/路由切换被销毁重建，模型切换又决定 @ 是否可用，
 * 所以统一用 watch 在这两个条件变化时重新挂载。
 */
watch(
  [inputRef, mentionEnabled],
  ([el], [prevEl]) => {
    if (prevEl && (prevEl !== el || !mentionEnabled.value)) {
      destroyTribute(prevEl)
    }
    if (el && mentionEnabled.value && !tribute) {
      initTribute(el)
    }
  },
  { flush: 'post' },
)

onBeforeUnmount(() => {
  if (inputRef.value) destroyTribute(inputRef.value)
})

/* ---------- 自动化任务：模板插入（抄自 enterprise-genclaw 的 customInput） ---------- */

const appContext = getCurrentInstance()?.appContext ?? null

/** TimeCom 的值格式化成提交用的文本 */
function formatTimeComValue(val: {
  freq: string
  days?: (string | number)[]
  time: string
}): string {
  const freqLabel: Record<string, string> = {
    once: '',
    daily: '每天',
    workday: '工作日',
    weekly: '每周',
    monthly: '每月',
    interval: '每隔',
  }
  const label = freqLabel[val.freq] ?? ''
  if (val.freq === 'weekly' || val.freq === 'monthly') {
    const days = (val.days ?? []).join('、')
    return `${label}${days ? days + ' ' : ''}${val.time}`
  }
  return val.time ? `${label}${val.time}` : label
}

/**
 * 行内 Vue 组件的挂载器。undo / 粘贴还原 innerHTML 后，ChatInput 会按
 * data-vc-type 重新调用这里的 mounter，data-vc-state 保存着上次的组件状态。
 */
const vcMounterMap: Record<string, (el: HTMLElement) => void> = {
  TimeCom: (el) => {
    let initVal: { freq?: string; days?: (string | number)[]; time?: string } | undefined
    if (el.dataset.vcState) {
      try {
        initVal = JSON.parse(el.dataset.vcState)
      } catch {
        initVal = undefined
      }
    }
    const vnode = h(TimeCom, {
      init: initVal,
      disablePast: true,
      onChange: (val: { freq: string; days?: (string | number)[]; time: string }) => {
        el.dataset.textVal = formatTimeComValue(val)
        // 每次变化都同步序列化到 DOM，保证 copy / undo 时状态可还原
        el.dataset.vcState = JSON.stringify(val)
      },
    })
    if (appContext) vnode.appContext = appContext
    render(vnode, el)
  },
  SelectFile: (el) => {
    let initFiles: SelectedFolder[] | undefined
    if (el.dataset.vcState) {
      try {
        initFiles = JSON.parse(el.dataset.vcState)
      } catch {
        initFiles = undefined
      }
    }
    const vnode = h(SelectFile, {
      init: initFiles,
      userId: String(currentUser.value?.id ?? ''),
      onChange: (files: SelectedFolder[]) => {
        el.dataset.textVal = files.length
          ? `文件管理目录：${files.map((f) => f.path || '/').join(',')}`
          : ''
        el.dataset.vcState = JSON.stringify(files)
        // 选完把光标移到组件之后，方便接着输入
        const host = inputRef.value
        if (host && host.contains(el) && el.parentNode) {
          host.focus()
          const range = document.createRange()
          const idx = Array.from(el.parentNode.childNodes).indexOf(el)
          range.setStart(el.parentNode, idx + 1)
          range.collapse(true)
          const sel = window.getSelection()
          sel?.removeAllRanges()
          sel?.addRange(range)
        }
      },
    })
    if (appContext) vnode.appContext = appContext
    render(vnode, el)
  },
}

/**
 * 把模板插入输入框：
 * - text : 直接 insertText
 * - com  : 创建锚点 span，挂载对应 Vue 组件
 * - el   : 创建不可编辑的行内 DOM 元素，携带 data-el-val
 *
 * 整段插入期间 pauseSnapshot，只在开头存一次快照，保证 Cmd+Z 一次撤回整个模板。
 */
function insertFromTemplate(template: InputTemplateNode[]) {
  void nextTick(() => {
    const input = chatInputRef.value
    if (!input) return
    input.pauseSnapshot?.()
    input.clear?.()
    input.saveSnapshot?.()

    for (const node of template) {
      if (node.type === 'text') {
        input.insertText?.(node.text)
      } else if (node.type === 'com') {
        const mounter = vcMounterMap[node.name]
        if (!mounter) continue
        const container = document.createElement('span')
        container.setAttribute('contenteditable', 'false')
        container.setAttribute('data-vc-type', node.name)
        if (node.init) container.dataset.vcState = JSON.stringify(node.init)
        mounter(container)
        input.insertElement?.(container)
      } else {
        const tag = node.el ?? 'span'
        const el = document.createElement(tag)
        el.setAttribute('contenteditable', 'false')
        el.setAttribute('data-el-val', node.val)
        if (node.class) el.className = node.class
        el.textContent = node.text
        input.insertElement?.(el)
      }
    }

    input.resumeSnapshot?.()
  })
}

// 注册 vc 渲染器：undo / 粘贴恢复 innerHTML 后由 ChatInput 自动重新挂载组件
watch(
  chatInputRef,
  (input) => {
    inputRef.value = (input?.inputEl as HTMLElement | undefined) ?? null
    if (!input) return
    for (const [name, mounter] of Object.entries(vcMounterMap)) {
      input.registerVcRenderer?.(name, mounter)
    }
  },
  { flush: 'post' },
)

// 选中自动化任务 -> 插入对应模板（取消选中时不清空输入框，与 genclaw 一致）
watch(selectedAutoTaskKey, (key) => {
  if (!key) return
  const tpl = AUTO_TASK_TEMPLATE_MAP[key]
  if (tpl) insertFromTemplate(tpl)
})

/**
 * 提交时从 contenteditable 提取完整文本：
 * - 普通文本节点原样取
 * - contenteditable=false 的节点优先取 data-text-val（TimeCom / SelectFile / @ chip），
 *   否则取 data-el-val（「有新增文件」这类 chip）
 * - BR / DIV / P 还原换行
 */
function buildFullMessage(): string {
  const host = inputRef.value
  if (!host) return inputText.value

  const extract = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    const el = node as HTMLElement
    if (el.getAttribute('contenteditable') === 'false') {
      if (el.dataset.textVal !== undefined) return el.dataset.textVal
      if (el.dataset.elVal !== undefined) return el.dataset.elVal
      return ''
    }
    if (el.tagName === 'BR') return '\n'
    if (el.tagName === 'DIV' || el.tagName === 'P') {
      const inner = Array.from(el.childNodes).map(extract).join('')
      return inner.replace(/\n$/, '') + '\n'
    }
    return Array.from(el.childNodes).map(extract).join('')
  }

  return Array.from(host.childNodes).map(extract).join('')
}

/**
 * 粘贴处理（抄自 enterprise-genclaw 的 handlePaste）：
 * - 含 data-vc-type：交给 ChatInput，由它负责重新挂载 Vue 组件
 * - 含 data-el-val / data-text-val：用 insertHTML 保留 span 结构
 * - 纯文本：insertHTML 且 \n 转 <br>，粘贴前存快照，Cmd+Z 可精确回到粘贴前
 */
function handlePaste(e: ClipboardEvent) {
  // 剪贴板里有图片文件：走上传逻辑（保持原 textarea 时代的粘贴上传能力）
  const items = e.clipboardData?.items
  if (supportsUpload.value && items && items.length) {
    const pastedFiles: File[] = []
    for (let i = 0; i < items.length; i += 1) {
      if (items[i].kind !== 'file') continue
      const f = items[i].getAsFile?.()
      if (f) pastedFiles.push(f)
    }
    if (pastedFiles.length) {
      e.preventDefault()
      e.stopImmediatePropagation()
      void handleFilesSelected(pastedFiles)
      return
    }
  }

  const html = e.clipboardData?.getData('text/html') || ''
  const plain = e.clipboardData?.getData('text/plain') || ''

  if (html && new DOMParser().parseFromString(html, 'text/html').querySelector('[data-vc-type]')) {
    // vc 组件粘贴交给 ChatInput 接管
    return
  }

  e.preventDefault()
  e.stopImmediatePropagation()

  type Segment =
    | { type: 'text'; text: string }
    | { type: 'span'; label: string; attrs: Record<string, string>; cls?: string }
  const segments: Segment[] = []

  if (html) {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const hasChip = doc.querySelector('[data-el-val],[data-text-val]')
    if (!hasChip && plain) {
      segments.push({ type: 'text', text: plain })
    } else {
      const walk = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent || ''
          if (text) segments.push({ type: 'text', text })
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as HTMLElement
          if (el.tagName === 'SPAN' && (el.dataset.elVal !== undefined || el.dataset.textVal !== undefined)) {
            const attrs: Record<string, string> = {}
            if (el.dataset.elVal !== undefined) attrs['data-el-val'] = el.dataset.elVal
            if (el.dataset.textVal !== undefined) attrs['data-text-val'] = el.dataset.textVal
            if (el.dataset.mentionUrl !== undefined) attrs['data-mention-url'] = el.dataset.mentionUrl
            segments.push({ type: 'span', label: el.textContent || '', attrs, cls: el.className || undefined })
          } else if (el.tagName === 'BR') {
            segments.push({ type: 'text', text: '\n' })
          } else {
            el.childNodes.forEach(walk)
          }
        }
      }
      doc.body.childNodes.forEach(walk)
    }
  } else if (plain) {
    segments.push({ type: 'text', text: plain })
  }

  if (!segments.length) return

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const escAttr = (s: string) => esc(s).replace(/"/g, '&quot;')

  // 粘贴前保存快照：把"粘贴前状态"写入 undo 栈
  chatInputRef.value?.saveSnapshot?.()

  const htmlStr = segments
    .map((s) => {
      if (s.type === 'text') return esc(s.text).replace(/\n/g, '<br>')
      const attrStr = Object.entries(s.attrs)
        .map(([k, v]) => `${k}="${escAttr(v)}"`)
        .join(' ')
      return `<span contenteditable="false" class="${escAttr(s.cls || 'wp-chat-input-temp-span')}" ${attrStr}>${esc(s.label)}</span>`
    })
    .join('')
  document.execCommand('insertHTML', false, htmlStr)

  void nextTick(handleInputChange)
}

/**
 * 是否处于"贴底"状态。用户手动上滑查看历史时置为 false，
 * 流式 token 追加时只有 stickToBottom 才自动滚动，避免"抽搐"。
 */
const stickToBottom = ref(true)

/** 用 rAF 合帧的调度标记，避免每个 token 都触发一次 reflow */
let scrollScheduled = false
/** 标记当前 scrollTop 是我们自己写入的，防止 scroll 事件误判为用户操作 */
let isProgrammaticScroll = false

// 登录状态
const isLoggedIn = ref(false)
const currentUser = ref<UserInfo | null>(null)
const authToken = ref('')
const authPage = ref<AuthPage>('login')

// 设置面板
const showSettings = ref(false)

/**
 * 多会话状态表：key = 真实 conversationId（数字字符串） 或 "pending_xxx"（新对话未落库前）。
 * 使用 reactive 让 Vue 感知内部字段变化。
 */
const sessionStates = reactive<Record<string, SessionState>>({})

/**
 * SSE 控制器实例不参与响应式，用普通 Map 存放，key 与 sessionStates 一致。
 */
const sessionControllers = new Map<string, SSEController>()

/** 计数器：为尚未拿到 conversationId 的新对话生成一个临时 key */
let pendingCounter = 0

// 展示层：当前活动会话的状态
const activeSession = computed<SessionState | undefined>(() =>
  activeChatId.value ? sessionStates[activeChatId.value] : undefined,
)
const messages = computed<Message[]>(() => activeSession.value?.messages ?? [])
const loading = computed<boolean>(() => activeSession.value?.loading ?? false)
const paused = computed<boolean>(() => activeSession.value?.paused ?? false)

// 检查本地存储的登录态
onMounted(() => {
  const savedData = localStorage.getItem('chatai_auth')
  if (savedData) {
    try {
      const parsed = JSON.parse(savedData)
      currentUser.value = parsed.user
      authToken.value = parsed.token
      isLoggedIn.value = true
      void refreshCurrentUser()
      void loadConversations()
      // 刷新时若 URL 指向某个会话，直接打开它（停留在当前会话，不跳回首页）
      if (route.name === 'chat' && route.params.id) {
        void openConversation(String(route.params.id))
      }
    } catch {
      localStorage.removeItem('chatai_auth')
    }
  }
  // 恢复主题
  const savedTheme = localStorage.getItem('chatai_theme')
  if (savedTheme) {
    document.documentElement.setAttribute('data-theme', savedTheme)
  }
})

/**
 * 拉取数据库中的最新用户信息（头像、用户名）
 */
async function refreshCurrentUser() {
  if (!currentUser.value?.id) return
  try {
    const response = await fetch(
      `/api/users/${encodeURIComponent(currentUser.value.id)}`,
    )
    if (!response.ok) return
    const result = await response.json()
    if (result.code === 0 && result.data) {
      currentUser.value = result.data
      const authData = { token: authToken.value, user: result.data }
      localStorage.setItem('chatai_auth', JSON.stringify(authData))
    }
  } catch (error) {
    console.error('刷新用户信息失败', error)
  }
}

function handleAuthSuccess(data: { token: string; user: UserInfo }) {
  currentUser.value = data.user
  authToken.value = data.token
  isLoggedIn.value = true
  localStorage.setItem('chatai_auth', JSON.stringify(data))
  void loadConversations()
}

function handleLogout() {
  // 登出前中止所有正在流式的会话
  for (const [key, controller] of sessionControllers.entries()) {
    controller.abort()
    const state = sessionStates[key]
    if (state?.sessionId) {
      cancelSSE('/api', state.sessionId)
    }
  }
  sessionControllers.clear()
  for (const key of Object.keys(sessionStates)) {
    delete sessionStates[key]
  }

  isLoggedIn.value = false
  currentUser.value = null
  authToken.value = ''
  conversations.value = []
  activeChatId.value = ''
  localStorage.removeItem('chatai_auth')
}

function handleUpdateUser(user: UserInfo) {
  currentUser.value = user
  // 更新本地存储
  const authData = { token: authToken.value, user }
  localStorage.setItem('chatai_auth', JSON.stringify(authData))
}

function scrollToBottom(force = false) {
  if (!force && !stickToBottom.value) return
  if (scrollScheduled) return
  scrollScheduled = true
  requestAnimationFrame(() => {
    scrollScheduled = false
    const el = chatListRef.value
    if (!el) return
    isProgrammaticScroll = true
    el.scrollTop = el.scrollHeight
    // 双 rAF 后再解除，避免 scroll 事件被误判为"用户上滑"
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        isProgrammaticScroll = false
      })
    })
  })
}

/**
 * 消息区滚动监听：判断用户是否仍在底部（40px 容差），
 * 用来决定后续 token 追加时是否要跟随滚动。
 */
function handleChatScroll() {
  if (isProgrammaticScroll) return
  const el = chatListRef.value
  if (!el) return
  const threshold = 40
  stickToBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight <= threshold
}

/**
 * 输入内容变化：ChatInput 自己管高度，这里只负责校对 @ 附件。
 */
function handleInputChange() {
  // @ 进来的附件若对应 chip 被删掉，同步移除附件
  syncMentionAttachments()
}

watch(activeChatId, () => {
  stickToBottom.value = true
  nextTick(() => {
    scrollToBottom(true)
  })
})

/**
 * 将 assistant 的 markdown 文本渲染为安全的 HTML。
 * 使用同步的 marked.parse + DOMPurify 净化，配合流式 token 追加即可实现打字机效果。
 */
function renderMarkdown(content: string): string {
  if (!content) return ''
  try {
    const html = marked.parse(content) as string
    return DOMPurify.sanitize(html, {
      ADD_ATTR: ['target', 'rel'],
    })
  } catch (err) {
    console.error('markdown 渲染失败', err)
    return DOMPurify.sanitize(content)
  }
}

function normalizeMessages(rawMessages: Array<{ role: string; content: string; images?: string[]; attachments?: RemoteAttachment[] }> | undefined): Message[] {
  return (rawMessages ?? []).map((item) => ({
    role: item.role === 'assistant' ? 'assistant' : 'user',
    content: item.content ?? '',
    images: item.images && item.images.length ? item.images : undefined,
    attachments: item.attachments && item.attachments.length ? item.attachments : undefined,
  }))
}

/**
 * 确保指定 key 存在一个 SessionState（不覆盖已存在的）
 */
function ensureSession(key: string): SessionState {
  if (!sessionStates[key]) {
    sessionStates[key] = {
      messages: [],
      loading: false,
      paused: false,
      sessionId: '',
      assistantIndex: -1,
    }
  }
  return sessionStates[key]
}

async function loadConversations() {
  if (!currentUser.value?.id) {
    conversations.value = []
    return
  }
  try {
    const response = await fetch(
      `/api/conversations?userId=${encodeURIComponent(currentUser.value.id)}`,
    )
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    const data = await response.json()
    conversations.value = (data ?? []).map(
      (item: { id: number; title: string; updatedAt?: string }) => ({
        id: String(item.id),
        name: item.title || '新对话',
        updatedAt: item.updatedAt,
      }),
    )
  } catch (error) {
    console.error('加载会话列表失败', error)
  }
}

/**
 * 中止指定会话的流（若在流），并清理其控制器与后端 sessionId
 */
function abortSessionStream(key: string) {
  const state = sessionStates[key]
  const controller = sessionControllers.get(key)
  controller?.abort()
  if (state?.sessionId) {
    cancelSSE('/api', state.sessionId)
  }
  sessionControllers.delete(key)
  if (state) {
    state.loading = false
    state.paused = false
    state.sessionId = ''
    state.assistantIndex = -1
  }
}

async function handleDeleteChat(id: string) {
  try {
    const response = await fetch(`/api/conversations/${id}`, {
      method: 'DELETE',
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    const data = await response.json()
    if (data.code !== 0) {
      throw new Error(data.message || '删除失败')
    }
    conversations.value = conversations.value.filter((item) => item.id !== id)

    // 若该会话正在流式，先中止它
    if (sessionStates[id]?.loading) {
      abortSessionStream(id)
    }
    // 清空会话本地状态
    delete sessionStates[id]

    // 若删除的是当前打开会话，回到"新对话"状态并清掉 URL 上的会话 id
    if (activeChatId.value === id) {
      activeChatId.value = ''
      if (route.name === 'chat') router.push('/')
    }
    ElMessage.success('已删除会话')
  } catch (error) {
    ElMessage.error('删除失败: ' + (error as Error).message)
  }
}

async function loadMessages(conversationId: string) {
  const state = ensureSession(conversationId)
  try {
    const response = await fetch(`/api/conversations/${conversationId}/messages`)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    const data = await response.json()
    state.messages = normalizeMessages(data)
    stickToBottom.value = true
    scrollToBottom(true)
  } catch (error) {
    console.error('加载历史消息失败', error)
    state.messages = []
  }
}

function handleSubmit() {
  // 输入框是 contenteditable：文本要从 DOM 提取，行内组件取 data-text-val
  const body = buildFullMessage().trim()
  if (!body) return
  // 选了自动化任务时，按 genclaw 的做法给 query 加任务前缀
  const taskTitle = autoTaskMap.find((t) => t.key === selectedAutoTaskKey.value)?.title
  const text = taskTitle ? `任务：${taskTitle}; ${body}` : body

  // 附件有上传中的项：先拦住，避免消息发出后 URL 还没回填
  if (pendingAttachments.value.some((a) => a.status === 'uploading')) {
    ElMessage.warning('附件还在上传，请稍候')
    return
  }

  // 决定这次提交所属会话 key：已选会话则用其 id，否则生成一个 pending key（新对话尚未落库）
  let key = activeChatId.value
  const isNew = !key
  if (isNew) {
    key = `pending_${++pendingCounter}_${Date.now()}`
    activeChatId.value = key
  }

  const state = ensureSession(key)
  // 当前会话已经在流式生成，避免重复提交（其他会话仍可以并发）
  if (state.loading) return

  // 只保留上传成功的附件，作为消息附件写入历史
  const succAttachments: RemoteAttachment[] = pendingAttachments.value
    .filter((a) => a.status === 'success' && a.url)
    .map((a) => ({ url: a.url as string, name: a.name, type: a.type, size: a.size }))

  state.messages.push({
    role: 'user',
    content: text,
    attachments: succAttachments.length ? succAttachments : undefined,
  })
  inputText.value = ''
  // contenteditable 需要显式清空 DOM（顺带重置 isEmpty / 多行状态）
  chatInputRef.value?.clear?.()
  clearAutoTaskSelection()
  // 清空输入区附件（本地缩略图释放 blob URL）
  for (const a of pendingAttachments.value) {
    if (a.thumbnail && a.thumbnail.startsWith('blob:')) URL.revokeObjectURL(a.thumbnail)
  }
  pendingAttachments.value = []
  mentionTokens.clear()
  state.messages.push({ role: 'assistant', content: '' })
  state.assistantIndex = state.messages.length - 1
  state.loading = true
  state.paused = false
  // 用户主动发送，视为想跟随最新回复
  stickToBottom.value = true
  scrollToBottom(true)

  const requestBody: Record<string, unknown> = { message: text }
  // 只有落库过的会话（key 是真实数字 id）才带 conversationId
  if (!isNew && key && !key.startsWith('pending_')) {
    requestBody.conversationId = Number(key)
  }
  if (currentUser.value?.id) {
    requestBody.userId = Number(currentUser.value.id)
  }
  // 带上当前选中的模型 type，后端据此选择对应模型
  requestBody.model = selectedModel.value
  // 深度思考开关（仅对支持的模型有意义），默认关闭，开启时后端会附带 thinking 参数
  if (deepThinking.value && supportsThinking.value) {
    requestBody.thinking = true
  }
  // 附件（远端 URL）随请求发送，后端保存到用户 Message 并可传给模型
  if (succAttachments.length) {
    requestBody.attachments = succAttachments
  }

  // 用闭包变量跟踪当前会话 key，收到真实 conversationId 时会重命名
  let currentKey = key

  const controller = fetchSSE({
    url: '/api/chat',
    body: requestBody,
    onSessionId(sessionId) {
      const s = sessionStates[currentKey]
      if (s) s.sessionId = sessionId
    },
    onEvent(payload) {
      if (!payload.conversationId) return
      const nextId = String(payload.conversationId)
      // 首次拿到真实 conversationId：把 pending_xxx 重命名为该 id
      if (currentKey !== nextId) {
        const s = sessionStates[currentKey]
        const c = sessionControllers.get(currentKey)
        if (s) {
          sessionStates[nextId] = s
          delete sessionStates[currentKey]
        }
        if (c) {
          sessionControllers.set(nextId, c)
          sessionControllers.delete(currentKey)
        }
        if (activeChatId.value === currentKey) {
          activeChatId.value = nextId
          // 新会话拿到真实 id：把 URL 同步为 /chat/:id，刷新后仍停留在该会话
          if (String(route.params.id) !== nextId) {
            router.replace(`/chat/${nextId}`)
          }
        }
        currentKey = nextId
      }
      // 侧边栏若没有这条会话，插入到顶部
      const existing = conversations.value.find((it) => it.id === nextId)
      if (!existing) {
        conversations.value.unshift({
          id: nextId,
          name: text.slice(0, 50) || '新对话',
          updatedAt: new Date().toISOString(),
        })
      }
      // 统一图片增量：后端归一化后的 images 字段，前端按图片组件渲染
      const imgs = (payload.choices as Array<{ delta?: { images?: string[] } }> | undefined)?.[0]?.delta?.images
      if (imgs && imgs.length) {
        const s = sessionStates[currentKey]
        const idx = s?.assistantIndex ?? -1
        if (s && idx >= 0 && idx < s.messages.length) {
          s.messages[idx] = {
            ...s.messages[idx],
            images: [...(s.messages[idx].images ?? []), ...imgs],
          }
          if (activeChatId.value === currentKey) scrollToBottom()
        }
      }
    },
    onMessage(content) {
      const s = sessionStates[currentKey]
      if (!s) return
      const idx = s.assistantIndex
      if (idx < 0 || idx >= s.messages.length) return
      s.messages[idx] = {
        ...s.messages[idx],
        content: s.messages[idx].content + content,
      }
      // 只有当用户仍在查看这个会话时才自动滚动
      if (activeChatId.value === currentKey) scrollToBottom()
    },
    onDone() {
      const s = sessionStates[currentKey]
      if (s) {
        s.loading = false
        s.paused = false
        s.sessionId = ''
        s.assistantIndex = -1
      }
      sessionControllers.delete(currentKey)
      if (activeChatId.value === currentKey) scrollToBottom()
      void loadConversations()
    },
    onError(error) {
      const s = sessionStates[currentKey]
      if (s) {
        const idx = s.assistantIndex
        if (idx >= 0 && idx < s.messages.length) {
          s.messages[idx] = {
            ...s.messages[idx],
            content: '请求失败: ' + error.message,
          }
        }
        s.loading = false
        s.paused = false
        s.sessionId = ''
        s.assistantIndex = -1
      }
      sessionControllers.delete(currentKey)
      void loadConversations()
    },
  })

  sessionControllers.set(key, controller)
}

function handlePause() {
  const state = activeSession.value
  const controller = activeChatId.value ? sessionControllers.get(activeChatId.value) : null
  if (!state?.loading || state.paused) return
  controller?.pause()
  state.paused = true
}

function handleResume() {
  const state = activeSession.value
  const controller = activeChatId.value ? sessionControllers.get(activeChatId.value) : null
  if (!state?.paused) return
  controller?.resume()
  state.paused = false
}

function handleStop() {
  const key = activeChatId.value
  const state = activeSession.value
  if (!key || !state?.loading) return
  abortSessionStream(key)
}

/**
 * "新建对话"：切换到空白新对话状态并回到首页路由（URL 不带会话 id）。
 */
function handleNewChat() {
  activeChatId.value = ''
  inputText.value = ''
  chatInputRef.value?.clear?.()
  clearAutoTaskSelection()
  if (route.name !== 'home') router.push('/')
}

/**
 * 打开文件管理页：跳转到 /files 路由。
 */
function handleOpenFileManager() {
  if (route.name !== 'files') router.push('/files')
}

/**
 * 打开某个会话（加载/沿用其状态）。作为路由变化的统一入口，保证刷新/前进后退一致。
 */
async function openConversation(id: string) {
  activeChatId.value = id
  inputText.value = ''
  chatInputRef.value?.clear?.()
  clearAutoTaskSelection()
  if (!sessionStates[id]) {
    await loadMessages(id)
  } else {
    stickToBottom.value = true
    scrollToBottom(true)
  }
}

/**
 * 点击侧边栏会话：把会话 id 写到 URL（/chat/:id），由路由 watch 统一打开，
 * 这样刷新时仍停留在当前会话。
 */
function handleSelectChat(id: string) {
  if (String(route.params.id) !== id) {
    router.push(`/chat/${id}`)
  } else {
    void openConversation(id)
  }
}

/**
 * 重命名会话：调用后端并更新本地列表。
 */
async function handleRenameConversation(id: string, newName: string) {
  const title = newName.trim()
  if (!title) return
  try {
    const res = await fetch(`/api/conversations/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
    const data = await res.json()
    if (data.code !== 0) throw new Error(data.message || '重命名失败')
    const conv = conversations.value.find((c) => c.id === id)
    if (conv) conv.name = title
    ElMessage.success('已重命名')
  } catch (e) {
    ElMessage.error('重命名失败: ' + (e as Error).message)
  }
}

// 路由 -> 会话：根据 URL 打开对应会话；无会话 id（首页）时回到新对话
watch(
  () => route.fullPath,
  () => {
    if (!isLoggedIn.value) return
    if (route.name === 'chat' && route.params.id) {
      const id = String(route.params.id)
      if (id !== activeChatId.value) void openConversation(id)
    } else if (route.name === 'home') {
      if (activeChatId.value !== '') {
        activeChatId.value = ''
        inputText.value = ''
        chatInputRef.value?.clear?.()
        clearAutoTaskSelection()
      }
    }
  },
)

</script>

<template>
  <!-- 未登录：显示登录或注册页 -->
  <LoginPage
    v-if="!isLoggedIn && authPage === 'login'"
    @login="handleAuthSuccess"
    @go-register="authPage = 'register'"
  />
  <RegisterPage
    v-else-if="!isLoggedIn && authPage === 'register'"
    @register="handleAuthSuccess"
    @go-login="authPage = 'login'"
  />

  <!-- 已登录：显示主界面 -->
  <div v-else class="chat-container">
    <SideBar
      :active-id="activeChatId"
      :conversations="conversations"
      :user="currentUser"
      :active-view="route.name === 'files' ? 'files' : 'chat'"
      @new-chat="handleNewChat"
      @select="handleSelectChat"
      @delete="handleDeleteChat"
      @rename="handleRenameConversation"
      @logout="handleLogout"
      @open-settings="showSettings = true"
      @open-file-manager="handleOpenFileManager"
    />

    <!-- 设置面板 -->
    <SettingsPanel
      v-if="showSettings"
      :user="currentUser"
      @close="showSettings = false"
      @update-user="handleUpdateUser"
    />

    <!-- 文件管理页 -->
    <FileManager v-if="route.name === 'files'" :user="currentUser" />

    <div v-else class="main-container">
      <div class="chat-wrapper" :class="{ 'has-work': messages.length > 0 }">
        <!-- 消息列表 -->
        <div
          v-if="messages.length > 0"
          ref="chatListRef"
          class="message-list"
          @scroll.passive="handleChatScroll"
        >
          <template v-for="(msg, idx) in messages" :key="idx">
            <div
              v-if="!(loading && msg.role === 'assistant' && msg.content === '' && (!msg.images || msg.images.length === 0) && idx === messages.length - 1)"
              class="message-item"
              :class="msg.role"
            >
              <div
                v-if="msg.role === 'assistant'"
                class="message-bubble markdown-body"
              >
                <div v-if="msg.content" v-html="renderMarkdown(msg.content)"></div>
                <ImageCard
                  v-if="msg.images && msg.images.length"
                  :images="msg.images"
                  :user-id="currentUser?.id"
                />
              </div>
              <template v-else>
                <div class="user-content-col">
                  <FileGrid
                    v-if="msg.attachments && msg.attachments.length"
                    class="user-attachments"
                    :files="toAttachmentDisplay(msg.attachments)"
                    :closable="false"
                  />
                  <div v-if="msg.content" class="message-bubble">{{ msg.content }}</div>
                </div>
              </template>
            </div>
          </template>
          <div
            v-if="loading && messages[messages.length - 1]?.role === 'assistant' && messages[messages.length - 1]?.content === '' && (!messages[messages.length - 1]?.images || messages[messages.length - 1]?.images?.length === 0)"
            class="message-item assistant"
          >
            <div class="message-bubble thinking">思考中...</div>
          </div>
        </div>

        <!-- 首屏 Hero 标题：仅无消息时显示 -->
        <div v-if="messages.length === 0" class="hero-block">
          <h1 class="hero-title">
            <span class="hero-title-text">ChatAI</span>
          </h1>
          <p class="hero-subtitle">简单对话，智能创造</p>
        </div>

        <!-- 输入区域 -->
        <div class="chat-input-area">
          <div class="chat-input-wrapper">
            <!-- 待发送附件网格 -->
            <FileGrid
              v-if="pendingAttachments.length"
              :files="pendingAttachments"
              @remove="removeAttachment"
            />
            <ChatInput
              ref="chatInputRef"
              v-model="inputText"
              bare
              class="chat-input"
              :placeholder="mentionEnabled ? '描述您的问题，或输入 @ 选择图片' : '描述您的问题'"
              :exclude-events="['shift-enter', 'ctrl-enter']"
              inline-element-vertical-align="middle"
              @submit="handleSubmit"
              @input="handleInputChange"
              @paste="handlePaste"
            />
            <!-- 隐藏的文件选择器 -->
            <input
              ref="fileInputRef"
              type="file"
              class="upload-file-input"
              :accept="uploadAccept"
              multiple
              @change="onFileInputChange"
            />
            <div class="chat-operate">
              <div class="chat-operate-left">
                <AutoTask />
                <button
                  v-if="supportsUpload"
                  type="button"
                  class="upload-btn"
                  :title="uploadTooltip"
                  @click="pickFile"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M8 3v10M3 8h10"
                      stroke="currentColor"
                      stroke-width="1.6"
                      stroke-linecap="round"
                    />
                  </svg>
                </button>
                <button
                  v-if="supportsThinking"
                  type="button"
                  class="thinking-btn"
                  :class="{ active: deepThinking }"
                  :title="deepThinking ? '已开启深度思考' : '开启深度思考'"
                  @click="deepThinking = !deepThinking"
                >
                  <svg class="thinking-icon" width="15" height="15" viewBox="0 0 16 16" fill="none">
                    <!-- 大脑轮廓：左右两瓣 + 中缝 -->
                    <path
                      d="M6.2 2.3a2 2 0 013.6 0 2 2 0 012.4 2v.2a2.2 2.2 0 011 3.5 2.2 2.2 0 01-.8 3.3 2 2 0 01-2.4 2.3 2 2 0 01-3.6 0 2 2 0 01-2.4-2.3 2.2 2.2 0 01-.8-3.3 2.2 2.2 0 011-3.5V4.3a2 2 0 012-2z"
                      stroke="currentColor"
                      stroke-width="1.1"
                      stroke-linejoin="round"
                    />
                    <path d="M8 2.5v11" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
                    <!-- 灵感火花，激活时点亮 -->
                    <circle
                      cx="12.8"
                      cy="3.2"
                      r="1"
                      :fill="deepThinking ? 'currentColor' : 'none'"
                      stroke="currentColor"
                      stroke-width="1"
                    />
                  </svg>
                  <span>深度思考</span>
                </button>
                <ModelSelect v-model="selectedModel" />
              </div>
              <div class="chat-operate-right">
              <!-- 生成中：暂停 + 终止 -->
              <template v-if="loading && !paused">
                <button class="ctrl-btn pause-btn" title="暂停生成" @click="handlePause">
                  <svg width="16" height="16" viewBox="0 0 1024 1024" fill="none">
                    <path d="M512 66.56a445.44 445.44 0 1 0 0 890.88 445.44 445.44 0 0 0 0-890.88z M138.24 512a373.76 373.76 0 1 1 747.52 0 373.76 373.76 0 0 1-747.52 0z m230.4-153.6a25.6 25.6 0 0 0-25.6 25.6v256a25.6 25.6 0 0 0 25.6 25.6h51.2a25.6 25.6 0 0 0 25.6-25.6v-256a25.6 25.6 0 0 0-25.6-25.6h-51.2z m204.8 0a25.6 25.6 0 0 0-25.6 25.6v256a25.6 25.6 0 0 0 25.6 25.6h51.2a25.6 25.6 0 0 0 25.6-25.6v-256a25.6 25.6 0 0 0-25.6-25.6h-51.2z" fill="currentColor"/>
                  </svg>
                  <span>暂停</span>
                </button>
                <button class="ctrl-btn stop-btn" title="终止生成" @click="handleStop">
                  <svg width="16" height="16" viewBox="0 0 1024 1024" fill="none">
                    <path d="M512 66.56a445.44 445.44 0 1 0 0 890.88 445.44 445.44 0 0 0 0-890.88z M138.24 512a373.76 373.76 0 1 1 747.52 0 373.76 373.76 0 0 1-747.52 0z m245.76-153.6a25.6 25.6 0 0 0-25.6 25.6v256a25.6 25.6 0 0 0 25.6 25.6h256a25.6 25.6 0 0 0 25.6-25.6v-256a25.6 25.6 0 0 0-25.6-25.6h-256z" fill="currentColor"/>
                  </svg>
                  <span>终止</span>
                </button>
              </template>

              <!-- 暂停中：继续 + 终止 -->
              <template v-else-if="paused">
                <button class="ctrl-btn resume-btn" title="继续生成" @click="handleResume">
                  <svg width="16" height="16" viewBox="0 0 1024 1024" fill="none">
                    <path d="M512 66.56a445.44 445.44 0 1 0 0 890.88 445.44 445.44 0 0 0 0-890.88z M138.24 512a373.76 373.76 0 1 1 747.52 0 373.76 373.76 0 0 1-747.52 0z m256-179.2a25.6 25.6 0 0 0-25.6 25.6v307.2a25.6 25.6 0 0 0 38.4 22.19l256-153.6a25.6 25.6 0 0 0 0-44.38l-256-153.6a25.6 25.6 0 0 0-12.8-3.41z" fill="currentColor"/>
                  </svg>
                  <span>继续</span>
                </button>
                <button class="ctrl-btn stop-btn" title="终止生成" @click="handleStop">
                  <svg width="16" height="16" viewBox="0 0 1024 1024" fill="none">
                    <path d="M512 66.56a445.44 445.44 0 1 0 0 890.88 445.44 445.44 0 0 0 0-890.88z M138.24 512a373.76 373.76 0 1 1 747.52 0 373.76 373.76 0 0 1-747.52 0z m245.76-153.6a25.6 25.6 0 0 0-25.6 25.6v256a25.6 25.6 0 0 0 25.6 25.6h256a25.6 25.6 0 0 0 25.6-25.6v-256a25.6 25.6 0 0 0-25.6-25.6h-256z" fill="currentColor"/>
                  </svg>
                  <span>终止</span>
                </button>
              </template>

              <!-- 空闲：发送按钮 -->
              <button
                v-else
                class="send-btn"
                :class="{ disabled: !inputText.trim() }"
                :disabled="!inputText.trim()"
                @click="handleSubmit"
              >
                发送
              </button>
              </div>
            </div>
          </div>
          <div v-if="messages.length > 0" class="footer-ai-tips">
            内容由AI生成，请仔细甄别
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
html, body, #app {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--gf-bg-page);
  color: var(--gf-text-primary);
  transition: background-color 0.2s ease, color 0.2s ease;
}

/* ---- 输入框 @ 候选菜单：tribute 把菜单挂到 body 上，样式必须是全局的 ---- */
.chat-mention__list {
  display: none;
  flex-direction: column;
  box-sizing: border-box;
  min-width: 280px;
  z-index: 3000;
  background: var(--gf-bg-panel);
  border: 1px solid var(--gf-border-strong);
  border-radius: 10px;
  box-shadow: var(--gf-shadow-menu);
  overflow: hidden;
}

.chat-mention__list > div {
  width: 100%;
  max-height: 320px;
  overflow-y: auto;
}

.chat-mention__list ul {
  margin: 0;
  padding: 4px;
  list-style: none;
}

.chat-mention__list li {
  padding: 0;
  border-radius: 6px;
  cursor: pointer;
}

.chat-mention__list li.is-selected {
  background: var(--gf-bg-elevated-hover);
}

.chat-mention__item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
}

.chat-mention__thumb {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 4px;
  object-fit: cover;
  background: var(--gf-bg-elevated);
}

.chat-mention__detail {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.chat-mention__name {
  font-size: 13px;
  color: var(--gf-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-mention__meta {
  font-size: 12px;
  color: var(--gf-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-mention__empty,
.chat-mention__loading {
  padding: 16px;
  text-align: center;
  font-size: 13px;
  color: var(--gf-text-tertiary);
}
</style>

<style scoped>
.chat-container {
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--gf-bg-page);
}

.main-container {
  position: relative;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  min-width: 480px;
  background: var(--gf-bg-page);
}

.chat-wrapper {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  justify-content: center;
}

.chat-wrapper.has-work {
  justify-content: flex-start;
}

/* 首屏 Hero 标题 */
.hero-block {
  width: calc(100% - 40px);
  max-width: 800px;
  margin: 0 auto 24px;
  text-align: center;
  user-select: none;
  pointer-events: none;
}

.hero-title {
  margin: 0 0 12px;
  font-size: 40px;
  line-height: 1.15;
  font-weight: 600;
  letter-spacing: 0.5px;
  animation: heroTitleIn 0.7s cubic-bezier(0.22, 1, 0.36, 1) both;
}

.hero-title-text {
  background: linear-gradient(
    120deg,
    var(--gf-primary, #4f7cff) 0%,
    #7a5cff 25%,
    #ff6ab0 50%,
    #7a5cff 75%,
    var(--gf-primary, #4f7cff) 100%
  );
  background-size: 220% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  animation: heroGradientShift 6s ease-in-out infinite;
  display: inline-block;
}

.hero-subtitle {
  margin: 0;
  font-size: 15px;
  line-height: 1.5;
  color: var(--gf-text-secondary, #8a94a6);
  letter-spacing: 0.4px;
  animation: heroSubtitleIn 0.7s cubic-bezier(0.22, 1, 0.36, 1) 0.15s both;
}

@keyframes heroTitleIn {
  0% {
    opacity: 0;
    transform: translateY(12px) scale(0.98);
    filter: blur(4px);
  }
  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
    filter: blur(0);
  }
}

@keyframes heroSubtitleIn {
  0% {
    opacity: 0;
    transform: translateY(8px);
  }
  100% {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes heroGradientShift {
  0% {
    background-position: 0% 50%;
  }
  50% {
    background-position: 100% 50%;
  }
  100% {
    background-position: 0% 50%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .hero-title,
  .hero-subtitle,
  .hero-title-text {
    animation: none;
  }
}

.message-list {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 24px 0;
  width: calc(100% - 40px);
  max-width: 800px;
  margin: 0 auto;
}

.message-item {
  margin-bottom: 16px;
  display: flex;
}

.message-item.user {
  justify-content: flex-end;
}

.message-item.assistant {
  justify-content: flex-start;
}

.message-bubble {
  max-width: 70%;
  padding: 10px 16px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.message-item.user .message-bubble {
  background: var(--gf-bubble-user-bg);
  color: var(--gf-bubble-user-text);
}

.message-item.assistant .message-bubble {
  background: var(--gf-bubble-assistant-bg);
  color: var(--gf-bubble-assistant-text);
}

.message-bubble.thinking {
  color: var(--gf-text-tertiary);
  font-style: italic;
}

/* Markdown 富文本样式 */
.markdown-body {
  white-space: normal;
}

.markdown-body :deep(p) {
  margin: 0 0 8px;
}

.markdown-body :deep(p:last-child) {
  margin-bottom: 0;
}

.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4),
.markdown-body :deep(h5),
.markdown-body :deep(h6) {
  margin: 12px 0 8px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--gf-text-primary);
}

.markdown-body :deep(h1) { font-size: 20px; }
.markdown-body :deep(h2) { font-size: 18px; }
.markdown-body :deep(h3) { font-size: 16px; }
.markdown-body :deep(h4) { font-size: 15px; }
.markdown-body :deep(h5),
.markdown-body :deep(h6) { font-size: 14px; }

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  padding-left: 1.4em;
  margin: 4px 0 8px;
}

.markdown-body :deep(li) {
  margin: 2px 0;
}

.markdown-body :deep(a) {
  color: var(--gf-primary);
  text-decoration: none;
}

.markdown-body :deep(a:hover) {
  text-decoration: underline;
}

.markdown-body :deep(strong) {
  font-weight: 600;
  color: var(--gf-text-primary);
}

.markdown-body :deep(em) {
  font-style: italic;
}

.markdown-body :deep(blockquote) {
  margin: 8px 0;
  padding: 4px 12px;
  border-left: 3px solid var(--gf-border-strong);
  color: var(--gf-text-secondary);
  background: var(--gf-bg-elevated);
  border-radius: 0 6px 6px 0;
}

.markdown-body :deep(hr) {
  border: none;
  border-top: 1px solid var(--gf-divider);
  margin: 12px 0;
}

.markdown-body :deep(code) {
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--gf-bg-elevated-hover);
  color: var(--gf-danger);
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 0.9em;
}

.markdown-body :deep(pre) {
  margin: 8px 0;
  padding: 12px 14px;
  border-radius: 8px;
  background: var(--gf-code-bg, #0f172a);
  color: var(--gf-code-text, #e2e8f0);
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.55;
}

.markdown-body :deep(pre code) {
  padding: 0;
  background: transparent;
  color: inherit;
  font-size: inherit;
}

.markdown-body :deep(table) {
  border-collapse: collapse;
  margin: 8px 0;
  font-size: 13px;
  width: 100%;
}

.markdown-body :deep(th),
.markdown-body :deep(td) {
  padding: 6px 10px;
  border: 1px solid var(--gf-border);
  text-align: left;
}

.markdown-body :deep(th) {
  background: var(--gf-bg-elevated);
  font-weight: 600;
}

.markdown-body :deep(img) {
  max-width: 100%;
  border-radius: 6px;
}

.chat-input-area {
  padding-top: 12px;
  flex-shrink: 0;
  margin: 0 auto;
  width: calc(100% - 40px);
  max-width: 800px;
}

.chat-input-wrapper {
  border: 1px solid var(--gf-border-strong);
  border-radius: 12px;
  padding: 12px 16px;
  background: var(--gf-bg-panel);
  transition: border-color 0.2s, background-color 0.2s;
}

.chat-input-wrapper:focus-within {
  border-color: var(--gf-primary);
}

.chat-input {
  width: 100%;
  border: none;
  outline: none;
  resize: none;
  font-size: 14px;
  line-height: 1.6;
  min-height: 24px;
  max-height: 200px;
  overflow-y: auto;
  font-family: inherit;
  background: transparent;
  color: var(--gf-text-primary);
  box-sizing: border-box;
  display: block;
}

.chat-input::placeholder {
  color: var(--gf-text-placeholder);
}

.chat-operate {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding-top: 10px;
}

.chat-operate-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 深度思考开关：与 ModelSelect 按钮风格一致，激活时以主色高亮 */
.thinking-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--gf-border-strong);
  border-radius: 8px;
  background: transparent;
  color: var(--gf-text-regular);
  font-size: 13px;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.thinking-btn:hover {
  background: var(--gf-bg-elevated);
  border-color: var(--gf-primary);
  color: var(--gf-primary);
}

.thinking-btn.active {
  background: var(--gf-primary-bg, rgba(79, 124, 255, 0.12));
  border-color: var(--gf-primary);
  color: var(--gf-primary);
}

.thinking-icon {
  flex-shrink: 0;
}

/* 上传附件按钮：与 thinking-btn 视觉风格一致 */
.upload-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--gf-border-strong);
  border-radius: 8px;
  background: transparent;
  color: var(--gf-text-regular);
  cursor: pointer;
  padding: 0;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.upload-btn:hover {
  background: var(--gf-bg-elevated);
  border-color: var(--gf-primary);
  color: var(--gf-primary);
}

.upload-file-input {
  display: none;
}

/* 历史用户消息：附件 + 气泡纵向堆叠，整体右对齐 */
.message-item.user .user-content-col {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  max-width: 100%;
}

.message-item.user .user-attachments {
  padding: 0;
  max-width: 100%;
}

.chat-operate-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.send-btn {
  width: 60px;
  height: 32px;
  border-radius: 8px;
  border: none;
  background: var(--gf-primary);
  color: var(--gf-primary-inverse);
  font-size: 14px;
  cursor: pointer;
  transition: background 0.2s;
}

.send-btn:hover:not(.disabled) {
  background: var(--gf-primary-hover);
}

.send-btn.disabled {
  background: var(--gf-border-strong);
  color: var(--gf-text-tertiary);
  cursor: not-allowed;
}

.ctrl-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--gf-border-strong);
  background: var(--gf-bg-elevated);
  color: var(--gf-text-regular);
  font-size: 14px;
  cursor: pointer;
  transition: background 0.15s;
}

.ctrl-btn:hover {
  background: var(--gf-bg-elevated-hover);
}

.ctrl-btn:active {
  background: var(--gf-bg-elevated-hover);
}

.ctrl-btn svg {
  width: 16px;
  height: 16px;
}

.stop-btn {
  color: var(--gf-danger);
  border-color: var(--gf-danger-border);
}

.stop-btn:hover {
  background: var(--gf-danger-bg);
}

.resume-btn {
  color: var(--gf-primary);
  border-color: var(--gf-primary-bg);
}

.resume-btn:hover {
  background: var(--gf-primary-bg);
}

.footer-ai-tips {
  display: flex;
  justify-content: center;
  font-size: 12px;
  line-height: 16px;
  color: var(--gf-text-disabled);
  margin: 8px 0 12px;
}
</style>
