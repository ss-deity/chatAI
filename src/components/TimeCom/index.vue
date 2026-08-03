<template>
    <div class="time-com-wrapper">
        <SelectPre :init="initFreqPayload" @change="handleFreqChange" />
        <HourTime
            v-if="showHourTime"
            :init="timeInitForChild"
            @change="handleTimeChange"
        />
        <DateTime
            v-if="showDateTime"
            :init="timeInitForChild"
            :disable-past="disablePast"
            @change="handleDateTimeChange"
        />
        <IntervalTime
            v-if="showIntervalTime"
            :init="timeInitForChild"
            :auto-focus="hasUserChangedFreq"
            @change="handleTimeChange"
        />
    </div>
</template>

<script lang="ts">
export default { name: 'TimeCom' };
</script>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import SelectPre from './selectPre.vue';
import HourTime from './hourTime.vue';
import DateTime from './dateTime.vue';
import IntervalTime from './intervalTime.vue';

// <!-- 1. 仅一次（DateTime）：指定日期时间 -->
// <TimeCom
//     :init="{ freq: 'once', time: '2026-06-01 09:30' }"
//     @change="handleChange"
// />
// <!-- 2. 每天 / 工作日 / 每周（HourTime）：指定 HH:mm -->
// <TimeCom
//     :init="{ freq: 'daily', time: '08:00' }"
//     @change="handleChange"
// />
// <!-- 3. 每周（HourTime + 选中星期几） -->
// <TimeCom
//     :init="{ freq: 'weekly', days: ['mon', 'wed', 'fri'], time: '09:00' }"
//     @change="handleChange"
// />
// <!-- 4. 间隔（IntervalTime）：数字 + 单位 -->
// <TimeCom
//     :init="{ freq: 'interval', time: '30分钟' }"
//     @change="handleChange"
// />
// <!-- 5. 不传 init：所有子组件使用各自默认值（当前时间） -->
// <TimeCom @change="handleChange" />

const props = defineProps<{
    init?: { freq?: string; days?: (string | number)[]; time?: string };
    /** 是否禁用当前时间之前的日期时间（仅对"仅一次"模式的 DateTime 生效） */
    disablePast?: boolean;
}>();

const currentFreq = ref(props.init?.freq || 'once');

// 用户是否已通过 SelectPre 切换过频率
// 切换后不再把原始 init.time（格式可能不匹配）传给子组件，改用子组件自身默认值（当前时间）
const hasUserChangedFreq = ref(false);

// 只在用户未切换过时才向子组件传 init.time，避免格式错配导致 Invalid dayjs
const timeInitForChild = computed(() =>
    hasUserChangedFreq.value ? undefined : props.init?.time
);

// 仅一次 → dateTime；间隔 → intervalTime；其余 → hourTime
const showDateTime = computed(() => currentFreq.value === 'once');
const showHourTime = computed(
    () => currentFreq.value !== 'once' && currentFreq.value !== 'interval'
);
const showIntervalTime = computed(() => currentFreq.value === 'interval');

const emit = defineEmits<{
    (
        event: 'change',
        value: { freq: string; days?: (string | number)[]; time: string }
    ): void;
}>();

// 缓存最新的各部分值，统一 emit
const freqPayload = ref<{ freq: string; days?: (string | number)[] }>({
    freq: props.init?.freq || 'once',
    ...(props.init?.days?.length ? { days: [...props.init.days] } : {})
});
const timeVal = ref('');

// 传给 SelectPre 的初始值
const initFreqPayload = computed(() =>
    props.init?.freq ? { freq: props.init.freq, days: props.init.days } : undefined
);

const emitChange = () => {
    emit('change', { ...freqPayload.value, time: timeVal.value });
};

const handleFreqChange = (val: { freq: string; days?: (string | number)[] }) => {
    // 判断时间子组件是否会切换
    const getTimeCompType = (freq: string) =>
        freq === 'once' ? 'datetime' : freq === 'interval' ? 'interval' : 'hourtime';
    const timeComponentChanges =
        getTimeCompType(currentFreq.value) !== getTimeCompType(val.freq);
    currentFreq.value = val.freq;
    freqPayload.value = val;
    hasUserChangedFreq.value = true;

    if (timeComponentChanges) {
        // 时间组件会重新挂载：重置 timeVal，等新组件 onMounted 后自行 emit
        timeVal.value = '';
    } else {
        // 时间组件不换：直接用当前 timeVal emit
        emitChange();
    }
};

const handleTimeChange = (val: string) => {
    timeVal.value = val;
    emitChange();
};

const handleDateTimeChange = (val: string) => {
    timeVal.value = val;
    emitChange();
};

onMounted(() => {
    emitChange();
});
</script>

<style lang="scss" scoped>
.time-com-wrapper {
    display: inline-flex;
    align-items: center;
    gap: 4px;
}
</style>
