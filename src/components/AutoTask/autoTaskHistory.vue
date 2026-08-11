<template>
    <div class="auto-task-history-panel">
        <!-- 任务列表 -->
        <div class="auto-task-history-list">
            <div
                class="auto-task-history-item"
                v-for="item in autoTaskList"
                :key="item.key"
                :class="{ active: isItemSelected(item) }"
                @click="selectItem(item)"
                @mouseenter="hoveredKey = item.key"
                @mouseleave="hoveredKey = null"
            >
                <div class="auto-task-item-left">
                    <div class="auto-task-main">
                        <div class="auto-task-top">
                            <img
                                class="auto-task-icon"
                                :src="item.icon"
                                :alt="item.title"
                            />
                            <span class="auto-task-title">{{ item.title }}</span>
                        </div>
                        <span class="auto-task-des">{{ item.des }}</span>
                    </div>
                </div>
                <!-- 选中状态标识 -->
                <div class="check-icon-wrapper" v-if="isItemSelected(item)">
                    <img
                        class="check-icon"
                        src="@/assets/input/tick-icon.png"
                        alt="selected"
                    />
                </div>
                <div
                    class="check-icon-wrapper gray-check"
                    v-else-if="hoveredKey === item.key"
                >
                    <img
                        class="check-icon"
                        src="@/assets/input/tick-icon-gray.png"
                        alt="select"
                    />
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { selectedAutoTaskKey, toggleAutoTaskSelection } from '@/composables/useAutoTask';
import { autoTaskMap, type AutoTaskItem } from './const';

const autoTaskList = autoTaskMap;
const hoveredKey = ref<string | null>(null);

const isItemSelected = (item: AutoTaskItem): boolean => {
    return selectedAutoTaskKey.value === item.key;
};

const selectItem = (item: AutoTaskItem) => {
    toggleAutoTaskSelection(item);
    emit('selectAutoTask', item);
};

const emit = defineEmits<{
    (event: 'selectAutoTask', item: AutoTaskItem): void;
}>();
</script>

<style lang="scss" scoped>
.auto-task-history-panel {
    width: 256px;
    background: var(--gf-bg-panel);
    border-radius: 8px;
    border: 1px solid var(--gf-border);
    box-shadow: var(--gf-shadow-menu);
    padding: 4px;
    display: flex;
    flex-direction: column;
}

.auto-task-history-list {
    overflow-y: auto;
    overflow-x: hidden;

    &::-webkit-scrollbar {
        width: 4px !important;
    }

    &::-webkit-scrollbar-track {
        background: transparent;
    }

    &::-webkit-scrollbar-thumb {
        background: var(--gf-scrollbar-thumb) !important;
        border-radius: 99px;
    }
}

.auto-task-history-item {
    min-height: 52px;
    padding: 8px 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-radius: 6px;
    cursor: pointer;
    transition: background-color 0.2s ease;
    box-sizing: border-box;

    &:hover {
        background-color: var(--gf-bg-elevated);
    }
}

.auto-task-item-left {
    display: flex;
    align-items: center;
    flex: 1;
    min-width: 0;
    margin-right: 8px;
}

.auto-task-main {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
}

.auto-task-top {
    display: flex;
    align-items: center;
    gap: 4px;
}

.auto-task-icon {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
}

.auto-task-info {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
}

.auto-task-icon {
    width: 16px;
    height: 16px;
    border-radius: 3.6px;
    flex-shrink: 0;
}

.auto-task-info {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
}

.auto-task-title {
    font-family: 'PingFang SC', sans-serif;
    font-size: 14px;
    font-weight: 400;
    color: var(--gf-text-primary);
    line-height: 22px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.auto-task-des {
    font-family: 'PingFang SC', sans-serif;
    font-size: 12px;
    font-weight: 400;
    color: var(--gf-text-disabled);
    line-height: 18px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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
