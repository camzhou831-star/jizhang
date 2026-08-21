import { requireDb } from './books'
import { round2 } from '../db'
import type { Account, Voucher, VoucherLine, VoucherListItem } from '@shared/types'

export function periodOf(date: string): string {
  return date.slice(0, 7)
}

export function isPeriodClosed(period: string): boolean {
  const db = requireDb()
  return (db.scalar<number>('SELECT closed FROM period WHERE period=?', [period]) ?? 0) === 1
}

export function nextVoucherNum(period: string, word = '记'): number {
  const db = requireDb()
  return (db.scalar<number>('SELECT COALESCE(MAX(num),0)+1 FROM voucher WHERE period=? AND word=?', [period, word]) ?? 1)
}

function validate(v: Voucher): VoucherLine[] {
  const db = requireDb()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) throw new Error('日期格式错误')
  const start = db.getMeta('start_period')
  if (periodOf(v.date) < start) throw new Error(`日期不能早于账套启用期间 ${start}`)
  const lines = v.lines
    .map((l, i) => ({
      ...l,
      seq: i + 1,
      summary: (l.summary ?? '').trim(),
      account_code: (l.account_code ?? '').trim(),
      debit: round2(Number(l.debit) || 0),
      credit: round2(Number(l.credit) || 0)
    }))
    .filter((l) => l.account_code || l.debit || l.credit || l.summary)
  if (lines.length < 2) throw new Error('凭证至少需要两条分录')
  let d = 0
  let c = 0
  for (const l of lines) {
    if (!l.account_code) throw new Error(`第 ${l.seq} 行未选择科目`)
    const acc = db.get<Account>('SELECT * FROM account WHERE code=?', [l.account_code])
    if (!acc) throw new Error(`第 ${l.seq} 行科目 ${l.account_code} 不存在`)
    if (!acc.is_leaf) throw new Error(`第 ${l.seq} 行科目 ${acc.code} ${acc.name} 不是末级科目`)
    if (!acc.enabled) throw new Error(`第 ${l.seq} 行科目 ${acc.code} ${acc.name} 已停用`)
    if (l.debit && l.credit) throw new Error(`第 ${l.seq} 行借方和贷方不能同时有金额`)
    if (!l.debit && !l.credit) throw new Error(`第 ${l.seq} 行金额不能为空`)
    if (!l.summary) throw new Error(`第 ${l.seq} 行摘要不能为空`)
    d += l.debit
    c += l.credit
  }
  if (Math.abs(round2(d) - round2(c)) > 0.004) throw new Error(`借贷不平衡：借方 ${round2(d)}，贷方 ${round2(c)}`)
  return lines
}

export function saveVoucher(v: Voucher): { id: number; num: number } {
  const db = requireDb()
  const lines = validate(v)
  const period = periodOf(v.date)
  if (isPeriodClosed(period)) throw new Error(`${period} 期间已结账，不能新增或修改凭证`)
  const word = v.word || '记'
  let id = v.id ?? 0
  let num = v.num
  db.transaction(() => {
    if (id) {
      const old = db.get<Voucher>('SELECT * FROM voucher WHERE id=?', [id])
      if (!old) throw new Error('凭证不存在')
      if (isPeriodClosed(old.period)) throw new Error(`${old.period} 期间已结账，不能修改凭证`)
      if (old.period !== period || old.word !== word) num = nextVoucherNum(period, word)
      else num = old.num
      db.run(
        `UPDATE voucher SET period=?,date=?,word=?,num=?,attachments=?,maker=?,note=?,updated_at=datetime('now','localtime') WHERE id=?`,
        [period, v.date, word, num, v.attachments || 0, v.maker || '', v.note || '', id]
      )
      db.run('DELETE FROM voucher_line WHERE voucher_id=?', [id])
    } else {
      num = nextVoucherNum(period, word)
      db.run('INSERT INTO voucher(period,date,word,num,attachments,maker,note,source) VALUES(?,?,?,?,?,?,?,?)', [
        period, v.date, word, num, v.attachments || 0, v.maker || '', v.note || '', v.source ?? null
      ])
      id = db.lastId()
    }
    for (const l of lines) {
      db.run('INSERT INTO voucher_line(voucher_id,seq,summary,account_code,debit,credit) VALUES(?,?,?,?,?,?)', [
        id, l.seq, l.summary, l.account_code, l.debit, l.credit
      ])
    }
    db.run('INSERT OR IGNORE INTO period(period,closed) VALUES(?,0)', [period])
  })
  db.save()
  return { id, num }
}

