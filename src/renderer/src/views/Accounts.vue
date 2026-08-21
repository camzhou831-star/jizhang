<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api'
import PageHeader from '../components/PageHeader.vue'
import { toast } from '../utils'
import { CATEGORY_NAMES } from '@shared/coa'
import type { Account } from '@shared/types'

const list = ref<Account[]>([])
const keyword = ref('')
const cat = ref('')
const dlg = ref(false)
const form = ref({ code: '', name: '', direction: 'debit' as 'debit' | 'credit' })
const parentHint = ref('')

async function load(): Promise<void> {
  try {
    list.value = await api.accounts.list()
  } catch (e) {
    toast(e)
  }
}
onMounted(load)

const filtered = computed(() =>
  list.value.filter((a) => (!cat.value || a.category === cat.value) && (!keyword.value || a.code.includes(keyword.value) || a.name.includes(keyword.value)))
)

function openAdd(parent?: Account): void {
  if (parent) {
    const children = list.value.filter((a) => a.parent_code === parent.code)
    const lens = [4, 6, 8, 10]
    const nextLen = lens[parent.level] ?? parent.code.length + 2
    const maxChild = children.map((c) => Number(c.code.slice(parent.code.length))).reduce((a, b) => Math.max(a, b), 0)
    form.value = { code: parent.code + String(maxChild + 1).padStart(nextLen - parent.code.length, '0'), name: '', direction: parent.direction }
    parentHint.value = `上级：${parent.code} ${parent.name}`
  } else {
    form.value = { code: '', name: '', direction: 'debit' }
    parentHint.value = '一级科目编码 4 位；明细科目在上级科目行点「增加明细」'
  }
  dlg.value = true
}
async function save(): Promise<void> {
  try {
    await api.accounts.add(form.value)
    dlg.value = false
    ElMessage.success('已新增')
    await load()
  } catch (e) {
    toast(e)
  }
}
async function rename(a: Account): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt('科目名称', `修改 ${a.code}`, { inputValue: a.name, inputValidator: (v) => !!v.trim() || '不能为空' })
    await api.accounts.update(a.code, { name: value })
    await load()
  } catch (e) {
    if (e !== 'cancel') toast(e)
  }
}
async function toggle(a: Account): Promise<void> {
  try {
    await api.accounts.update(a.code, { enabled: a.enabled ? 0 : 1 })
    await load()
  } catch (e) {
    toast(e)
  }
}
async function remove(a: Account): Promise<void> {
  try {
    await ElMessageBox.confirm(`删除科目 ${a.code} ${a.name}？`, '确认', { type: 'warning' })
    await api.accounts.delete(a.code)
    await load()
  } catch (e) {
    if (e !== 'cancel') toast(e)
  }
}
</script>

<template>
  <div class="page">
    <PageHeader title="会计科目" desc="预置《小企业会计准则》附录科目表；凭证只能使用末级科目，明细科目编码规则 4-2-2-2">
      <el-button type="primary" icon="Plus" @click="openAdd()">新增一级科目</el-button>
    </PageHeader>
    <div class="filter-bar">
      <label>类别</label>
      <el-select v-model="cat" placeholder="全部类别" clearable style="width: 130px">
        <el-option v-for="(n, k) in CATEGORY_NAMES" :key="k" :label="n" :value="k" />
      </el-select>
      <el-input v-model="keyword" placeholder="编码 / 名称 搜索" clearable prefix-icon="Search" style="width: 240px" />
      <span class="grow" />
      <span class="hint">共 {{ filtered.length }} 个科目</span>
    </div>
    <div class="card" style="padding: 0; overflow: hidden">
    <el-table :data="filtered" stripe height="calc(100vh - 190px)" row-key="code" size="small">
      <el-table-column prop="code" label="编码" width="110" />
      <el-table-column label="名称" min-width="220">
        <template #default="{ row }">
          <span :style="{ paddingLeft: (row.level - 1) * 18 + 'px' }">{{ row.name }}</span>
          <el-tag v-if="!row.enabled" size="small" type="info" style="margin-left: 6px">停用</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="类别" width="80"><template #default="{ row }">{{ CATEGORY_NAMES[row.category as keyof typeof CATEGORY_NAMES] }}</template></el-table-column>
      <el-table-column label="方向" width="70"><template #default="{ row }">{{ row.direction === 'debit' ? '借' : '贷' }}</template></el-table-column>
      <el-table-column label="级次" width="60" prop="level" />
      <el-table-column label="末级" width="60"><template #default="{ row }">{{ row.is_leaf ? '是' : '' }}</template></el-table-column>
      <el-table-column label="操作" width="260">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openAdd(row)">增加明细</el-button>
          <el-button link type="primary" size="small" @click="rename(row)">改名</el-button>
          <el-button link size="small" @click="toggle(row)">{{ row.enabled ? '停用' : '启用' }}</el-button>
          <el-button link type="danger" size="small" :disabled="row.preset && row.level === 1" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    </div>

    <el-dialog v-model="dlg" title="新增科目" width="420px">
      <p style="color: #888; margin: 0 0 10px; font-size: 12px">{{ parentHint }}</p>
      <el-form label-width="80px">
        <el-form-item label="编码" required><el-input v-model="form.code" /></el-form-item>
        <el-form-item label="名称" required><el-input v-model="form.name" @keyup.enter="save" /></el-form-item>
        <el-form-item label="余额方向">
          <el-radio-group v-model="form.direction">
            <el-radio value="debit">借</el-radio>
            <el-radio value="credit">贷</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlg = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>
