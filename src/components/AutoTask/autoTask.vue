<template>
    <div class="wp-chat-auto-task">
        <!-- 未选中状态 -->
        <div
            ref="autoTaskButtonRef"
            class="work-space-button"
            v-if="!selectedTask"
            @click="openPanel"
        >
            <div class="auto-task-icon-mask"></div>
            <div class="work-space-title">设置自动化任务</div>
        </div>

        <!-- 已选中状态 -->
        <div
            v-else
            ref="autoTaskButtonRef"
            class="work-space-button-selected"
        >
            <div
                class="selected-content"
                @click="openPanel"
            >
                <div class="selected-icon-wrapper">
                    <img
                        class="selected-folder-icon"
                        :src="selectedTask.icon_acitve"
                        :alt="selectedTask.title"
                        draggable="false"
                    />
                </div>
                <div class="selected-text-wrapper">
                    <span class="selected-filename">{{ selectedTask.title }}</span>
                </div>
            </div>
            <div class="selected-close-btn" @click.stop="handleClearSelection">
                <div class="close-icon-wrapper">
                    <img
                        class="close-icon"
                        :src="closeIcon"
                        draggable="false"
                    />
                </div>
            </div>
        </div>

        <!-- 弹出面板 -->
        <teleport to="body">
            <div
                v-if="panelShow"
                ref="panelRef"
                class="auto-task-history-wrapper"
                :style="panelStyle"
            >
                <auto-task-history @selectAutoTask="handleSelectAutoTask" />
            </div>
        </teleport>
    </div>
</template>

<script lang="ts">
export default { name: 'AutoTask' };
</script>

<script setup lang="ts">
import { ref, computed, nextTick, onUnmounted } from 'vue';
import AutoTaskHistory from './autoTaskHistory.vue';
import { selectedAutoTaskKey, clearAutoTaskSelection } from '@/composables/useAutoTask';
import { autoTaskMap, type AutoTaskItem } from './const';
import closeIcon from '@/assets/input/close-icon.png';

const panelShow = ref(false);
const autoTaskButtonRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const panelStyle = ref<Record<string, string>>({});

// 当前选中的任务对象
const selectedTask = computed<AutoTaskItem | null>(() => {
    const key = selectedAutoTaskKey.value;
    if (!key) return null;
    return autoTaskMap.find((t) => t.key === key) ?? null;
});

// 计算面板位置：按钮上方，左对齐，间距 4px
const positionPanel = () => {
    const btn = autoTaskButtonRef.value;
    const panel = panelRef.value;
    if (!btn || !panel) return;

    const btnRect = btn.getBoundingClientRect();
    panelStyle.value = {
        position: 'fixed',
        left: `${btnRect.left}px`,
        top: `${btnRect.top - panel.offsetHeight - 4}px`,
        zIndex: '1000'
    };
};

const handleClickOutside = (e: MouseEvent) => {
    if (panelRef.value && !panelRef.value.contains(e.target as Node)) {
        closePanel();
    }
};

const closePanel = () => {
    panelShow.value = false;
    document.removeEventListener('mousedown', handleClickOutside);
    window.removeEventListener('resize', positionPanel);
    window.removeEventListener('scroll', positionPanel, true);
};

const openPanel = () => {
    panelShow.value = true;
    nextTick(() => {
        positionPanel();
        document.addEventListener('mousedown', handleClickOutside);
        window.addEventListener('resize', positionPanel);
        window.addEventListener('scroll', positionPanel, true);
    });
};

const handleSelectAutoTask = (_item: AutoTaskItem) => {
    closePanel();
};

const handleClearSelection = () => {
    clearAutoTaskSelection();
};

onUnmounted(() => {
    closePanel();
});
</script>

<style lang="scss" scoped>
.work-space-button {
    width: 118px;
    height: 32px;
    box-sizing: border-box;
    border: 1px solid var(--gf-border);
    border-radius: 8px;
    display: flex;
    flex-direction: row;
    justify-content: center;
    align-items: center;
    cursor: pointer;
    position: relative;
    gap: 2px;

    &:hover {
        .auto-task-icon-mask {
            background-color: var(--gf-text-secondary);
        }
        .work-space-title {
            color: var(--gf-text-secondary);
        }
    }

    .auto-task-icon-mask {
        width: 16px;
        height: 16px;
        background-color: var(--gf-text-primary);
        -webkit-mask: url('@/assets/input/oc-add.svg') no-repeat center / contain;
        mask: url('@/assets/input/oc-add.svg') no-repeat center / contain;
    }

    .work-space-title {
        font-family: 'PingFang SC';
        font-size: 12px;
        font-weight: 500;
        line-height: 16px;
        color: var(--gf-text-primary);
        max-width: 180px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
}

.work-space-button-selected {
    max-width: 180px;
    height: 32px;
    border-radius: 9px;
    border: 1px solid rgba(89, 182, 255, 0.15);
    background: rgba(89, 182, 255, 0.08);
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
    padding: 7px 8px;
    box-sizing: border-box;
    cursor: pointer;

    .selected-content {
        display: flex;
        flex-direction: row;
        justify-content: flex-start;
        align-items: center;
        flex: 1;
        min-width: 0;
        margin-right: 6px;
    }

    .selected-icon-wrapper {
        width: 20px;
        height: 20px;
        display: flex;
        justify-content: center;
        align-items: center;
        margin-right: 2px;
        flex-shrink: 0;
    }

    .selected-folder-icon {
        width: 18px;
        height: 18px;
    }

    .selected-text-wrapper {
        display: flex;
        align-items: center;
        font-family: 'PingFang SC';
        font-size: 12px;
        font-weight: 400;
        line-height: 16px;
        color: #2e7dfe;
        flex: 1;
        min-width: 0;
    }

    .selected-filename {
        max-width: 110px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;

        &:hover {
            color: #469cff;
        }
    }

    .selected-close-btn {
        width: 16px;
        height: 16px;
        border-radius: 4px;
        display: flex;
        justify-content: center;
        align-items: center;
        flex-shrink: 0;
        cursor: pointer;

        .close-icon-wrapper {
            width: 100%;
            height: 100%;
            display: flex;
            justify-content: center;
            align-items: center;
        }

        .close-icon {
            width: 12px;
            height: 12px;
        }
    }
}
</style>
