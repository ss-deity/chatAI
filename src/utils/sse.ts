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

/**
 * 发起 SSE 流式请求（POST 方式），逐步回调返回内容
 * 返回控制器，支持暂停/恢复/终止
 */
export function fetchSSE(options: SSEOptions): SSEController {
  const { url, body, headers = {}, onMessage, onSessionId, onEvent, onDone, onError } = options
  const abortController = new AbortController()

  let sessionId = ''
  const baseUrl = new URL(url).origin

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
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('Response body is not readable')
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
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') {
              onDone?.()
              return
            }
            try {
              const parsed = JSON.parse(data)
              if (parsed.sessionId && !sessionId) {
                sessionId = parsed.sessionId
                onSessionId?.(parsed.sessionId)
              }
              onEvent?.(parsed)
              const content = parsed.choices?.[0]?.delta?.content
              if (content) {
                onMessage(content)
              }
            } catch {
              if (data.trim()) {
                onMessage(data)
              }
            }
          }
        }
      }

      onDone?.()
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        onDone?.()
      } else {
        onError?.(e as Error)
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
 * 向服务器发送取消请求
 */
export async function cancelSSE(baseUrl: string, sessionId: string): Promise<void> {
  await fetch(`${baseUrl}/chat/cancel/${sessionId}`, {
    method: 'POST',
  })
}
