<template>
    <div class="interval-time-wrapper">
        <span class="interval-every">每</span>

        <a-input-number
            ref="inputNumberRef"
            v-model:value="numValue"
            class="interval-input"
            :min="minValue"
            :max="1000"
            :precision="1"
            :controls="false"
            :formatter="
                (v) => (v != null && v !== '' ? String(parseFloat(String(v))) : '')
            "
            :parser="(v) => (v ? v.replace(/[^\d.]/g, '') : '')"
            @change="handleChange"
            @blur="handleBlur"
        />

        <div
            ref="unitTriggerRef"
            class="interval-unit-trigger"
            :class="{ 'is-open': unitPanelShow }"
            @click="toggleUnitPanel"
        >
            <span class="unit-label">{{ selectedUnit.label }}</span>
            <img
                class="unit-arrow"
                :src="unitPanelShow ? upIcon : downIcon"
                alt=""
            />
        </div>

        <teleport to="body">
            <div
                v-if="unitPanelShow"
                ref="unitPanelRef"
                class="interval-unit-panel"
                :class="{ 'panel-hidden': !unitPanelPositioned }"
                :style="unitPanelStyle"
            >
                <div
                    v-for="unit in unitList"
                    :key="unit.key"
                    class="interval-unit-item"
                    :class="{ active: selectedUnit.key === unit.key }"
                    @click="selectUnit(unit)"
                >
                    {{ unit.label }}
                </div>
            </div>
        </teleport>
    </div>
</template>

<script lang="ts">
export default { name: 'IntervalTime' };
</script>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue';
import { InputNumber as AInputNumber } from 'ant-design-vue';
import downIcon from '@/assets/input/down.svg';
import upIcon from '@/assets/input/up.svg';

const unitList = [
    { key: 'minute', label: '分钟' },
    { key: 'hour', label: '小时' }
];

const DEFAULT_UNIT = unitList[1]; // 小时

/** 每个单位对应的最小值：分钟 10、小时 1 */
const UNIT_MIN_MAP: Record<string, number> = {
    minute: 10,
    hour: 1
};

 /** 初始间隔，格式如 "1小时" / "30分钟" */const props = defineProps<{
    init?: string;
    autoFocus?: boolean;
}>();

/** 解析 init 字符串，返回数值和单位 */
const parseInit = () => {
    if (props.init) {
        const match = props.init.match(/^(\d+(?:\.\d+)?)(分钟|小时)$/);
        if (match) {
            const num = parseFloat(match[1]);
            const unit = unitList.find(u => u.label === match[2]) ?? DEFAULT_UNIT;
            return { num, unit };
        }
    }
    return { num: 1, unit: DEFAULT_UNIT };
};

const { num: initNum, unit: initUnit } = parseInit();
const selectedUnit = ref(initUnit);

/** 当前单位对应的最小值 */
const minValue = computed(() => UNIT_MIN_MAP[selectedUnit.value.key] ?? 1);

/** 初始值小于当前单位最小值时，重置为最小值 */
const numValue = ref<number>(
    initNum < (UNIT_MIN_MAP[initUnit.key] ?? 1)
        ? UNIT_MIN_MAP[initUnit.key] ?? 1
        : initNum
);

const emit = defineEmits<{
    (event: 'change', value: string): void;
}>();

/**
 * 将当前数值和单位格式化后 emit
 * 小于当前单位最小值时，自动重置为最小值
 */
const emitChange = () => {
    const min = minValue.value;
    if (numValue.value == null || isNaN(numValue.value) || numValue.value < min) {
        numValue.value = min;
    }
    emit('change', `${numValue.value}${selectedUnit.value.label}`);
};

const handleChange = (raw: string | number | null) => {
    const val = raw == null || raw === '' ? null : Number(raw);
    if (val == null || Number.isNaN(val)) return;
    const min = minValue.value;
    if (val < min) numValue.value = min;
    emitChange();
};

/** 失焦时若值为空、非数字或小于最小值，自动重置为最小值并 emit */
const handleBlur = () => {
    const min = minValue.value;
    if (numValue.value == null || isNaN(numValue.value) || numValue.value < min) {
        numValue.value = min;
        emitChange();
    }
};

// ─── 单位下拉 ─────────────────────────────────────────────────────────────────

const unitTriggerRef = ref<HTMLElement | null>(null);
const inputNumberRef = ref<InstanceType<typeof AInputNumber> | null>(null);
const unitPanelRef = ref<HTMLElement | null>(null);
const unitPanelShow = ref(false);
const unitPanelStyle = ref<Record<string, string>>({});
// 面板是否已完成定位
const unitPanelPositioned = ref(false);

