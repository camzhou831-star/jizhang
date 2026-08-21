import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import * as Icons from '@element-plus/icons-vue'
import App from './App.vue'
import { router } from './router'
import './style.css'
import { bookState } from './store'
import { api } from './api'

// 先取当前账套，避免路由守卫在状态加载前误跳回账套页
bookState.current = await api.books.init().catch(() => null)

const app = createApp(App)
for (const [k, c] of Object.entries(Icons)) app.component(k, c)
app.use(ElementPlus, { locale: zhCn, size: 'default' })
app.use(router)
app.mount('#app')
