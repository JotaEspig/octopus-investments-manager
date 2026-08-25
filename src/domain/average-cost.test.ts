import { describe, expect, it } from 'vitest'
import { costBasis, groupBySymbol, netValue } from './average-cost'
import type { Trade, TradeKind } from './types'

function trade(
  kind: TradeKind,
  quantity: number,
  unitPrice: number,
  overrides: Partial<Trade> = {},
): Trade {
  return {
    id: `${kind}-${quantity}-${unitPrice}-${overrides.date ?? ''}`,
    date: '2026-01-01',
    kind,
    symbol: 'AAPL',
    quantity,
    unitPrice,
    currency: 'USD',
    fees: 0,
    fxRate: 1,
    note: '',
    ...overrides,
  }
}

describe('netValue', () => {
  it('soma as taxas na compra e subtrai na venda', () => {
    expect(netValue(trade('buy', 10, 100, { fees: 5 }))).toBe(1005)
    expect(netValue(trade('sell', 10, 100, { fees: 5 }))).toBe(995)
    expect(netValue(trade('dividend', 10, 0.5, { fees: 0 }))).toBe(5)
  })
})

describe('costBasis', () => {
  it('devolve zeros quando não há operação', () => {
    expect(costBasis([]).quantity).toBe(0)
    expect(costBasis([]).avgPriceNative).toBe(0)
  })

  it('calcula a média ponderada de duas compras', () => {
    const basis = costBasis([trade('buy', 10, 100), trade('buy', 10, 200)])
    expect(basis.quantity).toBe(20)
    expect(basis.avgPriceNative).toBe(150)
    expect(basis.totalCostNative).toBe(3000)
  })

  it('NÃO altera o preço médio na venda — só reduz a posição', () => {
    // O caso que mais se erra: quem recalcula a média depois de vender
    // apura ganho de capital errado.
    const basis = costBasis([
      trade('buy', 10, 100, { date: '2026-01-01' }),
      trade('sell', 5, 180, { date: '2026-02-01' }),
      trade('buy', 10, 200, { date: '2026-03-01' }),
    ])
    expect(basis.quantity).toBe(15)
    // Média das COMPRAS: (10×100 + 10×200) / 20 = 150 — a venda não entra.
    expect(basis.avgPriceNative).toBe(150)
    expect(basis.totalCostNative).toBe(2250)
  })

  it('mantém o preço médio quando a posição é zerada e recomprada', () => {
    const basis = costBasis([
      trade('buy', 10, 100),
      trade('sell', 10, 300),
      trade('buy', 10, 400),
    ])
    expect(basis.quantity).toBe(10)
    expect(basis.avgPriceNative).toBe(250)
  })

  it('inclui as taxas no custo de aquisição', () => {
    const basis = costBasis([trade('buy', 10, 100, { fees: 20 })])
    // (10×100 + 20) / 10 = 102,00
    expect(basis.avgPriceNative).toBe(102)
    expect(basis.totalCostNative).toBe(1020)
  })

  it('guarda o custo em BRL ao câmbio de cada compra, não ao de hoje', () => {
    const basis = costBasis([
      trade('buy', 10, 100, { fxRate: 5 }),
      trade('buy', 10, 100, { fxRate: 6 }),
    ])
    expect(basis.avgPriceNative).toBe(100)
    // (1000×5 + 1000×6) / 20 = 550 por unidade
    expect(basis.avgPriceBRL).toBe(550)
    expect(basis.totalCostBRL).toBe(11000)
  })

  it('acumula proventos sem mexer em posição nem preço médio', () => {
    const basis = costBasis([
      trade('buy', 100, 10),
      trade('dividend', 100, 0.24, { fxRate: 5 }),
      trade('dividend', 100, 0.26, { fxRate: 5 }),
    ])
    expect(basis.quantity).toBe(100)
    expect(basis.avgPriceNative).toBe(10)
    expect(basis.incomeNative).toBe(50)
    expect(basis.incomeBRL).toBe(250)
  })

  it('aceita posição zerada sem quebrar', () => {
    const basis = costBasis([trade('buy', 10, 100), trade('sell', 10, 150)])
    expect(basis.quantity).toBe(0)
    expect(basis.avgPriceNative).toBe(100)
    expect(basis.totalCostNative).toBe(0)
  })

  it('lida com fração de ação', () => {
    const basis = costBasis([trade('buy', 0.5, 231.4), trade('buy', 1.25, 240)])
    expect(basis.quantity).toBe(1.75)
    // (0.5×231,40 + 1,25×240) / 1,75 = 415,70 / 1,75
    expect(basis.avgPriceNative).toBeCloseTo(237.542857, 6)
    expect(basis.totalCostNative).toBe(415.7)
  })
})

describe('groupBySymbol', () => {
  it('separa por ativo e ordena por data dentro do grupo', () => {
    const groups = groupBySymbol([
      trade('buy', 1, 10, { symbol: 'MSFT', date: '2026-03-01' }),
      trade('buy', 1, 10, { symbol: 'AAPL', date: '2026-02-01' }),
      trade('buy', 1, 10, { symbol: 'MSFT', date: '2026-01-01' }),
    ])
    expect([...groups.keys()].sort()).toEqual(['AAPL', 'MSFT'])
    expect(groups.get('MSFT')!.map((t) => t.date)).toEqual(['2026-01-01', '2026-03-01'])
  })
})
