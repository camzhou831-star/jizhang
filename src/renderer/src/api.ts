import type {
  Account, BalanceRow, BalanceSheetData, BookInfo, CashFlowData, IncomeStatementData, InitBalanceRow,
  LedgerRow, PeriodInfo, Voucher, VoucherListItem
} from '@shared/types'

const call = <T>(ch: string, ...args: unknown[]): Promise<T> => window.api.invoke<T>(ch, ...args)

export const api = {
  books: {
    list: () => call<BookInfo[]>('books:list'),
    create: (meta: { name: string; company: string; start_period: string }) => call<BookInfo>('books:create', meta),
    open: (id: string) => call<BookInfo>('books:open', id),
    close: () => call<void>('books:close'),
    delete: (id: string) => call<void>('books:delete', id),
    current: () => call<BookInfo | null>('books:current'),
    init: () => call<BookInfo | null>('books:init'),
    updateMeta: (meta: { name: string; company: string }) => call<void>('books:updateMeta', meta),
    backup: () => call<string | null>('books:backup'),
    import: () => call<BookInfo | null>('books:import'),
    openDir: () => call<void>('books:openDir'),
    lastPeriod: () => call<string>('books:lastPeriod')
  },
  accounts: {
    list: () => call<Account[]>('accounts:list'),
    add: (input: { code: string; name: string; direction?: 'debit' | 'credit' }) => call<Account>('accounts:add', input),
    update: (code: string, patch: { name?: string; enabled?: number; direction?: 'debit' | 'credit' }) => call<void>('accounts:update', code, patch),
    delete: (code: string) => call<void>('accounts:delete', code)
  },
  init: {
    get: () => call<InitBalanceRow[]>('init:get'),
    save: (rows: InitBalanceRow[]) => call<{ balanced: boolean; debit: number; credit: number }>('init:save', rows),
    trial: () => call<{ balanced: boolean; debit: number; credit: number }>('init:trial')
  },
  vouchers: {
    save: (v: Voucher) => call<{ id: number; num: number }>('vouchers:save', v),
    get: (id: number) => call<Voucher | null>('vouchers:get', id),
    delete: (id: number) => call<void>('vouchers:delete', id),
    list: (filter: { period?: string; from?: string; to?: string; keyword?: string }) => call<VoucherListItem[]>('vouchers:list', filter),
    nextNum: (period: string, word = '记') => call<number>('vouchers:nextNum', period, word),
    renumber: (period: string) => call<number>('vouchers:renumber', period),
    summaries: () => call<string[]>('vouchers:summaries'),
    isClosed: (period: string) => call<boolean>('vouchers:isClosed', period)
  },
  ledger: {
    balance: (from: string, to: string, opts: { maxLevel?: number; hideZero?: boolean }) => call<BalanceRow[]>('ledger:balance', from, to, opts),
    general: (code: string, from: string, to: string) => call<LedgerRow[]>('ledger:general', code, from, to),
    subsidiary: (code: string, from: string, to: string) => call<LedgerRow[]>('ledger:subsidiary', code, from, to)
  },
  reports: {
    balanceSheet: (period: string) => call<BalanceSheetData>('reports:balanceSheet', period),
    income: (period: string) => call<IncomeStatementData>('reports:income', period),
    cashFlow: (period: string) => call<CashFlowData>('reports:cashFlow', period)
  },
  closing: {
    periods: () => call<PeriodInfo[]>('closing:periods'),
    carry: (period: string, maker: string) => call<{ id: number; num: number; lines: number }>('closing:carry', period, maker),
    close: (period: string) => call<void>('closing:close', period),
    reopen: (period: string) => call<void>('closing:reopen', period)
  },
  app: {
    saveFile: (name: string, data: Uint8Array, filters?: { name: string; extensions: string[] }[]) => call<string | null>('app:saveFile', name, data, filters),
    print: () => window.api.print()
  }
}
