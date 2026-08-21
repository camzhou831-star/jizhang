<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api'
import PageHeader from '../components/PageHeader.vue'
import { bookState } from '../store'
import { curPeriod, fmt, toast, exportXlsx } from '../utils'
import AccountSelect from '../components/AccountSelect.vue'
import type { Account, LedgerRow } from '@shared/types'

const router = useRouter()
const accounts = ref<Account[]>([])
const code = ref('')
const mode = ref<'general' | 'subsidiary'>('subsidiary')
const from = ref(curPeriod().slice(0, 4) + '-01')
const to = ref(curPeriod())
const rows = ref<LedgerRow[]>([])
const loading = ref(false)
const accName = computed(() => {
  const a = accounts.value.find((x) => x.code === code.value)
  return a ? `${a.code} ${a.name}` : ''
})

onMounted(async () => {
  const lp = await api.books.lastPeriod().catch(() => curPeriod())
  to.value = lp
  from.value = lp.slice(0, 4) + '-01'
  if (bookState.current && from.value < bookState.current.start_period) from.value = bookState.current.start_period
  accounts.value = await api.accounts.list().catch(() => [])
  code.value = accounts.value.find((a) => a.code === '1002')?.code ?? accounts.value[0]?.code ?? ''
  await load()
})
async function load(): Promise<void> {
  if (!code.value) return
  loading.value = true
  try {
    rows.value = mode.value === 'general' ? await api.ledger.general(code.value, from.value, to.value) : await api.ledger.subsidiary(code.value, from.value, to.value)
  } catch (e) {
    toast(e)
  } finally {
    loading.value = false
  }
}
function exportIt(): void {
  exportXlsx(`${mode.value === 'general' ? '总账' : '明细账'}-${accName.value}-${from.value}至${to.value}.xlsx`, '账簿', [
    ['期间', '日期', '凭证号', '摘要', '借方', '贷方', '方向', '余额'],
    ...rows.value.map((r) => [r.period, r.date, r.voucher_no, r.summary, r.debit, r.credit, r.direction, r.balance])
  ])
}
const rowClass = ({ row }: { row: LedgerRow }): string => (row.voucher_id === null ? 'bold-row' : '')
</script>

<template>
  <div class="page">
    <PageHeader title="总账 / 明细账" desc="明细账逐笔列示并双击可跳转凭证；总账按月汇总">
      <el-button icon="Download" @click="exportIt">导出 Excel</el-button>
      <el-button icon="Printer" @click="api.app.print()">打印</el-button>
    </PageHeader>
    <div class="filter-bar no-print">
      <el-radio-group v-model="mode" @change="load">
        <el-radio-button value="subsidiary">明细账</el-radio-button>
        <el-radio-button value="general">总账</el-radio-button>
      </el-radio-group>
      <label>科目</label>
      <AccountSelect v-model="code" :accounts="accounts" @change="load" />
      <label>期间</label>
      <el-date-picker v-model="from" type="month" value-format="YYYY-MM" format="YYYY-MM" :clearable="false" style="width: 120px" />
      <span class="hint">至</span>
      <el-date-picker v-model="to" type="month" value-format="YYYY-MM" format="YYYY-MM" :clearable="false" style="width: 120px" />
      <el-button type="primary" @click="load">查询</el-button>
    </div>
    <div class="print-area paper">
      <div class="report-title">{{ mode === 'general' ? '总 账' : '明 细 账' }}</div>
      <div class="report-sub"><span>单位：{{ bookState.current?.company || bookState.current?.name }}</span><span>科目：{{ accName }}</span><span>期间：{{ from }} 至 {{ to }}</span></div>
      <el-table :data="rows" v-loading="loading" border size="small" :row-class-name="rowClass" style="margin-top: 6px" @row-dblclick="(r: LedgerRow) => r.voucher_id && router.push(`/voucher/${r.voucher_id}`)">
        <el-table-column prop="period" label="期间" width="90" />
        <el-table-column prop="date" label="日期" width="110" />
        <el-table-column prop="voucher_no" label="凭证号" width="90" />
        <el-table-column prop="summary" label="摘要" min-width="200" />
        <el-table-column label="借方" align="right" width="140"><template #default="{ row }">{{ fmt(row.debit) }}</template></el-table-column>
        <el-table-column label="贷方" align="right" width="140"><template #default="{ row }">{{ fmt(row.credit) }}</template></el-table-column>
        <el-table-column prop="direction" label="方向" width="60" align="center" />
        <el-table-column label="余额" align="right" width="140"><template #default="{ row }">{{ fmt(row.balance, '0.00') }}</template></el-table-column>
      </el-table>
      <p class="no-print" style="color: #888; font-size: 12px">双击明细行可打开对应凭证</p>
    </div>
  </div>
</template>
