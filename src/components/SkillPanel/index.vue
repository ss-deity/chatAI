<script setup lang="ts">
/**
 * 输入框 `/` 唤起的技能候选面板。
 *
 * 交互与样式对齐 enterprise-genclaw 的 SelectSkillOptionList：
 * - 分「系统」/「我的技能」两组，组内按后端返回顺序
 * - 关键字过滤（名称 / 指令名，忽略大小写）
 * - 键盘导航由父组件转发（moveUp / moveDown / confirm 通过 defineExpose 暴露）
 * - 面板 mousedown 阻止默认行为，避免点击时输入框失焦、光标丢失
 */
import { ref, computed, watch, nextTick } from 'vue'
import type { Skill } from '../../utils/skills'

const props = withDefaults(
  defineProps<{
    /** `/` 之后已输入的关键字 */
    keyword?: string
    /** 全量技能列表 */
    skills: Skill[]
    /** 列表最大高度 */
    listMaxHeight?: string
  }>(),
  {
    keyword: '',
    listMaxHeight: '312px',
  },
)

const emit = defineEmits<{
  (e: 'select', skill: Skill): void
  /** 过滤后无候选项，父组件据此收起面板 */
  (e: 'empty'): void
}>()

/** 键盘高亮项在合并列表中的下标 */
const activeIndex = ref(-1)
const itemRefs: HTMLElement[] = []

function match(skill: Skill, kw: string): boolean {
  if (!kw) return true
  return (
    skill.name.toLowerCase().includes(kw) ||
    skill.command.toLowerCase().includes(kw)
  )
}

const filteredSystem = computed(() => {
  const kw = props.keyword.trim().toLowerCase()
  return props.skills.filter((s) => s.category !== 'own' && match(s, kw))
})

const filteredOwn = computed(() => {
  const kw = props.keyword.trim().toLowerCase()
  return props.skills.filter((s) => s.category === 'own' && match(s, kw))
})

/** 合并列表（系统在前），键盘导航按此顺序 */
const filteredList = computed(() => [...filteredSystem.value, ...filteredOwn.value])

watch(
  filteredList,
  () => {
    if (filteredList.value.length === 0) {
      emit('empty')
      activeIndex.value = -1
      return
    }
    // 默认高亮第一项，打开面板后直接 Enter 即可选中
    activeIndex.value = 0
  },
  { immediate: true },
)

// 键盘移动时把高亮项滚进可视区
watch(activeIndex, (idx) => {
  if (idx < 0) return
  void nextTick(() => {
    itemRefs[idx]?.scrollIntoView({ block: 'nearest' })
  })
})

function moveUp() {
  const len = filteredList.value.length
  if (!len) return
  activeIndex.value = (activeIndex.value - 1 + len) % len
}

function moveDown() {
  const len = filteredList.value.length
  if (!len) return
  activeIndex.value = (activeIndex.value + 1) % len
}

function confirm() {
  const item = filteredList.value[activeIndex.value]
  if (item) emit('select', item)
}

defineExpose({ moveUp, moveDown, confirm })
</script>

<template>
  <div v-if="filteredList.length" class="skill-panel" @mousedown.prevent>
    <div class="skill-panel__list" :style="{ maxHeight: listMaxHeight }">
      <template v-if="filteredSystem.length">
        <div class="skill-panel__section">系统</div>
        <div
          v-for="(item, i) in filteredSystem"
          :key="item.id"
          :ref="(el) => { if (el) itemRefs[i] = el as HTMLElement }"
          class="skill-panel__item"
          :class="{ focused: activeIndex === i }"
          @click="emit('select', item)"
          @mouseenter="activeIndex = i"
        >
          <span class="skill-panel__title">
            {{ item.name }}
            <span class="skill-panel__cmd">/{{ item.command }}</span>
          </span>
          <span class="skill-panel__desc">{{ item.description }}</span>
        </div>
      </template>

      <template v-if="filteredOwn.length">
        <div class="skill-panel__section">我的技能</div>
        <div
          v-for="(item, j) in filteredOwn"
          :key="item.id"
          :ref="(el) => { if (el) itemRefs[filteredSystem.length + j] = el as HTMLElement }"
          class="skill-panel__item"
          :class="{ focused: activeIndex === filteredSystem.length + j }"
          @click="emit('select', item)"
          @mouseenter="activeIndex = filteredSystem.length + j"
        >
          <span class="skill-panel__title">
            {{ item.name }}
            <span class="skill-panel__cmd">/{{ item.command }}</span>
          </span>
          <span class="skill-panel__desc">{{ item.description }}</span>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.skill-panel {
  width: 100%;
  max-width: 480px;
  box-sizing: border-box;
  background: var(--gf-bg-panel);
  border: 1px solid var(--gf-border-strong);
  border-radius: 8px;
  box-shadow: var(--gf-shadow-menu);
  padding: 4px;
}

.skill-panel__list {
  overflow-y: auto;
  overflow-x: hidden;
}

.skill-panel__section {
  font-size: 12px;
  line-height: 18px;
  color: var(--gf-text-disabled);
  padding: 6px 12px 2px;
}

.skill-panel__section:not(:first-child) {
  margin-top: 4px;
  padding-top: 8px;
}

.skill-panel__item {
  min-height: 52px;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  border-radius: 6px;
  cursor: pointer;
  box-sizing: border-box;
  transition: background-color 0.2s ease;
}

.skill-panel__item.focused,
.skill-panel__item:hover {
  background-color: var(--gf-bg-elevated);
}

.skill-panel__title {
  font-size: 14px;
  line-height: 22px;
  color: var(--gf-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.skill-panel__cmd {
  margin-left: 6px;
  font-size: 12px;
  color: var(--gf-text-tertiary);
}

.skill-panel__desc {
  font-size: 12px;
  line-height: 18px;
  color: var(--gf-text-disabled);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
