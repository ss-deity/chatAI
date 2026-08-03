<template>
    <div class="select-file" :class="{ 'select-file--has-files': selectedFiles.length > 0 }">
        <!-- 未选中：触发按钮 -->
        <div
            v-if="selectedFiles.length === 0"
            class="select-file__trigger"
            @click="openFileSelect"
        >
            <span class="select-file__label">选择文件夹</span>
            <img
                class="select-file__arrow"
                :src="visible ? upIcon : downIcon"
                alt="arrow"
            />
        </div>

        <!-- 已选中：显示文件夹名 + 清空 -->
        <div v-else class="select-file__selected">
            <div class="select-file__selected-content" @click="openFileSelect">
                <img
                    class="select-file__selected-folder"
                    :src="panFolderIcon"
                    draggable="false"
                />
                <div class="select-file__selected-text">
                    <span class="select-file__selected-name">{{
                        selectedFiles[0].name
                    }}</span>
                </div>
            </div>
            <div class="select-file__close-btn" @click.stop="clearAll">
                <img
                    class="select-file__close-icon"
                    :src="closeIcon"
                    draggable="false"
                />
            </div>
        </div>

        <FilePicker
            v-if="visible"
            :visible="visible"
            :user-id="props.userId"
            :save="handleConfirm"
            title="选择监听文件夹"
            confirm-text="确定"
            @update:visible="visible = $event"
            @cancel="visible = false"
        />
    </div>
</template>

<script lang="ts">
export default { name: 'SelectFile' };
</script>

<script setup lang="ts">
/**
 * 事件触发任务模板里的「选择文件夹」行内组件，抄自 enterprise-genclaw 的
 * customInput/fileCom/selectFile.vue，数据源换成 chatAI 文件管理的 FilePicker。
 *
 * init / change 契约必须保持：粘贴与撤销恢复时，宿主会把上次序列化的
 * data-vc-state 通过 init 传回来重建选中态。
 */
import { ref } from 'vue';
import FilePicker from '../FilePicker/index.vue';
import panFolderIcon from '@/assets/input/pan-folder-icon.png';
import closeIcon from '@/assets/input/close-icon.png';
import downIcon from '@/assets/input/down.svg';
import upIcon from '@/assets/input/up.svg';

/** 选中的文件夹（相对用户根目录的 path + 展示名） */
export interface SelectedFolder {
    name: string;
    path: string;
}

const props = defineProps<{
    /** 粘贴或撤销恢复时，传入已选文件夹列表，恢复选中状态 */
    init?: SelectedFolder[];
    /** 当前登录用户 id，FilePicker 拉取目录需要 */
    userId: string;
}>();

const emit = defineEmits<{
    (e: 'change', files: SelectedFolder[]): void;
}>();

const visible = ref(false);
const selectedFiles = ref<SelectedFolder[]>(props.init ? [...props.init] : []);

const openFileSelect = () => {
    visible.value = true;
};

/** FilePicker 的 save 回调：拿到目标目录路径，转成选中态 */
const handleConfirm = async (dir: string) => {
    const path = dir || '';
    const name = path ? path.slice(path.lastIndexOf('/') + 1) : '我的文件';
    selectedFiles.value = [{ name, path }];
    emit('change', selectedFiles.value);
    visible.value = false;
};

const clearAll = () => {
    selectedFiles.value = [];
    emit('change', selectedFiles.value);
};
</script>

<style lang="scss" scoped>
.select-file {
    display: inline-flex;
    align-items: center;
    vertical-align: baseline;

    &--has-files {
        vertical-align: middle;
    }

    &__trigger {
        height: 32px;
        padding: 0 10px;
        box-sizing: border-box;
        border-radius: 8px;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        transition: background 0.2s;
        background: #f5f7fa;

        &:hover {
            .select-file__label {
                color: #495366;
            }
        }
    }

    &__label {
        font-family: 'PingFang SC', sans-serif;
        font-size: 14px;
        font-weight: 400;
        line-height: 16px;
        color: #030b1a;
        white-space: nowrap;
    }

    &__arrow {
        width: 12px;
        height: 12px;
        flex-shrink: 0;
    }

    &__selected {
        max-width: 200px;
        height: 32px;
        border-radius: 8px;
        border: 1px solid rgba(89, 182, 255, 0.15);
        background: rgba(89, 182, 255, 0.08);
        display: inline-flex;
        align-items: center;
        padding: 0 8px;
        box-sizing: border-box;
        gap: 4px;
        cursor: pointer;
    }

    &__selected-content {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        flex: 1;
        min-width: 0;
    }

    &__selected-folder {
        width: 16px;
        height: 16px;
        flex-shrink: 0;
    }

    &__selected-text {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        flex: 1;
        min-width: 0;
    }

    &__selected-name {
        font-family: 'PingFang SC', sans-serif;
        font-size: 12px;
        font-weight: 400;
        line-height: 16px;
        color: #2e7dfe;
        max-width: 90px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    &__close-btn {
        width: 16px;
        height: 16px;
        border-radius: 4px;
        background: #ffffff;
        display: flex;
        justify-content: center;
        align-items: center;
        flex-shrink: 0;
        cursor: pointer;

        &:hover {
            background: #f5f7fa;
        }
    }

    &__close-icon {
        width: 10px;
        height: 10px;
    }
}
</style>
