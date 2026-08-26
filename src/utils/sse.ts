export interface SSEOptions {
  url: string
  body?: Record<string, unknown>
  headers?: Record<string, string>
  onMessage: (content: string) => void
  onSessionId?: (sessionId: string) => void
  onEvent?: (payload: Record<string, unknown>) => void
  onDone?: () => void
  onError?: (error: Error) => void
}

export interface SSEController {
  /** 彻底终止，不可恢复 */
  abort: () => void
  /** 暂停：通知服务端暂停推送 */
  pause: () => void
  /** 恢复：通知服务端恢复，缓冲内容会通过原 SSE 连接逐条发回 */
  resume: () => void
  /** 获取当前 sessionId */
  getSessionId: () => string
}

/** 上游错误的稳定分类，供 UI 展示不同文案 */
export type SSEErrorKind =
  | 'billing'
  | 'rate_limit'
  | 'auth'
  | 'timeout'
  | 'upstream'
  | 'network'
  | 'unknown'

/** SSE 过程中的错误：带上 HTTP 状态与归类，方便 UI 给出可读提示 */
export class SSEError extends Error {
  readonly kind: SSEErrorKind
  readonly status?: number
  readonly code?: string

  constructor(
    message: string,
    opts: { kind?: SSEErrorKind; status?: number; code?: string } = {},
  ) {
    super(message)
    this.name = 'SSEError'
    this.status = opts.status
    this.code = opts.code
    this.kind = opts.kind ?? classifyError(message, opts.status, opts.code)
  }
}

/**
 * 把上游各家不统一的报错归成几类。
 * 优先看 HTTP 状态码，其次做关键字兜底（DeepSeek/OpenAI 的文案都覆盖到）。
 */
function classifyError(
  message: string,
  status?: number,
  code?: string,
): SSEErrorKind {
  if (status === 401 || status === 403) return 'auth'
  if (status === 402) return 'billing'
  if (status === 429) return 'rate_limit'
  if (status === 408 || status === 504) return 'timeout'
  if (status && status >= 500) return 'upstream'

  const text = `${message} ${code ?? ''}`.toLowerCase()
  if (
    /insufficient|balance|quota|billing|arrears|欠费|余额|额度/.test(text)
  ) return 'billing'
  if (/rate limit|too many requests|请求过于频繁|限流/.test(text)) return 'rate_limit'
  if (
    /unauthorized|invalid api key|authentication|forbidden|鉴权|未授权/.test(text)
  ) return 'auth'
  if (/timeout|timed out|超时/.test(text)) return 'timeout'
  if (/failed to fetch|network|econnreset|socket/.test(text)) return 'network'
  return 'unknown'
}

/** 由后端 error 帧构造 SSEError（后端可能额外带 status / code） */
function buildSSEError(parsed: {
  error?: unknown
  status?: unknown
  code?: unknown
}): SSEError {
  const rawMessage =
    typeof parsed.error === 'string'
      ? parsed.error
      : typeof parsed.error === 'object' && parsed.error
        ? String((parsed.error as { message?: unknown }).message ?? '模型服务返回错误')
        : '模型服务返回错误'
  const status = typeof parsed.status === 'number' ? parsed.status : undefined
  const code = typeof parsed.code === 'string' ? parsed.code : undefined
  return new SSEError(rawMessage, { status, code })
}

/**
 * 发起 SSE 流式请求（POST 方式），逐步回调返回内容
 * 返回控制器，支持暂停/恢复/终止
 */
