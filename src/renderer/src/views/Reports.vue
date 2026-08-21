<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api } from '../api'
import PageHeader from '../components/PageHeader.vue'
import { bookState } from '../store'
import { curPeriod, fmt, toast, exportXlsx } from '../utils'
import type { BalanceSheetData, CashFlowData, IncomeStatementData, ReportLine } from '@shared/types'

const tab = ref<'bs' | 'is' | 'cf'>('bs')
const period = ref(curPeriod())
const bs = ref<BalanceSheetData | null>(null)
const is = ref<IncomeStatementData | null>(null)
const cf = ref<CashFlowData | null>(null)
const loading = ref(false)

async function load(): Promise<void> {
  loading.value = true
  try {
    ;[bs.value, is.value, cf.value] = await Promise.all([api.reports.balanceSheet(period.value), api.reports.income(period.value), api.reports.cashFlow(period.value)])
  } catch (e) {
    toast(e)
  } finally {
    loading.value = false
  }
}
onMounted(async () => {
  period.value = await api.books.lastPeriod().catch(() => curPeriod())
  load()
})
const company = (): string => bookState.current?.company || bookState.current?.name || ''
const lineRows = (ls: ReportLine[]): (string | number | null)[][] => ls.map((l) => [l.name, l.lineNo ?? '', l.amount, l.amount2])

function exportIt(): void {
  if (tab.value === 'bs' && bs.value) {
    const a = bs.value.assets
    const l = bs.value.liabilities
    const n = Math.max(a.length, l.length)
    const rows: (string | number | null)[][] = [['资产负债表'], [`单位：${company()}`, '', '', `${period.value} 期末`, '', '', '', '单位：元'], ['资产', '行次', '期末余额', '年初余额', '负债和所有者权益', '行次', '期末余额', '年初余额']]
    for (let i = 0; i < n; i++) {
      const x = a[i]
      const y = l[i]
      rows.push([x?.name ?? '', x?.lineNo ?? '', x?.amount ?? null, x?.amount2 ?? null, y?.name ?? '', y?.lineNo ?? '', y?.amount ?? null, y?.amount2 ?? null])
    }
    exportXlsx(`资产负债表-${period.value}.xlsx`, '资产负债表', rows)
  } else if (tab.value === 'is' && is.value) {
    exportXlsx(`利润表-${period.value}.xlsx`, '利润表', [['利润表'], [`单位：${company()}`, '', `${period.value}`, '单位：元'], ['项目', '行次', '本年累计金额', '本月金额'], ...lineRows(is.value.lines)])
  } else if (tab.value === 'cf' && cf.value) {
    exportXlsx(`现金流量表-${period.value}.xlsx`, '现金流量表', [['现金流量表'], [`单位：${company()}`, '', `${period.value}`, '单位：元'], ['项目', '行次', '本年累计金额', '本月金额'], ...lineRows(cf.value.lines)])
  }
}
const pad = (l: ReportLine): string => '　'.repeat(l.indent ?? 0) + l.name
</script>

