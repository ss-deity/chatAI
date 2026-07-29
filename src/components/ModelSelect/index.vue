<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { MODELS, getModel } from '../../config/models'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [type: string] }>()

const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)

const current = computed(() => getModel(props.modelValue))

function toggle() {
  open.value = !open.value
}

function select(type: string) {
  emit('update:modelValue', type)
  open.value = false
}

function onDocClick(e: MouseEvent) {
  if (rootRef.value && !rootRef.value.contains(e.target as Node)) {
    open.value = false
  }
}

onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <div ref="rootRef" class="model-select" :class="{ open }">
    <div class="model-select-btn" :class="{ active: open }" @click.stop="toggle">
      <svg class="ms-icon" width="15" height="15" viewBox="0 0 16 16" fill="none">
        <path d="M8 1.7l1.6 3.4 3.7.4-2.8 2.5.8 3.6L8 9.9 4.7 12l.8-3.6L2.7 5.9l3.7-.4L8 1.7z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>
      </svg>
      <span class="ms-label">{{ current.label }}</span>
      <svg class="ms-arrow" width="12" height="12" viewBox="0 0 16 16" fill="none">
        <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>

    <div v-if="open" class="model-select-panel">
      <div
        v-for="m in MODELS"
        :key="m.type"
        class="model-option"
        :class="{ selected: m.type === current.type }"
        @click.stop="select(m.type)"
      >
        <div class="model-option-main">
          <span class="model-option-label">{{ m.label }}</span>
          <span v-if="m.desc" class="model-option-desc">{{ m.desc }}</span>
        </div>
        <svg v-if="m.type === current.type" class="model-option-check" width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M3 8.5l3 3 7-7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
    </div>
  </div>
</template>

<style scoped>
.model-select {
  position: relative;
  display: inline-flex;
}

.model-select-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--gf-border-strong);
  border-radius: 8px;
  font-size: 13px;
  color: var(--gf-text-regular);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
  user-select: none;
}

.model-select-btn:hover,
.model-select-btn.active {
  background: var(--gf-bg-elevated);
  border-color: var(--gf-primary);
  color: var(--gf-primary);
}

.ms-icon {
  flex-shrink: 0;
}

.ms-label {
  white-space: nowrap;
}

.ms-arrow {
  flex-shrink: 0;
  transition: transform 0.15s;
  color: var(--gf-text-tertiary);
}

.model-select.open .ms-arrow {
  transform: rotate(180deg);
}

/* 向上弹出（输入框在底部） */
.model-select-panel {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  min-width: 220px;
  background: var(--gf-bg-panel);
  border: 1px solid var(--gf-border);
  border-radius: 10px;
  box-shadow: var(--gf-shadow-menu);
  padding: 4px;
  z-index: 60;
}

.model-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}

.model-option:hover {
  background: var(--gf-bg-elevated);
}

.model-option-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.model-option-label {
  font-size: 13px;
  color: var(--gf-text-primary);
}

.model-option.selected .model-option-label {
  color: var(--gf-primary);
  font-weight: 500;
}

.model-option-desc {
  font-size: 12px;
  color: var(--gf-text-tertiary);
}

.model-option-check {
  color: var(--gf-primary);
  flex-shrink: 0;
}
</style>
