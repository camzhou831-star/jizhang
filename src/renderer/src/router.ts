import { createRouter, createWebHashHistory } from 'vue-router'
import { bookState } from './store'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/dashboard' },
    { path: '/dashboard', component: () => import('./views/Dashboard.vue'), meta: { title: '工作台' } },
    { path: '/books', component: () => import('./views/Books.vue'), meta: { title: '账套管理', noBook: true } },
    { path: '/accounts', component: () => import('./views/Accounts.vue'), meta: { title: '会计科目' } },
    { path: '/init', component: () => import('./views/InitBalance.vue'), meta: { title: '期初余额' } },
    { path: '/voucher/new', component: () => import('./views/VoucherEdit.vue'), meta: { title: '凭证录入' } },
    { path: '/voucher/:id', component: () => import('./views/VoucherEdit.vue'), meta: { title: '凭证编辑' } },
    { path: '/vouchers', component: () => import('./views/VoucherList.vue'), meta: { title: '凭证查询' } },
    { path: '/balance', component: () => import('./views/TrialBalance.vue'), meta: { title: '科目余额表' } },
    { path: '/ledger', component: () => import('./views/Ledger.vue'), meta: { title: '总账 / 明细账' } },
    { path: '/reports', component: () => import('./views/Reports.vue'), meta: { title: '财务报表' } },
    { path: '/closing', component: () => import('./views/Closing.vue'), meta: { title: '期末处理' } }
  ]
})

router.beforeEach((to) => {
  if (!bookState.current && !to.meta.noBook) return '/books'
  return true
})
