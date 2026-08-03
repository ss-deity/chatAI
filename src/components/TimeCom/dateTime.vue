<template>
    <a-date-picker
        v-model:value="dateTimeValue"
        format="YYYY-MM-DD HH:mm"
        :show-time="{ format: 'HH:mm', hideNow: true }"
        :open="pickerOpen"
        :allow-clear="false"
        :locale="pickerLocale"
        :disabled-date="disabledDate"
        :disabled-time="disabledTime"
        popup-class-name="date-time-panel"
        class="date-time-picker"
        :class="{ 'is-open': pickerOpen }"
        @openChange="handleOpenChange"
        @change="handleChange"
        @ok="handleOk"
    >
        <template #suffixIcon>
            <img
                class="picker-arrow"
                :src="pickerOpen ? upIcon : downIcon"
                alt="arrow"
            />
        </template>
    </a-date-picker>
</template>

<script lang="ts">
export default { name: 'DateTime' };
</script>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue';
import { message } from 'ant-design-vue';
import dayjs, { type Dayjs } from 'dayjs';
import 'dayjs/locale/zh-cn';
import downIcon from '@/assets/input/down.svg';
import upIcon from '@/assets/input/up.svg';
import zhCN from 'ant-design-vue/es/date-picker/locale/zh_CN';

dayjs.locale('zh-cn');

const pickerLocale = {
    ...zhCN,
    lang: {
        ...zhCN.lang,
        now: '此刻',
        ok: '确定'
    }
};

const props = defineProps<{
    /** 初始日期时间，格式 YYYY-MM-DD HH:mm */
    init?: string;
    /** 是否禁用当前时间之前的日期时间 */
    disablePast?: boolean;
}>();

const dateTimeValue = ref<Dayjs>(
    props.init
        ? dayjs(props.init, 'YYYY-MM-DD HH:mm')
        : dayjs().add(1, 'day').hour(9).minute(0).second(0)
);
const pickerOpen = ref(false);

const disabledDate = (current: Dayjs) => {
    if (!props.disablePast) return false;
    return current.isBefore(dayjs().startOf('day'));
};

const disabledTime = (current: Dayjs | null) => {
    if (!props.disablePast || !current) return {};
    const now = dayjs();
    if (!current.isSame(now, 'day')) return {};
    const nowHour = now.hour();
    const nowMinute = now.minute();
    return {
        disabledHours: () => Array.from({ length: nowHour }, (_, i) => i),
        disabledMinutes: (selectedHour: number) =>
            selectedHour === nowHour
                ? Array.from({ length: nowMinute + 1 }, (_, i) => i)
                : [],
    };
};

const emit = defineEmits<{
    (event: 'change', value: string): void;
}>();

const handleOpenChange = (open: boolean) => {
    pickerOpen.value = open;
    if (open) {
        // 延迟注册，跳过面板打开瞬间 contenteditable 触发的 scroll 事件
        setTimeout(() => {
            window.addEventListener('resize', closePanel);
        }, 100);
    } else {
        removePositionListeners();
    }
};

const closePanel = () => {
    pickerOpen.value = false;
    removePositionListeners();
};

const removePositionListeners = () => {
    window.removeEventListener('resize', closePanel);
};

const handleChange = (value: Dayjs) => {
    if (!value) return;
    if (props.disablePast) {
        const now = dayjs();
        if (value.isSame(now, 'day') && value.isBefore(now, 'minute')) {
            const adjusted = value.hour(now.hour()).minute(now.minute()).second(0);
            nextTick(() => {
                dateTimeValue.value = adjusted;
            });
            emit('change', adjusted.format('YYYY-MM-DD HH:mm'));
            return;
        }
    }
    emit('change', value.format('YYYY-MM-DD HH:mm'));
};

// 点击确定后关闭面板
const handleOk = (value: Dayjs) => {
    if (props.disablePast && value && !value.isAfter(dayjs(), 'minute')) {
        message.error('选中时间应该晚于当前时间');
        return;
    }
    if (value) {
        emit('change', value.format('YYYY-MM-DD HH:mm'));
    }
    closePanel();
};

