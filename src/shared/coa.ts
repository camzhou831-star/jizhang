import type { Category, Direction } from './types'

// 小企业会计准则（财会〔2011〕17号）附录 会计科目表 —— 66 个一级科目 + 常用明细
type Preset = [code: string, name: string, category: Category, direction: Direction]

export const PRESET_ACCOUNTS: Preset[] = [
  // 资产类
  ['1001', '库存现金', 'asset', 'debit'],
  ['1002', '银行存款', 'asset', 'debit'],
  ['1012', '其他货币资金', 'asset', 'debit'],
  ['1101', '短期投资', 'asset', 'debit'],
  ['1121', '应收票据', 'asset', 'debit'],
  ['1122', '应收账款', 'asset', 'debit'],
  ['1123', '预付账款', 'asset', 'debit'],
  ['1131', '应收股利', 'asset', 'debit'],
  ['1132', '应收利息', 'asset', 'debit'],
  ['1221', '其他应收款', 'asset', 'debit'],
  ['1401', '材料采购', 'asset', 'debit'],
  ['1402', '在途物资', 'asset', 'debit'],
  ['1403', '原材料', 'asset', 'debit'],
  ['1404', '材料成本差异', 'asset', 'debit'],
  ['1405', '库存商品', 'asset', 'debit'],
  ['1407', '商品进销差价', 'asset', 'credit'],
  ['1408', '委托加工物资', 'asset', 'debit'],
  ['1411', '周转材料', 'asset', 'debit'],
  ['1421', '消耗性生物资产', 'asset', 'debit'],
  ['1501', '长期债券投资', 'asset', 'debit'],
  ['1511', '长期股权投资', 'asset', 'debit'],
  ['1601', '固定资产', 'asset', 'debit'],
  ['1602', '累计折旧', 'asset', 'credit'],
  ['1604', '在建工程', 'asset', 'debit'],
  ['1605', '工程物资', 'asset', 'debit'],
  ['1606', '固定资产清理', 'asset', 'debit'],
  ['1621', '生产性生物资产', 'asset', 'debit'],
  ['1622', '生产性生物资产累计折旧', 'asset', 'credit'],
  ['1701', '无形资产', 'asset', 'debit'],
  ['1702', '累计摊销', 'asset', 'credit'],
  ['1801', '长期待摊费用', 'asset', 'debit'],
  ['1901', '待处理财产损溢', 'asset', 'debit'],
  // 负债类
  ['2001', '短期借款', 'liability', 'credit'],
  ['2201', '应付票据', 'liability', 'credit'],
  ['2202', '应付账款', 'liability', 'credit'],
  ['2203', '预收账款', 'liability', 'credit'],
  ['2211', '应付职工薪酬', 'liability', 'credit'],
  ['221101', '工资', 'liability', 'credit'],
  ['221102', '职工福利', 'liability', 'credit'],
  ['221103', '社会保险费', 'liability', 'credit'],
  ['221104', '住房公积金', 'liability', 'credit'],
  ['2221', '应交税费', 'liability', 'credit'],
  ['222101', '应交增值税', 'liability', 'credit'],
  ['22210101', '进项税额', 'liability', 'credit'],
  ['22210102', '销项税额', 'liability', 'credit'],
  ['22210103', '已交税金', 'liability', 'credit'],
  ['22210104', '转出未交增值税', 'liability', 'credit'],
  ['222102', '未交增值税', 'liability', 'credit'],
  ['222103', '应交城市维护建设税', 'liability', 'credit'],
  ['222104', '应交教育费附加', 'liability', 'credit'],
  ['222105', '应交地方教育附加', 'liability', 'credit'],
  ['222106', '应交企业所得税', 'liability', 'credit'],
  ['222107', '应交个人所得税', 'liability', 'credit'],
  ['222108', '应交印花税', 'liability', 'credit'],
  ['2231', '应付利息', 'liability', 'credit'],
  ['2232', '应付利润', 'liability', 'credit'],
  ['2241', '其他应付款', 'liability', 'credit'],
  ['2401', '递延收益', 'liability', 'credit'],
  ['2501', '长期借款', 'liability', 'credit'],
  ['2701', '长期应付款', 'liability', 'credit'],
  // 所有者权益类
  ['3001', '实收资本', 'equity', 'credit'],
  ['3002', '资本公积', 'equity', 'credit'],
  ['3101', '盈余公积', 'equity', 'credit'],
  ['310101', '法定盈余公积', 'equity', 'credit'],
  ['310102', '任意盈余公积', 'equity', 'credit'],
  ['3103', '本年利润', 'equity', 'credit'],
  ['3104', '利润分配', 'equity', 'credit'],
  ['310401', '提取法定盈余公积', 'equity', 'credit'],
  ['310402', '提取任意盈余公积', 'equity', 'credit'],
  ['310403', '应付利润', 'equity', 'credit'],
  ['310404', '未分配利润', 'equity', 'credit'],
  // 成本类
  ['4001', '生产成本', 'cost', 'debit'],
  ['4101', '制造费用', 'cost', 'debit'],
  ['4301', '研发支出', 'cost', 'debit'],
  ['4401', '工程施工', 'cost', 'debit'],
  ['4403', '机械作业', 'cost', 'debit'],
  // 损益类
  ['5001', '主营业务收入', 'pl', 'credit'],
  ['5051', '其他业务收入', 'pl', 'credit'],
  ['5111', '投资收益', 'pl', 'credit'],
  ['5301', '营业外收入', 'pl', 'credit'],
  ['5401', '主营业务成本', 'pl', 'debit'],
  ['5402', '其他业务成本', 'pl', 'debit'],
  ['5403', '税金及附加', 'pl', 'debit'],
  ['5601', '销售费用', 'pl', 'debit'],
  ['5602', '管理费用', 'pl', 'debit'],
  ['560201', '办公费', 'pl', 'debit'],
  ['560202', '差旅费', 'pl', 'debit'],
  ['560203', '工资', 'pl', 'debit'],
  ['560204', '社会保险费', 'pl', 'debit'],
  ['560205', '折旧费', 'pl', 'debit'],
  ['560206', '业务招待费', 'pl', 'debit'],
  ['560207', '房租水电', 'pl', 'debit'],
  ['560208', '其他', 'pl', 'debit'],
  ['5603', '财务费用', 'pl', 'debit'],
  ['560301', '利息支出', 'pl', 'debit'],
  ['560302', '手续费', 'pl', 'debit'],
  ['5711', '营业外支出', 'pl', 'debit'],
  ['5801', '所得税费用', 'pl', 'debit']
]

export const CATEGORY_NAMES: Record<Category, string> = {
  asset: '资产',
  liability: '负债',
  equity: '权益',
  cost: '成本',
  pl: '损益'
}

/** 科目编码级次：4-2-2-2 */
export const CODE_LEVELS = [4, 2, 2, 2]

export function levelOfCode(code: string): number {
  let len = 0
  for (let i = 0; i < CODE_LEVELS.length; i++) {
    len += CODE_LEVELS[i]
    if (code.length === len) return i + 1
  }
  return 0
}

export function parentOfCode(code: string): string | null {
  const lv = levelOfCode(code)
  if (lv <= 1) return null
  let len = 0
  for (let i = 0; i < lv - 1; i++) len += CODE_LEVELS[i]
  return code.slice(0, len)
}
