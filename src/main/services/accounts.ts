import { requireDb, } from './books'
import { round2 } from '../db'
import { levelOfCode, parentOfCode, CODE_LEVELS } from '@shared/coa'
import type { Account, InitBalanceRow } from '@shared/types'

export function listAccounts(): Account[] {
  return requireDb().all<Account>('SELECT * FROM account ORDER BY code')
}

export function addAccount(input: { code: string; name: string; direction?: 'debit' | 'credit' }): Account {
  const db = requireDb()
  const code = input.code.trim()
  const name = input.name.trim()
  if (!/^\d+$/.test(code)) throw new Error('科目编码只能是数字')
  const level = levelOfCode(code)
  if (!level) throw new Error(`科目编码长度须为 ${CODE_LEVELS.reduce<number[]>((a, n) => [...a, (a[a.length - 1] ?? 0) + n], []).join('/')} 位`)
  if (!name) throw new Error('科目名称不能为空')
  if (db.get('SELECT code FROM account WHERE code=?', [code])) throw new Error('科目编码已存在')
  const parentCode = parentOfCode(code)
  let category: string
  let direction: string
  if (parentCode) {
    const parent = db.get<Account>('SELECT * FROM account WHERE code=?', [parentCode])
    if (!parent) throw new Error(`上级科目 ${parentCode} 不存在`)
    category = parent.category
    direction = parent.direction
    // 上级科目已有发生/期初，不允许再增设明细
    const used = db.scalar<number>('SELECT COUNT(*) FROM voucher_line WHERE account_code=?', [parentCode]) ?? 0
    const ib = db.get<InitBalanceRow>('SELECT * FROM init_balance WHERE account_code=?', [parentCode])
    if (used > 0 || (ib && (ib.debit || ib.credit || ib.year_debit || ib.year_credit)))
      throw new Error(`上级科目 ${parentCode} ${parent.name} 已有期初余额或凭证，不能再增设明细科目`)
  } else {
    const first = code[0]
    category = first === '1' ? 'asset' : first === '2' ? 'liability' : first === '3' ? 'equity' : first === '4' ? 'cost' : 'pl'
    direction = input.direction ?? (category === 'asset' || category === 'cost' ? 'debit' : 'credit')
  }
  db.transaction(() => {
    db.run(
      'INSERT INTO account(code,name,category,direction,parent_code,level,is_leaf,enabled,preset) VALUES(?,?,?,?,?,?,1,1,0)',
      [code, name, category, direction, parentCode, level]
    )
    if (parentCode) {
      db.run('UPDATE account SET is_leaf=0 WHERE code=?', [parentCode])
      db.run('DELETE FROM init_balance WHERE account_code=?', [parentCode])
    }
  })
  db.save()
  return db.get<Account>('SELECT * FROM account WHERE code=?', [code])!
}

export function updateAccount(code: string, patch: { name?: string; enabled?: number; direction?: 'debit' | 'credit' }): void {
  const db = requireDb()
  const acc = db.get<Account>('SELECT * FROM account WHERE code=?', [code])
  if (!acc) throw new Error('科目不存在')
  if (patch.name !== undefined) db.run('UPDATE account SET name=? WHERE code=?', [patch.name.trim(), code])
  if (patch.enabled !== undefined) db.run('UPDATE account SET enabled=? WHERE code=?', [patch.enabled, code])
  if (patch.direction !== undefined && !acc.preset) db.run('UPDATE account SET direction=? WHERE code=?', [patch.direction, code])
  db.save()
}

export function deleteAccount(code: string): void {
  const db = requireDb()
  const acc = db.get<Account>('SELECT * FROM account WHERE code=?', [code])
  if (!acc) throw new Error('科目不存在')
  if (acc.preset && acc.level === 1) throw new Error('预置一级科目不能删除，可停用')
  if (!acc.is_leaf) throw new Error('请先删除其下级科目')
  const used = db.scalar<number>('SELECT COUNT(*) FROM voucher_line WHERE account_code=?', [code]) ?? 0
  if (used > 0) throw new Error('该科目已有凭证使用，不能删除')
  db.transaction(() => {
    db.run('DELETE FROM init_balance WHERE account_code=?', [code])
    db.run('DELETE FROM account WHERE code=?', [code])
    if (acc.parent_code) {
      const siblings = db.scalar<number>('SELECT COUNT(*) FROM account WHERE parent_code=?', [acc.parent_code]) ?? 0
      if (siblings === 0) db.run('UPDATE account SET is_leaf=1 WHERE code=?', [acc.parent_code])
    }
  })
  db.save()
}

export function getInitBalances(): InitBalanceRow[] {
  return requireDb().all<InitBalanceRow>('SELECT * FROM init_balance')
}

export function saveInitBalances(rows: InitBalanceRow[]): { balanced: boolean; debit: number; credit: number } {
  const db = requireDb()
  db.transaction(() => {
    for (const r of rows) {
      const acc = db.get<Account>('SELECT * FROM account WHERE code=?', [r.account_code])
      if (!acc) throw new Error(`科目 ${r.account_code} 不存在`)
      if (!acc.is_leaf) throw new Error(`科目 ${r.account_code} 不是末级科目`)
      const d = round2(Number(r.debit) || 0)
      const c = round2(Number(r.credit) || 0)
      const yd = round2(Number(r.year_debit) || 0)
      const yc = round2(Number(r.year_credit) || 0)
      if (!d && !c && !yd && !yc) {
        db.run('DELETE FROM init_balance WHERE account_code=?', [r.account_code])
      } else {
        db.run(
          `INSERT INTO init_balance(account_code,debit,credit,year_debit,year_credit) VALUES(?,?,?,?,?)
           ON CONFLICT(account_code) DO UPDATE SET debit=excluded.debit,credit=excluded.credit,year_debit=excluded.year_debit,year_credit=excluded.year_credit`,
          [r.account_code, d, c, yd, yc]
        )
      }
    }
  })
  db.save()
  return initTrial()
}

export function initTrial(): { balanced: boolean; debit: number; credit: number } {
  const db = requireDb()
  const r = db.get<{ d: number; c: number }>('SELECT COALESCE(SUM(debit),0) d, COALESCE(SUM(credit),0) c FROM init_balance')
  const debit = round2(r?.d ?? 0)
  const credit = round2(r?.c ?? 0)
  return { balanced: Math.abs(debit - credit) < 0.005, debit, credit }
}
