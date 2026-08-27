/**
 * 对话模型配置。新增模型只需在此追加一项，并在 ai-gateway 注册对应 Provider。
 * type 需与后端 ModelProvider 的 type 一致。
 */
export interface ModelOption {
  /** 模型类型标识，发送会话时随请求带给后端 */
  type: string
  /** 展示名称 */
  label: string
  /** 简短描述 */
  desc?: string
  /** 是否支持"深度思考"（reasoning）；仅对支持的模型显示对应按钮 */
  supportsThinking?: boolean
}

export const MODELS: ModelOption[] = [
  {
    type: 'deepseek-v4',
    label: 'DeepSeek-V4',
    desc: '通用文本对话',
    supportsThinking: true,
  },
  {
    type: 'openapi',
    label: 'openApi',
    desc: '内部 OneAPI 网关（默认 gpt-5.5）',
  },
]

/** 默认模型 */
export const DEFAULT_MODEL_TYPE = 'openapi'

export function getModel(type: string): ModelOption {
  return (
    MODELS.find((m) => m.type === type) ||
    MODELS.find((m) => m.type === DEFAULT_MODEL_TYPE) ||
    MODELS[0]
  )
}
