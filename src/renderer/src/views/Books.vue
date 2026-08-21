<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api'
import PageHeader from '../components/PageHeader.vue'
import { bookState } from '../store'
import { curPeriod, toast } from '../utils'
import type { BookInfo } from '@shared/types'

const router = useRouter()
const list = ref<BookInfo[]>([])
const loading = ref(false)
const dlg = ref(false)
const form = ref({ name: '', company: '', start_period: curPeriod() })
const editDlg = ref(false)
const editForm = ref({ name: '', company: '' })

async function load(): Promise<void> {
  loading.value = true
  try {
    list.value = await api.books.list()
  } catch (e) {
    toast(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)

async function create(): Promise<void> {
  try {
    const b = await api.books.create({ ...form.value, start_period: form.value.start_period.slice(0, 7) })
    bookState.current = b
    dlg.value = false
    ElMessage.success('账套已创建并打开')
    router.push('/init')
  } catch (e) {
    toast(e)
  }
}

async function open(b: BookInfo): Promise<void> {
  try {
    bookState.current = await api.books.open(b.id)
    ElMessage.success(`已打开：${b.name}`)
    router.push('/dashboard')
  } catch (e) {
    toast(e)
  }
}

async function remove(b: BookInfo): Promise<void> {
  try {
    await ElMessageBox.confirm(`确定删除账套「${b.name}」？此操作不可恢复，建议先备份。`, '删除账套', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' })
  } catch {
    return
  }
  try {
    await api.books.delete(b.id)
    if (bookState.current?.id === b.id) bookState.current = null
    await load()
  } catch (e) {
    toast(e)
  }
}

async function backup(): Promise<void> {
  try {
    const p = await api.books.backup()
    if (p) ElMessage.success(`已备份到 ${p}`)
  } catch (e) {
    toast(e)
  }
}
async function importBook(): Promise<void> {
  try {
    const b = await api.books.import()
    if (b) {
      bookState.current = b
      ElMessage.success(`已导入并打开：${b.name}`)
      await load()
    }
  } catch (e) {
    toast(e)
  }
}
function openEdit(): void {
  if (!bookState.current) return
  editForm.value = { name: bookState.current.name, company: bookState.current.company }
  editDlg.value = true
}
async function saveEdit(): Promise<void> {
  try {
    await api.books.updateMeta(editForm.value)
    bookState.current = await api.books.current()
    editDlg.value = false
    await load()
  } catch (e) {
    toast(e)
  }
}
</script>

<template>
  <div class="page">
    <PageHeader title="账套管理" desc="一个账套对应一家单位的一套账；每个账套是一个独立文件，备份或换电脑只需复制该文件">
      <el-button link type="primary" icon="FolderOpened" @click="api.books.openDir()">打开存放目录</el-button>
      <el-button icon="Upload" @click="importBook">导入</el-button>
      <el-button icon="Download" :disabled="!bookState.current" @click="backup">备份</el-button>
      <el-button icon="Edit" :disabled="!bookState.current" @click="openEdit">修改信息</el-button>
      <el-button type="primary" icon="Plus" @click="dlg = true">新建账套</el-button>
    </PageHeader>
    <div v-if="bookState.current" class="card" style="margin-bottom: 14px; display: flex; align-items: center; gap: 14px; border-left: 4px solid var(--el-color-primary)">
      <el-icon style="font-size: 22px; color: var(--el-color-primary)"><Notebook /></el-icon>
      <div>
        <div style="font-weight: 600; font-size: 15px">{{ bookState.current.name }}</div>
        <div class="hint">{{ bookState.current.company || '未填单位名称' }} · 启用期间 {{ bookState.current.start_period }} · {{ bookState.current.standard }}</div>
      </div>
      <span style="flex: 1" />
      <el-button type="primary" plain @click="router.push('/dashboard')">进入工作台</el-button>
    </div>
    <div class="card">
    <el-table :data="list" v-loading="loading" stripe>
      <el-table-column prop="name" label="账套名称" min-width="140" />
      <el-table-column prop="company" label="单位名称" min-width="140" />
      <el-table-column prop="start_period" label="启用期间" width="110" />
      <el-table-column prop="standard" label="会计准则" width="130" />
      <el-table-column label="大小" width="80"><template #default="{ row }">{{ (row.size / 1024).toFixed(0) }} KB</template></el-table-column>
      <el-table-column label="最近修改" width="160"><template #default="{ row }">{{ row.mtime ? new Date(row.mtime).toLocaleString('zh-CN') : '' }}</template></el-table-column>
      <el-table-column label="操作" width="170">
        <template #default="{ row }">
          <el-button size="small" type="primary" :disabled="bookState.current?.id === row.id" @click="open(row)">{{ bookState.current?.id === row.id ? '已打开' : '打开' }}</el-button>
          <el-button size="small" type="danger" plain @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
      <template #empty>还没有账套，点击右上角「新建账套」开始</template>
    </el-table>
    </div>

    <el-dialog v-model="dlg" title="新建账套" width="460px">
      <el-form label-width="90px">
        <el-form-item label="账套名称" required><el-input v-model="form.name" placeholder="如：XX公司2026账" /></el-form-item>
        <el-form-item label="单位名称"><el-input v-model="form.company" placeholder="报表抬头显示" /></el-form-item>
        <el-form-item label="启用期间" required>
          <el-date-picker v-model="form.start_period" type="month" value-format="YYYY-MM" format="YYYY-MM" placeholder="选择启用月份" />
        </el-form-item>
        <el-form-item label="会计准则"><el-input model-value="小企业会计准则" disabled /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlg = false">取消</el-button>
        <el-button type="primary" @click="create">创建</el-button>
      </template>
    </el-dialog>
    <el-dialog v-model="editDlg" title="修改账套信息" width="420px">
      <el-form label-width="90px">
        <el-form-item label="账套名称"><el-input v-model="editForm.name" /></el-form-item>
        <el-form-item label="单位名称"><el-input v-model="editForm.company" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDlg = false">取消</el-button>
        <el-button type="primary" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>
