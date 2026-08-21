export type Category = 'asset' | 'liability' | 'equity' | 'cost' | 'pl'
export type Direction = 'debit' | 'credit'

export interface Account {
  code: string
  name: string
  category: Category
  direction: Direction
  parent_code: string | null
  level: number
  is_leaf: number
  enabled: number
  preset: number
}

export interface BookInfo {
  id: string
  name: string
  company: string
  start_period: string // YYYY-MM
  standard: string
  file: string
  size: number
  mtime: number
}

export interface InitBalanceRow {
  account_code: string
  debit: number
  credit: number
  year_debit: number
  year_credit: number
}

export interface VoucherLine {
  id?: number
  seq: number
  summary: string
  account_code: string
  debit: number
  credit: number
}

export interface Voucher {
  id?: number
  period: string
  date: string
  word: string
  num: number
  attachments: number
  maker: string
  note: string
  source: string | null
  lines: VoucherLine[]
}

export interface VoucherListItem {
  id: number
  period: string
  date: string
  word: string
  num: number
  attachments: number
  maker: string
  source: string | null
  summary: string
  total: number
  line_count: number
}

export interface BalanceRow {
  code: string
  name: string
  level: number
  category: Category
  direction: Direction
  open_debit: number
  open_credit: number
  period_debit: number
  period_credit: number
  close_debit: number
  close_credit: number
}

export interface LedgerRow {
  period: string
  date: string
  voucher_id: number | null
  voucher_no: string
  summary: string
  debit: number
  credit: number
  direction: '借' | '贷' | '平'
  balance: number
}

export interface ReportLine {
  name: string
  lineNo?: number | string
  amount: number | null      // 期末 / 本年累计
  amount2: number | null     // 年初 / 本月
  bold?: boolean
  indent?: number
}

export interface BalanceSheetData {
  period: string
  assets: ReportLine[]
  liabilities: ReportLine[]
  balanced: boolean
  diff: number
}

export interface IncomeStatementData {
  period: string
  lines: ReportLine[]
}

export interface CashFlowData {
  period: string
  lines: ReportLine[]
}

export interface PeriodInfo {
  period: string
  closed: number
  voucher_count: number
  has_closing: boolean
}

export interface SaveResult {
  ok: boolean
  message?: string
  id?: number
}
