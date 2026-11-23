import { describe, it, expect, beforeAll, vi } from 'vitest'
import path from 'path'
import fs from 'fs'
import os from 'os'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jz-ai-'))
vi.mock('electron', () => ({ app: { getPath: () => tmp } }))

import * as books from '../src/main/services/books'
import * as accounts from '../src/main/services/accounts'
import * as vouchers from '../src/main/services/vouchers'
import * as ai from '../src/main/services/assistant'

const L = (summary: string, account_code: string, debit: number, credit: number) => ({ seq: 0, summary, account_code, debit, credit })

/** 按脚本回放的假模型：每轮返回预设的 tool_calls 或最终文本，并记录收到的消息 */
function scripted(rounds: ({ calls: [string, object][] } | { text: string })[]) {
  const seen: any[] = []
  let i = 0
  const complete: ai.Completer = async (body) => {
    seen.push(JSON.parse(JSON.stringify(body)))
    const r = rounds[i++]
    if ('text' in r) return { choices: [{ message: { content: r.text } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }
    return {
      choices: [{ message: { content: null, tool_calls: r.calls.map(([name, args], k) => ({ id: `c${i}_${k}`, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } })) } }]
    }
  }
  return { complete, seen }
}

describe('AI assistant tool calling', () => {
  beforeAll(async () => {
    await books.createBook({ name: 'AI测试', company: '测试公司', start_period: '2026-10' })
    accounts.saveInitBalances([
      { account_code: '1002', debit: 300000, credit: 0, year_debit: 0, year_credit: 0 },
      { account_code: '3001', debit: 0, credit: 300000, year_debit: 0, year_credit: 0 }
    ])
    vouchers.saveVoucher({ period: '', date: '2026-10-16', word: '记', num: 0, attachments: 0, maker: 't', note: '', source: null,
      lines: [L('支付本月房租', '560207', 8000, 0), L('支付本月房租', '1002', 0, 8000)] })
  })

  it('exposes tool schemas', () => {
    expect(ai.TOOL_DEFS.map((t) => t.function.name)).toEqual(['find_accounts', 'get_account_balance', 'search_vouchers', 'get_financial_report', 'draft_voucher'])
  })

  it('answers a balance question through a tool call', async () => {
    const m = scripted([{ calls: [['get_account_balance', { account: '银行存款', from: '2026-10' }]] }, { text: '期末 292,000.00 元' }])
    const r = await ai.chat([{ role: 'user', content: '10 月银行存款还剩多少' }], { complete: m.complete, today: '2026-10-31' })
    expect(r.reply).toBe('期末 292,000.00 元')
    expect(r.steps).toHaveLength(1)
    expect(r.steps[0].ok).toBe(true)
    // 工具结果原样交回给了模型
    const toolMsg = m.seen[1].messages.find((x: any) => x.role === 'tool')
    const res = JSON.parse(toolMsg.content)
    expect(res.closing).toEqual({ amount: 292000, side: '借' })
    expect(res.period_credit).toBe(8000)
    expect(m.seen[0].tools).toHaveLength(5)
  })

  it('search_vouchers and income report return real data', () => {
    const v = ai.runTool('search_vouchers', { from: '2026-10', keyword: '房租' }) as any[]
    expect(v).toHaveLength(1)
    expect(v[0]).toMatchObject({ no: '记-1', total: 8000 })
    const rep = ai.runTool('get_financial_report', { type: 'income', period: '2026-10' }) as any
    expect(rep.lines.length).toBeGreaterThan(0)
  })

  it('draft is validated, errors go back to the model, nothing is saved until confirmed', async () => {
    const before = vouchers.listVouchers({ from: '2026-10' }).length
    const m = scripted([
      { calls: [['find_accounts', { keyword: '应收' }]] },
      // 第一次故意借贷不平 → 校验失败，错误交回模型
      { calls: [['draft_voucher', { date: '2026-10-31', lines: [{ summary: '收回货款', account_code: '1002', debit: 5000, credit: 0 }, { summary: '收回货款', account_code: '1122', debit: 0, credit: 4000 }] }]] },
      { calls: [['draft_voucher', { date: '2026-10-31', lines: [{ summary: '收回货款', account_code: '1002', debit: 5000, credit: 0 }, { summary: '收回货款', account_code: '1122', debit: 0, credit: 5000 }] }]] },
      { text: '已起草，请确认' }
    ])
    const r = await ai.chat([{ role: 'user', content: '收到客户货款 5000' }], { complete: m.complete, today: '2026-10-31' })
    expect(r.steps.map((s) => s.ok)).toEqual([true, false, true])
    expect(r.steps[1].result).toMatch(/借贷不平衡/)
    expect(r.drafts).toHaveLength(1)
    expect(r.drafts[0].lines[1].account_name).toBe('应收账款')
    expect(vouchers.listVouchers({ from: '2026-10' }).length).toBe(before) // 草稿不入账

    const saved = ai.confirmDraft(r.drafts[0].id)
    expect(saved.num).toBe(2)
    expect(vouchers.listVouchers({ from: '2026-10' }).length).toBe(before + 1)
    expect(() => ai.confirmDraft(r.drafts[0].id)).toThrow(/不存在/) // 不能重复入账
  })

  it('stops after max rounds', async () => {
    const loop = Array.from({ length: 10 }, () => ({ calls: [['find_accounts', { keyword: '1' }]] as [string, object][] }))
    const r = await ai.chat([{ role: 'user', content: 'x' }], { complete: scripted(loop).complete })
    expect(r.rounds).toBe(8)
    expect(r.steps).toHaveLength(8)
  })

  it('config never leaks the key', () => {
    ai.saveConfig({ apiKey: 'sk-test-123', model: 'deepseek-chat' })
    expect(ai.publicConfig()).toEqual({ baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', hasKey: true })
    ai.saveConfig({ apiKey: '' }) // 空 = 不修改
    expect(ai.loadConfig().apiKey).toBe('sk-test-123')
  })
})
