<script setup lang="ts">
import { ref, reactive, onMounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { api, type AiDraft, type AiStep } from '../api'
import PageHeader from '../components/PageHeader.vue'
import { fmt, toast } from '../utils'

interface Turn {
  role: 'user' | 'assistant'
  content: string
  steps?: AiStep[]
  drafts?: (AiDraft & { state?: 'pending' | 'saved' | 'discarded'; savedNo?: string; savedId?: number })[]
  meta?: string
  error?: boolean
}

const router = useRouter()
const turns = ref<Turn[]>([])
const input = ref('')
const busy = ref(false)
const box = ref<HTMLElement>()
const cfg = reactive({ baseUrl: '', model: '', hasKey: false })
const showCfg = ref(false)
const form = reactive({ baseUrl: '', model: '', apiKey: '' })

const examples = [
  '10 月银行存款期末余额是多少？',
  '10 月净利润多少？哪项费用最高？',
  '今天收到客户前欠货款 5000 元，已存入银行，帮我记一笔',
  '查一下 10 月所有跟房租有关的凭证'
]

const TOOL_LABEL: Record<string, string> = {
  find_accounts: '搜索科目',
  get_account_balance: '查科目余额',
  search_vouchers: '查凭证',
  get_financial_report: '取财务报表',
  draft_voucher: '起草凭证'
}

onMounted(loadCfg)
async function loadCfg(): Promise<void> {
  Object.assign(cfg, await api.ai.config().catch(() => cfg))
  if (!cfg.hasKey) openCfg()
}
function openCfg(): void {
  Object.assign(form, { baseUrl: cfg.baseUrl, model: cfg.model, apiKey: '' })
  showCfg.value = true
}
async function saveCfg(): Promise<void> {
  try {
    await api.ai.saveConfig({ ...form })
    await loadCfg()
    showCfg.value = false
    ElMessage.success('已保存')
  } catch (e) {
    toast(e)
  }
}

async function scroll(): Promise<void> {
  await nextTick()
  box.value?.scrollTo({ top: box.value.scrollHeight, behavior: 'smooth' })
}

async function send(text?: string): Promise<void> {
  const q = (text ?? input.value).trim()
  if (!q || busy.value) return
  input.value = ''
  turns.value.push({ role: 'user', content: q })
  busy.value = true
  scroll()
  const history = turns.value.filter((t) => !t.error).map((t) => ({ role: t.role, content: t.content }))
  const t0 = Date.now()
  try {
    const r = await api.ai.chat(history)
    turns.value.push({
      role: 'assistant',
      content: r.reply,
      steps: r.steps,
      drafts: r.drafts.map((d) => ({ ...d, state: 'pending' })),
      meta: `${r.rounds} 轮模型调用 · ${r.steps.length} 次工具调用 · ${((Date.now() - t0) / 1000).toFixed(1)} 秒 · ${r.usage.prompt + r.usage.completion} tokens`
    })
  } catch (e: any) {
    turns.value.push({ role: 'assistant', content: e?.message ?? String(e), error: true })
  } finally {
    busy.value = false
    scroll()
  }
}

async function confirm(d: NonNullable<Turn['drafts']>[number]): Promise<void> {
  try {
    const r = await api.ai.confirm(d.id)
    d.state = 'saved'
    d.savedNo = `${r.period} 记-${r.num}`
    d.savedId = r.id
    ElMessage.success(`已入账：${d.savedNo}`)
  } catch (e) {
    toast(e)
  }
}
async function discard(d: NonNullable<Turn['drafts']>[number]): Promise<void> {
  await api.ai.discard(d.id).catch(() => undefined)
  d.state = 'discarded'
}
function argText(a: Record<string, unknown>): string {
  return JSON.stringify(a)
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    send()
  }
}
</script>

