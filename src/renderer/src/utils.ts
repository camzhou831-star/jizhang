import * as XLSX from 'xlsx'
import { ElMessage } from 'element-plus'
import { api } from './api'

export function fmt(n: number | null | undefined, zero = ''): string {
  if (n === null || n === undefined) return ''
  if (!n) return zero
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function curPeriod(): string {
  return todayStr().slice(0, 7)
}

export function periodRange(start: string, end: string): string[] {
  const out: string[] = []
  let [y, m] = start.split('-').map(Number)
  let guard = 0
  while (guard++ < 600) {
    const p = `${y}-${String(m).padStart(2, '0')}`
    if (p > end) break
    out.push(p)
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }
  return out
}

/** 大写金额 */
export function toChineseMoney(n: number): string {
  if (!n) return '零元整'
  const digits = '零壹贰叁肆伍陆柒捌玖'
  const units = ['', '拾', '佰', '仟']
  const bigUnits = ['', '万', '亿', '兆']
  const neg = n < 0
  n = Math.abs(round2(n))
  const int = Math.floor(n)
  const cents = Math.round((n - int) * 100)
  let s = ''
  let intStr = String(int)
  let sections: string[] = []
  while (intStr.length > 0) {
    sections.unshift(intStr.slice(-4))
    intStr = intStr.slice(0, -4)
  }
  sections.forEach((sec, si) => {
    let part = ''
    let zero = false
    for (let i = 0; i < sec.length; i++) {
      const d = Number(sec[i])
      const pos = sec.length - 1 - i
      if (d === 0) zero = true
      else {
        if (zero && part) part += '零'
        part += digits[d] + units[pos]
        zero = false
      }
    }
    if (part) s += part + bigUnits[sections.length - 1 - si]
    else if (s && si < sections.length - 1) s += ''
  })
  s = s ? s + '元' : ''
  if (cents === 0) s += '整'
  else {
    const j = Math.floor(cents / 10)
    const f = cents % 10
    if (j) s += digits[j] + '角'
    else if (s) s += '零'
    if (f) s += digits[f] + '分'
    else if (j) s += '整'
  }
  return (neg ? '负' : '') + s
}

export async function exportXlsx(filename: string, sheetName: string, rows: (string | number | null)[][]): Promise<void> {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31))
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const p = await api.app.saveFile(filename, new Uint8Array(out))
  if (p) ElMessage.success(`已导出：${p}`)
}

export function toast(e: unknown): void {
  ElMessage.error(e instanceof Error ? e.message : String(e))
}
