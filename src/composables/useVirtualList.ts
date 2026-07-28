import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  toValue,
  type MaybeRefOrGetter,
  type Ref,
} from 'vue'

export interface UseVirtualListOptions {
  /** 固定行高（含行间距），px */
  itemHeight: number
  /** 可视区上下额外多渲染的缓冲行数，默认 5 */
  overscan?: number
}

export interface VirtualItem<T> {
  item: T
  index: number
}

/**
 * 轻量固定行高虚拟列表（移植自 pc-genflow-pro team/file 的实现）。
 * 通过监听容器 scroll 只渲染可视区 + overscan 的行，配合外层撑高 + translateY 定位。
 */
export function useVirtualList<T>(
  items: MaybeRefOrGetter<T[]>,
  containerRef: Ref<HTMLElement | null>,
  options: UseVirtualListOptions,
) {
  const { itemHeight, overscan = 5 } = options

  const scrollTop = ref(0)
  const viewportHeight = ref(0)

  const count = computed(() => toValue(items).length)
  const totalHeight = computed(() => count.value * itemHeight)

  const startIndex = computed(() =>
    Math.max(0, Math.floor(scrollTop.value / itemHeight) - overscan),
  )
  const visibleCount = computed(() =>
    Math.ceil(viewportHeight.value / itemHeight) + overscan * 2,
  )
  const endIndex = computed(() =>
    Math.min(count.value, startIndex.value + visibleCount.value),
  )

  const offsetY = computed(() => startIndex.value * itemHeight)

  const visibleItems = computed<VirtualItem<T>[]>(() => {
    const source = toValue(items)
    const result: VirtualItem<T>[] = []
    for (let i = startIndex.value; i < endIndex.value; i++) {
      const item = source[i]
      if (item === undefined) continue
      result.push({ item, index: i })
    }
    return result
  })

  function handleScroll() {
    const el = containerRef.value
    if (el) scrollTop.value = el.scrollTop
  }

  function scrollToIndex(index: number) {
    const el = containerRef.value
    if (el) el.scrollTop = index * itemHeight
  }

  let resizeObserver: ResizeObserver | null = null

  onMounted(() => {
    const el = containerRef.value
    if (!el) return
    viewportHeight.value = el.clientHeight
    scrollTop.value = el.scrollTop
    el.addEventListener('scroll', handleScroll, { passive: true })
    resizeObserver = new ResizeObserver(() => {
      viewportHeight.value = el.clientHeight
    })
    resizeObserver.observe(el)
  })

  onBeforeUnmount(() => {
    const el = containerRef.value
    if (el) el.removeEventListener('scroll', handleScroll)
    resizeObserver?.disconnect()
    resizeObserver = null
  })

  return {
    totalHeight,
    offsetY,
    visibleItems,
    startIndex,
    endIndex,
    scrollToIndex,
  }
}
