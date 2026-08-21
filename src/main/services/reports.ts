import { requireDb } from './books'
import { round2 } from '../db'
import { allAccounts, leafOpeningNet, leafOccurrence, leafYearOccurrence, nextPeriod, rollupNet, rollupDC, type DC } from './ledger'
import type { Account, BalanceSheetData, CashFlowData, IncomeStatementData, ReportLine } from '@shared/types'

type NetMap = Map<string, number>

/** 某时点（period 期末）全部科目净余额（借正贷负），含上级汇总 */
function netAt(accounts: Account[], periodEnd: string): NetMap {
  return rollupNet(accounts, leafOpeningNet(nextPeriod(periodEnd)))
}

/** 年初余额：当年第一期期初 */
function netYearStart(accounts: Account[], period: string): NetMap {
  return rollupNet(accounts, leafOpeningNet(`${period.slice(0, 4)}-01`))
}

const sum = (m: NetMap, codes: string[]): number => round2(codes.reduce((s, c) => s + (m.get(c) ?? 0), 0))

/** 往来科目按末级科目方向拆分：返回 [借方余额合计, 贷方余额合计] */
function splitLeaf(accounts: Account[], leaf: NetMap, code: string): [number, number] {
  let d = 0
  let c = 0
  for (const a of accounts) {
    if (!a.is_leaf || !a.code.startsWith(code)) continue
    const v = leaf.get(a.code) ?? 0
    if (v > 0) d += v
    else c += -v
  }
  return [round2(d), round2(c)]
}

