<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api'
import { bookState } from '../store'
import { fmt, toast } from '../utils'
import PageHeader from '../components/PageHeader.vue'
import type { PeriodInfo, VoucherListItem } from '@shared/types'

const router = useRouter()
const period = ref('')
const cash = ref(0)
const assets = ref(0)
const revenueYear = ref(0)
const profitYear = ref(0)
const profitMonth = ref(0)
const periods = ref<PeriodInfo[]>([])
const recent = ref<VoucherListItem[]>([])
const balanced = ref(true)

onMounted(async () => {
  try {
    period.value = await api.books.lastPeriod()
    const [bs, is, ps, vs] = await Promise.all([api.reports.balanceSheet(period.value), api.reports.income(period.value), api.closing.periods(), api.vouchers.list({ period: period.value })])
    cash.value = bs.assets.find((l) => l.name === '货币资金')?.amount ?? 0
    assets.value = bs.assets.find((l) => l.name === '资产总计')?.amount ?? 0
    balanced.value = bs.balanced
    revenueYear.value = is.lines.find((l) => l.name.includes('营业收入'))?.amount ?? 0
    profitYear.value = is.lines.find((l) => l.name.includes('净利润'))?.amount ?? 0
    profitMonth.value = is.lines.find((l) => l.name.includes('净利润'))?.amount2 ?? 0
    periods.value = ps
    recent.value = vs.slice(0, 8)
  } catch (e) {
    toast(e)
  }
})
const cur = computed(() => periods.value.find((p) => p.period === period.value))
const openCount = computed(() => periods.value.filter((p) => !p.closed && p.voucher_count > 0).length)
const quick = [
  { path: '/voucher/new', icon: 'EditPen', color: '#2f6fed', title: '录凭证', desc: '记一笔业务' },
  { path: '/reports', icon: 'DataAnalysis', color: '#10b981', title: '看报表', desc: '资产负债表 / 利润表 / 现金流量表' },
  { path: '/balance', icon: 'Grid', color: '#f59e0b', title: '科目余额表', desc: '核对各科目余额' },
  { path: '/closing', icon: 'Lock', color: '#8b5cf6', title: '月末结账', desc: '结转损益并锁定期间' }
]
</script>

<template>
  <div class="page">
    <PageHeader :title="`你好，${bookState.current?.company || bookState.current?.name || ''}`" :desc="`当前账套：${bookState.current?.name}（启用 ${bookState.current?.start_period}）· 数据截止 ${period}`">
      <el-tag :type="balanced ? 'success' : 'danger'" effect="light">{{ balanced ? '账务平衡' : '资产负债表不平衡' }}</el-tag>
    </PageHeader>

    <div class="tiles">
      <div class="tile"><div class="label">货币资金（{{ period }} 期末）</div><div class="value">{{ fmt(cash, '0.00') }}</div><div class="sub">资产总计 {{ fmt(assets, '0.00') }}</div><div class="ico" style="background:#eaf0fd;color:#2f6fed"><el-icon><Wallet /></el-icon></div></div>
      <div class="tile"><div class="label">本年营业收入</div><div class="value">{{ fmt(revenueYear, '0.00') }}</div><div class="sub">截至 {{ period }}</div><div class="ico" style="background:#e7f8f1;color:#10b981"><el-icon><TrendCharts /></el-icon></div></div>
      <div class="tile"><div class="label">本年净利润</div><div class="value" :style="{ color: profitYear < 0 ? '#dc2626' : undefined }">{{ fmt(profitYear, '0.00') }}</div><div class="sub">本月 {{ fmt(profitMonth, '0.00') }}</div><div class="ico" style="background:#fff4e0;color:#f59e0b"><el-icon><Coin /></el-icon></div></div>
      <div class="tile"><div class="label">{{ period }} 凭证</div><div class="value">{{ cur?.voucher_count ?? 0 }} <span style="font-size:13px;font-weight:400;color:#6b7280">张</span></div><div class="sub">{{ cur?.closed ? '本期已结账' : cur?.has_closing ? '已结转损益，未结账' : '未结转损益' }} · 未结账期间 {{ openCount }} 个</div><div class="ico" style="background:#f1ecfe;color:#8b5cf6"><el-icon><Document /></el-icon></div></div>
    </div>

    <div class="card" style="margin-bottom: 14px">
      <div style="font-weight: 600; margin-bottom: 12px">快捷操作</div>
      <div class="quick">
        <a v-for="q in quick" :key="q.path" href="javascript:void 0" @click="router.push(q.path)">
          <div class="qi" :style="{ background: q.color }"><el-icon><component :is="q.icon" /></el-icon></div>
          <div><b>{{ q.title }}</b><span>{{ q.desc }}</span></div>
        </a>
      </div>
    </div>

    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="font-weight: 600">{{ period }} 最近凭证</div>
        <el-button link type="primary" @click="router.push('/vouchers')">查看全部</el-button>
      </div>
      <el-table :data="recent" size="small" @row-dblclick="(r: VoucherListItem) => router.push(`/voucher/${r.id}`)">
        <el-table-column prop="date" label="日期" width="110" />
        <el-table-column label="凭证号" width="90"><template #default="{ row }">{{ row.word }}-{{ row.num }}</template></el-table-column>
        <el-table-column prop="summary" label="摘要" min-width="240" show-overflow-tooltip />
        <el-table-column label="金额" align="right" width="150"><template #default="{ row }">{{ fmt(row.total) }}</template></el-table-column>
        <el-table-column prop="maker" label="制单" width="100" />
        <template #empty>本期还没有凭证，去「凭证录入」记第一笔</template>
      </el-table>
    </div>
  </div>
</template>
