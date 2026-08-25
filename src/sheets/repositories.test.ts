import { describe, expect, it } from 'vitest'
import { createTradeSchema } from '@/lib/schemas'
import { escapeSheetsFormula, formula, quoteFormula } from './repositories'

/**
 * Injeção de fórmula na ESCRITA é mais grave que no CSV.
 *
 * O CSV é um arquivo derivado; a planilha é a fonte de verdade. Uma anotação
 * que vira fórmula ali não estraga uma exportação — estraga o livro-razão, e
 * a leitura seguinte devolve o resultado da conta em vez do que foi escrito.
 *
 * Comportamento medido na planilha real, gravando com USER_ENTERED:
 *   `=1+1`  vira fórmula → lê de volta `2`
 *   `'=1+1` vira texto   → lê de volta `=1+1`
 */
describe('escapeSheetsFormula', () => {
  it('neutraliza os gatilhos do Sheets', () => {
    expect(escapeSheetsFormula('=1+1')).toBe("'=1+1")
    expect(escapeSheetsFormula('=HYPERLINK("http://x";"clique")')).toBe(
      '\'=HYPERLINK("http://x";"clique")',
    )
    expect(escapeSheetsFormula('=IMPORTRANGE("id";"A1")')).toBe('\'=IMPORTRANGE("id";"A1")')
    expect(escapeSheetsFormula('+1')).toBe("'+1")
  })

  it('não escapa o que o Sheets não interpreta', () => {
    // Menos agressivo que no CSV de propósito: medido na planilha, `@` não é
    // gatilho e `-` só coage número. Escapar a mais poluiria anotação legítima.
    expect(escapeSheetsFormula('-- ajuste manual')).toBe('-- ajuste manual')
    expect(escapeSheetsFormula('@corretora')).toBe('@corretora')
  })

  it('deixa número e texto comum intactos', () => {
    expect(escapeSheetsFormula(1283.4)).toBe(1283.4)
    expect(escapeSheetsFormula(-500)).toBe(-500)
    expect(escapeSheetsFormula('Inicialização da carteira')).toBe('Inicialização da carteira')
    expect(escapeSheetsFormula('25/08/2026')).toBe('25/08/2026')
    expect(escapeSheetsFormula('')).toBe('')
  })

  it('preserva o texto — a defesa não pode custar o dado', () => {
    // O apóstrofo é marcador de formatação do Sheets, não conteúdo: a leitura
    // devolve a string original. É o que torna neutralizar melhor que bloquear.
    const original = '=1+1'
    expect(String(escapeSheetsFormula(original)).slice(1)).toBe(original)
  })
})

describe('formula()', () => {
  it('marca a fórmula intencional, que não pode ser neutralizada', () => {
    // Se a cotação fosse escapada, `Cotações` guardaria o texto da fórmula em
    // vez do preço, e a carteira inteira zeraria.
    const marked = formula(quoteFormula('AAPL', 'us_stock'))
    expect(marked.text).toBe('=GOOGLEFINANCE("AAPL";"price")')
  })

  it('prefixa BVMF só nos ativos brasileiros', () => {
    expect(quoteFormula('PETR4', 'br_stock')).toContain('BVMF:PETR4')
    expect(quoteFormula('HGLG11', 'br_fii')).toContain('BVMF:HGLG11')
    expect(quoteFormula('VOO', 'us_etf')).not.toContain('BVMF')
  })
})

/**
 * O ticker é o único campo com forma conhecida, e vira critério de busca nas
 * fórmulas da planilha — por isso aqui a lista de permitidos é a defesa certa.
 */
describe('validação do ticker', () => {
  const body = (symbol: string) => ({
    trade: {
      date: '2026-08-25',
      kind: 'buy' as const,
      symbol,
      quantity: 1,
      unitPrice: 10,
      currency: 'BRL' as const,
      fees: 0,
      fxRate: 1,
      note: '',
    },
  })

  it('aceita os formatos reais', () => {
    for (const ticker of ['AAPL', 'PETR4', 'BRK.B', 'RF-CDB-BANCO-XP-2028', 'HGLG11']) {
      expect(createTradeSchema.safeParse(body(ticker)).success, ticker).toBe(true)
    }
  })

  it('recusa fórmula no ticker', () => {
    for (const lixo of ['=1+1', '=GOOGLEFINANCE("x")', '+AAPL', 'AAPL;DROP', 'AA PL', "AAPL'"]) {
      expect(createTradeSchema.safeParse(body(lixo)).success, lixo).toBe(false)
    }
  })

  it('normaliza para maiúsculas', () => {
    const parsed = createTradeSchema.parse(body('petr4'))
    expect(parsed.trade.symbol).toBe('PETR4')
  })

  it('deixa a observação livre — lá a defesa é neutralizar, não bloquear', () => {
    const comFormula = { ...body('PETR4') }
    comFormula.trade.note = '=1+1 conferir com a corretora'
    expect(createTradeSchema.safeParse(comFormula).success).toBe(true)
  })
})
