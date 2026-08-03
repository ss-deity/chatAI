/**
 * 输入框 @ 唤起「文件管理」图片文件的数据源。
 *
 * 后端 GET /api/files/images?userId=&keyword= 会递归检索用户 BOS 根目录下的图片，
 * 这里把 FileEntry 转成菜单需要的形状（补出 MIME 与所在目录）。
 */

/** 后端 /files/images 返回的条目 */
interface ImageFileEntry {
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
  size: number
}

const EXT_TO_MIME: Record<string, string> = {
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
}

/** 按扩展名推断 MIME，未知时退回 image/png（列表本身已由后端限定为图片） */
export function mimeOfImageName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return EXT_TO_MIME[ext] || 'image/png'
}

/**
 * 拉取该用户文件管理中的图片文件。
 * @param keyword @ 后面已输入的关键字，空串表示不过滤
 */
export async function fetchMentionImages(
  userId: number | string,
  keyword = '',
): Promise<MentionFile[]> {
  const qs = new URLSearchParams({ userId: String(userId), keyword })
  const res = await fetch(`/api/files/images?${qs.toString()}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = (await res.json()) as {
    code: number
    message?: string
    data?: ImageFileEntry[]
  }
  if (json.code !== 0 || !json.data) {
    throw new Error(json.message || '获取图片列表失败')
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
        type: mimeOfImageName(it.name),
        size: it.size,
      }
    })
}
