<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api'
import PageHeader from '../components/PageHeader.vue'
import { bookState } from '../store'
import { fmt, round2, todayStr, toChineseMoney, toast } from '../utils'
import type { Account, Voucher, VoucherLine } from '@shared/types'

const route = useRoute()
const router = useRouter()
const accounts = ref<Account[]>([])
const summaries = ref<string[]>([])
const saving = ref(false)
const closedPeriod = ref(false)

function emptyLine(seq: number): VoucherLine {
  return { seq, summary: '', account_code: '', debit: 0, credit: 0 }
}
function blank(): Voucher {
  return { period: '', date: todayStr(), word: '记', num: 0, attachments: 0, maker: localStorage.getItem('maker') ?? '', note: '', source: null, lines: [emptyLine(1), emptyLine(2), emptyLine(3), emptyLine(4)] }
}
const v = ref<Voucher>(blank())
const editing = computed(() => !!v.value.id)
const leafAccounts = computed(() => accounts.value.filter((a) => a.is_leaf && a.enabled))
const accMap = computed(() => new Map(accounts.value.map((a) => [a.code, a])))

function fullName(code: string): string {
  const parts: string[] = []
  let cur = accMap.value.get(code)
  while (cur) {
    parts.unshift(cur.name)
    cur = cur.parent_code ? accMap.value.get(cur.parent_code) : undefined
  }
  return parts.join('_')
}
function accFilter(q: string, a: Account): boolean {
  if (!q) return true
  const s = q.toLowerCase()
  return a.code.startsWith(s) || fullName(a.code).toLowerCase().includes(s)
}
const query = ref('')
const visibleAccounts = computed(() => leafAccounts.value.filter((a) => accFilter(query.value, a)))

const totalD = computed(() => round2(v.value.lines.reduce((s, l) => s + (Number(l.debit) || 0), 0)))
const totalC = computed(() => round2(v.value.lines.reduce((s, l) => s + (Number(l.credit) || 0), 0)))
const balanced = computed(() => Math.abs(totalD.value - totalC.value) < 0.005 && totalD.value > 0)