function buildBS(accounts: Account[], leaf: NetMap): { assets: Map<string, number>; liab: Map<string, number> } {
  const m = rollupNet(accounts, leaf)
  const ar = splitLeaf(accounts, leaf, '1122')
  const adv = splitLeaf(accounts, leaf, '2203')
  const prepay = splitLeaf(accounts, leaf, '1123')
  const ap = splitLeaf(accounts, leaf, '2202')
  const othRec = splitLeaf(accounts, leaf, '1221')
  const othPay = splitLeaf(accounts, leaf, '2241')
  const A = new Map<string, number>()
  const L = new Map<string, number>()
  A.set('货币资金', sum(m, ['1001', '1002', '1012']))
  A.set('短期投资', sum(m, ['1101']))
  A.set('应收票据', sum(m, ['1121']))
  A.set('应收账款', round2(ar[0] + adv[0]))
  A.set('预付账款', round2(prepay[0] + ap[0]))
  A.set('应收股利', sum(m, ['1131']))
  A.set('应收利息', sum(m, ['1132']))
  A.set('其他应收款', round2(othRec[0] + othPay[0]))
  A.set('原材料', sum(m, ['1401', '1402', '1403', '1404']))
  A.set('在产品', sum(m, ['4001', '4101']))
  A.set('库存商品', sum(m, ['1405', '1407', '1408', '1421']))
  A.set('周转材料', sum(m, ['1411']))
  A.set('存货', round2(A.get('原材料')! + A.get('在产品')! + A.get('库存商品')! + A.get('周转材料')!))
  A.set('其他流动资产', sum(m, ['1901']))
  A.set('流动资产合计', round2(['货币资金', '短期投资', '应收票据', '应收账款', '预付账款', '应收股利', '应收利息', '其他应收款', '存货', '其他流动资产'].reduce((s, k) => s + A.get(k)!, 0)))
  A.set('长期债券投资', sum(m, ['1501']))
  A.set('长期股权投资', sum(m, ['1511']))
  A.set('固定资产原价', sum(m, ['1601']))
  A.set('累计折旧', -sum(m, ['1602']))
  A.set('固定资产账面价值', round2(A.get('固定资产原价')! - A.get('累计折旧')!))
  A.set('在建工程', sum(m, ['1604']))
  A.set('工程物资', sum(m, ['1605']))
  A.set('固定资产清理', sum(m, ['1606']))
  A.set('生产性生物资产', round2(sum(m, ['1621']) + sum(m, ['1622'])))
  A.set('无形资产', round2(sum(m, ['1701']) + sum(m, ['1702'])))
  A.set('开发支出', sum(m, ['4301']))
  A.set('长期待摊费用', sum(m, ['1801']))
  A.set('其他非流动资产', sum(m, ['4401', '4403']))
  A.set('非流动资产合计', round2(['长期债券投资', '长期股权投资', '固定资产账面价值', '在建工程', '工程物资', '固定资产清理', '生产性生物资产', '无形资产', '开发支出', '长期待摊费用', '其他非流动资产'].reduce((s, k) => s + A.get(k)!, 0)))
  A.set('资产总计', round2(A.get('流动资产合计')! + A.get('非流动资产合计')!))

  L.set('短期借款', -sum(m, ['2001']))
  L.set('应付票据', -sum(m, ['2201']))
  L.set('应付账款', round2(ap[1] + prepay[1]))
  L.set('预收账款', round2(adv[1] + ar[1]))
  L.set('应付职工薪酬', -sum(m, ['2211']))
  L.set('应交税费', -sum(m, ['2221']))
  L.set('应付利息', -sum(m, ['2231']))
  L.set('应付利润', -sum(m, ['2232']))
  L.set('其他应付款', round2(othPay[1] + othRec[1]))
  L.set('其他流动负债', 0)
  L.set('流动负债合计', round2(['短期借款', '应付票据', '应付账款', '预收账款', '应付职工薪酬', '应交税费', '应付利息', '应付利润', '其他应付款', '其他流动负债'].reduce((s, k) => s + L.get(k)!, 0)))
  L.set('长期借款', -sum(m, ['2501']))
  L.set('长期应付款', -sum(m, ['2701']))
  L.set('递延收益', -sum(m, ['2401']))
  L.set('其他非流动负债', 0)
  L.set('非流动负债合计', round2(['长期借款', '长期应付款', '递延收益', '其他非流动负债'].reduce((s, k) => s + L.get(k)!, 0)))
  L.set('负债合计', round2(L.get('流动负债合计')! + L.get('非流动负债合计')!))
  L.set('实收资本', -sum(m, ['3001']))
  L.set('资本公积', -sum(m, ['3002']))
  L.set('盈余公积', -sum(m, ['3101']))
  // 未分配利润 = 本年利润 + 利润分配 + 尚未结转的损益类科目净额（贷正）
  const plCodes = accounts.filter((a) => a.level === 1 && a.category === 'pl').map((a) => a.code)
  L.set('未分配利润', round2(-sum(m, ['3103', '3104']) - sum(m, plCodes)))
  L.set('所有者权益合计', round2(['实收资本', '资本公积', '盈余公积', '未分配利润'].reduce((s, k) => s + L.get(k)!, 0)))
  L.set('负债和所有者权益总计', round2(L.get('负债合计')! + L.get('所有者权益合计')!))
  return { assets: A, liab: L }
}

