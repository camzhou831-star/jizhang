<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import { bookState } from './store'

const route = useRoute()
const groups = [
  { label: '概览', items: [{ path: '/dashboard', label: '工作台', icon: 'Odometer' }] },
  { label: '基础设置', items: [
    { path: '/books', label: '账套管理', icon: 'Files' },
    { path: '/accounts', label: '会计科目', icon: 'Collection' },
    { path: '/init', label: '期初余额', icon: 'Coin' }
  ] },
  { label: '日常业务', items: [
    { path: '/voucher/new', label: '凭证录入', icon: 'EditPen' },
    { path: '/vouchers', label: '凭证查询', icon: 'Search' }
  ] },
  { label: '账簿报表', items: [
    { path: '/balance', label: '科目余额表', icon: 'Grid' },
    { path: '/ledger', label: '总账 / 明细账', icon: 'Notebook' },
    { path: '/reports', label: '财务报表', icon: 'DataAnalysis' }
  ] },
  { label: '期末', items: [{ path: '/closing', label: '期末处理', icon: 'Lock' }] }
]
const active = computed(() => (route.path.startsWith('/voucher/') && route.path !== '/voucher/new' ? '/vouchers' : route.path))
const version = ref('')
onMounted(async () => {
  version.value = await window.api.invoke<string>('app:version').catch(() => '')
})
</script>

<template>
  <el-container style="height: 100%">
    <el-aside width="200px" class="side">
      <div class="brand">
        <div class="logo">简</div>
        <div>
          <div class="name">简账</div>
          <div class="tag">小企业会计准则</div>
        </div>
      </div>
      <div class="book" :title="bookState.current?.name">
        <el-icon><Notebook /></el-icon>
        <span class="ell">{{ bookState.current ? bookState.current.name : '未打开账套' }}</span>
      </div>
      <el-scrollbar style="flex: 1">
        <el-menu :default-active="active" router class="menu" background-color="transparent" text-color="#aab4c3" active-text-color="#ffffff">
          <template v-for="g in groups" :key="g.label">
            <div class="group-label">{{ g.label }}</div>
            <el-menu-item v-for="m in g.items" :key="m.path" :index="m.path" :disabled="!bookState.current && m.path !== '/books'">
              <el-icon><component :is="m.icon" /></el-icon>
              <span>{{ m.label }}</span>
            </el-menu-item>
          </template>
        </el-menu>
      </el-scrollbar>
      <div class="foot">v{{ version }} · 数据仅保存在本机</div>
    </el-aside>
    <el-main style="padding: 0; overflow: auto; background: var(--jz-bg)">
      <router-view :key="route.fullPath" />
    </el-main>
  </el-container>
</template>

<style>
.side { background: var(--jz-sidebar); color: #fff; display: flex; flex-direction: column; border-right: 1px solid #0f1620; }
.brand { display: flex; align-items: center; gap: 10px; padding: 18px 16px 12px; }
.brand .logo { width: 36px; height: 36px; border-radius: 9px; background: linear-gradient(135deg, #2f6fed, #6aa0ff); display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 18px; color: #fff; box-shadow: 0 4px 12px rgba(47,111,237,.35); }
.brand .name { font-size: 17px; font-weight: 700; letter-spacing: 1px; line-height: 1.1; }
.brand .tag { font-size: 11px; color: #8a95a6; margin-top: 3px; }
.book { margin: 4px 12px 10px; padding: 8px 10px; background: var(--jz-sidebar-2); border-radius: 8px; font-size: 12px; color: #d5dbe5; display: flex; align-items: center; gap: 6px; }
.book .ell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.menu { border: none !important; padding: 0 10px; }
.group-label { font-size: 11px; color: #6f7b8e; padding: 12px 12px 4px; letter-spacing: 1px; }
.menu .el-menu-item { height: 38px; line-height: 38px; border-radius: 8px; margin: 2px 0; font-size: 13.5px; }
.menu .el-menu-item:hover { background: rgba(255,255,255,.06) !important; }
.menu .el-menu-item.is-active { background: rgba(47,111,237,.28) !important; color: #fff !important; font-weight: 600; }
.menu .el-menu-item.is-active .el-icon { color: var(--jz-accent); }
.menu .el-menu-item.is-disabled { opacity: .45; }
.foot { padding: 10px 16px 12px; font-size: 11px; color: #6f7b8e; border-top: 1px solid rgba(255,255,255,.06); }
</style>
