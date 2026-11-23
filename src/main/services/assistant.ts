/**
 * AI 助手：用大模型的工具调用（function calling）读账、起草凭证。
 *
 * 调用链：用户提问 → 模型决定调用哪个工具 → 这里执行工具（只读查询 / 凭证草稿校验）
 *        → 结果交回模型 → 模型继续调用或给出回答。
 *
 * 安全边界：模型拿不到任何写库的工具。draft_voucher 只做校验并把草稿暂存在内存，
 * 真正入账要用户在界面上点「确认入账」（confirmDraft）。
 *
 * 接口走 OpenAI 兼容的 /chat/completions，默认 DeepSeek，Base URL / 模型可改。
 */
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { requireDb, currentBookInfo, lastPeriod } from './books'
import { balanceTable, allAccounts } from './ledger'
import { listVouchers, validateVoucher, saveVoucher, periodOf } from './vouchers'
import { balanceSheet, incomeStatement } from './reports'
import type { Account, VoucherLine } from '@shared/types'

// ---------- 配置 ----------

export interface AiConfig {
  baseUrl: string
  model: string
  apiKey: string
}

const DEFAULTS: AiConfig = { baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', apiKey: '' }

function configPath(): string {
  return path.join(app.getPath('userData'), 'ai.json')
}

export function loadConfig(): AiConfig {
  let file: Partial<AiConfig> = {}
  try {
    file = JSON.parse(fs.readFileSync(configPath(), 'utf8'))
  } catch {
    /* 没配置过 */
  }
  return {
    baseUrl: process.env.JIZHANG_AI_BASE_URL || file.baseUrl || DEFAULTS.baseUrl,
    model: process.env.JIZHANG_AI_MODEL || file.model || DEFAULTS.model,
    apiKey: process.env.JIZHANG_AI_KEY || file.apiKey || ''
  }
}

/** 给界面看的配置：不回传密钥本身 */
export function publicConfig(): { baseUrl: string; model: string; hasKey: boolean } {
  const c = loadConfig()
  return { baseUrl: c.baseUrl, model: c.model, hasKey: !!c.apiKey }
}

export function saveConfig(patch: Partial<AiConfig>): void {
  let file: Partial<AiConfig> = {}
  try {
    file = JSON.parse(fs.readFileSync(configPath(), 'utf8'))
  } catch {
    /* 新建 */
  }
  const next = { ...file }
  if (patch.baseUrl !== undefined) next.baseUrl = patch.baseUrl.trim().replace(/\/+$/, '')
  if (patch.model !== undefined) next.model = patch.model.trim()
  if (patch.apiKey) next.apiKey = patch.apiKey.trim() // 空字符串表示不修改
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), { mode: 0o600 })
}

// ---------- 草稿 ----------

export interface DraftLine extends VoucherLine {
  account_name: string
}

export interface Draft {
  id: string
  date: string
  lines: DraftLine[]
  total: number
}

const drafts = new Map<string, Draft>()
let draftSeq = 0

export function confirmDraft(id: string, maker = 'AI 助手'): { id: number; num: number; period: string } {
  const d = drafts.get(id)
  if (!d) throw new Error('草稿不存在或已处理')
  const r = saveVoucher({
    period: periodOf(d.date), date: d.date, word: '记', num: 0, attachments: 0, maker, note: 'AI 助手起草，用户确认入账', source: null,
    lines: d.lines.map(({ account_name: _n, ...l }) => l)
  })
  drafts.delete(id)
  return { ...r, period: periodOf(d.date) }
}

export function discardDraft(id: string): void {
  drafts.delete(id)
}

// ---------- 工具 ----------

type Json = Record<string, unknown>

function resolveAccount(input: string): Account {
  const key = String(input ?? '').trim()
  const list = allAccounts()
  const hit = list.find((a) => a.code === key) ?? list.find((a) => a.name === key) ?? list.find((a) => a.name.includes(key))
  if (!hit) throw new Error(`找不到科目「${key}」，可先用 find_accounts 搜索`)
  return hit
}

function net(debit: number, credit: number, direction: string): { amount: number; side: string } {
  const v = Math.round((debit - credit) * 100) / 100
  if (v === 0) return { amount: 0, side: '平' }
  // 按科目方向给出正数余额，方向相反时标出来
  if (direction === 'debit') return v > 0 ? { amount: v, side: '借' } : { amount: -v, side: '贷' }
  return v < 0 ? { amount: -v, side: '贷' } : { amount: v, side: '借' }
}

