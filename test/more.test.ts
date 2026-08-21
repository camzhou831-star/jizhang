import { describe, it, expect, beforeAll, vi } from 'vitest'
import path from 'path'
import fs from 'fs'
import os from 'os'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jz2-'))
vi.mock('electron', () => ({ app: { getPath: () => tmp } }))

import * as books from '../src/main/services/books'
import * as accounts from '../src/main/services/accounts'
import * as vouchers from '../src/main/services/vouchers'
import * as ledger from '../src/main/services/ledger'
import * as reports from '../src/main/services/reports'
import * as closing from '../src/main/services/closing'

const L = (summary: string, account_code: string, debit: number, credit: number) => ({ seq: 0, summary, account_code, debit, credit })
const V = (date: string, lines: ReturnType<typeof L>[]) => ({ period: '', date, word: '记', num: 0, attachments: 0, maker: 't', note: '', source: null, lines })

describe('mid-year book, editing, reclassification, books', () => {
  let bookId = ''
  beforeAll(async () => {
    const b = await books.createBook({ name: '年中账套', company: 'C', start_period: '2026-06' })
    bookId = b.id
  })

  it('init balance rejects non-leaf & parent with balance cannot get children', () => {
    expect(() => accounts.saveInitBalances([{ account_code: '2221', debit: 0, credit: 1, year_debit: 0, year_credit: 0 }])).toThrow(/末级/)
    accounts.saveInitBalances([
      { account_code: '1002', debit: 50000, credit: 0, year_debit: 0, year_credit: 0 },
      { account_code: '1122', debit: 0, credit: 2000, year_debit: 0, year_credit: 0 }, // 应收账款贷方余额 → 应在预收账款列示
      { account_code: '3001', debit: 0, credit: 48000, year_debit: 0, year_credit: 0 },
      { account_code: '5001', debit: 0, credit: 0, year_debit: 0, year_credit: 120000 }, // 1-5 月累计收入
      { account_code: '560208', debit: 0, credit: 0, year_debit: 70000, year_credit: 0 }
    ])
    expect(accounts.initTrial().balanced).toBe(true)
    expect(() => accounts.addAccount({ code: '100201', name: 'x' })).toThrow(/已有期初余额/)
  })

  it('balance sheet reclassifies credit AR into advances and balances at start', () => {
    const bs = reports.balanceSheet('2026-06')
    const a = (n: string) => bs.assets.find((l) => l.name === n)!.amount
    const l = (n: string) => bs.liabilities.find((l) => l.name === n)!.amount
    expect(a('应收账款')).toBe(0)
    expect(l('预收账款')).toBe(2000)
    expect(bs.balanced).toBe(true)
    // 年中启用：年初余额应为空（=启用期初），与期末一致
    expect(bs.assets.find((l) => l.name === '货币资金')!.amount2).toBe(50000)
  })

  it('income statement year-to-date includes pre-start accumulations', () => {
    vouchers.saveVoucher(V('2026-06-10', [L('6月收入', '1002', 10000, 0), L('6月收入', '5001', 0, 10000)]))
    const is = reports.incomeStatement('2026-06')
    const g = (n: string) => is.lines.find((l) => l.name.includes(n))!
    expect(g('营业收入').amount).toBe(130000) // 120000 + 10000
    expect(g('营业收入').amount2).toBe(10000)
    expect(g('管理费用').amount).toBe(70000)
    expect(g('净利润').amount).toBe(60000)
  })

  it('edit / delete / renumber vouchers', () => {
    const a = vouchers.saveVoucher(V('2026-06-11', [L('a', '1001', 100, 0), L('a', '1002', 0, 100)]))
    const b = vouchers.saveVoucher(V('2026-06-12', [L('b', '1001', 200, 0), L('b', '1002', 0, 200)]))
    expect([a.num, b.num]).toEqual([2, 3])
    // 编辑 a：金额改为 150，期间不变 → 编号不变
    const va = vouchers.getVoucher(a.id)!
    va.lines = [L('a2', '1001', 150, 0), L('a2', '1002', 0, 150)]
    const r = vouchers.saveVoucher(va)
    expect(r.num).toBe(2)
    expect(vouchers.getVoucher(a.id)!.lines[0].debit).toBe(150)
    // 编辑 a：改到 7 月 → 在 7 月重新编号为 1
    va.date = '2026-07-01'
    expect(vouchers.saveVoucher(va).num).toBe(1)
    // 删除 b 后 6 月只剩 1 号（收入凭证），整理断号不变
    vouchers.deleteVoucher(b.id)
    expect(vouchers.listVouchers({ period: '2026-06' }).length).toBe(1)
    const c = vouchers.saveVoucher(V('2026-06-20', [L('c', '1001', 1, 0), L('c', '1002', 0, 1)]))
    expect(c.num).toBe(2) // MAX+1
    const d = vouchers.saveVoucher(V('2026-06-21', [L('d', '1001', 1, 0), L('d', '1002', 0, 1)]))
    expect(d.num).toBe(3)
    vouchers.deleteVoucher(c.id)
    expect(vouchers.renumber('2026-06')).toBe(2)
    expect(vouchers.getVoucher(d.id)!.num).toBe(2)
    // 关键字查询
    expect(vouchers.listVouchers({ from: '2026-06', to: '2026-07', keyword: '库存现金' }).length).toBe(2)
  })

  it('subsidiary ledger running balance & general ledger', () => {
    const rows = ledger.subsidiaryLedger('1002', '2026-06', '2026-07')
    expect(rows[0].summary).toBe('期初余额')
    expect(rows[0].balance).toBe(50000)
    const last = rows[rows.length - 1]
    expect(last.summary).toBe('本年累计')
    expect(last.balance).toBe(50000 + 10000 - 1 - 150)
    const gl = ledger.generalLedger('1002', '2026-06', '2026-07')
    expect(gl.filter((r) => r.summary === '本期合计').length).toBe(2)
  })

  it('close → reopen → edit allowed again; cannot delete used account', () => {
    closing.carryForwardPL('2026-06')
    closing.closePeriod('2026-06')
    expect(() => vouchers.saveVoucher(V('2026-06-15', [L('x', '1001', 1, 0), L('x', '1002', 0, 1)]))).toThrow(/已结账/)
    expect(() => closing.reopenPeriod('2026-05')).toThrow()
    closing.reopenPeriod('2026-06')
    expect(vouchers.saveVoucher(V('2026-06-15', [L('x', '1001', 1, 0), L('x', '1002', 0, 1)])).num).toBe(4)
    // 重新结转会替换旧结转凭证
    const before = vouchers.listVouchers({ period: '2026-06' }).filter((v) => v.source === 'closing').length
    closing.carryForwardPL('2026-06')
    const after = vouchers.listVouchers({ period: '2026-06' }).filter((v) => v.source === 'closing').length
    expect(before).toBe(1)
    expect(after).toBe(1)
    expect(() => accounts.deleteAccount('1001')).toThrow(/预置一级/)
    expect(() => accounts.addAccount({ code: '100101', name: '备用金' })).toThrow(/已有期初余额或凭证/)
    accounts.addAccount({ code: '101201', name: '支付宝' })
    expect(() => accounts.deleteAccount('1012')).toThrow()
    expect(accounts.listAccounts().find((a) => a.code === '1012')!.is_leaf).toBe(0)
    accounts.deleteAccount('101201')
    expect(accounts.listAccounts().find((a) => a.code === '1012')!.is_leaf).toBe(1)
    // 被凭证使用的科目不能删除（用 5001 下新建明细并使用）
    expect(() => accounts.addAccount({ code: '500101', name: '商品销售' })).toThrow(/已有期初余额或凭证/)
  })

  it('books: list / backup / import / init last', async () => {
    const list = await books.listBooks()
    expect(list.find((b) => b.id === bookId)?.name).toBe('年中账套')
    const target = path.join(tmp, 'bak.db')
    books.backupBook(target)
    expect(fs.existsSync(target)).toBe(true)
    const imported = await books.importBook(target)
    expect(imported.name).toBe('年中账套')
    expect(imported.id).not.toBe(bookId)
    expect(vouchers.listVouchers({ period: '2026-06' }).length).toBeGreaterThan(0)
    books.closeBook()
    const again = await books.initBook()
    expect(again?.id).toBe(imported.id)
    books.deleteBook(imported.id)
    expect((await books.listBooks()).find((b) => b.id === imported.id)).toBeUndefined()
  })
})