const BS_ASSET_LAYOUT: [name: string, lineNo: number, key: string, opts?: Partial<ReportLine>][] = [
  ['流动资产：', 0, '', { bold: true }],
  ['货币资金', 1, '货币资金'],
  ['短期投资', 2, '短期投资'],
  ['应收票据', 3, '应收票据'],
  ['应收账款', 4, '应收账款'],
  ['预付账款', 5, '预付账款'],
  ['应收股利', 6, '应收股利'],
  ['应收利息', 7, '应收利息'],
  ['其他应收款', 8, '其他应收款'],
  ['存货', 9, '存货'],
  ['其中：原材料', 10, '原材料', { indent: 1 }],
  ['在产品', 11, '在产品', { indent: 2 }],
  ['库存商品', 12, '库存商品', { indent: 2 }],
  ['周转材料', 13, '周转材料', { indent: 2 }],
  ['其他流动资产', 14, '其他流动资产'],
  ['流动资产合计', 15, '流动资产合计', { bold: true }],
  ['非流动资产：', 0, '', { bold: true }],
  ['长期债券投资', 16, '长期债券投资'],
  ['长期股权投资', 17, '长期股权投资'],
  ['固定资产原价', 18, '固定资产原价'],
  ['减：累计折旧', 19, '累计折旧'],
  ['固定资产账面价值', 20, '固定资产账面价值'],
  ['在建工程', 21, '在建工程'],
  ['工程物资', 22, '工程物资'],
  ['固定资产清理', 23, '固定资产清理'],
  ['生产性生物资产', 24, '生产性生物资产'],
  ['无形资产', 25, '无形资产'],
  ['开发支出', 26, '开发支出'],
  ['长期待摊费用', 27, '长期待摊费用'],
  ['其他非流动资产', 28, '其他非流动资产'],
  ['非流动资产合计', 29, '非流动资产合计', { bold: true }],
  ['资产总计', 30, '资产总计', { bold: true }]
]

const BS_LIAB_LAYOUT: [name: string, lineNo: number, key: string, opts?: Partial<ReportLine>][] = [
  ['流动负债：', 0, '', { bold: true }],
  ['短期借款', 31, '短期借款'],
  ['应付票据', 32, '应付票据'],
  ['应付账款', 33, '应付账款'],
  ['预收账款', 34, '预收账款'],
  ['应付职工薪酬', 35, '应付职工薪酬'],
  ['应交税费', 36, '应交税费'],
  ['应付利息', 37, '应付利息'],
  ['应付利润', 38, '应付利润'],
  ['其他应付款', 39, '其他应付款'],
  ['其他流动负债', 40, '其他流动负债'],
  ['流动负债合计', 41, '流动负债合计', { bold: true }],
  ['非流动负债：', 0, '', { bold: true }],
  ['长期借款', 42, '长期借款'],
  ['长期应付款', 43, '长期应付款'],
  ['递延收益', 44, '递延收益'],
  ['其他非流动负债', 45, '其他非流动负债'],
  ['非流动负债合计', 46, '非流动负债合计', { bold: true }],
  ['负债合计', 47, '负债合计', { bold: true }],
  ['所有者权益（或股东权益）：', 0, '', { bold: true }],
  ['实收资本（或股本）', 48, '实收资本'],
  ['资本公积', 49, '资本公积'],
  ['盈余公积', 50, '盈余公积'],
  ['未分配利润', 51, '未分配利润'],
  ['所有者权益（或股东权益）合计', 52, '所有者权益合计', { bold: true }],
  ['负债和所有者权益（或股东权益）总计', 53, '负债和所有者权益总计', { bold: true }]
]

export function balanceSheet(period: string): BalanceSheetData {
  const accounts = allAccounts()
  const endLeaf = leafOpeningNet(nextPeriod(period))
  const startLeaf = leafOpeningNet(`${period.slice(0, 4)}-01`)
  const end = buildBS(accounts, endLeaf)
  const start = buildBS(accounts, startLeaf)
  const toLines = (layout: typeof BS_ASSET_LAYOUT, e: Map<string, number>, s: Map<string, number>): ReportLine[] =>
    layout.map(([name, lineNo, key, opts]) => ({
      name,
      lineNo: lineNo || '',
      amount: key ? (e.get(key) ?? 0) : null,
      amount2: key ? (s.get(key) ?? 0) : null,
      ...opts
    }))
  const assets = toLines(BS_ASSET_LAYOUT, end.assets, start.assets)
  const liabilities = toLines(BS_LIAB_LAYOUT, end.liab, start.liab)
  const diff = round2(end.assets.get('资产总计')! - end.liab.get('负债和所有者权益总计')!)
  return { period, assets, liabilities, balanced: Math.abs(diff) < 0.005, diff }
}