async function loadMeta(): Promise<void> {
  try {
    ;[accounts.value, summaries.value] = await Promise.all([api.accounts.list(), api.vouchers.summaries()])
  } catch (e) {
    toast(e)
  }
}
async function refreshNum(): Promise<void> {
  if (editing.value) return
  const p = v.value.date.slice(0, 7)
  try {
    v.value.num = await api.vouchers.nextNum(p, v.value.word)
    closedPeriod.value = await api.vouchers.isClosed(p)
  } catch {
    /* ignore */
  }
}
async function load(): Promise<void> {
  const id = Number(route.params.id)
  if (id) {
    try {
      const got = await api.vouchers.get(id)
      if (!got) throw new Error('凭证不存在')
      while (got.lines.length < 4) got.lines.push(emptyLine(got.lines.length + 1))
      v.value = got
      closedPeriod.value = await api.vouchers.isClosed(got.period)
    } catch (e) {
      toast(e)
      router.replace('/vouchers')
    }
  } else {
    v.value = blank()
    await refreshNum()
  }
}
onMounted(async () => {
  await loadMeta()
  await load()
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
watch(() => v.value.date, refreshNum)

function onKey(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    save(false)
  }
}

function fetchSummaries(q: string, cb: (r: { value: string }[]) => void): void {
  cb(summaries.value.filter((s) => !q || s.includes(q)).slice(0, 12).map((s) => ({ value: s })))
}
function addLine(): void {
  v.value.lines.push(emptyLine(v.value.lines.length + 1))
}
function removeLine(i: number): void {
  v.value.lines.splice(i, 1)
  if (v.value.lines.length < 2) addLine()
}
function onSummaryFocus(i: number): void {
  if (!v.value.lines[i].summary && i > 0) v.value.lines[i].summary = v.value.lines[i - 1].summary
}
function onAmountKey(e: KeyboardEvent, i: number, side: 'debit' | 'credit'): void {
  if (e.key === '=' ) {
    e.preventDefault()
    const l = v.value.lines[i]
    const other = side === 'debit' ? totalC.value - (totalD.value - (Number(l.debit) || 0)) : totalD.value - (totalC.value - (Number(l.credit) || 0))
    l[side] = round2(other)
    l[side === 'debit' ? 'credit' : 'debit'] = 0
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    if (i === v.value.lines.length - 1) addLine()
    nextTick(() => focusCell(i + 1, 'summary'))
  }
}
function focusCell(i: number, col: string): void {
  const el = document.querySelector<HTMLInputElement>(`[data-cell="${i}-${col}"] input`)
  el?.focus()
}
function setAmount(l: VoucherLine, side: 'debit' | 'credit', val: string): void {
  // 允许输入过程中的中间态（如 "12."），失焦时 normalize
  ;(l as unknown as Record<string, unknown>)[side] = val
}
function normalize(l: VoucherLine, side: 'debit' | 'credit'): void {
  const n = round2(Number(l[side]) || 0)
  l[side] = n
  if (n) l[side === 'debit' ? 'credit' : 'debit'] = 0
}

async function save(andNew: boolean): Promise<void> {
  if (saving.value) return
  saving.value = true
  try {
    localStorage.setItem('maker', v.value.maker)
    const r = await api.vouchers.save(JSON.parse(JSON.stringify(v.value)))
    ElMessage.success(`已保存：${v.value.date.slice(0, 7)} 记-${r.num}`)
    summaries.value = await api.vouchers.summaries()
    if (andNew || !editing.value) {
      const keepDate = v.value.date
      const keepMaker = v.value.maker
      v.value = blank()
      v.value.date = keepDate
      v.value.maker = keepMaker
      if (route.path !== '/voucher/new') router.replace('/voucher/new')
      else await refreshNum()
      nextTick(() => focusCell(0, 'summary'))
    } else {
      await load()
    }
  } catch (e) {
    toast(e)
  } finally {
    saving.value = false
  }
}
async function remove(): Promise<void> {
  if (!v.value.id) return
  try {
    await ElMessageBox.confirm('确定删除这张凭证？', '删除', { type: 'warning' })
    await api.vouchers.delete(v.value.id)
    ElMessage.success('已删除')
    router.replace('/vouchers')
  } catch (e) {
    if (e !== 'cancel') toast(e)
  }
}
function newBlank(): void {
  if (route.path !== '/voucher/new') router.push('/voucher/new')
  else {
    v.value = blank()
    refreshNum()
  }
}
</script>

<template>
  <div class="page">
    <PageHeader :title="editing ? '凭证编辑' : '凭证录入'" desc="摘要为空时自动带上一行 · 金额栏按 = 自动补平 · 回车跳下一行 · Ctrl+S 保存">
      <el-tag v-if="closedPeriod" type="warning" effect="light">该期间已结账，只读</el-tag>
      <el-tag v-if="v.source === 'closing'" type="info" effect="light">系统自动生成（结转损益）</el-tag>
      <el-button v-if="editing" link @click="router.push('/vouchers')">返回列表</el-button>
      <el-button icon="Printer" @click="api.app.print()">打印</el-button>
      <el-button v-if="editing" type="danger" plain icon="Delete" :disabled="closedPeriod" @click="remove">删除</el-button>
      <el-button icon="Plus" @click="newBlank">新增空白</el-button>
      <el-button icon="DocumentAdd" :disabled="closedPeriod" @click="save(true)">保存并新增</el-button>
      <el-button type="primary" icon="Check" :loading="saving" :disabled="closedPeriod" @click="save(false)">保存</el-button>
    </PageHeader>

    <div class="print-area paper">
      <div class="report-title">记 账 凭 证</div>
      <div class="report-sub" style="align-items: center; gap: 12px">
        <span>单位：{{ bookState.current?.company || bookState.current?.name }}</span>
        <span style="display: inline-flex; align-items: center; gap: 6px">
          日期
          <el-date-picker v-model="v.date" type="date" value-format="YYYY-MM-DD" format="YYYY-MM-DD" :clearable="false" :disabled="closedPeriod" size="small" style="width: 140px" class="no-print" />
          <span class="print-only" style="display: none">{{ v.date }}</span>
        </span>
        <span>字号：{{ v.word }}字第 <b>{{ v.num || '-' }}</b> 号</span>
        <span style="display: inline-flex; align-items: center; gap: 6px">
          附件 <el-input-number v-model="v.attachments" :min="0" :controls="false" size="small" style="width: 60px" :disabled="closedPeriod" /> 张
        </span>
      </div>

      <table class="report voucher-grid" style="table-layout: fixed">
        <colgroup>
          <col style="width: 34px" />
          <col style="width: 26%" />
          <col />
          <col style="width: 150px" />
          <col style="width: 150px" />
          <col style="width: 40px" class="no-print" />
        </colgroup>
        <thead>
          <tr>
            <th>#</th>
            <th>摘要</th>
            <th>会计科目</th>
            <th>借方金额</th>
            <th>贷方金额</th>
            <th class="no-print"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(l, i) in v.lines" :key="i">
            <td style="text-align: center; color: #999">{{ i + 1 }}</td>
            <td :data-cell="`${i}-summary`">
              <el-autocomplete
                v-model="l.summary"
                :fetch-suggestions="fetchSummaries"
                size="small"
                placeholder="摘要"
                :disabled="closedPeriod"
                style="width: 100%"
                @focus="onSummaryFocus(i)"
                @keydown.enter.prevent="focusCell(i, 'account')"
              />
            </td>
            <td :data-cell="`${i}-account`">
              <el-select
                v-model="l.account_code"
                filterable
                remote
                :remote-method="(q: string) => (query = q)"
                reserve-keyword
                size="small"
                placeholder="编码 / 名称检索"
                :disabled="closedPeriod"
                style="width: 100%"
                @visible-change="(vis: boolean) => !vis && (query = '')"
                @change="() => nextTick(() => focusCell(i, 'debit'))"
              >
                <el-option v-for="a in visibleAccounts" :key="a.code" :value="a.code" :label="`${a.code} ${fullName(a.code)}`">
                  <span style="font-family: monospace; margin-right: 8px; color: #666">{{ a.code }}</span>{{ fullName(a.code) }}
                </el-option>
              </el-select>
            </td>
            <td :data-cell="`${i}-debit`">
              <el-input :model-value="l.debit || ''" size="small" class="money" :disabled="closedPeriod" @update:model-value="(val: string) => setAmount(l, 'debit', val)" @keydown="(e: KeyboardEvent) => onAmountKey(e, i, 'debit')" @blur="normalize(l, 'debit')" />
            </td>
            <td :data-cell="`${i}-credit`">
              <el-input :model-value="l.credit || ''" size="small" class="money" :disabled="closedPeriod" @update:model-value="(val: string) => setAmount(l, 'credit', val)" @keydown="(e: KeyboardEvent) => onAmountKey(e, i, 'credit')" @blur="normalize(l, 'credit')" />
            </td>
            <td class="no-print" style="text-align: center">
              <el-button link type="danger" size="small" icon="Close" :disabled="closedPeriod" @click="removeLine(i)" />
            </td>
          </tr>
          <tr class="bold">
            <td colspan="3">合计：{{ toChineseMoney(totalD) }}</td>
            <td class="num">{{ fmt(totalD) }}</td>
            <td class="num">{{ fmt(totalC) }}</td>
            <td class="no-print" style="text-align: center"><el-button link type="primary" size="small" icon="Plus" :disabled="closedPeriod" @click="addLine" /></td>
          </tr>
        </tbody>
      </table>
      <div class="report-sub" style="margin-top: 8px; align-items: center">
        <span style="display: inline-flex; align-items: center; gap: 6px">制单：<el-input v-model="v.maker" size="small" style="width: 100px" :disabled="closedPeriod" /></span>
        <span style="display: inline-flex; align-items: center; gap: 6px">备注：<el-input v-model="v.note" size="small" style="width: 300px" :disabled="closedPeriod" /></span>
        <el-tag :type="balanced ? 'success' : 'danger'" size="small" class="no-print">{{ balanced ? '借贷平衡' : totalD || totalC ? '借贷不平衡，差额 ' + fmt(round2(totalD - totalC)) : '请录入分录' }}</el-tag>
      </div>
    </div>
  </div>
</template>

<style>
.voucher-grid td { padding: 2px 4px; }
.voucher-grid .el-input__inner { text-align: left; }
.voucher-grid .money .el-input__inner { text-align: right; font-variant-numeric: tabular-nums; }
@media print {
  .print-only { display: inline !important; }
}
</style>