export const TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'find_accounts',
      description: '按名称或编码关键字搜索会计科目。起草凭证前必须先用它拿到末级科目编码（is_leaf=1 才能记账）。',
      parameters: { type: 'object', properties: { keyword: { type: 'string', description: '如「银行」「应收」「1002」' } }, required: ['keyword'] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_account_balance',
      description: '查询某个科目在一段期间的期初余额、本期借贷发生额和期末余额。',
      parameters: {
        type: 'object',
        properties: {
          account: { type: 'string', description: '科目编码或名称' },
          from: { type: 'string', description: '起始期间 YYYY-MM，默认最近期间' },
          to: { type: 'string', description: '结束期间 YYYY-MM，默认同 from' }
        },
        required: ['account']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_vouchers',
      description: '按期间和关键字（摘要、科目名、科目编码）查凭证，最多返回 30 条。',
      parameters: {
        type: 'object',
        properties: { from: { type: 'string' }, to: { type: 'string' }, keyword: { type: 'string' } }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_financial_report',
      description: '取利润表或资产负债表。利润表 amount=本年累计、amount2=本月；资产负债表 amount=期末、amount2=年初。',
      parameters: {
        type: 'object',
        properties: { type: { type: 'string', enum: ['income', 'balance_sheet'] }, period: { type: 'string', description: 'YYYY-MM，默认最近期间' } },
        required: ['type']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'draft_voucher',
      description: '起草一张记账凭证并做完整校验（末级科目、借贷平衡、期间未结账）。只生成草稿，不会入账；入账需要用户在界面上确认。校验失败会返回原因，可修改后重试。',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          lines: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                summary: { type: 'string' },
                account_code: { type: 'string', description: '末级科目编码' },
                debit: { type: 'number' },
                credit: { type: 'number' }
              },
              required: ['summary', 'account_code', 'debit', 'credit']
            }
          }
        },
        required: ['date', 'lines']
      }
    }
  }
] as const

export function runTool(name: string, args: Json): unknown {
  const lp = lastPeriod()
  switch (name) {
    case 'find_accounts': {
      const k = String(args.keyword ?? '').trim()
      return allAccounts()
        .filter((a) => a.enabled && (a.code.startsWith(k) || a.name.includes(k)))
        .slice(0, 25)
        .map((a) => ({ code: a.code, name: a.name, is_leaf: a.is_leaf, direction: a.direction === 'debit' ? '借' : '贷' }))
    }
    case 'get_account_balance': {
      const acc = resolveAccount(String(args.account))
      const from = String(args.from || lp)
      const to = String(args.to || from)
      const row = balanceTable(from, to).find((r) => r.code === acc.code)
      if (!row) throw new Error(`科目 ${acc.code} 没有数据`)
      return {
        code: acc.code, name: acc.name, from, to,
        opening: net(row.open_debit, row.open_credit, acc.direction),
        period_debit: row.period_debit,
        period_credit: row.period_credit,
        closing: net(row.close_debit, row.close_credit, acc.direction)
      }
    }
    case 'search_vouchers': {
      const from = String(args.from || lp)
      const to = String(args.to || from)
      return listVouchers({ from, to, keyword: args.keyword ? String(args.keyword) : undefined })
        .slice(0, 30)
        .map((v) => ({ no: `${v.word}-${v.num}`, period: v.period, date: v.date, summary: v.summary, total: v.total }))
    }
    case 'get_financial_report': {
      const period = String(args.period || lp)
      const data = args.type === 'balance_sheet' ? balanceSheet(period) : incomeStatement(period)
      const lines = 'lines' in data ? data.lines : [...data.assets, ...data.liabilities]
      return {
        period,
        type: args.type,
        lines: lines.filter((l) => l.amount || l.amount2).map((l) => ({ name: l.name.trim(), amount: l.amount, amount2: l.amount2 }))
      }
    }
    case 'draft_voucher': {
      const date = String(args.date ?? '')
      const raw = Array.isArray(args.lines) ? (args.lines as Json[]) : []
      const lines = validateVoucher({
        period: periodOf(date), date, word: '记', num: 0, attachments: 0, maker: '', note: '', source: null,
        lines: raw.map((l, i) => ({ seq: i + 1, summary: String(l.summary ?? ''), account_code: String(l.account_code ?? ''), debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 }))
      })
      const db = requireDb()
      if ((db.scalar<number>('SELECT closed FROM period WHERE period=?', [periodOf(date)]) ?? 0) === 1) throw new Error(`${periodOf(date)} 已结账，不能记账`)
      const names = new Map(allAccounts().map((a) => [a.code, a.name]))
      const id = `d${++draftSeq}`
      const draft: Draft = {
        id, date,
        lines: lines.map((l) => ({ ...l, account_name: names.get(l.account_code) ?? '' })),
        total: Math.round(lines.reduce((s, l) => s + l.debit, 0) * 100) / 100
      }
      drafts.set(id, draft)
      return { draft_id: id, status: '草稿已生成，等待用户在界面上确认，尚未入账', total: draft.total }
    }
    default:
      throw new Error(`未知工具 ${name}`)
  }
}