function plAmount(accounts: Account[], occ: Map<string, DC>, codes: string[]): number {
  // 收入类：贷-借；费用类：借-贷
  let s = 0
  for (const code of codes) {
    const acc = accounts.find((a) => a.code === code)
    const v = occ.get(code) ?? { debit: 0, credit: 0 }
    s += acc?.direction === 'credit' ? v.credit - v.debit : v.debit - v.credit
  }
  return round2(s)
}

export function incomeStatement(period: string): IncomeStatementData {
  const accounts = allAccounts()
  const month = rollupDC(accounts, leafOccurrence(period, period, { excludeClosing: true }))
  const year = rollupDC(accounts, leafYearOccurrence(period, { excludeClosing: true }))
  const build = (occ: Map<string, DC>): Map<string, number> => {
    const m = new Map<string, number>()
    m.set('营业收入', plAmount(accounts, occ, ['5001', '5051']))
    m.set('营业成本', plAmount(accounts, occ, ['5401', '5402']))
    m.set('税金及附加', plAmount(accounts, occ, ['5403']))
    m.set('销售费用', plAmount(accounts, occ, ['5601']))
    m.set('管理费用', plAmount(accounts, occ, ['5602']))
    m.set('财务费用', plAmount(accounts, occ, ['5603']))
    m.set('利息费用', plAmount(accounts, occ, ['560301']))
    m.set('投资收益', plAmount(accounts, occ, ['5111']))
    m.set('营业利润', round2(m.get('营业收入')! - m.get('营业成本')! - m.get('税金及附加')! - m.get('销售费用')! - m.get('管理费用')! - m.get('财务费用')! + m.get('投资收益')!))
    m.set('营业外收入', plAmount(accounts, occ, ['5301']))
    m.set('营业外支出', plAmount(accounts, occ, ['5711']))
    m.set('利润总额', round2(m.get('营业利润')! + m.get('营业外收入')! - m.get('营业外支出')!))
    m.set('所得税费用', plAmount(accounts, occ, ['5801']))
    m.set('净利润', round2(m.get('利润总额')! - m.get('所得税费用')!))
    return m
  }
  const y = build(year)
  const mo = build(month)
  const layout: [string, number, string, Partial<ReportLine>?][] = [
    ['一、营业收入', 1, '营业收入', { bold: true }],
    ['减：营业成本', 2, '营业成本'],
    ['税金及附加', 3, '税金及附加', { indent: 1 }],
    ['销售费用', 9, '销售费用', { indent: 1 }],
    ['管理费用', 13, '管理费用', { indent: 1 }],
    ['财务费用', 17, '财务费用', { indent: 1 }],
    ['其中：利息费用（收入以“－”号填列）', 18, '利息费用', { indent: 2 }],
    ['加：投资收益（损失以“－”号填列）', 20, '投资收益'],
    ['二、营业利润（亏损以“－”号填列）', 21, '营业利润', { bold: true }],
    ['加：营业外收入', 22, '营业外收入'],
    ['减：营业外支出', 24, '营业外支出'],
    ['三、利润总额（亏损总额以“－”号填列）', 27, '利润总额', { bold: true }],
    ['减：所得税费用', 28, '所得税费用'],
    ['四、净利润（净亏损以“－”号填列）', 29, '净利润', { bold: true }]
  ]
  return {
    period,
    lines: layout.map(([name, lineNo, key, opts]) => ({ name, lineNo, amount: y.get(key) ?? 0, amount2: mo.get(key) ?? 0, ...opts }))
  }
}

// ---------------- 现金流量表（按对方科目自动分析，T 型账户法） ----------------

const CASH_PREFIX = ['1001', '1002', '1012']
const isCash = (code: string): boolean => CASH_PREFIX.some((p) => code.startsWith(p))

