import { describe, expect, it } from 'vitest'
import { portfolioCashFlows, summarizePerformance, xirr } from './returns'
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

describe('xirr', () => {
  it('recupera uma taxa conhecida num fluxo simples', () => {
    // R$ 1.000 viram R$ 1.100 em um ano → 10% a.a.
    const rate = xirr([
      { date: '2026-01-01', amount: -1000 },
      { date: '2027-01-01', amount: 1100 },
    ])
    expect(rate).toBeCloseTo(0.1, 4)
  })

  it('anualiza corretamente um período menor que um ano', () => {
    // +10% em meio ano equivale a ~21% a.a. (1,1² − 1).
    const rate = xirr([
      { date: '2026-01-01', amount: -1000 },
      { date: '2026-07-02', amount: 1100 },
    ])
    expect(rate).toBeCloseTo(1.1 ** 2 - 1, 2)
  })

  it('bate com o caso clássico da documentação do Excel', () => {
    const rate = xirr([
      { date: '2008-01-01', amount: -10000 },
      { date: '2008-03-01', amount: 2750 },
      { date: '2008-10-30', amount: 4250 },
      { date: '2009-02-15', amount: 3250 },
      { date: '2009-04-01', amount: 2750 },
    ])
    expect(rate).toBeCloseTo(0.3733, 3)
  })

  it('mostra por que o retorno simples engana com aportes mensais', () => {
    // Doze aportes de R$ 1.000 ao longo do ano, valendo R$ 12.780 no fim.
    const flows = Array.from({ length: 12 }, (_, month) => ({
      date: `2026-${String(month + 1).padStart(2, '0')}-01`,
      amount: -1000,
    }))
    flows.push({ date: '2026-12-31', amount: 12780 })

    const rate = xirr(flows)!
    const simple = 12780 / 12000 - 1 // 6,5%

    // O dinheiro ficou investido, em média, meio ano — a taxa ANUAL é bem maior.
    expect(simple).toBeCloseTo(0.065, 3)
    expect(rate).toBeGreaterThan(simple * 1.8)
  })

  it('lida com prejuízo', () => {
    const rate = xirr([
      { date: '2026-01-01', amount: -1000 },
      { date: '2027-01-01', amount: 800 },
    ])
    expect(rate).toBeCloseTo(-0.2, 4)
  })

  it('converge com aportes e resgates alternados', () => {
    // Múltiplas trocas de sinal: é onde Newton diverge e a bisseção salva.
    const rate = xirr([
      { date: '2026-01-01', amount: -5000 },
      { date: '2026-04-01', amount: 2000 },
      { date: '2026-07-01', amount: -3000 },
      { date: '2026-10-01', amount: 1500 },
      { date: '2027-01-01', amount: 5200 },
    ])
    expect(rate).not.toBeNull()
    expect(Number.isFinite(rate!)).toBe(true)
  })

  it('devolve null em vez de inventar número quando não há resposta', () => {
    expect(xirr([])).toBeNull()
    expect(xirr([{ date: '2026-01-01', amount: -1000 }])).toBeNull()
    // Só saídas: nunca zera.
    expect(
      xirr([
        { date: '2026-01-01', amount: -1000 },
        { date: '2027-01-01', amount: -1000 },
      ]),
    ).toBeNull()
  })
})

describe('portfolioCashFlows', () => {
  it('inverte o sinal da compra e converte pelo câmbio da operação', () => {
    const flows = portfolioCashFlows(
      [trade({ kind: 'buy', quantity: 10, unitPrice: 100, currency: 'USD', fxRate: 5 })],
      0,
      '2026-12-31',
    )
    expect(flows).toEqual([{ date: '2026-01-01', amount: -5000 }])
  })

  it('acrescenta o valor de mercado como resgate hipotético de hoje', () => {
    const flows = portfolioCashFlows([trade({})], 1500, '2026-12-31')
    expect(flows.at(-1)).toEqual({ date: '2026-12-31', amount: 1500 })
  })

  it('não acrescenta nada quando a posição está zerada', () => {
    const flows = portfolioCashFlows([trade({})], 0, '2026-12-31')
    expect(flows).toHaveLength(1)
  })
})

describe('summarizePerformance', () => {
  it('separa aportado, valor atual e ganho', () => {
    const summary = summarizePerformance(
      [
        trade({ date: '2026-01-01', quantity: 10, unitPrice: 100 }),
        trade({ date: '2026-06-01', kind: 'dividend', quantity: 10, unitPrice: 2 }),
      ],
      1200,
      '2027-01-01',
    )
    // Aportou 1000, recebeu 20 de dividendo → investido líquido 980.
    expect(summary.investedBRL).toBe(980)
    expect(summary.currentValueBRL).toBe(1200)
    expect(summary.gainBRL).toBe(220)
    expect(summary.annualizedReturn).not.toBeNull()
    expect(summary.firstTradeDate).toBe('2026-01-01')
  })

  it('não quebra numa carteira vazia', () => {
    const summary = summarizePerformance([], 0, '2026-01-01')
    expect(summary.investedBRL).toBe(0)
    expect(summary.simpleReturn).toBe(0)
    expect(summary.annualizedReturn).toBeNull()
    expect(summary.firstTradeDate).toBeNull()
  })
})
