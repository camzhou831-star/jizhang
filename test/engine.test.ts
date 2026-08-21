import { describe, it, expect, beforeAll, vi } from 'vitest'
import path from 'path'
import fs from 'fs'
import os from 'os'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jz-'))
vi.mock('electron', () => ({ app: { getPath: () => tmp } }))

import * as books from '../src/main/services/books'
import * as accounts from '../src/main/services/accounts'
import * as vouchers from '../src/main/services/vouchers'
import * as ledger from '../src/main/services/ledger'
import * as reports from '../src/main/services/reports'
import * as closing from '../src/main/services/closing'

const L = (summary: string, account_code: string, debit: number, credit: number) => ({ seq: 0, summary, account_code, debit, credit })
const V = (date: string, lines: ReturnType<typeof L>[]) => ({ period: '', date, word: '记', num: 0, attachments: 0, maker: 't', note: '', source: null, lines })

describe('accounting engine', () => {
  beforeAll(async () => {
    await books.createBook({ name: '测试账套', company: '测试公司', start_period: '2026-01' })
  })

  it('seeds preset accounts', () => {
    const list = accounts.listAccounts()
    expect(list.find((a) => a.code === '1002')?.name).toBe('银行存款')
    expect(list.find((a) => a.code === '2221')?.is_leaf).toBe(0)
    expect(list.find((a) => a.code === '222101')?.is_leaf).toBe(0)
    expect(list.find((a) => a.code === '22210101')?.is_leaf).toBe(1)
  })

  it('adds detail account and blocks parent usage', () => {
    const a = accounts.addAccount({ code: '100201', name: '工行基本户' })
    expect(a.level).toBe(2)
    expect(accounts.listAccounts().find((x) => x.code === '1002')?.is_leaf).toBe(0)
    expect(() => vouchers.saveVoucher(V('2026-01-05', [L('x', '1002', 1, 0), L('x', '1001', 0, 1)]))).toThrow(/末级/)
  })

  it('init balances & trial', () => {
    const r = accounts.saveInitBalances([
      { account_code: '100201', debit: 100000, credit: 0, year_debit: 0, year_credit: 0 },
      { account_code: '3001', debit: 0, credit: 100000, year_debit: 0, year_credit: 0 }
    ])
    expect(r.balanced).toBe(true)
  })

  it('rejects unbalanced voucher, accepts balanced', () => {
    expect(() => vouchers.saveVoucher(V('2026-01-10', [L('a', '100201', 100, 0), L('a', '5001', 0, 90)]))).toThrow(/不平衡/)
    // 销售收入 含税 11300：借 银行 11300 贷 主营业务收入 10000 贷 销项税 1300
    const r1 = vouchers.saveVoucher(V('2026-01-10', [L('销售商品', '100201', 11300, 0), L('销售商品', '5001', 0, 10000), L('销售商品', '22210102', 0, 1300)]))
    expect(r1.num).toBe(1)
    // 付房租 3000 管理费用
    const r2 = vouchers.saveVoucher(V('2026-01-15', [L('付房租', '560207', 3000, 0), L('付房租', '100201', 0, 3000)]))
    expect(r2.num).toBe(2)
    // 计提工资 4000
    vouchers.saveVoucher(V('2026-01-31', [L('计提工资', '560203', 4000, 0), L('计提工资', '221101', 0, 4000)]))
    // 2 月：发工资、买固定资产、赊购
    vouchers.saveVoucher(V('2026-02-05', [L('发工资', '221101', 4000, 0), L('发工资', '100201', 0, 4000)]))
    vouchers.saveVoucher(V('2026-02-08', [L('买电脑', '1601', 6000, 0), L('买电脑', '100201', 0, 6000)]))
    vouchers.saveVoucher(V('2026-02-20', [L('赊购材料', '1403', 2000, 0), L('赊购材料', '2202', 0, 2000)]))
  })

  it('balance table rolls up and balances', () => {
    const rows = ledger.balanceTable('2026-01', '2026-01', {})
    const bank = rows.find((r) => r.code === '1002')!
    expect(bank.open_debit).toBe(100000)
    expect(bank.period_debit).toBe(11300)
    expect(bank.period_credit).toBe(3000)
    expect(bank.close_debit).toBe(108300)
    const tax = rows.find((r) => r.code === '2221')!
    expect(tax.close_credit).toBe(1300)
    const l1 = rows.filter((r) => r.level === 1)
    const sd = l1.reduce((s, r) => s + r.close_debit, 0)
    const sc = l1.reduce((s, r) => s + r.close_credit, 0)
    expect(Math.abs(sd - sc)).toBeLessThan(0.005)
  })

  it('income statement', () => {
    const is = reports.incomeStatement('2026-01')
    const g = (n: string) => is.lines.find((l) => l.name.includes(n))!
    expect(g('营业收入').amount).toBe(10000)
    expect(g('管理费用').amount).toBe(7000)
    expect(g('净利润').amount).toBe(3000)
    const feb = reports.incomeStatement('2026-02')
    expect(feb.lines.find((l) => l.name.includes('净利润'))!.amount).toBe(3000) // 本年累计
    expect(feb.lines.find((l) => l.name.includes('净利润'))!.amount2).toBe(0) // 本月
  })

  it('balance sheet balances before and after closing', () => {
    let bs = reports.balanceSheet('2026-01')
    expect(bs.balanced).toBe(true)
    const get = (arr: typeof bs.assets, n: string) => arr.find((l) => l.name === n)!.amount
    expect(get(bs.assets, '货币资金')).toBe(108300)
    expect(get(bs.liabilities, '未分配利润')).toBe(3000)
    expect(get(bs.liabilities, '应付职工薪酬')).toBe(4000)
    expect(get(bs.liabilities, '应交税费')).toBe(1300)
    expect(get(bs.assets, '资产总计')).toBe(108300)

    const r = closing.carryForwardPL('2026-01')
    expect(r.lines).toBe(4) // 5001, 560207, 560203 → 3103
    bs = reports.balanceSheet("2026-01")
    expect(bs.balanced).toBe(true)
    expect(get(bs.liabilities, "未分配利润")).toBe(3000)
    expect(ledger.balanceTable("2026-01","2026-01",{}).find((r) => r.code === "5001")!.close_credit).toBe(0)
    expect(() => closing.closePeriod("2026-02")).toThrow(/先结账/)
    closing.closePeriod("2026-01")
    expect(() => vouchers.saveVoucher(V("2026-01-20", [L("x", "100201", 1, 0), L("x", "5001", 0, 1)]))).toThrow(/已结账/)
    const cf = reports.cashFlowStatement("2026-02")
    const c = (n: string) => cf.lines.find((l) => l.name === n)!
    expect(c("销售产成品、商品、提供劳务收到的现金").amount).toBe(11300)
    expect(c("支付的职工薪酬").amount).toBe(4000)
    expect(c("购建固定资产、无形资产和其他非流动资产支付的现金").amount).toBe(6000)
    expect(c("五、期末现金余额").amount).toBe(98300)
    expect(c("（账面期末货币资金，用于核对）").amount).toBe(98300)
  })
})