const CF_ITEMS = [
  '销售产成品、商品、提供劳务收到的现金',
  '收到其他与经营活动有关的现金',
  '购买原材料、商品、接受劳务支付的现金',
  '支付的职工薪酬',
  '支付的税费',
  '支付其他与经营活动有关的现金',
  '收回短期投资、长期债券投资和长期股权投资收到的现金',
  '取得投资收益收到的现金',
  '处置固定资产、无形资产和其他非流动资产收回的现金净额',
  '短期投资、长期债券投资和长期股权投资支付的现金',
  '购建固定资产、无形资产和其他非流动资产支付的现金',
  '取得借款收到的现金',
  '吸收投资者投资收到的现金',
  '偿还借款本金支付的现金',
  '偿还借款利息支付的现金',
  '分配利润支付的现金'
] as const
type CfItem = (typeof CF_ITEMS)[number]

function classify(counterCode: string, cashIn: boolean): CfItem {
  const c = counterCode
  const st = (...ps: string[]): boolean => ps.some((p) => c.startsWith(p))
  if (cashIn) {
    if (st('5001', '5051', '1122', '1121', '2203', '22210102')) return '销售产成品、商品、提供劳务收到的现金'
    if (st('1101', '1501', '1511')) return '收回短期投资、长期债券投资和长期股权投资收到的现金'
    if (st('5111', '1131', '1132')) return '取得投资收益收到的现金'
    if (st('1601', '1604', '1605', '1606', '1621', '1701', '1801')) return '处置固定资产、无形资产和其他非流动资产收回的现金净额'
    if (st('2001', '2501', '2701')) return '取得借款收到的现金'
    if (st('3001', '3002')) return '吸收投资者投资收到的现金'
    return '收到其他与经营活动有关的现金'
  }
  if (st('5401', '5402', '1401', '1402', '1403', '1405', '1408', '1411', '2202', '2201', '1123', '4001', '4101', '22210101')) return '购买原材料、商品、接受劳务支付的现金'
  if (st('2211', '560203', '560204')) return '支付的职工薪酬'
  if (st('2221', '5403', '5801')) return '支付的税费'
  if (st('1101', '1501', '1511')) return '短期投资、长期债券投资和长期股权投资支付的现金'
  if (st('1601', '1604', '1605', '1621', '1701', '1801', '4301')) return '购建固定资产、无形资产和其他非流动资产支付的现金'
  if (st('2001', '2501', '2701')) return '偿还借款本金支付的现金'
  if (st('2231', '560301')) return '偿还借款利息支付的现金'
  if (st('2232', '3104')) return '分配利润支付的现金'
  return '支付其他与经营活动有关的现金'
}

function cashFlowTotals(from: string, to: string): Map<CfItem, number> {
  const db = requireDb()
  const totals = new Map<CfItem, number>()
  const vouchers = db.all<{ id: number }>(`SELECT id FROM voucher WHERE period>=? AND period<=? AND (source IS NULL OR source<>'closing')`, [from, to])
  for (const v of vouchers) {
    const lines = db.all<{ account_code: string; debit: number; credit: number }>('SELECT account_code,debit,credit FROM voucher_line WHERE voucher_id=?', [v.id])
    const cashLines = lines.filter((l) => isCash(l.account_code))
    const others = lines.filter((l) => !isCash(l.account_code))
    if (!cashLines.length || !others.length) continue
    const cashIn = round2(cashLines.reduce((s, l) => s + l.debit - l.credit, 0))
    if (!cashIn) continue
    const inflow = cashIn > 0
    // 对方科目：与现金方向相反的那一侧
    const counters = others.filter((l) => (inflow ? l.credit > 0 : l.debit > 0))
    const pool = counters.length ? counters : others
    const total = pool.reduce((s, l) => s + (inflow ? l.credit - l.debit : l.debit - l.credit), 0) || 1
    for (const l of pool) {
      const w = (inflow ? l.credit - l.debit : l.debit - l.credit) / total
      const item = classify(l.account_code, inflow)
      totals.set(item, round2((totals.get(item) ?? 0) + Math.abs(cashIn) * w))
    }
  }
  return totals
}

