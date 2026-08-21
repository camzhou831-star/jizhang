import { requireDb, } from './books'
import { round2 } from '../db'
import type { Account, BalanceRow, LedgerRow } from '@shared/types'

export interface DC {
  debit: number
  credit: number
}

export function allAccounts(): Account[] {
  return requireDb().all<Account>('SELECT * FROM account ORDER BY code')
}

export function prevPeriod(p: string): string {
  const [y, m] = p.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

export function nextPeriod(p: string): string {
  const [y, m] = p.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

/** 末级科目在期间 asOf 期初的净余额（借正贷负）= 期初余额 + asOf 之前所有发生 */
export function leafOpeningNet(asOf: string): Map<string, number> {
  const db = requireDb()
  const m = new Map<string, number>()
  for (const r of db.all<{ account_code: string; debit: number; credit: number }>('SELECT account_code,debit,credit FROM init_balance')) {
    m.set(r.account_code, round2((m.get(r.account_code) ?? 0) + r.debit - r.credit))
  }
  const rows = db.all<{ account_code: string; d: number; c: number }>(
    `SELECT l.account_code, COALESCE(SUM(l.debit),0) d, COALESCE(SUM(l.credit),0) c
     FROM voucher_line l JOIN voucher v ON v.id=l.voucher_id WHERE v.period < ? GROUP BY l.account_code`,
    [asOf]
  )
  for (const r of rows) m.set(r.account_code, round2((m.get(r.account_code) ?? 0) + r.d - r.c))
  return m
}

/** 末级科目在 [from,to] 的发生额 */
export function leafOccurrence(from: string, to: string, opts: { excludeClosing?: boolean } = {}): Map<string, DC> {
  const db = requireDb()
  const m = new Map<string, DC>()
  const rows = db.all<{ account_code: string; d: number; c: number }>(
    `SELECT l.account_code, COALESCE(SUM(l.debit),0) d, COALESCE(SUM(l.credit),0) c
     FROM voucher_line l JOIN voucher v ON v.id=l.voucher_id
     WHERE v.period >= ? AND v.period <= ? ${opts.excludeClosing ? "AND (v.source IS NULL OR v.source <> 'closing')" : ''}
     GROUP BY l.account_code`,
    [from, to]
  )
  for (const r of rows) m.set(r.account_code, { debit: round2(r.d), credit: round2(r.c) })
  return m
}

/** 年初至今的累计发生（含账套年中启用时录入的本年累计） */
export function leafYearOccurrence(period: string, opts: { excludeClosing?: boolean } = {}): Map<string, DC> {
  const db = requireDb()
  const year = period.slice(0, 4)
  const m = leafOccurrence(`${year}-01`, period, opts)
  const start = db.getMeta('start_period')
  if (start.slice(0, 4) === year) {
    for (const r of db.all<{ account_code: string; year_debit: number; year_credit: number }>('SELECT account_code,year_debit,year_credit FROM init_balance')) {
      const cur = m.get(r.account_code) ?? { debit: 0, credit: 0 }
      m.set(r.account_code, { debit: round2(cur.debit + r.year_debit), credit: round2(cur.credit + r.year_credit) })
    }
  }
  return m
}

/** 按编码前缀把末级值向上汇总到每个科目 */
export function rollupNet(accounts: Account[], leaf: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>()
  const entries = [...leaf.entries()]
  for (const a of accounts) {
    let s = 0
    for (const [code, v] of entries) if (code.startsWith(a.code)) s += v
    out.set(a.code, round2(s))
  }
  return out
}

export function rollupDC(accounts: Account[], leaf: Map<string, DC>): Map<string, DC> {
  const out = new Map<string, DC>()
  const entries = [...leaf.entries()]
  for (const a of accounts) {
    let d = 0
    let c = 0
    for (const [code, v] of entries)
      if (code.startsWith(a.code)) {
        d += v.debit
        c += v.credit
      }
    out.set(a.code, { debit: round2(d), credit: round2(c) })
  }
  return out
}

/** 科目余额表 */
export function balanceTable(from: string, to: string, opts: { maxLevel?: number; hideZero?: boolean } = {}): BalanceRow[] {
  const accounts = allAccounts()
  const open = rollupNet(accounts, leafOpeningNet(from))
  const occ = rollupDC(accounts, leafOccurrence(from, to))
  const rows: BalanceRow[] = []
  for (const a of accounts) {
    if (opts.maxLevel && a.level > opts.maxLevel) continue
    const o = open.get(a.code) ?? 0
    const p = occ.get(a.code) ?? { debit: 0, credit: 0 }
    const e = round2(o + p.debit - p.credit)
    if (opts.hideZero && !o && !p.debit && !p.credit && !e) continue
    rows.push({
      code: a.code,
      name: a.name,
      level: a.level,
      category: a.category,
      direction: a.direction,
      open_debit: o > 0 ? o : 0,
      open_credit: o < 0 ? -o : 0,
      period_debit: p.debit,
      period_credit: p.credit,
      close_debit: e > 0 ? e : 0,
      close_credit: e < 0 ? -e : 0
    })
  }
  return rows
}

function dirOf(net: number): '借' | '贷' | '平' {
  return net > 0 ? '借' : net < 0 ? '贷' : '平'
}

/** 总账：按月汇总 */
export function generalLedger(code: string, from: string, to: string): LedgerRow[] {
  const db = requireDb()
  const acc = db.get<Account>('SELECT * FROM account WHERE code=?', [code])
  if (!acc) throw new Error('科目不存在')
  const accounts = [acc]
  let bal = rollupNet(accounts, leafOpeningNet(from)).get(code) ?? 0
  const rows: LedgerRow[] = []
  rows.push({ period: from, date: '', voucher_id: null, voucher_no: '', summary: '期初余额', debit: 0, credit: 0, direction: dirOf(bal), balance: Math.abs(bal) })
  let p = from
  let yd = 0
  let yc = 0
  while (p <= to) {
    const occ = rollupDC(accounts, leafOccurrence(p, p)).get(code) ?? { debit: 0, credit: 0 }
    bal = round2(bal + occ.debit - occ.credit)
    yd = round2(yd + occ.debit)
    yc = round2(yc + occ.credit)
    rows.push({ period: p, date: '', voucher_id: null, voucher_no: '', summary: '本期合计', debit: occ.debit, credit: occ.credit, direction: dirOf(bal), balance: Math.abs(bal) })
    rows.push({ period: p, date: '', voucher_id: null, voucher_no: '', summary: '本年累计', debit: yd, credit: yc, direction: dirOf(bal), balance: Math.abs(bal) })
    if (p.endsWith('-12')) {
      yd = 0
      yc = 0
    }
    p = nextPeriod(p)
  }
  return rows
}

/** 明细账：逐笔 */
export function subsidiaryLedger(code: string, from: string, to: string): LedgerRow[] {
  const db = requireDb()
  const acc = db.get<Account>('SELECT * FROM account WHERE code=?', [code])
  if (!acc) throw new Error('科目不存在')
  let bal = rollupNet([acc], leafOpeningNet(from)).get(code) ?? 0
  const rows: LedgerRow[] = []
  rows.push({ period: from, date: '', voucher_id: null, voucher_no: '', summary: '期初余额', debit: 0, credit: 0, direction: dirOf(bal), balance: Math.abs(bal) })
  const lines = db.all<{ period: string; date: string; voucher_id: number; word: string; num: number; summary: string; debit: number; credit: number }>(
    `SELECT v.period, v.date, v.id voucher_id, v.word, v.num, l.summary, l.debit, l.credit
     FROM voucher_line l JOIN voucher v ON v.id=l.voucher_id
     WHERE l.account_code LIKE ? AND v.period>=? AND v.period<=?
     ORDER BY v.period, v.date, v.word, v.num, l.seq`,
    [code + '%', from, to]
  )
  let cur = ''
  let pd = 0
  let pc = 0
  let yd = 0
  let yc = 0
  const flush = (): void => {
    if (!cur) return
    rows.push({ period: cur, date: '', voucher_id: null, voucher_no: '', summary: '本期合计', debit: pd, credit: pc, direction: dirOf(bal), balance: Math.abs(bal) })
    rows.push({ period: cur, date: '', voucher_id: null, voucher_no: '', summary: '本年累计', debit: yd, credit: yc, direction: dirOf(bal), balance: Math.abs(bal) })
  }
  for (const l of lines) {
    if (l.period !== cur) {
      flush()
      if (cur && cur.slice(0, 4) !== l.period.slice(0, 4)) {
        yd = 0
        yc = 0
      }
      cur = l.period
      pd = 0
      pc = 0
    }
    bal = round2(bal + l.debit - l.credit)
    pd = round2(pd + l.debit)
    pc = round2(pc + l.credit)
    yd = round2(yd + l.debit)
    yc = round2(yc + l.credit)
    rows.push({ period: l.period, date: l.date, voucher_id: l.voucher_id, voucher_no: `${l.word}-${l.num}`, summary: l.summary, debit: l.debit, credit: l.credit, direction: dirOf(bal), balance: Math.abs(bal) })
  }
  flush()
  return rows
}
