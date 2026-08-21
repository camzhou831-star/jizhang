import fs from 'fs'
import path from 'path'
import initSqlJs, { type Database, type SqlJsStatic, type BindParams } from 'sql.js'
import { PRESET_ACCOUNTS, levelOfCode, parentOfCode } from '@shared/coa'

let SQL: SqlJsStatic | null = null

async function getSql(): Promise<SqlJsStatic> {
  if (SQL) return SQL
  // sql.js 为纯 wasm，无需原生编译；wasm 文件随 node_modules 打进 asar，fs 可直接读取
  const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm')
  const wasmBinary = fs.readFileSync(wasmPath)
  SQL = await initSqlJs({ wasmBinary: wasmBinary as unknown as ArrayBuffer })
  return SQL
}

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS book_meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS account (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  direction TEXT NOT NULL,
  parent_code TEXT,
  level INTEGER NOT NULL,
  is_leaf INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  preset INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS init_balance (
  account_code TEXT PRIMARY KEY,
  debit REAL NOT NULL DEFAULT 0,
  credit REAL NOT NULL DEFAULT 0,
  year_debit REAL NOT NULL DEFAULT 0,
  year_credit REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS voucher (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period TEXT NOT NULL,
  date TEXT NOT NULL,
  word TEXT NOT NULL DEFAULT '记',
  num INTEGER NOT NULL,
  attachments INTEGER NOT NULL DEFAULT 0,
  maker TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_voucher_period ON voucher(period);
CREATE TABLE IF NOT EXISTS voucher_line (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voucher_id INTEGER NOT NULL REFERENCES voucher(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  account_code TEXT NOT NULL,
  debit REAL NOT NULL DEFAULT 0,
  credit REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_line_voucher ON voucher_line(voucher_id);
CREATE INDEX IF NOT EXISTS idx_line_account ON voucher_line(account_code);
CREATE TABLE IF NOT EXISTS period (
  period TEXT PRIMARY KEY,
  closed INTEGER NOT NULL DEFAULT 0,
  closed_at TEXT
);
`

export class BookDb {
  constructor(
    public readonly file: string,
    private db: Database
  ) {}

  static async open(file: string): Promise<BookDb> {
    const sql = await getSql()
    const buf = fs.readFileSync(file)
    const db = new sql.Database(buf)
    db.exec('PRAGMA foreign_keys = ON;')
    db.exec(SCHEMA)
    return new BookDb(file, db)
  }

  static async create(
    file: string,
    meta: { name: string; company: string; start_period: string; standard: string }
  ): Promise<BookDb> {
    const sql = await getSql()
    const db = new sql.Database()
    db.exec('PRAGMA foreign_keys = ON;')
    db.exec(SCHEMA)
    const bdb = new BookDb(file, db)
    for (const [k, v] of Object.entries({ ...meta, created_at: new Date().toISOString() })) {
      bdb.run('INSERT INTO book_meta(key,value) VALUES(?,?)', [k, v])
    }
    bdb.seedAccounts()
    bdb.save()
    return bdb
  }

  seedAccounts(): void {
    const codes = new Set(PRESET_ACCOUNTS.map((a) => a[0]))
    for (const [code, name, category, direction] of PRESET_ACCOUNTS) {
      const parent = parentOfCode(code)
      const hasChild = PRESET_ACCOUNTS.some((a) => a[0] !== code && a[0].startsWith(code) && parentOfCode(a[0]) === code)
      this.run(
        `INSERT OR IGNORE INTO account(code,name,category,direction,parent_code,level,is_leaf,enabled,preset)
         VALUES(?,?,?,?,?,?,?,1,1)`,
        [code, name, category, direction, parent && codes.has(parent) ? parent : null, levelOfCode(code), hasChild ? 0 : 1]
      )
    }
  }

  run(sql: string, params: BindParams = []): void {
    this.db.run(sql, params)
  }

  all<T = Record<string, unknown>>(sql: string, params: BindParams = []): T[] {
    const stmt = this.db.prepare(sql)
    stmt.bind(params)
    const rows: T[] = []
    while (stmt.step()) rows.push(stmt.getAsObject() as T)
    stmt.free()
    return rows
  }

  get<T = Record<string, unknown>>(sql: string, params: BindParams = []): T | undefined {
    return this.all<T>(sql, params)[0]
  }

  scalar<T = number>(sql: string, params: BindParams = []): T | undefined {
    const stmt = this.db.prepare(sql)
    stmt.bind(params)
    let v: T | undefined
    if (stmt.step()) v = stmt.get()[0] as T
    stmt.free()
    return v
  }

  lastId(): number {
    return this.scalar<number>('SELECT last_insert_rowid()') ?? 0
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN')
    try {
      const r = fn()
      this.db.exec('COMMIT')
      return r
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  getMeta(key: string): string {
    return this.scalar<string>('SELECT value FROM book_meta WHERE key=?', [key]) ?? ''
  }

  setMeta(key: string, value: string): void {
    this.run('INSERT INTO book_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, value])
  }

  /** 落盘：写临时文件后原子替换，避免写一半断电损坏 */
  save(): void {
    const data = this.db.export()
    const tmp = this.file + '.tmp'
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(tmp, Buffer.from(data))
    fs.renameSync(tmp, this.file)
  }

  close(): void {
    this.db.close()
  }
}

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100
