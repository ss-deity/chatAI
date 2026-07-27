<script setup lang="ts">
defineProps<{
  msg: string
}>()
</script>

<template>
  <div class="hello">
    <h2>{{ msg }}</h2>
    <p>项目已就绪，可以开始开发了。</p>
  </div>
</template>

<style scoped>
.hello {
  text-align: center;
}
</style>