<template>
  <div class="page ai-page">
    <PageHeader title="AI 助手" desc="用自然语言查账、起草凭证。助手只能读账和起草，入账要你点确认。">
      <span class="model-tag">{{ cfg.model || '未配置模型' }}</span>
      <el-button size="small" @click="openCfg"><el-icon><Setting /></el-icon>模型设置</el-button>
    </PageHeader>

    <div ref="box" class="chat card">
      <div v-if="!turns.length" class="empty">
        <div class="empty-title">可以这样问</div>
        <div class="examples">
          <button v-for="e in examples" :key="e" class="ex" :disabled="busy" @click="send(e)">{{ e }}</button>
        </div>
      </div>

      <div v-for="(t, i) in turns" :key="i" class="turn" :class="t.role">
        <div class="bubble" :class="{ error: t.error }">{{ t.content }}</div>

        <details v-if="t.steps?.length" class="chain">
          <summary>调用链 · {{ t.steps.length }} 步</summary>
          <ol>
            <li v-for="(s, j) in t.steps" :key="j" :class="{ bad: !s.ok }">
              <div class="step-head">
                <span class="tool">{{ TOOL_LABEL[s.tool] ?? s.tool }}</span>
                <code>{{ s.tool }}({{ argText(s.args) }})</code>
                <span class="ms">{{ s.ms }} ms</span>
              </div>
              <pre>{{ s.result }}</pre>
            </li>
          </ol>
        </details>

        <div v-for="d in t.drafts" :key="d.id" class="draft" :class="d.state">
          <div class="draft-head">
            <b>凭证草稿</b><span>{{ d.date }}</span>
            <span v-if="d.state === 'saved'" class="ok">已入账 {{ d.savedNo }}</span>
            <span v-else-if="d.state === 'discarded'" class="muted">已放弃</span>
            <span v-else class="pending">待确认</span>
          </div>
          <table>
            <thead><tr><th>摘要</th><th>科目</th><th class="num">借方</th><th class="num">贷方</th></tr></thead>
            <tbody>
              <tr v-for="l in d.lines" :key="l.seq">
                <td>{{ l.summary }}</td>
                <td>{{ l.account_code }} {{ l.account_name }}</td>
                <td class="num">{{ fmt(l.debit) }}</td>
                <td class="num">{{ fmt(l.credit) }}</td>
              </tr>
            </tbody>
            <tfoot><tr><td colspan="2">合计</td><td class="num">{{ fmt(d.total) }}</td><td class="num">{{ fmt(d.total) }}</td></tr></tfoot>
          </table>
          <div v-if="d.state === 'pending'" class="draft-actions">
            <el-button size="small" @click="discard(d)">放弃</el-button>
            <el-button size="small" type="primary" @click="confirm(d)">确认入账</el-button>
          </div>
          <div v-else-if="d.state === 'saved'" class="draft-actions">
            <el-button size="small" link type="primary" @click="router.push('/voucher/' + d.savedId)">打开凭证</el-button>
          </div>
        </div>

        <div v-if="t.meta" class="meta">{{ t.meta }}</div>
      </div>

      <div v-if="busy" class="turn assistant"><div class="bubble thinking">正在查账…</div></div>
    </div>

    <div class="composer card">
      <el-input v-model="input" type="textarea" :autosize="{ minRows: 2, maxRows: 5 }" resize="none"
        placeholder="问点什么，比如「10 月管理费用花在哪了」，或者「今天付了 3000 元广告费，记一笔」。Enter 发送，Shift+Enter 换行"
        :disabled="busy" @keydown="onKey" />
      <el-button type="primary" :loading="busy" :disabled="!input.trim()" @click="send()">发送</el-button>
    </div>

    <el-dialog v-model="showCfg" title="模型设置" width="480px">
      <el-form label-width="84px" size="default">
        <el-form-item label="Base URL"><el-input v-model="form.baseUrl" placeholder="https://api.deepseek.com" /></el-form-item>
        <el-form-item label="模型"><el-input v-model="form.model" placeholder="deepseek-chat" /></el-form-item>
        <el-form-item label="API Key">
          <el-input v-model="form.apiKey" type="password" show-password :placeholder="cfg.hasKey ? '已设置，留空表示不修改' : '填写你的 API Key'" />
        </el-form-item>
      </el-form>
      <div class="cfg-note">支持任何 OpenAI 兼容接口（DeepSeek、通义、OpenAI 等）。密钥只保存在本机。</div>
      <template #footer>
        <el-button @click="showCfg = false">取消</el-button>
        <el-button type="primary" @click="saveCfg">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.ai-page { display: flex; flex-direction: column; height: 100vh; box-sizing: border-box; padding-bottom: 20px; }