export function cashFlowStatement(period: string): CashFlowData {
  const db = requireDb()
  const accounts = allAccounts()
  const year = period.slice(0, 4)
  const monthT = cashFlowTotals(period, period)
  const yearT = cashFlowTotals(`${year}-01`, period)
  const g = (t: Map<CfItem, number>, k: CfItem): number => t.get(k) ?? 0
  const net = (t: Map<CfItem, number>, ins: CfItem[], outs: CfItem[]): number => round2(ins.reduce((s, k) => s + g(t, k), 0) - outs.reduce((s, k) => s + g(t, k), 0))
  const opIn: CfItem[] = ['销售产成品、商品、提供劳务收到的现金', '收到其他与经营活动有关的现金']
  const opOut: CfItem[] = ['购买原材料、商品、接受劳务支付的现金', '支付的职工薪酬', '支付的税费', '支付其他与经营活动有关的现金']
  const invIn: CfItem[] = ['收回短期投资、长期债券投资和长期股权投资收到的现金', '取得投资收益收到的现金', '处置固定资产、无形资产和其他非流动资产收回的现金净额']
  const invOut: CfItem[] = ['短期投资、长期债券投资和长期股权投资支付的现金', '购建固定资产、无形资产和其他非流动资产支付的现金']
  const finIn: CfItem[] = ['取得借款收到的现金', '吸收投资者投资收到的现金']
  const finOut: CfItem[] = ['偿还借款本金支付的现金', '偿还借款利息支付的现金', '分配利润支付的现金']
  const cashCodes = accounts.filter((a) => a.level === 1 && isCash(a.code)).map((a) => a.code)
  const cashStartYear = sum(netYearStart(accounts, period), cashCodes)
  const cashStartMonth = sum(rollupNet(accounts, leafOpeningNet(period)), cashCodes)
  const cashEnd = sum(netAt(accounts, period), cashCodes)
  void db
  const lines: ReportLine[] = []
  let no = 1
  const push = (name: string, y: number | null, m: number | null, opts: Partial<ReportLine> = {}, numbered = true): void => {
    lines.push({ name, lineNo: numbered ? no++ : '', amount: y, amount2: m, ...opts })
  }
  push('一、经营活动产生的现金流量：', null, null, { bold: true }, false)
  for (const k of opIn) push(k, g(yearT, k), g(monthT, k))
  for (const k of opOut) push(k, g(yearT, k), g(monthT, k))
  push('经营活动产生的现金流量净额', net(yearT, opIn, opOut), net(monthT, opIn, opOut), { bold: true })
  push('二、投资活动产生的现金流量：', null, null, { bold: true }, false)
  for (const k of invIn) push(k, g(yearT, k), g(monthT, k))
  for (const k of invOut) push(k, g(yearT, k), g(monthT, k))
  push('投资活动产生的现金流量净额', net(yearT, invIn, invOut), net(monthT, invIn, invOut), { bold: true })
  push('三、筹资活动产生的现金流量：', null, null, { bold: true }, false)
  for (const k of finIn) push(k, g(yearT, k), g(monthT, k))
  for (const k of finOut) push(k, g(yearT, k), g(monthT, k))
  push('筹资活动产生的现金流量净额', net(yearT, finIn, finOut), net(monthT, finIn, finOut), { bold: true })
  const yNet = round2(net(yearT, opIn, opOut) + net(yearT, invIn, invOut) + net(yearT, finIn, finOut))
  const mNet = round2(net(monthT, opIn, opOut) + net(monthT, invIn, invOut) + net(monthT, finIn, finOut))
  push('四、现金净增加额', yNet, mNet, { bold: true })
  push('加：期初现金余额', cashStartYear, cashStartMonth)
  push('五、期末现金余额', round2(cashStartYear + yNet), round2(cashStartMonth + mNet), { bold: true })
  push('（账面期末货币资金，用于核对）', cashEnd, cashEnd, { indent: 1 }, false)
  return { period, lines }
}
