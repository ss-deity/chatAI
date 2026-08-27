/**
 * 输入框文件上传：校验、压缩、直传后端 BOS。
 *
 * 参考 enterprise-ai-assistant 的 useUploadFile 交互与限制，按 chatAI 的模型（deepseek-v4 / openapi）改写。
 * 后端 BOS 直传：POST /api/upload?userId=&dir=chat  ->  { code:0, data:{ url } }
 */
import imageCompression from 'browser-image-compression'
import { ElMessage } from 'element-plus'

/** 上传中/成功/失败三态 */
export type AttachmentStatus = 'uploading' | 'success' | 'failed'

/** 附件本地数据结构 */
export interface Attachment {
  /** 前端本地 uid，key 用 */
  uid: string
  /** 原始文件名 */
  name: string
  /** MIME 类型 */
  type: string
  /** 大小（byte，原始） */
  size: number
  /** 展示用缩略图（图片：本地 object URL；非图片：空） */
  thumbnail: string
  /** 上传成功后回填的远端 URL */
  url?: string
  status: AttachmentStatus
}

/** 服务端消息回显附件的最小结构（跟 message.entity.ts 里保存的一致） */
export interface RemoteAttachment {
  url: string
  name: string
  type: string
  size: number
}

/** 每个模型的上传规则 */
export interface UploadConfig {
  maxCount: number
  /** 图片：文件大小超过这个 MB 触发压缩 */
  maxImgCompressLimit: number
  /** 图片压缩目标 MB */
  targetCompressMB: number
  /** accept 属性用的 MIME 列表 */
  fileType: string
  /** 展示给用户的说明（tooltip / placeholder） */
  hitWord: string
  /** 分辨率限制（仅图片模型）：宽或高不超过 maxWH；宽高比在 [ratioLimitMiniWH, ratioLimitMaxWH] */
  resolution?: {
    maxWH: number
    ratioLimitMiniWH: number
    ratioLimitMaxWH: number
  }
}

const getMB = (n: number) => n * 1024 * 1024

/** Excel（xlsx）MIME，部分环境下 file.type 会给成 octet-stream，靠扩展名兜底 */
const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** 单个文件按 MIME 的大小上限（byte） */
const FILE_SIZE_LIMITS: Record<string, number> = {
  'application/pdf': getMB(50),
  'text/plain': getMB(50),
  'text/csv': getMB(50),
  [XLSX_MIME]: getMB(20),
  'image/png': getMB(30),
  'image/jpeg': getMB(30),
  'image/webp': getMB(30),
}

/** MIME -> 允许的扩展名，用于 MIME 缺失/错标时兜底判断 */
const MIME_TO_EXTENSIONS: Record<string, string[]> = {
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/webp': ['webp'],
  'application/pdf': ['pdf'],
  'text/plain': ['txt'],
  'text/csv': ['csv'],
  [XLSX_MIME]: ['xlsx'],
}

/** 按 chatAI 的 model type 组织的上传规则表 */
export const MODEL_UPLOAD_CONFIG: Record<string, UploadConfig> = {
  'deepseek-v4': {
    maxCount: 3,
    maxImgCompressLimit: 7,
    targetCompressMB: 3,
    fileType: `image/png,image/jpeg,image/webp,application/pdf,text/plain,text/csv,${XLSX_MIME}`,
    hitWord:
      '上传附件，最多3个，文档支持 pdf、txt、csv、xlsx，图片支持 png、jpeg、webp，文档最大 50MB（xlsx 20MB），图片最大 30MB',
  },
  'openapi': {
    maxCount: 3,
    maxImgCompressLimit: 7,
    targetCompressMB: 3,
    fileType: `image/png,image/jpeg,image/webp,application/pdf,text/plain,text/csv,${XLSX_MIME}`,
    hitWord:
      '上传附件，最多3个，文档支持 pdf、txt、csv、xlsx，图片支持 png、jpeg、webp，文档最大 50MB（xlsx 20MB），图片最大 30MB',
  },
}

export function getUploadConfig(modelType: string): UploadConfig | null {
  return MODEL_UPLOAD_CONFIG[modelType] ?? null
}

function getFileExtension(name: string): string {
  const idx = name.lastIndexOf('.')
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : ''
}

