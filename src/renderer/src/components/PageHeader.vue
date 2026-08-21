<script setup lang="ts">
defineProps<{ title: string; desc?: string }>()
</script>
<template>
  <div class="page-header no-print">
    <div>
      <h1>{{ title }}</h1>
      <div v-if="desc" class="desc">{{ desc }}</div>
    </div>
    <div class="actions"><slot /></div>
  </div>
</template>
