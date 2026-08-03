<template>
    <a-time-picker
        v-model:value="timeValue"
        format="HH:mm"
        :open="pickerOpen"
        :allow-clear="false"
        :locale="pickerLocale"
        popup-class-name="hour-time-panel"
        class="hour-time-picker"
        :class="{ 'is-open': pickerOpen }"
        @openChange="handleOpenChange"
        @change="handleChange"
    >
        <template #suffixIcon>
            <img
                class="picker-arrow"
                :src="pickerOpen ? upIcon : downIcon"
                alt="arrow"
            />
        </template>
    </a-time-picker>
</template>

<script lang="ts">
export default { name: 'HourTime' };
</script>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import dayjs, { type Dayjs } from 'dayjs';
import downIcon from '@/assets/input/down.svg';
import upIcon from '@/assets/input/up.svg';
import zhCN from 'ant-design-vue/es/date-picker/locale/zh_CN';

const pickerLocale = {
    ...zhCN,
    lang: {
        ...zhCN.lang,
        now: '此刻',
        ok: '确定'
    }
};

const props = defineProps<{
    /** 初始时间，格式 HH:mm */
    init?: string;
}>();

const timeValue = ref<Dayjs>(
    props.init ? dayjs(props.init, 'HH:mm') : dayjs().hour(9).minute(0).second(0)
);
const pickerOpen = ref(false);

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
    if (value) {
        emit('change', value.format('HH:mm'));
    }
};

onMounted(() => {
    emit('change', timeValue.value.format('HH:mm'));
});

onUnmounted(() => {
    removePositionListeners();
});
</script>

<style lang="scss" scoped>
.hour-time-picker {
    width: 76px !important;
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
.hour-time-panel {
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

    .ant-picker-ranges {
        margin: 0 !important;
        padding: 4px 12px;

        // 此刻按钮
        .ant-picker-now-btn {
            font-family: 'PingFang SC', sans-serif;
            font-weight: 500;
            font-size: 12px;
            line-height: 20px;
            letter-spacing: 0;
            text-align: center;
        }

        .ant-btn-primary {
            height: 28px;
            box-sizing: border-box;
            border-radius: 4px;
            border: none;
            background: rgba(37, 138, 255, 1);
            font-family: 'PingFang SC', sans-serif;
            font-weight: 400;
            font-size: 12px;
            line-height: 16px;
            letter-spacing: 0;
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
                color: #258aff !important;
                background: #f5f7fa !important;
            }
        }
    }
}
</style>
