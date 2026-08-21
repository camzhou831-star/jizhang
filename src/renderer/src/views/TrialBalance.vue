<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { api } from '../api'
import PageHeader from '../components/PageHeader.vue'
import { bookState } from '../store'
import { curPeriod, fmt, toast, exportXlsx } from '../utils'
import type { BalanceRow } from '@shared/types'

const rows = ref<BalanceRow[]>([])
const from = ref(curPeriod())
const to = ref(curPeriod())
const level = ref(0)
const hideZero = ref(true)
const loading = ref(false)

async function load(): Promise<void> {
  loading.value = true
  try {
    rows.value = await api.ledger.balance(from.value, to.value, { maxLevel: level.value || undefined, hideZero: hideZero.value })
  } catch (e) {
    toast(e)
  } finally {
    loading.value = false
  }
}
onMounted(async () => {
  const lp = await api.books.lastPeriod().catch(() => curPeriod())
  from.value = to.value = lp
  load()
})
const totals = computed(() => {
  const t = { od: 0, oc: 0, pd: 0, pc: 0, cd: 0, cc: 0 }
  for (const r of rows.value.filter((r) => r.level === 1)) {
    t.od += r.open_debit
    t.oc += r.open_credit
    t.pd += r.period_debit
    t.pc += r.period_credit
    t.cd += r.close_debit
    t.cc += r.close_credit
  }
  return t
})
const rowClass = ({ row }: { row: BalanceRow }): string => (row.level === 1 ? 'bold-row' : '')
const summaryRow = (): string[] => ['合计', '', fmt(totals.value.od), fmt(totals.value.oc), fmt(totals.value.pd), fmt(totals.value.pc), fmt(totals.value.cd), fmt(totals.value.cc)]
function exportIt(): void {
  exportXlsx(`科目余额表-${from.value}至${to.value}.xlsx`, '科目余额表', [
    ['科目编码', '科目名称', '期初借方', '期初贷方', '本期借方', '本期贷方', '期末借方', '期末贷方'],
    ...rows.value.map((r) => [r.code, r.name, r.open_debit, r.open_credit, r.period_debit, r.period_credit, r.close_debit, r.close_credit]),
    ['合计', '', totals.value.od, totals.value.oc, totals.value.pd, totals.value.pc, totals.value.cd, totals.value.cc]
  ])
}
</script>

<template>
  <div class="page">
    <PageHeader title="科目余额表" desc="各科目期初、本期发生、期末余额；期初 + 本期借 − 本期贷 = 期末">
      <el-button icon="Download" @click="exportIt">导出 Excel</el-button>
      <el-button icon="Printer" @click="api.app.print()">打印</el-button>
    </PageHeader>
    <div class="filter-bar no-print">
      <label>期间</label>
      <el-date-picker v-model="from" type="month" value-format="YYYY-MM" format="YYYY-MM" :clearable="false" style="width: 120px" />
      <span class="hint">至</span>
      <el-date-picker v-model="to" type="month" value-format="YYYY-MM" format="YYYY-MM" :clearable="false" style="width: 120px" />
      <label>级次</label>
      <el-select v-model="level" style="width: 110px">
        <el-option :value="0" label="全部级次" />
        <el-option :value="1" label="一级科目" />
        <el-option :value="2" label="到二级" />
        <el-option :value="3" label="到三级" />
      </el-select>
      <el-checkbox v-model="hideZero">隐藏无发生无余额</el-checkbox>
      <el-button type="primary" @click="load">查询</el-button>
    </div>
    <div class="print-area paper">
      <div class="report-title">科目余额表</div>
      <div class="report-sub"><span>单位：{{ bookState.current?.company || bookState.current?.name }}</span><span>期间：{{ from }} 至 {{ to }}</span><span>单位：元</span></div>
      <el-table :data="rows" v-loading="loading" border size="small" :row-class-name="rowClass" show-summary :summary-method="summaryRow" style="margin-top: 6px">
        <el-table-column prop="code" label="科目编码" width="100" />
        <el-table-column label="科目名称" min-width="150"><template #default="{ row }"><span :style="{ paddingLeft: (row.level - 1) * 16 + 'px' }">{{ row.name }}</span></template></el-table-column>
        <el-table-column label="期初借方" align="right" width="120"><template #default="{ row }">{{ fmt(row.open_debit) }}</template></el-table-column>
        <el-table-column label="期初贷方" align="right" width="120"><template #default="{ row }">{{ fmt(row.open_credit) }}</template></el-table-column>
        <el-table-column label="本期借方" align="right" width="120"><template #default="{ row }">{{ fmt(row.period_debit) }}</template></el-table-column>
        <el-table-column label="本期贷方" align="right" width="120"><template #default="{ row }">{{ fmt(row.period_credit) }}</template></el-table-column>
        <el-table-column label="期末借方" align="right" width="120"><template #default="{ row }">{{ fmt(row.close_debit) }}</template></el-table-column>
        <el-table-column label="期末贷方" align="right" width="120"><template #default="{ row }">{{ fmt(row.close_credit) }}</template></el-table-column>
      </el-table>
    </div>
  </div>
</template>

<style>
.bold-row { font-weight: 600; }
</style>
