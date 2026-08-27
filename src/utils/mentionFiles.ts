/**
 * 输入框 @ 唤起「文件管理」文件的数据源。
 *
 * 后端 GET /api/files/mentions?userId=&keyword=&exts= 会递归检索用户 BOS 根目录下
 * 符合扩展名白名单的文件（图片 + 文档），这里把 FileEntry 转成菜单需要的形状
 * （补出 MIME 与所在目录）。exts 由当前模型允许的附件类型推导，避免选进来又被判定为不支持。
 */

/** 后端 /files/mentions 返回的条目 */
interface MentionFileEntry {
  name: string
  path: string
  size: number
  lastModified: number
  url?: string
}

/** @ 菜单项 */
export interface MentionFile {
  /** 文件名（含扩展名） */
  name: string
  /** 相对用户根目录的路径，如 `pics/a.png` */
  path: string
  /** 所在目录，根目录为空串 */
  dir: string
  /** 公网可访问 URL */
  url: string
  /** 按扩展名推断的 MIME */
  type: string
  /** 扩展名（小写，不带点），非图片项用它渲染角标 */
  ext: string
  size: number
}

const EXT_TO_MIME: Record<string, string> = {
  // 图片
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  avif: 'image/avif',
  // 文档
  txt: 'text/plain',
  log: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlsm: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

export function extOfName(name: string): string {
  return name.split('.').pop()?.toLowerCase() || ''
}

/** 按扩展名推断 MIME，未知时退回 application/octet-stream */
export function mimeOfFileName(name: string): string {
  return EXT_TO_MIME[extOfName(name)] || 'application/octet-stream'
}

/**
 * 拉取该用户文件管理中可 @ 引用的文件。
 * @param keyword @ 后面已输入的关键字，空串表示不过滤
 * @param exts 允许的扩展名，来自当前模型的附件配置
 */
export async function fetchMentionFiles(
  userId: number | string,
  keyword = '',
  exts: string[] = [],
): Promise<MentionFile[]> {
  const qs = new URLSearchParams({ userId: String(userId), keyword })
  if (exts.length) qs.set('exts', exts.join(','))
  const res = await fetch(`/api/files/mentions?${qs.toString()}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = (await res.json()) as {
    code: number
    message?: string
    data?: MentionFileEntry[]
  }
  if (json.code !== 0 || !json.data) {
    throw new Error(json.message || '获取文件列表失败')
  }
  return json.data
    .filter((it) => !!it.url)
    .map((it) => {
      const slash = it.path.lastIndexOf('/')
      return {
        name: it.name,
        path: it.path,
        dir: slash === -1 ? '' : it.path.slice(0, slash),
        url: it.url as string,
        type: mimeOfFileName(it.name),
        ext: extOfName(it.name),
        size: it.size,
      }
    })
}
