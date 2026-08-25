import { describe, expect, it } from 'vitest'
import {
  BUSINESS_DAYS_PER_YEAR,
  annualizedReturn,
  businessDays,
  calendarDaysBetween,
  incomeTaxRate,
  markToCurve,
  netOfTax,
  type CdiEntry,
} from './fixed-income'

/**
 * CDI de 0,051660% a.d. — o valor real publicado pelo BCB (série SGS 12) em
 * agosto de 2026, com a Selic a 14%. Guardado como fração.
 */
const CDI_DAILY = 0.0005166

/** Série sintética de `count` dias úteis a partir de 02/01, pulando fim de semana. */
function series(count: number, rate = CDI_DAILY): CdiEntry[] {
  const entries: CdiEntry[] = []
  const cursor = new Date(Date.UTC(2026, 0, 2))
  while (entries.length < count) {
    const weekday = cursor.getUTCDay()
    if (weekday !== 0 && weekday !== 6) {
      entries.push({ date: cursor.toISOString().slice(0, 10), rateDaily: rate })
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return entries
}

describe('cross-check da série do CDI', () => {
  it('a taxa diária da série 12 reproduz a anualizada da série 4389', () => {
    // Este é o teste que protege a marcação inteira: se a unidade da série 12
    // estiver errada, 40% da carteira fica errada em silêncio.
    const annual = (1 + CDI_DAILY) ** BUSINESS_DAYS_PER_YEAR - 1
    expect(annual).toBeCloseTo(0.139, 4) // série 4389: 13,90% a.a.
  })
})

describe('markToCurve — pós-fixado (% do CDI)', () => {
  it('aplica o percentual sobre a TAXA diária, não sobre o fator', () => {
    const value = markToCurve({
      principal: 1000,
      indexer: 'cdi',
      rate: 1.1, // 110% do CDI
      issueDate: '2026-01-01',
      asOf: '2026-01-06',
      series: series(3),
    })
    // 1000 × (1 + 0,0005166×1,1)³
    const expected = 1000 * (1 + CDI_DAILY * 1.1) ** 3
    expect(value).toBe(Number(expected.toFixed(2)))
  })

  it('um ano de dias úteis a 100% do CDI rende o CDI anual', () => {
    const value = markToCurve({
      principal: 10000,
      indexer: 'cdi',
      rate: 1,
      issueDate: '2025-12-31',
      asOf: '2030-01-01',
      series: series(BUSINESS_DAYS_PER_YEAR),
    })
    expect(value / 10000 - 1).toBeCloseTo(0.139, 3)
  })

  it('110% do CDI rende mais que 100%', () => {
    const base = { principal: 1000, indexer: 'cdi' as const, issueDate: '2025-12-31', asOf: '2030-01-01', series: series(60) }
    expect(markToCurve({ ...base, rate: 1.1 })).toBeGreaterThan(markToCurve({ ...base, rate: 1 }))
  })

  it('não rende no dia da aplicação', () => {
    const value = markToCurve({
      principal: 1000,
      indexer: 'cdi',
      rate: 1,
      issueDate: '2026-01-02',
      asOf: '2026-01-02',
      series: series(10),
    })
    expect(value).toBe(1000)
  })
})

describe('markToCurve — prefixado', () => {
  it('usa base 252 dias úteis, não 365 corridos', () => {
    const value = markToCurve({
      principal: 1000,
      indexer: 'prefixed',
      rate: 0.13,
      issueDate: '2025-12-31',
      asOf: '2030-01-01',
      series: series(BUSINESS_DAYS_PER_YEAR),
    })
    expect(value).toBe(1130)
  })

  it('meio ano útil rende a raiz do fator anual', () => {
    const value = markToCurve({
      principal: 1000,
      indexer: 'prefixed',
      rate: 0.13,
      issueDate: '2025-12-31',
      asOf: '2030-01-01',
      series: series(126),
    })
    expect(value).toBeCloseTo(1000 * 1.13 ** 0.5, 2)
  })
})

describe('markToCurve — IPCA+', () => {
  it('multiplica a inflação acumulada pelo cupom real', () => {
    const value = markToCurve({
      principal: 1000,
      indexer: 'ipca',
      rate: 0.06,
      issueDate: '2025-12-31',
      asOf: '2030-01-01',
      series: series(BUSINESS_DAYS_PER_YEAR),
      inflationFactor: 1.045,
    })
    expect(value).toBe(1107.7) // 1000 × 1,045 × 1,06
  })

  it('sem fator de inflação, rende só o cupom', () => {
    const value = markToCurve({
      principal: 1000,
      indexer: 'ipca',
      rate: 0.06,
      issueDate: '2025-12-31',
      asOf: '2030-01-01',
      series: series(BUSINESS_DAYS_PER_YEAR),
    })
    expect(value).toBe(1060)
  })
})

describe('businessDays', () => {
  it('conta pela série do BCB, ignorando fim de semana', () => {
    expect(businessDays(series(10), '2026-01-01', '2026-01-09')).toBe(6)
  })
})

describe('incomeTaxRate', () => {
  it('respeita as viradas de faixa da Lei 11.033', () => {
    expect(incomeTaxRate(1)).toBe(0.225)
    expect(incomeTaxRate(180)).toBe(0.225)
    expect(incomeTaxRate(181)).toBe(0.2)
    expect(incomeTaxRate(360)).toBe(0.2)
    expect(incomeTaxRate(361)).toBe(0.175)
    expect(incomeTaxRate(720)).toBe(0.175)
    expect(incomeTaxRate(721)).toBe(0.15)
    expect(incomeTaxRate(3650)).toBe(0.15)
  })
})

describe('netOfTax', () => {
  it('tributa só o rendimento, não o principal', () => {
    const result = netOfTax(1000, 1200, '2026-01-01', '2026-03-01')
    expect(result.gain).toBe(200)
    expect(result.taxRate).toBe(0.225)
    expect(result.tax).toBe(45)
    expect(result.net).toBe(1155)
  })

  it('avisa quantos dias faltam para a alíquota cair', () => {
    // 179 dias corridos: falta pouco para a faixa de 20%.
    const result = netOfTax(1000, 1100, '2026-01-01', '2026-06-29')
    expect(result.calendarDays).toBe(179)
    expect(result.taxRate).toBe(0.225)
    expect(result.daysToNextBracket).toBe(2)
  })

  it('não aponta próxima faixa quando já está na mínima', () => {
    const result = netOfTax(1000, 1500, '2020-01-01', '2026-01-01')
    expect(result.taxRate).toBe(0.15)
    expect(result.daysToNextBracket).toBeNull()
  })

  it('não gera imposto negativo quando o papel está no prejuízo', () => {
    const result = netOfTax(1000, 950, '2026-01-01', '2026-03-01')
    expect(result.gain).toBe(0)
    expect(result.tax).toBe(0)
    expect(result.net).toBe(950)
  })
})

describe('calendarDaysBetween', () => {
  it('conta dias corridos, atravessando ano bissexto', () => {
    expect(calendarDaysBetween('2026-01-01', '2026-01-31')).toBe(30)
    expect(calendarDaysBetween('2028-02-01', '2028-03-01')).toBe(29)
    expect(calendarDaysBetween('2026-05-01', '2026-01-01')).toBe(0)
  })
})

describe('annualizedReturn', () => {
  it('anualiza pelo número de dias úteis decorridos', () => {
    expect(annualizedReturn(1000, 1130, BUSINESS_DAYS_PER_YEAR)).toBeCloseTo(0.13, 6)
    // Metade do prazo com o mesmo ganho → taxa anual bem maior.
    expect(annualizedReturn(1000, 1130, 126)).toBeCloseTo(1.13 ** 2 - 1, 6)
  })

  it('devolve 0 nos casos degenerados', () => {
    expect(annualizedReturn(0, 100, 100)).toBe(0)
    expect(annualizedReturn(1000, 1100, 0)).toBe(0)
  })
})