export function fetchSSE(options: SSEOptions): SSEController {
  const { url, body, headers = {}, onMessage, onSessionId, onEvent, onDone, onError } = options
  const abortController = new AbortController()

  let sessionId = ''
  /** 是否已经以错误收尾：避免 onError 之后又走 onDone */
  let settled = false
  // 兼容相对地址（如 /api/chat）与绝对地址（如 http://host/chat）：
  // pause/resume/cancel 的前缀 = 去掉末尾的 /chat 后的 base（相对时即 /api）。
  const baseUrl = url.replace(/\/chat$/, '')

  const finishOk = () => {
    if (settled) return
    settled = true
    onDone?.()
  }

  const finishErr = (err: Error) => {
    if (settled) return
    settled = true
    onError?.(err)
  }

  const run = async () => {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify(body),
        signal: abortController.signal,
      })

      if (!response.ok) {
        // 非流式的失败（如网关 4xx/5xx）：尽量读出响应体里的错误描述
        let detail = ''
        try {
          const raw = await response.text()
          if (raw) {
            try {
              const j = JSON.parse(raw) as { message?: string; error?: string }
              detail = j.message || j.error || raw
            } catch {
              detail = raw
            }
          }
        } catch {
          /* ignore */
        }
        throw new SSEError(
          detail?.slice(0, 300) || `${response.status} ${response.statusText}`,
          { status: response.status },
        )
      }

      const reader = response.body?.getReader()
      if (!reader) {
        throw new SSEError('响应内容无法读取')
      }

      const decoder = new TextDecoder()
      let textBuffer = ''

      while (true) {
        const { done: streamDone, value } = await reader.read()
        if (streamDone) break

        textBuffer += decoder.decode(value, { stream: true })

        const lines = textBuffer.split('\n')
        textBuffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)
          if (data === '[DONE]') {
            finishOk()
            return
          }

          let parsed: Record<string, unknown> | null = null
          try {
            parsed = JSON.parse(data) as Record<string, unknown>
          } catch {
            // 非 JSON 帧：当作纯文本增量
            if (data.trim()) onMessage(data)
            continue
          }

          // 后端把上游模型错误（余额不足 / 限流 / 鉴权失败等）写成 {"error": "..."} 帧，
          // 此时 SSE 不会再发 [DONE]，必须显式转成 onError，
          // 否则流自然结束后前端会当成"正常完成"，用户看不到任何提示。
          if (parsed.error) {
            finishErr(buildSSEError(parsed))
            return
          }

          const sid = parsed.sessionId
          if (typeof sid === 'string' && sid && !sessionId) {
            sessionId = sid
            onSessionId?.(sid)
          }
          onEvent?.(parsed)
          const content = (
            parsed.choices as Array<{ delta?: { content?: string } }> | undefined
          )?.[0]?.delta?.content
          if (content) onMessage(content)
        }
      }

      // 流被对端关闭但从未收到 [DONE]：属于异常中断（上游断链 / 进程退出 / 网关超时）
      finishErr(
        new SSEError('连接意外中断，回复可能不完整', { kind: 'network' }),
      )
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        // 用户主动停止：正常收尾
        finishOk()
      } else if (e instanceof SSEError) {
        finishErr(e)
      } else {
        const msg = (e as Error).message || '请求失败'
        finishErr(new SSEError(msg))
      }
    }
  }

  run()

  return {
    abort: () => {
      abortController.abort()
    },
    pause: () => {
      if (sessionId) {
        fetch(`${baseUrl}/chat/pause/${sessionId}`, { method: 'POST' })
      }
    },
    resume: () => {
      if (sessionId) {
        fetch(`${baseUrl}/chat/resume/${sessionId}`, { method: 'POST' })
      }
    },
    getSessionId: () => sessionId,
  }
}

/**
 * 把 SSEError 转成给用户看的文案。
 */
export function describeSSEError(err: Error): string {
  const kind = err instanceof SSEError ? err.kind : classifyError(err.message)
  switch (kind) {
    case 'billing':
      return '模型服务余额不足或额度已用尽，请充值后重试。'
    case 'rate_limit':
      return '请求过于频繁，已被模型服务限流，请稍后重试。'
    case 'auth':
      return '模型服务鉴权失败，请检查 API Key 配置。'
    case 'timeout':
      return '模型服务响应超时，请重试。'
    case 'upstream':
      return '模型服务暂时不可用，请稍后重试。'
    case 'network':
      return '网络连接中断，回复可能不完整，请重试。'
    default:
      return err.message || '请求失败，请重试。'
  }
}

/**
 * 向服务器发送取消请求
 */
export async function cancelSSE(baseUrl: string, sessionId: string): Promise<void> {
  await fetch(`${baseUrl}/chat/cancel/${sessionId}`, {
    method: 'POST',
  })
}