const positionUnitPanel = () => {
    if (!unitTriggerRef.value) return;
    const rect = unitTriggerRef.value.getBoundingClientRect();
    const panel = unitPanelRef.value;
    const panelHeight = panel ? panel.offsetHeight : 0;

    // 上方空间够就向上展示（输入框位于页面底部），否则向下
    if (rect.top > panelHeight + 8) {
        unitPanelStyle.value = {
            position: 'fixed',
            left: `${rect.left}px`,
            top: `${rect.top - panelHeight - 4}px`,
            zIndex: '9999',
            minWidth: `${rect.width}px`
        };
    } else {
        unitPanelStyle.value = {
            position: 'fixed',
            left: `${rect.left}px`,
            top: `${rect.bottom + 4}px`,
            zIndex: '9999',
            minWidth: `${rect.width}px`
        };
    }
};

const openUnitPanel = () => {
    unitPanelShow.value = true;
    unitPanelPositioned.value = false;
    nextTick(() => {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                positionUnitPanel();
                unitPanelPositioned.value = true;
            });
        });
        document.addEventListener('mousedown', handleClickOutside);
        window.addEventListener('resize', positionUnitPanel);
        window.addEventListener('scroll', positionUnitPanel, true);
    });
};

const closeUnitPanel = () => {
    unitPanelShow.value = false;
    document.removeEventListener('mousedown', handleClickOutside);
    window.removeEventListener('resize', positionUnitPanel);
    window.removeEventListener('scroll', positionUnitPanel, true);
};

const toggleUnitPanel = () => {
    unitPanelShow.value ? closeUnitPanel() : openUnitPanel();
};

const handleClickOutside = (e: MouseEvent) => {
    const target = e.target as Node;
    if (
        !unitTriggerRef.value?.contains(target) &&
        !unitPanelRef.value?.contains(target)
    ) {
        closeUnitPanel();
    }
};

const selectUnit = (unit: (typeof unitList)[number]) => {
    selectedUnit.value = unit;
    // 切换单位后，若当前值低于新单位最小值，立即重置为最小值
    const newMin = UNIT_MIN_MAP[unit.key] ?? 1;
    if (numValue.value == null || isNaN(numValue.value) || numValue.value < newMin) {
        numValue.value = newMin;
    }
    closeUnitPanel();
    emitChange();
};

onMounted(() => {
    emitChange();
    if (props.autoFocus) {
        setTimeout(() => {
            (inputNumberRef.value as any)?.$el?.querySelector('input')?.focus();
        }, 100);
    }
});

onUnmounted(() => {
    closeUnitPanel();
});
</script>

<style lang="scss" scoped>
.interval-time-wrapper {
    display: inline-flex;
    align-items: center;
    gap: 4px;
}

.interval-every {
    font-size: 14px;
    color: #030b1a;
    flex-shrink: 0;
}

.interval-input {
    width: 64px !important;
    height: 32px !important;
    padding: 0 !important;
    border: none !important;
    border-radius: 8px !important;
    box-shadow: none !important;
    background: #f5f7fa !important;

    &:hover,
    &:focus-within {
        background: #edf0f3 !important;
    }

    :deep(.ant-input-number-input) {
        height: 32px;
        padding: 0 10px;
        text-align: center;
        font-family: 'PingFang SC', sans-serif;
        font-size: 14px;
        color: #030b1a;
        caret-color: #258aff;
    }
}

.interval-unit-trigger {
    height: 32px;
    padding: 0 10px;
    box-sizing: border-box;
    border-radius: 8px;
    background: #f5f7fa;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    user-select: none;
    transition: background 0.2s;
    white-space: nowrap;

    &.is-open {
        background: #edf0f3;
    }

    .unit-label {
        font-family: 'PingFang SC', sans-serif;
        font-size: 14px;
        color: #030b1a;
        line-height: 16px;
    }

    .unit-arrow {
        width: 12px;
        height: 12px;
        flex-shrink: 0;
    }
}
</style>

<style lang="scss">
.interval-unit-panel {
    background: #ffffff;
    border-radius: 8px;
    border: 1px solid #f5f7fa;
    box-shadow: 0 2px 16px 2px rgba(73, 83, 102, 0.16);
    overflow: hidden;
    padding: 4px;

    // 定位完成前移出视口，避免影响页面布局
    &.panel-hidden {
        position: fixed;
        left: -9999px;
        top: -9999px;
    }

    .interval-unit-item {
        height: 36px;
        padding: 0 12px;
        display: flex;
        align-items: center;
        border-radius: 6px;
        cursor: pointer;
        font-family: 'PingFang SC', sans-serif;
        font-size: 14px;
        color: #030b1a;
        white-space: nowrap;
        transition: background-color 0.2s;

        &:hover,
        &.active {
            background-color: #f5f7fa;
        }
    }
}
</style>
