import { describe, expect, it } from 'vitest'
import type { CdiEntry } from './fixed-income'
import {
  annualize,
  cdiBenchmarkSeries,
  cdiFactor,
  contributionsBetween,
  netContributionBRL,
  performanceOverview,
  performanceWindow,
  subtractMonths,
  timeWeightedReturn,
  type HistoryPoint,
} from './performance'
import type { Trade } from './types'

function trade(overrides: Partial<Trade>): Trade {
  return {
    id: Math.random().toString(36),
    date: '2026-01-01',
    kind: 'buy',
    symbol: 'AAPL',
    quantity: 1,
    unitPrice: 100,
    currency: 'BRL',
    fees: 0,
    fxRate: 1,
    note: '',
    ...overrides,
  }
}

const cdi: CdiEntry[] = [
  { date: '2026-01-02', rateDaily: 0.01 },
  { date: '2026-01-05', rateDaily: 0.01 },
  { date: '2026-01-06', rateDaily: 0.01 },
]

describe('netContributionBRL', () => {
  it('compra entra, venda e provento saem, tudo em reais ao câmbio da operação', () => {
    expect(netContributionBRL(trade({ quantity: 2, unitPrice: 10, fees: 1 }))).toBe(21)
    expect(netContributionBRL(trade({ kind: 'sell', quantity: 2, unitPrice: 10, fees: 1 }))).toBe(-19)
    expect(netContributionBRL(trade({ kind: 'dividend', quantity: 1, unitPrice: 5 }))).toBe(-5)
    expect(netContributionBRL(trade({ currency: 'USD', unitPrice: 10, fxRate: 5 }))).toBe(50)
  })
})

describe('contributionsBetween', () => {
  it('conta o intervalo aberto à esquerda e fechado à direita', () => {
    const trades = [trade({ date: '2026-01-01' }), trade({ date: '2026-01-05' })]
    expect(contributionsBetween(trades, '2026-01-01', '2026-01-05')).toBe(100)
    expect(contributionsBetween(trades, null, '2026-01-05')).toBe(200)
  })
})

describe('cdiFactor', () => {
  it('o dia do aporte não rende', () => {
    expect(cdiFactor(cdi, '2026-01-02', '2026-01-06')).toBeCloseTo(1.01 ** 2, 10)
    expect(cdiFactor(cdi, '2026-01-01', '2026-01-06')).toBeCloseTo(1.01 ** 3, 10)
    expect(cdiFactor(cdi, '2026-01-06', '2026-01-06')).toBe(1)
  })
})

describe('subtractMonths', () => {
  it('segue o EDATE, prendendo o dia ao fim do mês', () => {
    expect(subtractMonths('2026-09-27', 12)).toBe('2025-09-27')
    expect(subtractMonths('2028-02-29', 12)).toBe('2027-02-28')
    expect(subtractMonths('2026-03-31', 1)).toBe('2026-02-28')
    expect(subtractMonths('2026-01-15', 1)).toBe('2025-12-15')
  })
})

describe('performanceWindow', () => {
  it('pega os 12 meses até o ÚLTIMO snapshot, inclusive a borda', () => {
    const history: HistoryPoint[] = [
      { date: '2025-01-01', totalBRL: 1 },
      { date: '2025-09-27', totalBRL: 2 },
      { date: '2026-09-27', totalBRL: 3 },
    ]
    expect(performanceWindow(history).map((p) => p.date)).toEqual(['2025-09-27', '2026-09-27'])
  })

  it('com menos de 12 meses, devolve o histórico inteiro', () => {
    const history: HistoryPoint[] = [
      { date: '2026-05-01', totalBRL: 1 },
      { date: '2026-06-01', totalBRL: 2 },
    ]
    expect(performanceWindow(history)).toHaveLength(2)
  })
})