onMounted(() => {
    emit('change', dateTimeValue.value.format('YYYY-MM-DD HH:mm'));
});

onUnmounted(() => {
    removePositionListeners();
});
</script>

<style lang="scss" scoped>
.date-time-picker {
    width: 165px !important;
    height: 32px !important;
    padding: 0 10px !important;
    box-sizing: border-box;
    border: none !important;
    border-radius: 8px !important;
    box-shadow: none !important;
    background: #f5f7fa !important;
    gap: 8px;
    cursor: pointer;
    transition: background 0.2s;

    &.is-open {
        background: #edf0f3 !important;
    }

    :deep(.ant-picker-input) {
        input {
            font-family: 'PingFang SC', sans-serif;
            font-size: 14px;
            font-weight: 400;
            color: #030b1a;
            line-height: 16px;
            cursor: pointer;
            caret-color: transparent;
            user-select: none;
            pointer-events: none;

            &::placeholder {
                color: #a2abbd;
            }
        }
    }

    :deep(.ant-picker-suffix) {
        display: flex;
        align-items: center;
        margin-inline-start: 0;

        .picker-arrow {
            width: 12px;
            height: 12px;
            flex-shrink: 0;
        }
    }

    :deep(.ant-picker-active-bar) {
        display: none;
    }
}
</style>

<!-- 面板 teleport 到 body，需用非 scoped 全局样式 -->
<style lang="scss">
.date-time-panel {
    .ant-picker-time-panel-column {
        &::-webkit-scrollbar {
            width: 4px;
        }

        &::-webkit-scrollbar-track {
            background: transparent;
        }

        &::-webkit-scrollbar-thumb {
            min-height: 30px;
            background: #ccd2df;
            border-radius: 99px;
        }
    }

    .ant-picker-footer {
        .ant-picker-ranges {
            margin: 0 !important;
        }

        .ant-picker-now-btn {
            font-family: 'PingFang SC', sans-serif;
            font-weight: 500;
            font-size: 12px;
            line-height: 20px;
            letter-spacing: 0;
        }

        .ant-btn-primary {
            width: 56px;
            height: 28px;
            box-sizing: border-box;
            border-radius: 4px;
            border: none;
            background: rgba(37, 138, 255, 1);
            font-family: 'PingFang SC', sans-serif;
            font-weight: 400;
            font-size: 12px;
            line-height: 16px;
            color: rgba(255, 255, 255, 1);
            cursor: pointer;

            &:hover {
                background: rgba(37, 138, 255, 0.85);
            }
        }
    }

    .ant-picker-time-panel-cell {
        .ant-picker-time-panel-cell-inner {
            font-family: 'PingFang SC', sans-serif;
            font-weight: 500;
            font-size: 14px;
            line-height: 22px;
            letter-spacing: 0;
            color: rgba(0, 0, 0, 0.6);
        }

        &.ant-picker-time-panel-cell-selected {
            .ant-picker-time-panel-cell-inner {
                color: rgba(37, 138, 255, 1) !important;
                background: rgba(245, 247, 250, 1) !important;
            }
        }
    }

    // 日历日期单元格选中态
    .ant-picker-cell-selected,
    .ant-picker-cell-in-view.ant-picker-cell-selected {
        .ant-picker-cell-inner {
            background: rgba(245, 247, 250, 1) !important;
            color: rgba(37, 138, 255, 1) !important;
        }
    }

    // 移除"今天"日期的蓝色边框
    .ant-picker-cell-in-view.ant-picker-cell-today {
        .ant-picker-cell-inner::before {
            border: none !important;
            border-color: transparent !important;
        }
    }
}

// 全局覆盖 today 样式
.ant-picker-dropdown {
    .ant-picker-cell-in-view.ant-picker-cell-today {
        .ant-picker-cell-inner::before {
            border: none !important;
        }
    }
}
</style>