// ---------- 对话循环 ----------

interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

interface Msg {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

export interface Step {
  tool: string
  args: Json
  ok: boolean
  result: string
  ms: number
}

export interface ChatResult {
  reply: string
  steps: Step[]
  drafts: Draft[]
  rounds: number
  usage: { prompt: number; completion: number }
}

export type Completer = (body: Json) => Promise<{
  choices: { message: { content: string | null; tool_calls?: ToolCall[] } }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}>

function httpCompleter(cfg: AiConfig): Completer {
  return async (body) => {
    if (!cfg.apiKey) throw new Error('还没有设置 API Key：点右上角「模型设置」填写')
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 90_000)
    try {
      const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({ model: cfg.model, ...body }),
        signal: ctrl.signal
      })
      const text = await res.text()
      if (!res.ok) throw new Error(`模型接口返回 ${res.status}：${text.slice(0, 300)}`)
      return JSON.parse(text)
    } catch (e: any) {
      if (e?.name === 'AbortError') throw new Error('模型接口 90 秒没有响应')
      throw e
    } finally {
      clearTimeout(timer)
    }
  }
}

function systemPrompt(today: string): string {
  const book = currentBookInfo()
  return [
    '你是「简账」记账软件里的财务助手，按《小企业会计准则》工作，用简体中文简洁回答。',
    `当前账套：${book?.name ?? ''}（${book?.company ?? ''}），最近有凭证的期间：${lastPeriod()}，今天：${today}。`,
    '规则：',
    '1. 所有数字必须来自工具结果，不要估算或编造；查不到就直说。',
    '2. 用户要求记一笔业务时：先用 find_accounts 找到末级科目编码，再调用 draft_voucher 起草。日期没说就用今天。',
    '3. draft_voucher 只是草稿。回复里说明分录，并提醒用户在下方卡片点「确认入账」，不要说已经入账。',
    '4. 校验失败就根据错误修改后重试，最多重试两次。',
    '5. 金额写成「12,345.00 元」的格式。',
    '6. 回复是纯文本：不要用 Markdown（不要 **、#、表格）。起草凭证后界面会单独显示分录卡片，回复里用一两句话说明即可，不要再列分录表。'
  ].join('\n')
}

const MAX_ROUNDS = 8

export async function chat(
  history: { role: 'user' | 'assistant'; content: string }[],
  opts: { complete?: Completer; today?: string } = {}
): Promise<ChatResult> {
  const today = opts.today ?? new Date().toISOString().slice(0, 10)
  const complete = opts.complete ?? httpCompleter(loadConfig())
  const messages: Msg[] = [{ role: 'system', content: systemPrompt(today) }, ...history.slice(-12)]
  const steps: Step[] = []
  const made: Draft[] = []
  const usage = { prompt: 0, completion: 0 }

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const res = await complete({ messages, tools: TOOL_DEFS, tool_choice: 'auto', temperature: 0.2 })
    usage.prompt += res.usage?.prompt_tokens ?? 0
    usage.completion += res.usage?.completion_tokens ?? 0
    const msg = res.choices?.[0]?.message
    if (!msg) throw new Error('模型没有返回内容')
    const calls = msg.tool_calls ?? []
    if (!calls.length) return { reply: msg.content ?? '', steps, drafts: made, rounds: round, usage }

    messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: calls })
    for (const call of calls) {
      const t0 = Date.now()
      let args: Json = {}
      let ok = true
      let out: unknown
      try {
        args = JSON.parse(call.function.arguments || '{}')
        out = runTool(call.function.name, args)
        if (call.function.name === 'draft_voucher') {
          const d = drafts.get((out as { draft_id: string }).draft_id)
          if (d) made.push(d)
        }
      } catch (e: any) {
        ok = false
        out = { error: e?.message ?? String(e) }
      }
      const result = JSON.stringify(out)
      steps.push({ tool: call.function.name, args, ok, result: result.length > 600 ? result.slice(0, 600) + '…' : result, ms: Date.now() - t0 })
      messages.push({ role: 'tool', tool_call_id: call.id, content: result.slice(0, 8000) })
    }
  }
  return { reply: '这个问题需要的步骤太多，我先停在这里。可以把问题拆小一点再问。', steps, drafts: made, rounds: MAX_ROUNDS, usage }
}