/**
 * 判断文件类型是否在允许列表中。
 * 优先看 MIME，失败时按扩展名反查（有些文件 file.type 会为空）。
 */
export function checkFileFormat(
  file: { name: string; type: string },
  allowedFileTypes: string,
): boolean {
  const allowed = allowedFileTypes.split(',').map((t) => t.trim())
  if (file.type && allowed.includes(file.type)) return true
  const ext = getFileExtension(file.name)
  return allowed.some((mime) => MIME_TO_EXTENSIONS[mime]?.includes(ext))
}

/** 单文件大小校验（不满足会 toast） */
export function checkFileSize(file: File): boolean {
  const limit = FILE_SIZE_LIMITS[file.type] ?? sizeLimitByExt(file.name)
  if (limit && file.size > limit) {
    ElMessage.error(`${file.name} 超过大小限制（${limit / 1024 / 1024}MB）`)
    return false
  }
  return true
}

/** file.type 缺失/错标时，按扩展名反查大小上限 */
function sizeLimitByExt(name: string): number | undefined {
  const ext = getFileExtension(name)
  const mime = Object.keys(MIME_TO_EXTENSIONS).find((m) =>
    MIME_TO_EXTENSIONS[m].includes(ext),
  )
  return mime ? FILE_SIZE_LIMITS[mime] : undefined
}

/**
 * 图片分辨率校验（仅当 config 里定义 resolution 时生效）。
 * 不合规的图片直接返回 false，并 toast 说明原因。
 */
export async function checkImageResolution(
  file: File,
  rule: NonNullable<UploadConfig['resolution']>,
): Promise<boolean> {
  if (!file.type.startsWith('image/')) return true
  return new Promise((resolve) => {
    const img = new Image()
    const objUrl = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(objUrl)
      const { maxWH, ratioLimitMiniWH, ratioLimitMaxWH } = rule
      const ratio = img.width / img.height
      if (img.width > maxWH || img.height > maxWH) {
        ElMessage.error(`${file.name} 分辨率过大，最大 ${maxWH}×${maxWH}`)
        return resolve(false)
      }
      if (ratio < ratioLimitMiniWH || ratio > ratioLimitMaxWH) {
        ElMessage.error(`${file.name} 宽高比不符合要求`)
        return resolve(false)
      }
      resolve(true)
    }
    img.onerror = () => {
      URL.revokeObjectURL(objUrl)
      resolve(false)
    }
    img.src = objUrl
  })
}

/** 根据当前大小与目标大小推导压缩质量（0.25 ~ 0.9） */
function getDynamicQuality(sizeMB: number, targetMB: number): number {
  const ratio = targetMB / sizeMB
  return Math.max(0.25, Math.min(0.9, Math.pow(ratio, 0.8)))
}

/** 图片按需压缩：仅当大小超过 maxLimit 才走压缩，失败降级为原图 */
export async function compressImage(
  file: File,
  maxLimit: number,
  targetMB: number,
): Promise<File> {
  const sizeMB = file.size / 1024 / 1024
  if (!file.type.startsWith('image/') || sizeMB <= maxLimit) return file
  try {
    return await imageCompression(file, {
      maxSizeMB: maxLimit,
      maxWidthOrHeight: 4096,
      initialQuality: getDynamicQuality(sizeMB, targetMB),
      useWebWorker: true,
      fileType: file.type,
    })
  } catch {
    return file
  }
}

/** 上传单文件到后端 BOS（复用现有 /api/upload 端点） */
export async function uploadToServer(
  file: File,
  userId: number | string,
  dir = 'chat',
): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  const qs = new URLSearchParams({ userId: String(userId), dir })
  const res = await fetch(`/api/upload?${qs.toString()}`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = (await res.json()) as {
    code: number
    message?: string
    data?: { url?: string }
  }
  if (json.code !== 0 || !json.data?.url) {
    throw new Error(json.message || '上传失败')
  }
  return json.data.url
}

/** 判断文件是否为图片 */
export function isImageMime(mime: string): boolean {
  return mime.startsWith('image/')
}

let __uid = 0
export function nextAttachmentUid(): string {
  __uid += 1
  return `att_${Date.now()}_${__uid}`
}
