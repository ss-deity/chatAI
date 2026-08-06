import { ref } from 'vue'

/**
 * 文件管理的上传 / 下载任务队列（进度列表的数据层）。
 *
 * 交互对齐 pc-genflow-pro netdisk 的 UploadManager：任务逐个执行、逐项展示进度、
 * 可单项取消或全部取消。上传沿用「整文件一次 POST /api/upload」的方式（不做分片），
 * 因此只支持取消、不支持暂停/续传；下载走网关同源转发的 /api/files/download，
 * 用 fetch 流式读取来统计进度。
 *
 * 状态是模块级单例，切换页面不会中断或清空任务，面板由根组件常驻渲染。
 */

export type TransferKind = 'upload' | 'download'

export type TransferStatus = 'pending' | 'active' | 'done' | 'error' | 'canceled'

export interface TransferTask {
  id: string
  kind: TransferKind
  /** 文件名 */
  name: string
  /** 已传字节 */
  loaded: number
  /** 总字节（下载时以响应头 Content-Length 为准） */
  total: number
  status: TransferStatus
  /** 失败原因 */
  errorMessage?: string
}

interface UploadContext {
  userId: string
  /** 目标目录（相对用户根目录） */
  dir: string
}

const BASE = '/api'

let taskSeed = 0

/** 触发浏览器保存文件 */
function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function createTransferTasks() {
  const tasks = ref<TransferTask[]>([])
  const visible = ref(false)

  /** taskId -> 中断当前传输的方法（仅执行中的任务有） */
  const aborters = new Map<string, () => void>()
  /** 待执行的任务队列，串行消费 */
  const queue: Array<() => Promise<void>> = []
  let running = false

  function addTask(task: Omit<TransferTask, 'id'>): TransferTask {
    const id = `t_${++taskSeed}_${Date.now()}`
    tasks.value.push({ ...task, id })
    visible.value = true
    // 返回响应式代理，后续直接改字段即可驱动视图
    return tasks.value[tasks.value.length - 1]
  }

  async function runQueue() {
    if (running) return
    running = true
    while (queue.length) {
      const job = queue.shift()!
      await job()
    }
    running = false
  }

  function enqueue(job: () => Promise<void>) {
    queue.push(job)
    void runQueue()
  }

  /* ------------------------------ 上传 ------------------------------ */

  function uploadOne(task: TransferTask, file: File, ctx: UploadContext) {
    return new Promise<boolean>((resolve) => {
      const xhr = new XMLHttpRequest()
      aborters.set(task.id, () => xhr.abort())

      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return
        task.loaded = e.loaded
        task.total = e.total
      }
      xhr.onload = () => {
        try {
          const data = JSON.parse(xhr.responseText) as {
            code: number
            message?: string
          }
          if (data.code !== 0) throw new Error(data.message || '上传失败')
          task.loaded = task.total
          task.status = 'done'
          resolve(true)
        } catch (e) {
          task.status = 'error'
          task.errorMessage = (e as Error).message
          resolve(false)
        }
      }
      xhr.onerror = () => {
        task.status = 'error'
        task.errorMessage = '网络异常'
        resolve(false)
      }
      xhr.onabort = () => {
        task.status = 'canceled'
        resolve(false)
      }

      const fd = new FormData()
      fd.append('file', file)
      const url =
        `${BASE}/upload?userId=${encodeURIComponent(ctx.userId)}` +
        `&dir=${encodeURIComponent(ctx.dir)}`
      xhr.open('POST', url)
      xhr.send(fd)
    })
  }

  /**
   * 批量上传：为每个文件建一个任务并入队，全部结束后回调（用于刷新列表）。
   * @param onBatchDone 参数为本批成功的文件数
   */
  function uploadFiles(
    files: File[],
    ctx: UploadContext,
    onBatchDone?: (okCount: number) => void,
  ) {
    if (!files.length) return
    let pending = files.length
    let okCount = 0

    for (const file of files) {
      const task = addTask({
        kind: 'upload',
        name: file.name,
        loaded: 0,
        total: file.size,
        status: 'pending',
      })
      enqueue(async () => {
        // 排队期间被取消的任务直接跳过
        if (task.status === 'canceled') {
          pending -= 1
          if (pending === 0) onBatchDone?.(okCount)
          return
        }
        task.status = 'active'
        const ok = await uploadOne(task, file, ctx)
        aborters.delete(task.id)
        if (ok) okCount += 1
        pending -= 1
        if (pending === 0) onBatchDone?.(okCount)
      })
    }
  }

  /* ------------------------------ 下载 ------------------------------ */

  async function downloadOne(
    task: TransferTask,
    ctx: { userId: string; path: string },
  ) {
    const controller = new AbortController()
    aborters.set(task.id, () => controller.abort())
    try {
      const url =
        `${BASE}/files/download?userId=${encodeURIComponent(ctx.userId)}` +
        `&path=${encodeURIComponent(ctx.path)}`
      const res = await fetch(url, { signal: controller.signal })
      if (!res.ok || !res.body) {
        // 失败时后端返回 JSON，尽量取出可读的报错信息
        let message = `HTTP ${res.status}`
        try {
          const data = (await res.json()) as { message?: string }
          if (data.message) message = data.message
        } catch {
          // 非 JSON 响应，保留状态码文案
        }
        throw new Error(message)
      }

      const total = Number(res.headers.get('content-length') || 0)
      if (total > 0) task.total = total

      const reader = res.body.getReader()
      const chunks: Uint8Array[] = []
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        task.loaded += value.length
      }

      // 服务端没给 Content-Length 时（chunked），用实际读到的字节数收尾
      if (!task.total) task.total = task.loaded
      saveBlob(new Blob(chunks as BlobPart[]), task.name)
      task.status = 'done'
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        task.status = 'canceled'
        return
      }
      task.status = 'error'
      task.errorMessage = (e as Error).message
    }
  }

  /** 下载单个文件（文件夹不支持） */
  function downloadFile(
    entry: { name: string; path: string; size: number },
    userId: string,
  ) {
    const task = addTask({
      kind: 'download',
      name: entry.name,
      loaded: 0,
      total: entry.size,
      status: 'pending',
    })
    enqueue(async () => {
      if (task.status === 'canceled') return
      task.status = 'active'
      await downloadOne(task, { userId, path: entry.path })
      aborters.delete(task.id)
    })
  }

  /* ------------------------------ 控制 ------------------------------ */

  function cancel(id: string) {
    const task = tasks.value.find((t) => t.id === id)
    if (!task) return
    if (task.status === 'active') {
      // 执行中：打断底层请求，状态由 onabort / catch 分支置为 canceled
      aborters.get(id)?.()
      return
    }
    if (task.status === 'pending') {
      task.status = 'canceled'
      return
    }
    // 已结束的任务直接从列表里移除
    tasks.value = tasks.value.filter((t) => t.id !== id)
    if (!tasks.value.length) visible.value = false
  }

  function cancelAll() {
    for (const task of tasks.value) {
      if (task.status === 'active') aborters.get(task.id)?.()
      else if (task.status === 'pending') task.status = 'canceled'
    }
    queue.length = 0
  }

  function close() {
    tasks.value = []
    visible.value = false
  }

  return {
    tasks,
    visible,
    uploadFiles,
    downloadFile,
    cancel,
    cancelAll,
    close,
  }
}

/**
 * 全局单例：进度列表要跨页面保留（例如从文件管理切到会话页），
 * 因此状态不能随组件卸载销毁，只有用户主动关闭面板时才由 close() 清空。
 */
const transferStore = createTransferTasks()

export function useTransferTasks() {
  return transferStore
}
