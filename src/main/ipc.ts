import { ipcMain, dialog, BrowserWindow, shell, app } from 'electron'
import fs from 'fs'
import path from 'path'
import * as books from './services/books'
import * as accounts from './services/accounts'
import * as vouchers from './services/vouchers'
import * as ledger from './services/ledger'
import * as reports from './services/reports'
import * as closing from './services/closing'

type Handler = (...args: any[]) => unknown

const handlers: Record<string, Handler> = {
  // 账套
  'books:list': () => books.listBooks(),
  'books:create': (meta) => books.createBook(meta),
  'books:open': (id) => books.openBook(id),
  'books:close': () => books.closeBook(),
  'books:delete': (id) => books.deleteBook(id),
  'books:current': () => books.currentBookInfo(),
  'books:init': () => books.initBook(),
  'books:updateMeta': (meta) => books.updateBookMeta(meta),
  'books:backup': async () => {
    const info = books.currentBookInfo()
    if (!info) throw new Error('尚未打开账套')
    const r = await dialog.showSaveDialog({
      title: '备份账套',
      defaultPath: `${info.name}-备份-${new Date().toISOString().slice(0, 10)}.db`,
      filters: [{ name: '账套文件', extensions: ['db'] }]
    })
    if (r.canceled || !r.filePath) return null
    books.backupBook(r.filePath)
    return r.filePath
  },
  'books:import': async () => {
    const r = await dialog.showOpenDialog({ title: '导入账套', filters: [{ name: '账套文件', extensions: ['db'] }], properties: ['openFile'] })
    if (r.canceled || !r.filePaths[0]) return null
    return books.importBook(r.filePaths[0])
  },
  'books:openDir': () => shell.openPath(books.booksDir()),
  'books:lastPeriod': () => books.lastPeriod(),
  // 科目
  'accounts:list': () => accounts.listAccounts(),
  'accounts:add': (input) => accounts.addAccount(input),
  'accounts:update': (code, patch) => accounts.updateAccount(code, patch),
  'accounts:delete': (code) => accounts.deleteAccount(code),
  'init:get': () => accounts.getInitBalances(),
  'init:save': (rows) => accounts.saveInitBalances(rows),
  'init:trial': () => accounts.initTrial(),
  // 凭证
  'vouchers:save': (v) => vouchers.saveVoucher(v),
  'vouchers:get': (id) => vouchers.getVoucher(id),
  'vouchers:delete': (id) => vouchers.deleteVoucher(id),
  'vouchers:list': (filter) => vouchers.listVouchers(filter ?? {}),
  'vouchers:nextNum': (period, word) => vouchers.nextVoucherNum(period, word),
  'vouchers:renumber': (period) => vouchers.renumber(period),
  'vouchers:summaries': () => vouchers.summaries(),
  'vouchers:isClosed': (period) => vouchers.isPeriodClosed(period),
  // 账簿
  'ledger:balance': (from, to, opts) => ledger.balanceTable(from, to, opts ?? {}),
  'ledger:general': (code, from, to) => ledger.generalLedger(code, from, to),
  'ledger:subsidiary': (code, from, to) => ledger.subsidiaryLedger(code, from, to),
  // 报表
  'reports:balanceSheet': (period) => reports.balanceSheet(period),
  'reports:income': (period) => reports.incomeStatement(period),
  'reports:cashFlow': (period) => reports.cashFlowStatement(period),
  // 期末
  'closing:periods': () => closing.listPeriods(),
  'closing:carry': (period, maker) => closing.carryForwardPL(period, maker),
  'closing:close': (period) => closing.closePeriod(period),
  'closing:reopen': (period) => closing.reopenPeriod(period),
  // 通用
  'app:saveFile': async (defaultName: string, data: ArrayBuffer | Uint8Array, filters?: { name: string; extensions: string[] }[]) => {
    const r = await dialog.showSaveDialog({ defaultPath: defaultName, filters: filters ?? [{ name: 'Excel', extensions: ['xlsx'] }] })
    if (r.canceled || !r.filePath) return null
    fs.writeFileSync(r.filePath, Buffer.from(data as ArrayBuffer))
    return r.filePath
  },
  'app:print': async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    win.webContents.print({ silent: false, printBackground: true })
  },
  'app:version': () => app.getVersion(),
  'app:userData': () => path.join(app.getPath('userData'))
}

export function registerIpc(): void {
  for (const [channel, fn] of Object.entries(handlers)) {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        if (channel === 'app:print') return await fn(event)
        const r = await fn(...args)
        return { ok: true, data: r }
      } catch (e: any) {
        return { ok: false, error: e?.message ?? String(e) }
      }
    })
  }
}
