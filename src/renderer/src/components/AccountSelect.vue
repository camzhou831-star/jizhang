<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Account } from '@shared/types'

const props = defineProps<{ modelValue: string; accounts: Account[]; leafOnly?: boolean; placeholder?: string; size?: 'small' | 'default' | 'large'; width?: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void; (e: 'change', v: string): void }>()
const query = ref('')
const accMap = computed(() => new Map(props.accounts.map((a) => [a.code, a])))
function fullName(code: string): string {
  const parts: string[] = []
  let cur = accMap.value.get(code)
  while (cur) {
    parts.unshift(cur.name)
    cur = cur.parent_code ? accMap.value.get(cur.parent_code) : undefined
  }
  return parts.join('_')
}
const options = computed(() => {
  const q = query.value.toLowerCase()
  return props.accounts.filter((a) => a.enabled && (!props.leafOnly || a.is_leaf) && (!q || a.code.startsWith(q) || fullName(a.code).toLowerCase().includes(q)))
})
</script>

<template>
  <el-select
    :model-value="modelValue"
    filterable
    remote
    reserve-keyword
    :remote-method="(q: string) => (query = q)"
    :size="size"
    :placeholder="placeholder ?? '编码 / 名称检索'"
    :style="{ width: width ?? '320px' }"
    clearable
    @visible-change="(v: boolean) => !v && (query = '')"
    @update:model-value="(v: string) => { emit('update:modelValue', v); emit('change', v) }"
  >
    <el-option v-for="a in options" :key="a.code" :value="a.code" :label="`${a.code} ${fullName(a.code)}`">
      <span style="font-family: monospace; margin-right: 8px; color: #666">{{ a.code }}</span>{{ fullName(a.code) }}
    </el-option>
  </el-select>
</template>
