import { requireDb } from './books'
import { round2 } from '../db'
import { allAccounts, leafOpeningNet, nextPeriod, rollupNet } from './ledger'
import { nextVoucherNum, isPeriodClosed } from './vouchers'
import type { PeriodInfo } from '@shared/types'

function lastDay(period: string): string {
  const [y, m] = period.split('-').map(Number)
  const d = new Date(y, m, 0).getDate()
  return `${period}-${String(d).padStart(2, '0')}`
}

export function listPeriods(): PeriodInfo[] {
  const db = requireDb()
  const start = db.getMeta('start_period')
  const now = new Date()
  let last = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const maxV = db.scalar<string>('SELECT MAX(period) FROM voucher')
  if (maxV && maxV > last) last = maxV
  const out: PeriodInfo[] = []
  let p = start
  let guard = 0
  while (p <= last && guard++ < 600) {
    const closed = db.scalar<number>('SELECT closed FROM period WHERE period=?', [p]) ?? 0
    const cnt = db.scalar<number>('SELECT COUNT(*) FROM voucher WHERE period=?', [p]) ?? 0
    const hasClosing = (db.scalar<number>(`SELECT COUNT(*) FROM voucher WHERE period=? AND source='closing'`, [p]) ?? 0) > 0
    out.push({ period: p, closed, voucher_count: cnt, has_closing: hasClosing })
    p = nextPeriod(p)
  }
  return out
}

/** 结转损益：把本期末损益类科目余额转入 3103 本年利润 */
export function carryForwardPL(period: string, maker = ''): { id: number; num: number; lines: number } {
  const db = requireDb()
  if (isPeriodClosed(period)) throw new Error('该期间已结账')
  const accounts = allAccounts()
  // 先删除已有的本期结转凭证（重新结转）
  const olds = db.all<{ id: number }>(`SELECT id FROM voucher WHERE period=? AND source='closing'`, [period])
  db.transaction(() => {
    for (const o of olds) {
      db.run('DELETE FROM voucher_line WHERE voucher_id=?', [o.id])
      db.run('DELETE FROM voucher WHERE id=?', [o.id])
    }
  })
  const net = rollupNet(accounts, leafOpeningNet(nextPeriod(period)))
  const lines: { summary: string; account_code: string; debit: number; credit: number }[] = []
  let total = 0
  for (const a of accounts) {
    if (a.category !== 'pl' || !a.is_leaf) continue
    const v = net.get(a.code) ?? 0
    if (!v) continue
    // 借方余额 → 贷方结转；贷方余额 → 借方结转
    lines.push({ summary: '结转损益', account_code: a.code, debit: v < 0 ? -v : 0, credit: v > 0 ? v : 0 })
    total += v
  }
  if (!lines.length) throw new Error('本期损益类科目余额均为零，无需结转')
  total = round2(total)
  // 损益净额（借正）转入本年利润：收入>费用 → 贷记 3103
  lines.push({ summary: '结转损益', account_code: '3103', debit: total > 0 ? total : 0, credit: total < 0 ? -total : 0 })
  // 把 3103 放在凭证首行更符合习惯：利润为正时 借：各收入 贷：各费用 贷：本年利润
  const ordered = [...lines.filter((l) => l.debit > 0), ...lines.filter((l) => l.credit > 0)]
  const num = nextVoucherNum(period)
  let id = 0
  db.transaction(() => {
    db.run('INSERT INTO voucher(period,date,word,num,attachments,maker,note,source) VALUES(?,?,?,?,?,?,?,?)', [
      period, lastDay(period), '记', num, 0, maker, '系统自动结转损益', 'closing'
    ])
    id = db.lastId()
    ordered.forEach((l, i) => {
      db.run('INSERT INTO voucher_line(voucher_id,seq,summary,account_code,debit,credit) VALUES(?,?,?,?,?,?)', [id, i + 1, l.summary, l.account_code, l.debit, l.credit])
    })
    db.run('INSERT OR IGNORE INTO period(period,closed) VALUES(?,0)', [period])
  })
  db.save()
  return { id, num, lines: ordered.length }
}

export function closePeriod(period: string): void {
  const db = requireDb()
  const periods = listPeriods()
  const idx = periods.findIndex((p) => p.period === period)
  if (idx < 0) throw new Error('期间不存在')
  if (periods[idx].closed) throw new Error('该期间已结账')
  if (idx > 0 && !periods[idx - 1].closed) throw new Error(`请先结账 ${periods[idx - 1].period}`)
  const accounts = allAccounts()
  const net = rollupNet(accounts, leafOpeningNet(nextPeriod(period)))
  const unclosed = accounts.filter((a) => a.category === 'pl' && a.level === 1 && (net.get(a.code) ?? 0) !== 0)
  if (unclosed.length) throw new Error(`损益类科目尚有余额（${unclosed.map((a) => a.name).join('、')}），请先结转损益`)
  db.run(`INSERT INTO period(period,closed,closed_at) VALUES(?,1,datetime('now','localtime')) ON CONFLICT(period) DO UPDATE SET closed=1, closed_at=datetime('now','localtime')`, [period])
  db.save()
}

export function reopenPeriod(period: string): void {
  const db = requireDb()
  const periods = listPeriods()
  const idx = periods.findIndex((p) => p.period === period)
  if (idx < 0) throw new Error('期间不存在')
  if (!periods[idx].closed) throw new Error('该期间未结账')
  if (idx < periods.length - 1 && periods[idx + 1].closed) throw new Error(`请先反结账 ${periods[idx + 1].period}`)
  db.run('UPDATE period SET closed=0, closed_at=NULL WHERE period=?', [period])
  db.save()
}
