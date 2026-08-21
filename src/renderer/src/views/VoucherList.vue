<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api'
import PageHeader from '../components/PageHeader.vue'
import { bookState } from '../store'
import { curPeriod, fmt, toast, exportXlsx } from '../utils'
import type { VoucherListItem, Voucher, Account } from '@shared/types'

const router = useRouter()
const list = ref<VoucherListItem[]>([])
const from = ref(curPeriod())
const to = ref(curPeriod())
const keyword = ref('')
const loading = ref(false)
const accounts = ref<Account[]>([])
const detail = ref<Voucher | null>(null)
const accName = computed(() => new Map(accounts.value.map((a) => [a.code, a.name])))

async function load(): Promise<void> {
  loading.value = true
  try {
    list.value = await api.vouchers.list({ from: from.value, to: to.value, keyword: keyword.value || undefined })
  } catch (e) {
    toast(e)
  } finally {
    loading.value = false
  }
}
onMounted(async () => {
  const lp = await api.books.lastPeriod().catch(() => curPeriod())
  from.value = to.value = lp
  accounts.value = await api.accounts.list().catch(() => [])
  await load()
})
async function remove(row: VoucherListItem): Promise<void> {
  try {
    await ElMessageBox.confirm(`删除 ${row.period} ${row.word}-${row.num}？`, '删除凭证', { type: 'warning' })
    await api.vouchers.delete(row.id)
    ElMessage.success('已删除')
    await load()
  } catch (e) {
    if (e !== 'cancel') toast(e)
  }
}
async function renumber(): Promise<void> {
  try {
    await ElMessageBox.confirm(`将 ${to.value} 期间的凭证按日期重新连续编号？`, '整理断号', { type: 'warning' })
    const n = await api.vouchers.renumber(to.value)
    ElMessage.success(`已整理 ${n} 张`)
    await load()
  } catch (e) {
    if (e !== 'cancel') toast(e)
  }
}
async function show(row: VoucherListItem): Promise<void> {
  try {
    detail.value = await api.vouchers.get(row.id)
  } catch (e) {
    toast(e)
  }
}
async function exportAll(): Promise<void> {
  const rows: (string | number)[][] = [['期间', '日期', '凭证号', '摘要', '科目编码', '科目名称', '借方', '贷方', '制单']]
  for (const it of list.value) {
    const v = await api.vouchers.get(it.id)
    if (!v) continue
    for (const l of v.lines) rows.push([v.period, v.date, `${v.word}-${v.num}`, l.summary, l.account_code, accName.value.get(l.account_code) ?? '', l.debit, l.credit, v.maker])
  }
  await exportXlsx(`凭证明细-${from.value}至${to.value}.xlsx`, '凭证', rows)
}
const total = computed(() => list.value.reduce((s, r) => s + r.total, 0))
</script>

<template>
  <div class="page">
    <PageHeader title="凭证查询" desc="双击行可打开编辑；已结账期间的凭证只读">
      <el-button icon="Sort" @click="renumber">整理断号（{{ to }}）</el-button>
      <el-button icon="Download" @click="exportAll">导出 Excel</el-button>
      <el-button type="primary" icon="Plus" @click="router.push('/voucher/new')">新增凭证</el-button>
    </PageHeader>
    <div class="filter-bar">
      <label>期间</label>
      <el-date-picker v-model="from" type="month" value-format="YYYY-MM" format="YYYY-MM" :clearable="false" style="width: 120px" />
      <span class="hint">至</span>
      <el-date-picker v-model="to" type="month" value-format="YYYY-MM" format="YYYY-MM" :clearable="false" style="width: 120px" />
      <el-input v-model="keyword" placeholder="摘要 / 科目 关键字" clearable prefix-icon="Search" style="width: 220px" @keyup.enter="load" />
      <el-button type="primary" @click="load">查询</el-button>
      <span class="grow" />
      <span class="hint">共 {{ list.length }} 张，合计 {{ fmt(total, '0.00') }}</span>
    </div>
    <div class="card" style="padding: 0; overflow: hidden">
    <el-table :data="list" v-loading="loading" stripe size="small" height="calc(100vh - 190px)" @row-dblclick="(r: VoucherListItem) => router.push(`/voucher/${r.id}`)">
      <el-table-column prop="period" label="期间" width="90" />
      <el-table-column prop="date" label="日期" width="110" />
      <el-table-column label="凭证号" width="90"><template #default="{ row }">{{ row.word }}-{{ row.num }}</template></el-table-column>
      <el-table-column prop="summary" label="摘要" min-width="200" show-overflow-tooltip />
      <el-table-column label="金额" width="140" align="right"><template #default="{ row }">{{ fmt(row.total) }}</template></el-table-column>
      <el-table-column prop="line_count" label="分录" width="60" />
      <el-table-column prop="attachments" label="附件" width="60" />
      <el-table-column prop="maker" label="制单" width="90" />
      <el-table-column label="来源" width="90"><template #default="{ row }"><el-tag v-if="row.source === 'closing'" size="small" type="info">结转</el-tag></template></el-table-column>
      <el-table-column label="操作" width="180" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="show(row)">查看</el-button>
          <el-button link type="primary" size="small" @click="router.push(`/voucher/${row.id}`)">编辑</el-button>
          <el-button link type="danger" size="small" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    </div>

    <el-dialog :model-value="!!detail" :title="detail ? `${detail.period} ${detail.word}-${detail.num}  ${detail.date}` : ''" width="760px" @close="detail = null">
      <table v-if="detail" class="report">
        <thead><tr><th>摘要</th><th>科目</th><th>借方</th><th>贷方</th></tr></thead>
        <tbody>
          <tr v-for="l in detail.lines" :key="l.seq">
            <td>{{ l.summary }}</td>
            <td>{{ l.account_code }} {{ accName.get(l.account_code) }}</td>
            <td class="num">{{ fmt(l.debit) }}</td>
            <td class="num">{{ fmt(l.credit) }}</td>
          </tr>
        </tbody>
      </table>
      <template #footer>
        <el-button @click="detail = null">关闭</el-button>
        <el-button type="primary" @click="router.push(`/voucher/${detail!.id}`)">编辑</el-button>
      </template>
    </el-dialog>
  </div>
</template>
