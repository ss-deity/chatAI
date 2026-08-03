<template>
    <div class="select-pre-wrapper" ref="wrapperRef">
        <!-- 触发按钮 -->
        <div class="select-pre-trigger" @click="togglePanel">
            <span class="trigger-label">{{ selectedFreqLabel }}</span>
            <img
                class="trigger-arrow"
                :src="panelShow ? upIcon : downIcon"
                alt="arrow"
            />
        </div>

        <!-- 下拉面板 teleport 到 body，避免被输入框层叠上下文遮挡 -->
        <teleport to="body">
            <div
                v-if="panelShow"
                ref="panelRef"
                class="select-pre-panel"
                :class="{ 'panel-hidden': !panelPositioned }"
                :style="panelStyle"
            >
                <!-- 左侧：频率列表（单选，无 check icon） -->
                <div class="panel-left" ref="panelLeftRef">
                    <div
                        class="panel-item"
                        v-for="item in freqList"
                        :key="item.key"
                        :class="{ active: selectedFreq === item.key }"
                        @click="selectFreq(item)"
                    >
                        <span class="panel-item-label">{{ item.label }}</span>
                    </div>
                </div>

                <!-- 右侧扩展面板：每周 / 每月 -->
                <template v-if="selectedFreq === 'weekly' || selectedFreq === 'monthly'">
                    <div class="panel-divider"></div>
                    <div class="panel-right" :style="{ maxHeight: panelRightMaxHeight }">
                        <div
                            class="panel-item"
                            v-for="day in rightPanelList"
                            :key="day.key"
                            :class="{ active: isDaySelected(day.key) }"
                            @mouseenter="hoveredDayKey = day.key"
                            @mouseleave="hoveredDayKey = null"
                            @click="toggleDay(day.key)"
                        >
                            <span class="panel-item-label">{{ day.label }}</span>
                            <div class="check-icon-wrapper" v-if="isDaySelected(day.key)">
                                <img
                                    class="check-icon"
                                    src="@/assets/input/tick-icon.png"
                                    alt="selected"
                                />
                            </div>
                            <div
                                class="check-icon-wrapper gray-check"
                                v-else-if="hoveredDayKey === day.key"
                            >
                                <img
                                    class="check-icon"
                                    src="@/assets/input/tick-icon-gray.png"
                                    alt="select"
                                />
                            </div>
                        </div>
                    </div>
                </template>
            </div>
        </teleport>
    </div>
</template>

<script lang="ts">
export default { name: 'SelectPre' };
</script>

<script setup lang="ts">
import { ref, computed, onUnmounted, nextTick } from 'vue';
import downIcon from '@/assets/input/down.svg';
import upIcon from '@/assets/input/up.svg';
import { selectPreFreqList, weekDayList, monthDayList } from './const';

const freqList = selectPreFreqList;

const props = defineProps<{
    init?: { freq?: string; days?: (string | number)[] };
}>();

// ---- 状态 ----
const panelShow = ref(false);
const selectedFreq = ref(
    props.init?.freq && freqList.some(f => f.key === props.init!.freq)
        ? props.init.freq
        : freqList[0].key
);
const selectedDays = ref<(string | number)[]>((() => {
    if (props.init?.days?.length) return [...props.init.days];
    if (props.init?.freq === 'weekly') return ['mon'];
    if (props.init?.freq === 'monthly') return [1];
    return [];
})());
const hoveredDayKey = ref<string | number | null>(null);
const wrapperRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const panelLeftRef = ref<HTMLElement | null>(null);
const panelStyle = ref<Record<string, string>>({});
const panelRightMaxHeight = ref<string>('');
// 面板是否已完成定位（用于避免首次渲染时闪烁到错误位置）
const panelPositioned = ref(false);

// ---- 计算 ----
const selectedFreqLabel = computed(() => {
    const freqLabel = freqList.find((f) => f.key === selectedFreq.value)?.label ?? '';
    if (
        (selectedFreq.value === 'weekly' || selectedFreq.value === 'monthly') &&
        selectedDays.value.length > 0
    ) {
        const list = selectedFreq.value === 'weekly' ? weekDayList : monthDayList;
        // 按列表原始顺序（周一→周日 / 1日→31日）排序后展示
        const dayLabels = list
            .filter((d) => selectedDays.value.includes(d.key))
            .map((d) => d.label);
        return `${freqLabel}（${dayLabels.join('、')}）`;
    }
    return freqLabel;
});

const rightPanelList = computed(() => {
    if (selectedFreq.value === 'weekly') return weekDayList;
    if (selectedFreq.value === 'monthly') return monthDayList;
    return [];
});

// ---- emit ----
const emit = defineEmits<{
    (event: 'change', value: { freq: string; days?: (string | number)[] }): void;
}>();

const emitChange = () => {
    const needsDays = selectedFreq.value === 'weekly' || selectedFreq.value === 'monthly';
    emit('change', {
        freq: selectedFreq.value,
        ...(needsDays ? { days: [...selectedDays.value] } : {})
    });
};

