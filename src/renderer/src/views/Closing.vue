<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useRouter } from 'vue-router'
import { api } from '../api'
import PageHeader from '../components/PageHeader.vue'
import { toast } from '../utils'
import type { PeriodInfo } from '@shared/types'

const router = useRouter()
const periods = ref<PeriodInfo[]>([])
async function load(): Promise<void> {
  try {
    periods.value = await api.closing.periods()
  } catch (e) {
    toast(e)
  }
}
onMounted(load)

async function carry(p: PeriodInfo): Promise<void> {
  try {
    if (p.has_closing) await ElMessageBox.confirm(`${p.period} 已有结转损益凭证，重新结转将删除旧凭证并重新生成，继续？`, '重新结转', { type: 'warning' })
    const r = await api.closing.carry(p.period, '')
    ElMessage.success(`已生成结转凭证 记-${r.num}（${r.lines} 行）`)
    await load()
    router.push(`/voucher/${r.id}`)
  } catch (e) {
    if (e !== 'cancel') toast(e)
  }
}
async function close(p: PeriodInfo): Promise<void> {
  try {
    await ElMessageBox.confirm(`结账后 ${p.period} 的凭证将不能再修改。确定结账？`, '结账', { type: 'warning' })
    await api.closing.close(p.period)
    ElMessage.success(`${p.period} 已结账`)
    await load()
  } catch (e) {
    if (e !== 'cancel') toast(e)
  }
}
async function reopen(p: PeriodInfo): Promise<void> {
  try {
    await api.closing.reopen(p.period)
    ElMessage.success(`${p.period} 已反结账`)
    await load()
  } catch (e) {
    toast(e)
  }
}
</script>

<template>
  <div class="page">
    <PageHeader title="期末处理" desc="月末流程：① 录完本月凭证 → ② 结转损益（自动生成凭证，把收入、费用转入本年利润）→ ③ 结账（锁定本期）。发现错误可反结账后修改" />
    <div class="card" style="padding: 0; overflow: hidden">
    <el-table :data="periods" stripe>
      <el-table-column prop="period" label="会计期间" width="120" />
      <el-table-column prop="voucher_count" label="凭证数" width="90" />
      <el-table-column label="损益结转" width="110"><template #default="{ row }"><el-tag v-if="row.has_closing" type="success" size="small">已结转</el-tag><span v-else style="color: #aaa">未结转</span></template></el-table-column>
      <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="row.closed ? 'info' : 'primary'" size="small">{{ row.closed ? '已结账' : '未结账' }}</el-tag></template></el-table-column>
      <el-table-column label="操作">
        <template #default="{ row }">
          <el-button size="small" :disabled="!!row.closed" @click="carry(row)">{{ row.has_closing ? '重新结转损益' : '结转损益' }}</el-button>
          <el-button size="small" type="primary" :disabled="!!row.closed" @click="close(row)">结账</el-button>
          <el-button size="small" type="warning" plain :disabled="!row.closed" @click="reopen(row)">反结账</el-button>
        </template>
      </el-table-column>
    </el-table>
    </div>
  </div>
</template>
