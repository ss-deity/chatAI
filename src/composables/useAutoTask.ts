/**
 * 自动化任务选中态。
 *
 * enterprise-genclaw 里这份状态放在 Pinia 的 inputManageStore（selectedAutoTaskKey +
 * toggleAutoTaskSelection + clearAutoTaskSelection），chatAI 没有引入 Pinia，
 * 这里用模块级 ref 提供同样的语义：单选、重复点击已选项即取消。
 */
import { ref } from 'vue'
import type { AutoTaskItem } from '../components/AutoTask/const'

/** 当前选中的任务 key，null 表示未选择 */
export const selectedAutoTaskKey = ref<string | null>(null)

export function toggleAutoTaskSelection(item: AutoTaskItem) {
  selectedAutoTaskKey.value =
    selectedAutoTaskKey.value === item.key ? null : item.key
}

export function clearAutoTaskSelection() {
  selectedAutoTaskKey.value = null
}