<template>
  <div class="page">
    <PageHeader title="财务报表" desc="按《小企业会计准则》报表格式自动生成；资产负债表取期末与年初余额，利润表 / 现金流量表取本月与本年累计">
      <el-tag v-if="tab === 'bs' && bs" :type="bs.balanced ? 'success' : 'danger'" effect="light">{{ bs.balanced ? '资产 = 负债 + 所有者权益' : `不平衡，差额 ${fmt(bs.diff)}` }}</el-tag>
      <el-button icon="Download" @click="exportIt">导出 Excel</el-button>
      <el-button icon="Printer" @click="api.app.print()">打印</el-button>
    </PageHeader>
    <div class="filter-bar no-print">
      <el-radio-group v-model="tab">
        <el-radio-button value="bs">资产负债表</el-radio-button>
        <el-radio-button value="is">利润表</el-radio-button>
        <el-radio-button value="cf">现金流量表</el-radio-button>
      </el-radio-group>
      <label>期间</label>
      <el-date-picker v-model="period" type="month" value-format="YYYY-MM" format="YYYY-MM" :clearable="false" style="width: 130px" @change="load" />
      <el-button type="primary" icon="Refresh" @click="load">生成</el-button>
    </div>

    <div v-loading="loading" class="print-area paper">
      <!-- 资产负债表 -->
      <template v-if="tab === 'bs' && bs">
        <div class="report-title">资 产 负 债 表</div>
        <div class="report-sub"><span>会小企01表</span><span>编制单位：{{ company() }}</span><span>{{ period }} 期末</span><span>单位：元</span></div>
        <table class="report">
          <thead>
            <tr><th style="width: 26%">资产</th><th>行次</th><th>期末余额</th><th>年初余额</th><th style="width: 26%">负债和所有者权益（或股东权益）</th><th>行次</th><th>期末余额</th><th>年初余额</th></tr>
          </thead>
          <tbody>
            <tr v-for="i in Math.max(bs.assets.length, bs.liabilities.length)" :key="i">
              <td :style="{ fontWeight: bs.assets[i - 1]?.bold ? 600 : 400 }">{{ bs.assets[i - 1] ? pad(bs.assets[i - 1]) : '' }}</td>
              <td class="no">{{ bs.assets[i - 1]?.lineNo }}</td>
              <td class="num">{{ fmt(bs.assets[i - 1]?.amount) }}</td>
              <td class="num">{{ fmt(bs.assets[i - 1]?.amount2) }}</td>
              <td :style="{ fontWeight: bs.liabilities[i - 1]?.bold ? 600 : 400 }">{{ bs.liabilities[i - 1] ? pad(bs.liabilities[i - 1]) : '' }}</td>
              <td class="no">{{ bs.liabilities[i - 1]?.lineNo }}</td>
              <td class="num">{{ fmt(bs.liabilities[i - 1]?.amount) }}</td>
              <td class="num">{{ fmt(bs.liabilities[i - 1]?.amount2) }}</td>
            </tr>
          </tbody>
        </table>
      </template>

      <!-- 利润表 -->
      <template v-if="tab === 'is' && is">
        <div class="report-title">利 润 表</div>
        <div class="report-sub"><span>会小企02表</span><span>编制单位：{{ company() }}</span><span>{{ period }}</span><span>单位：元</span></div>
        <table class="report">
          <thead><tr><th>项目</th><th style="width: 60px">行次</th><th style="width: 160px">本年累计金额</th><th style="width: 160px">本月金额</th></tr></thead>
          <tbody>
            <tr v-for="(l, i) in is.lines" :key="i" :class="{ bold: l.bold }">
              <td>{{ pad(l) }}</td><td class="no">{{ l.lineNo }}</td><td class="num">{{ fmt(l.amount) }}</td><td class="num">{{ fmt(l.amount2) }}</td>
            </tr>
          </tbody>
        </table>
      </template>

      <!-- 现金流量表 -->
      <template v-if="tab === 'cf' && cf">
        <div class="report-title">现 金 流 量 表</div>
        <div class="report-sub"><span>会小企03表</span><span>编制单位：{{ company() }}</span><span>{{ period }}</span><span>单位：元</span></div>
        <table class="report">
          <thead><tr><th>项目</th><th style="width: 60px">行次</th><th style="width: 160px">本年累计金额</th><th style="width: 160px">本月金额</th></tr></thead>
          <tbody>
            <tr v-for="(l, i) in cf.lines" :key="i" :class="{ bold: l.bold }">
              <td>{{ pad(l) }}</td><td class="no">{{ l.lineNo }}</td><td class="num">{{ fmt(l.amount) }}</td><td class="num">{{ fmt(l.amount2) }}</td>
            </tr>
          </tbody>
        </table>
        <p class="no-print" style="color: #888; font-size: 12px; margin-top: 8px">现金流量按凭证中货币资金科目的对方科目自动归类（T 型账户法），供参考；最后一行为账面货币资金期末余额，用于与“期末现金余额”核对。</p>
      </template>
    </div>
  </div>
</template>