.model-tag { font-size: 12px; color: var(--el-text-color-secondary); margin-right: 8px; }
.chat { flex: 1; min-height: 0; overflow-y: auto; padding: 20px 24px; margin-bottom: 12px; }
.empty { padding: 40px 0; text-align: center; }
.empty-title { color: var(--el-text-color-secondary); margin-bottom: 14px; }
.examples { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; max-width: 640px; margin: 0 auto; }
.ex { border: 1px solid var(--el-border-color); background: #fff; border-radius: 16px; padding: 7px 14px; font-size: 13px; cursor: pointer; color: var(--el-text-color-regular); }
.ex:hover { border-color: var(--el-color-primary); color: var(--el-color-primary); }
.turn { margin-bottom: 18px; display: flex; flex-direction: column; }
.turn.user { align-items: flex-end; }
.bubble { max-width: 78%; padding: 10px 14px; border-radius: 10px; line-height: 1.7; white-space: pre-wrap; font-size: 14px; }
.user .bubble { background: var(--el-color-primary); color: #fff; }
.assistant .bubble { background: #f4f6fa; color: var(--el-text-color-primary); }
.bubble.error { background: #fef0f0; color: var(--el-color-danger); }
.bubble.thinking { color: var(--el-text-color-secondary); }
.chain { margin-top: 8px; max-width: 78%; font-size: 12.5px; }
.chain summary { cursor: pointer; color: var(--el-color-primary); user-select: none; }
.chain ol { margin: 8px 0 0; padding-left: 20px; }
.chain li { margin-bottom: 8px; }
.chain li.bad .tool { background: #fef0f0; color: var(--el-color-danger); }
.step-head { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.tool { background: #ecf5ff; color: var(--el-color-primary); border-radius: 4px; padding: 0 6px; font-weight: 600; }
.step-head code { color: #555; word-break: break-all; }
.ms { color: var(--el-text-color-placeholder); }
.chain pre { margin: 4px 0 0; background: #fafafa; border: 1px solid #eee; border-radius: 6px; padding: 6px 8px; white-space: pre-wrap; word-break: break-all; color: #666; max-height: 140px; overflow: auto; }
.draft { margin-top: 10px; max-width: 78%; width: 560px; border: 1px solid var(--el-color-primary-light-5); border-radius: 10px; padding: 12px 14px; background: #fff; }
.draft.saved { border-color: var(--el-color-success-light-5); }
.draft.discarded { opacity: .55; }
.draft-head { display: flex; gap: 10px; align-items: center; margin-bottom: 8px; font-size: 13px; }
.draft-head .pending { color: var(--el-color-warning); margin-left: auto; }
.draft-head .ok { color: var(--el-color-success); margin-left: auto; }
.draft-head .muted { color: var(--el-text-color-secondary); margin-left: auto; }
.draft table { width: 100%; border-collapse: collapse; font-size: 13px; }
.draft th, .draft td { border-bottom: 1px solid #eef0f3; padding: 5px 6px; text-align: left; }
.draft th { color: var(--el-text-color-secondary); font-weight: 500; }
.draft tfoot td { font-weight: 600; border-bottom: none; }
.num { text-align: right !important; font-variant-numeric: tabular-nums; }
.draft-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
.meta { font-size: 11.5px; color: var(--el-text-color-placeholder); margin-top: 6px; }
.composer { margin-top: 0 !important; display: flex; gap: 10px; align-items: flex-end; padding: 12px; }
.composer .el-button { height: 52px; }
.cfg-note { font-size: 12px; color: var(--el-text-color-secondary); padding-left: 84px; }
</style>