// ---- 面板定位 ----
const positionPanel = () => {
    const trigger = wrapperRef.value;
    const panel = panelRef.value;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const panelHeight = panel ? panel.offsetHeight : 0;
    panelStyle.value = {
        position: 'fixed',
        left: `${rect.left}px`,
        top: `${rect.bottom + 4}px`,
        zIndex: '9999'
    };
    // 如果面板超出视口底部，则向上展开
    if (panel && rect.bottom + 4 + panelHeight > window.innerHeight) {
        panelStyle.value.top = `${rect.top - panelHeight - 4}px`;
    }
};

// ---- 面板开关 ----
const openPanel = () => {
    panelShow.value = true;
    panelPositioned.value = false; // 重置定位状态
    nextTick(() => {
        if (panelLeftRef.value) {
            panelRightMaxHeight.value = `${panelLeftRef.value.offsetHeight}px`;
        }
        // 在下一个 rAF 中定位，确保 maxHeight 已生效
        requestAnimationFrame(() => {
            positionPanel();
            panelPositioned.value = true; // 定位完成
        });
        document.addEventListener('mousedown', handleClickOutside);
        window.addEventListener('resize', positionPanel);
        window.addEventListener('scroll', positionPanel, true);
    });
};

const closePanel = () => {
    panelShow.value = false;
    document.removeEventListener('mousedown', handleClickOutside);
    window.removeEventListener('resize', positionPanel);
    window.removeEventListener('scroll', positionPanel, true);
};

const togglePanel = () => {
    panelShow.value ? closePanel() : openPanel();
};

const handleClickOutside = (e: MouseEvent) => {
    const target = e.target as Node;
    const inWrapper = wrapperRef.value?.contains(target);
    const inPanel = panelRef.value?.contains(target);
    if (!inWrapper && !inPanel) {
        closePanel();
    }
};

// ---- 选择逻辑 ----
const selectFreq = (item: { key: string; label: string }) => {
    if (selectedFreq.value !== item.key) {
        selectedFreq.value = item.key;
        // 切换到每周/每月时设置对应默认值
        if (item.key === 'weekly') {
            selectedDays.value = ['mon'];
        } else if (item.key === 'monthly') {
            selectedDays.value = [1];
        } else {
            selectedDays.value = [];
        }
    }

    // weekly / monthly 保持面板展开，其余关闭面板
    if (item.key !== 'weekly' && item.key !== 'monthly') {
        closePanel();
    }

    emitChange();
};

const isDaySelected = (key: string | number): boolean => {
    return selectedDays.value.includes(key);
};

const toggleDay = (key: string | number) => {
    const idx = selectedDays.value.indexOf(key);
    if (idx >= 0) {
        // 不可取消最后一个选中项
        if (selectedDays.value.length <= 1) return;
        selectedDays.value.splice(idx, 1);
    } else {
        selectedDays.value.push(key);
    }
    emitChange();
};

onUnmounted(() => {
    document.removeEventListener('mousedown', handleClickOutside);
});
</script>

<style lang="scss" scoped>
.select-pre-wrapper {
    position: relative;
    display: inline-block;
}

.select-pre-trigger {
    height: 32px;
    padding: 0 10px;
    box-sizing: border-box;
    max-width: 188px;
    border-radius: 8px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    user-select: text;
    background: #F5F7FA;

    .trigger-label {
        font-family: 'PingFang SC', sans-serif;
        font-size: 14px;
        font-weight: 400;
        color: #030b1a;
        line-height: 16px;
        flex: 1;
        min-width: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .trigger-arrow {
        width: 12px;
        height: 12px;
        flex-shrink: 0;
    }
}

.select-pre-panel {
    display: flex;
    flex-direction: row;
    background: #ffffff;
    border-radius: 8px;
    border: 1px solid #f5f7fa;
    box-shadow: 0px 2px 16px 2px rgba(73, 83, 102, 0.16);
    overflow: hidden;

    // 定位完成前移出视口，避免影响页面布局导致滚动条闪烁
    &.panel-hidden {
        position: fixed;
        left: -9999px;
        top: -9999px;
    }
}

.panel-left {
    height: 224px;
    width: 120px;
    padding: 4px;
    box-sizing: border-box;
    flex-shrink: 0;
}

.panel-divider {
    width: 1px;
    background: #ebeef5;
    flex-shrink: 0;
}

.panel-right {
    width: 120px;
    padding: 4px;
    box-sizing: border-box;
    overflow-y: auto;
    flex-shrink: 0;

    &::-webkit-scrollbar {
        width: 4px !important;
    }

    &::-webkit-scrollbar-track {
        background: transparent;
    }

    &::-webkit-scrollbar-thumb {
        background: #ccd2df !important;
        border-radius: 99px;
    }
}

.panel-item {
    height: 36px;
    padding: 0 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-radius: 6px;
    cursor: pointer;
    transition: background-color 0.2s ease;
    box-sizing: border-box;

    &:hover,
    &.active {
        background-color: #f5f7fa;
    }

    .panel-item-label {
        font-family: 'PingFang SC', sans-serif;
        font-size: 14px;
        font-weight: 400;
        color: #030b1a;
        line-height: 24px;
        white-space: nowrap;
    }
}

.check-icon-wrapper {
    width: 14px;
    height: 14px;
    display: flex;
    justify-content: center;
    align-items: center;
    flex-shrink: 0;
}

.check-icon {
    width: 14px;
    height: 14px;
}
</style>
