<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../api'
import PageHeader from '../components/PageHeader.vue'
import { bookState } from '../store'
import { fmt, round2, toast } from '../utils'
import { CATEGORY_NAMES } from '@shared/coa'
import type { Account, InitBalanceRow } from '@shared/types'

interface Row extends InitBalanceRow {
  name: string
  level: number
  category: string
  direction: string
}
const rows = ref<Row[]>([])
const keyword = ref('')
const hideZero = ref(false)
const midYear = computed(() => !!bookState.current && !bookState.current.start_period.endsWith('-01'))

async function load(): Promise<void> {
  try {
    const [accs, ib] = await Promise.all([api.accounts.list(), api.init.get()])
    const map = new Map(ib.map((r) => [r.account_code, r]))
    rows.value = accs
      .filter((a: Account) => a.is_leaf && a.enabled)
      .map((a) => {
        const r = map.get(a.code)
        return { account_code: a.code, name: a.name, level: a.level, category: a.category, direction: a.direction, debit: r?.debit ?? 0, credit: r?.credit ?? 0, year_debit: r?.year_debit ?? 0, year_credit: r?.year_credit ?? 0 }
      })
  } catch (e) {
    toast(e)
  }
}
onMounted(load)

const filtered = computed(() => rows.value.filter((r) => (!keyword.value || r.account_code.includes(keyword.value) || r.name.includes(keyword.value)) && (!hideZero.value || r.debit || r.credit || r.year_debit || r.year_credit)))
const totals = computed(() => {
  const d = round2(rows.value.reduce((s, r) => s + (Number(r.debit) || 0), 0))
  const c = round2(rows.value.reduce((s, r) => s + (Number(r.credit) || 0), 0))
  return { d, c, ok: Math.abs(d - c) < 0.005 }
})
async function save(): Promise<void> {
  try {
    const r = await api.init.save(rows.value.map(({ account_code, debit, credit, year_debit, year_credit }) => ({ account_code, debit: Number(debit) || 0, credit: Number(credit) || 0, year_debit: Number(year_debit) || 0, year_credit: Number(year_credit) || 0 })))
    ElMessage[r.balanced ? 'success' : 'warning'](r.balanced ? '已保存，试算平衡' : `已保存，但试算不平衡：借 ${fmt(r.debit)} / 贷 ${fmt(r.credit)}`)
    await load()
  } catch (e) {
    toast(e)
  }
}
</script>

<template>
  <div class="page">
    <PageHeader title="期初余额" :desc="`录入账套启用期间（${bookState.current?.start_period}）的期初余额，只录末级科目；年中启用还需录损益类科目本年累计发生额`">
      <el-tag :type="totals.ok ? 'success' : 'danger'" size="large" effect="light">借 {{ fmt(totals.d, '0.00') }} ／ 贷 {{ fmt(totals.c, '0.00') }} · {{ totals.ok ? '试算平衡' : '差额 ' + fmt(round2(totals.d - totals.c)) }}</el-tag>
      <el-button type="primary" icon="Check" @click="save">保存</el-button>
    </PageHeader>
    <div class="filter-bar">
      <el-input v-model="keyword" placeholder="编码 / 名称" clearable prefix-icon="Search" style="width: 220px" />
      <el-checkbox v-model="hideZero">只看有余额</el-checkbox>
    </div>
    <div class="card" style="padding: 0; overflow: hidden">
    <el-table :data="filtered" size="small" height="calc(100vh - 190px)">
      <el-table-column prop="account_code" label="编码" width="100" />
      <el-table-column prop="name" label="科目名称" min-width="160" />
      <el-table-column label="类别" width="70"><template #default="{ row }">{{ CATEGORY_NAMES[row.category as keyof typeof CATEGORY_NAMES] }}</template></el-table-column>
      <el-table-column label="方向" width="60"><template #default="{ row }">{{ row.direction === 'debit' ? '借' : '贷' }}</template></el-table-column>
      <el-table-column label="期初借方" width="160"><template #default="{ row }"><el-input-number v-model="row.debit" :controls="false" :precision="2" style="width: 100%" /></template></el-table-column>
      <el-table-column label="期初贷方" width="160"><template #default="{ row }"><el-input-number v-model="row.credit" :controls="false" :precision="2" style="width: 100%" /></template></el-table-column>
      <template v-if="midYear">
        <el-table-column label="本年累计借方" width="160"><template #default="{ row }"><el-input-number v-model="row.year_debit" :controls="false" :precision="2" style="width: 100%" /></template></el-table-column>
        <el-table-column label="本年累计贷方" width="160"><template #default="{ row }"><el-input-number v-model="row.year_credit" :controls="false" :precision="2" style="width: 100%" /></template></el-table-column>
      </template>
    </el-table>
    </div>
  </div>
</template>
