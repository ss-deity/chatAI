export const selectPreFreqList = [
    { key: 'once', label: '仅一次' },
    { key: 'daily', label: '每天' },
    { key: 'workday', label: '工作日' },
    { key: 'weekly', label: '每周' },
    { key: 'monthly', label: '每月' },
    { key: 'interval', label: '时间间隔' }
];

export const weekDayList = [
    { key: 'mon', label: '周一' },
    { key: 'tue', label: '周二' },
    { key: 'wed', label: '周三' },
    { key: 'thu', label: '周四' },
    { key: 'fri', label: '周五' },
    { key: 'sat', label: '周六' },
    { key: 'sun', label: '周日' }
];

export const monthDayList = Array.from({ length: 31 }, (_, i) => ({
    key: i + 1,
    label: `${i + 1}日`
}));