describe('cdiBenchmarkSeries', () => {
  it('parte da carteira e rende cada aporte a partir da data dele', () => {
    const window: HistoryPoint[] = [
      { date: '2026-01-01', totalBRL: 1000 },
      { date: '2026-01-06', totalBRL: 1200 },
    ]
    const trades = [trade({ date: '2026-01-05', quantity: 1, unitPrice: 100 })]
    const series = cdiBenchmarkSeries(window, trades, cdi)
    expect(series[0]).toBe(1000)
    // 1000 rende três dias, os 100 do dia 5 rendem só o dia 6.
    expect(series[1]).toBeCloseTo(1000 * 1.01 ** 3 + 100 * 1.01, 8)
  })

  it('ignora aporte anterior à janela — ele já está no patrimônio inicial', () => {
    const window: HistoryPoint[] = [{ date: '2026-01-05', totalBRL: 500 }]
    const series = cdiBenchmarkSeries(window, [trade({ date: '2026-01-02' })], cdi)
    expect(series).toEqual([500])
  })
})

describe('timeWeightedReturn', () => {
  it('não confunde aporte com rendimento', () => {
    // 1000 → 1100 (+10%), aporte de 1000, 2100 → 2310 (+10%) = 21%.
    const points: HistoryPoint[] = [
      { date: '2026-01-01', totalBRL: 1000 },
      { date: '2026-02-01', totalBRL: 1100 },
      { date: '2026-03-01', totalBRL: 2310 },
    ]
    const trades = [
      trade({ date: '2026-01-01', quantity: 10 }),
      trade({ date: '2026-02-15', quantity: 10 }),
    ]
    expect(timeWeightedReturn(points, trades, false)).toBeCloseTo(0.21, 10)
    // Desde o primeiro aporte: 1000 aplicados viraram 1000 no primeiro snapshot.
    expect(timeWeightedReturn(points, trades, true)).toBeCloseTo(0.21, 10)
  })

  it('inclui o rendimento anterior ao primeiro snapshot quando pedido', () => {
    const points: HistoryPoint[] = [
      { date: '2026-01-31', totalBRL: 1050 },
      { date: '2026-02-28', totalBRL: 1102.5 },
    ]
    const trades = [trade({ date: '2026-01-10', quantity: 10 })]
    expect(timeWeightedReturn(points, trades, false)).toBeCloseTo(0.05, 10)
    expect(timeWeightedReturn(points, trades, true)).toBeCloseTo(1.05 ** 2 - 1, 10)
  })

  it('devolve null quando não há o que medir', () => {
    expect(timeWeightedReturn([], [], true)).toBeNull()
    expect(timeWeightedReturn([{ date: '2026-01-01', totalBRL: 0 }], [], true)).toBeNull()
  })
})

describe('annualize', () => {
  it('converte o retorno total em taxa anual composta', () => {
    expect(annualize(0.21, 730)).toBeCloseTo(0.1, 10)
  })

  it('não anualiza menos de um ano', () => {
    expect(annualize(0.05, 180)).toBeNull()
  })
})

describe('performanceOverview', () => {
  it('com menos de 12 meses, as duas linhas dão o mesmo número', () => {
    const history: HistoryPoint[] = [
      { date: '2026-01-31', totalBRL: 1050 },
      { date: '2026-02-28', totalBRL: 1102.5 },
    ]
    const overview = performanceOverview(history, [trade({ date: '2026-01-10', quantity: 10 })], cdi)!
    expect(overview.lastMonths.isFullHistory).toBe(true)
    expect(overview.lastMonths.portfolioReturn).toBe(overview.total.portfolioReturn)
    expect(overview.total.start).toBe('2026-01-10')
    expect(overview.total.cagr).toBeNull()
  })

  it('com mais de 12 meses, separa a janela do histórico total', () => {
    const history: HistoryPoint[] = [
      { date: '2024-01-01', totalBRL: 1000 },
      { date: '2025-01-01', totalBRL: 1100 },
      { date: '2026-01-01', totalBRL: 1210 },
    ]
    const overview = performanceOverview(history, [trade({ date: '2024-01-01', quantity: 10 })], [])!
    expect(overview.lastMonths.isFullHistory).toBe(false)
    expect(overview.lastMonths.start).toBe('2025-01-01')
    expect(overview.lastMonths.portfolioReturn).toBeCloseTo(0.1, 10)
    expect(overview.total.portfolioReturn).toBeCloseTo(0.21, 10)
    expect(overview.total.cagr).toBeCloseTo(0.1, 3)
  })

  it('sem histórico, não responde', () => {
    expect(performanceOverview([], [], cdi)).toBeNull()
  })
})
