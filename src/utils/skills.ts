/**
 * 输入框 `/` 唤起技能的数据源。
 *
 * 后端 GET /api/skills 读取 ai-gateway/src/skills/skills.json，
 * 只下发展示需要的字段（技能的 prompt 留在服务端，发消息时由后端拼 system prompt）。
 */

/** 技能候选项 */
export interface Skill {
  /** 唯一标识，提交会话时随 skills 字段回传给后端 */
  id: string
  /** `/` 指令名（英文），也参与关键字匹配 */
  command: string
  /** 展示名称 */
  name: string
  /** 一句话说明 */
  description: string
  /** 分组：system=系统，own=我的技能 */
  category: 'system' | 'own'
}

export async function fetchSkills(): Promise<Skill[]> {
  const res = await fetch('/api/skills')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = (await res.json()) as {
    code: number
    message?: string
    data?: Skill[]
  }
  if (json.code !== 0 || !json.data) {
    throw new Error(json.message || '获取技能列表失败')
  }
  return json.data
}

/** 一段文本拆出来的片段：普通文本 / 技能 tag */
export type SkillSegment =
  | { type: 'text'; value: string }
  | { type: 'skill'; name: string }

/**
 * 把含 `/command` 的文本拆成「普通文本 + 技能 tag」片段。
 *
 * 输入框里的技能 chip 提交时序列化成 `/command`（见 index.vue 的 buildFullMessage），
 * 消息气泡、侧边栏会话标题都据此反查展示名，保证 tag 样式与输入框一致。
 * 触发规则与 resolveSlashTrigger 一致：`/` 必须在行首或空白之后。
 *
 * @param commandToName command -> 展示名；为空时整段按普通文本返回
 */
export function splitSkillSegments(
  content: string,
  commandToName?: Map<string, string>,
): SkillSegment[] {
  if (!content) return []
  if (!commandToName || commandToName.size === 0) {
    return [{ type: 'text', value: content }]
  }
  const segs: SkillSegment[] = []
  let buf = ''
  let i = 0
  while (i < content.length) {
    if (content[i] === '/' && (i === 0 || /[\s\u00A0]/.test(content[i - 1]))) {
      const cmd = /^[\w-]+/.exec(content.slice(i + 1))?.[0]
      const name = cmd ? commandToName.get(cmd) : undefined
      if (cmd && name) {
        if (buf) {
          segs.push({ type: 'text', value: buf })
          buf = ''
        }
        segs.push({ type: 'skill', name })
        i += 1 + cmd.length
        continue
      }
    }
    buf += content[i]
    i += 1
  }
  if (buf) segs.push({ type: 'text', value: buf })
  return segs
}
