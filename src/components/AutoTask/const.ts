/** 自动化任务选项（与 enterprise-genclaw 的 autoTaskMap 保持一致） */
export interface AutoTaskItem {
  key: string
  title: string
  des: string
  icon: string
  icon_acitve: string
}

export const autoTaskMap: AutoTaskItem[] = [
  {
    key: 'timing',
    title: '定时任务',
    des: '设定固定时间/周期，到点自动执行',
    icon: 'https://staticsns.cdn.bcebos.com/amis/2026-5/1778382450425/time.svg',
    icon_acitve:
      'https://staticsns.cdn.bcebos.com/amis/2026-5/1778383830932/time_hove.svg'
  },
  {
    key: 'event',
    title: '事件触发任务',
    des: '监控指定条件，条件满足时自动执行',
    icon: 'https://staticsns.cdn.bcebos.com/amis/2026-5/1778382454682/order.svg',
    icon_acitve:
      'https://staticsns.cdn.bcebos.com/amis/2026-5/1778383834596/job_hove.svg'
  }
]