export function getVoucher(id: number): Voucher | null {
  const db = requireDb()
  const v = db.get<Voucher>('SELECT * FROM voucher WHERE id=?', [id])
  if (!v) return null
  v.lines = db.all<VoucherLine>('SELECT id,seq,summary,account_code,debit,credit FROM voucher_line WHERE voucher_id=? ORDER BY seq', [id])
  return v
}

export function deleteVoucher(id: number): void {
  const db = requireDb()
  const v = db.get<Voucher>('SELECT * FROM voucher WHERE id=?', [id])
  if (!v) return
  if (isPeriodClosed(v.period)) throw new Error(`${v.period} 期间已结账，不能删除凭证`)
  db.transaction(() => {
    db.run('DELETE FROM voucher_line WHERE voucher_id=?', [id])
    db.run('DELETE FROM voucher WHERE id=?', [id])
  })
  db.save()
}

export function listVouchers(filter: { period?: string; from?: string; to?: string; keyword?: string }): VoucherListItem[] {
  const db = requireDb()
  const where: string[] = []
  const params: (string | number)[] = []
  if (filter.period) {
    where.push('v.period=?')
    params.push(filter.period)
  }
  if (filter.from) {
    where.push('v.period>=?')
    params.push(filter.from)
  }
  if (filter.to) {
    where.push('v.period<=?')
    params.push(filter.to)
  }
  if (filter.keyword) {
    where.push(`v.id IN (SELECT voucher_id FROM voucher_line l JOIN account a ON a.code=l.account_code WHERE l.summary LIKE ? OR a.name LIKE ? OR a.code LIKE ?)`)
    const k = `%${filter.keyword}%`
    params.push(k, k, k)
  }
  const sql = `
    SELECT v.id, v.period, v.date, v.word, v.num, v.attachments, v.maker, v.source,
      (SELECT summary FROM voucher_line WHERE voucher_id=v.id ORDER BY seq LIMIT 1) summary,
      (SELECT COALESCE(SUM(debit),0) FROM voucher_line WHERE voucher_id=v.id) total,
      (SELECT COUNT(*) FROM voucher_line WHERE voucher_id=v.id) line_count
    FROM voucher v ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY v.period DESC, v.word, v.num DESC`
  return db.all<VoucherListItem>(sql, params)
}

/** 整理断号：按日期、原编号重新连续编号 */
export function renumber(period: string): number {
  const db = requireDb()
  if (isPeriodClosed(period)) throw new Error('已结账期间不能整理断号')
  const rows = db.all<{ id: number; word: string }>('SELECT id, word FROM voucher WHERE period=? ORDER BY word, date, num, id', [period])
  let n = 0
  const counters: Record<string, number> = {}
  db.transaction(() => {
    for (const r of rows) {
      counters[r.word] = (counters[r.word] ?? 0) + 1
      db.run('UPDATE voucher SET num=? WHERE id=?', [counters[r.word], r.id])
      n++
    }
  })
  db.save()
  return n
}

export function summaries(): string[] {
  const db = requireDb()
  return db.all<{ summary: string }>('SELECT summary, COUNT(*) c FROM voucher_line GROUP BY summary ORDER BY c DESC LIMIT 200').map((r) => r.summary)
}
