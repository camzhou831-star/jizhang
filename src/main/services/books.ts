import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { BookDb } from '../db'
import type { BookInfo } from '@shared/types'

let current: BookDb | null = null
let currentId: string | null = null

export function booksDir(): string {
  const dir = path.join(app.getPath('userData'), 'books')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function requireDb(): BookDb {
  if (!current) throw new Error('尚未打开账套')
  return current
}

export function currentBookId(): string | null {
  return currentId
}

export async function listBooks(): Promise<BookInfo[]> {
  const dir = booksDir()
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.db'))
  const list: BookInfo[] = []
  for (const f of files) {
    const file = path.join(dir, f)
    const id = f.replace(/\.db$/, '')
    try {
      const st = fs.statSync(file)
      const db = current && currentId === id ? current : await BookDb.open(file)
      list.push({
        id,
        name: db.getMeta('name'),
        company: db.getMeta('company'),
        start_period: db.getMeta('start_period'),
        standard: db.getMeta('standard'),
        file,
        size: st.size,
        mtime: st.mtimeMs
      })
      if (db !== current) db.close()
    } catch (e) {
      list.push({ id, name: `(损坏) ${f}`, company: '', start_period: '', standard: '', file, size: 0, mtime: 0 })
    }
  }
  list.sort((a, b) => b.mtime - a.mtime)
  return list
}

export async function createBook(meta: { name: string; company: string; start_period: string }): Promise<BookInfo> {
  if (!meta.name) throw new Error('账套名称不能为空')
  if (!/^\d{4}-\d{2}$/.test(meta.start_period)) throw new Error('启用期间格式应为 YYYY-MM')
  const id = `${Date.now().toString(36)}`
  const file = path.join(booksDir(), `${id}.db`)
  const db = await BookDb.create(file, { ...meta, standard: '小企业会计准则' })
  db.close()
  await openBook(id)
  const st = fs.statSync(file)
  return { id, ...meta, standard: '小企业会计准则', file, size: st.size, mtime: st.mtimeMs }
}

function lastFile(): string {
  return path.join(app.getPath('userData'), 'last-book.json')
}

/** 启动时自动打开上次使用的账套 */
export async function initBook(): Promise<BookInfo | null> {
  if (current) return currentBookInfo()
  try {
    const { id } = JSON.parse(fs.readFileSync(lastFile(), 'utf8')) as { id: string }
    if (id && fs.existsSync(path.join(booksDir(), `${id}.db`))) return await openBook(id)
  } catch {
    /* 没有记录或损坏，忽略 */
  }
  return null
}

export async function openBook(id: string): Promise<BookInfo> {
  const file = path.join(booksDir(), `${id}.db`)
  if (!fs.existsSync(file)) throw new Error('账套文件不存在')
  if (current) {
    current.close()
    current = null
    currentId = null
  }
  current = await BookDb.open(file)
  currentId = id
  try {
    fs.writeFileSync(lastFile(), JSON.stringify({ id }))
  } catch {
    /* ignore */
  }
  const st = fs.statSync(file)
  return {
    id,
    name: current.getMeta('name'),
    company: current.getMeta('company'),
    start_period: current.getMeta('start_period'),
    standard: current.getMeta('standard'),
    file,
    size: st.size,
    mtime: st.mtimeMs
  }
}

export function closeBook(): void {
  if (current) {
    current.save()
    current.close()
  }
  current = null
  currentId = null
}

export function deleteBook(id: string): void {
  if (currentId === id) closeBook()
  const file = path.join(booksDir(), `${id}.db`)
  if (fs.existsSync(file)) fs.unlinkSync(file)
}

export function updateBookMeta(meta: { name: string; company: string }): void {
  const db = requireDb()
  db.setMeta('name', meta.name)
  db.setMeta('company', meta.company)
  db.save()
}

/** 备份当前账套到指定路径 */
export function backupBook(target: string): void {
  const db = requireDb()
  db.save()
  fs.copyFileSync(db.file, target)
}

/** 从外部 .db 文件导入为新账套 */
export async function importBook(source: string): Promise<BookInfo> {
  const test = await BookDb.open(source)
  const name = test.getMeta('name')
  test.close()
  if (!name) throw new Error('不是有效的账套文件')
  const id = `${Date.now().toString(36)}`
  fs.copyFileSync(source, path.join(booksDir(), `${id}.db`))
  return openBook(id)
}

export function currentBookInfo(): BookInfo | null {
  if (!current || !currentId) return null
  const st = fs.statSync(current.file)
  return {
    id: currentId,
    name: current.getMeta('name'),
    company: current.getMeta('company'),
    start_period: current.getMeta('start_period'),
    standard: current.getMeta('standard'),
    file: current.file,
    size: st.size,
    mtime: st.mtimeMs
  }
}

/** 最近有凭证的期间；没有凭证则返回启用期间 */
export function lastPeriod(): string {
  const db = requireDb()
  return db.scalar<string>('SELECT MAX(period) FROM voucher') || db.getMeta('start_period')
}
