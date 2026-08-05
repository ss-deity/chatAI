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
