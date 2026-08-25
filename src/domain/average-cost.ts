import { roundMoney, roundPrice, roundQuantity, safeDivide } from '@/lib/money'
import type { Trade } from './types'

/**
 * Preço médio e custo da posição, projetados a partir do livro-razão.
 *
 * REGRA (RFB, Instrução Normativa 1.585/2015 e o Perguntão do IR):
 *
 *   preço médio = Σ (quantidade × preço + taxas)  ←  SOMENTE COMPRAS
 *                 ────────────────────────────────
 *                        Σ quantidade              ←  SOMENTE COMPRAS
 *
 * Uma VENDA reduz a quantidade e **não** altera o preço médio. É o ponto que
 * mais se erra: quem "recalcula a média" depois de vender infla ou desinfla o
 * custo e depois apura ganho de capital errado.
 *
 *   compra 10 @ 100  →  PM 100,00 · posição 10
 *   vende   5        →  PM 100,00 · posição  5      (PM intocado)
 *   compra 10 @ 200  →  PM 150,00 · posição 15      ← média das COMPRAS, não da posição
 *
 * As taxas de corretagem entram no custo de aquisição na compra e reduzem o
 * valor recebido na venda — por isso `netValue` abaixo tem sinal diferente
 * conforme o tipo, espelhando a coluna "Valor líquido" da planilha.
 */

export interface CostBasis {
  /** Posição atual: compras menos vendas. */
  quantity: number
  /** Preço médio na moeda do ativo. */
  avgPriceNative: number
  /** Custo médio por unidade em BRL, ao câmbio de cada compra. */
  avgPriceBRL: number
  /** Custo da posição remanescente (quantidade × preço médio). */
  totalCostNative: number
  totalCostBRL: number
  /** Dividendos e juros já recebidos. */
  incomeNative: number
  incomeBRL: number
}

const EMPTY: CostBasis = {
  quantity: 0,
  avgPriceNative: 0,
  avgPriceBRL: 0,
  totalCostNative: 0,
  totalCostBRL: 0,
  incomeNative: 0,
  incomeBRL: 0,
}

/** Valor líquido da operação: taxas somam na compra, subtraem no resto. */
export function netValue(trade: Trade): number {
  const gross = trade.quantity * trade.unitPrice
  return trade.kind === 'buy' ? gross + trade.fees : gross - trade.fees
}

export function costBasis(trades: readonly Trade[]): CostBasis {
  let quantity = 0
  let boughtQuantity = 0
  let boughtCostNative = 0
  let boughtCostBRL = 0
  let incomeNative = 0
  let incomeBRL = 0

  for (const trade of trades) {
    const value = netValue(trade)
    const fxRate = trade.fxRate || 1

    switch (trade.kind) {
      case 'buy':
        quantity += trade.quantity
        boughtQuantity += trade.quantity
        boughtCostNative += value
        boughtCostBRL += value * fxRate
        break
      case 'sell':
        // Não mexe no preço médio — só reduz a posição.
        quantity -= trade.quantity
        break
      case 'dividend':
      case 'interest':
        incomeNative += value
        incomeBRL += value * fxRate
        break
    }
  }

  if (boughtQuantity === 0) {
    return { ...EMPTY, incomeNative: roundMoney(incomeNative), incomeBRL: roundMoney(incomeBRL) }
  }

  const avgPriceNative = safeDivide(boughtCostNative, boughtQuantity)
  const avgPriceBRL = safeDivide(boughtCostBRL, boughtQuantity)
  const position = roundQuantity(quantity)

  return {
    quantity: position,
    avgPriceNative: roundPrice(avgPriceNative),
    avgPriceBRL: roundPrice(avgPriceBRL),
    totalCostNative: roundMoney(position * avgPriceNative),
    totalCostBRL: roundMoney(position * avgPriceBRL),
    incomeNative: roundMoney(incomeNative),
    incomeBRL: roundMoney(incomeBRL),
  }
}

/** Agrupa o livro-razão por ativo, preservando a ordem cronológica dentro de cada grupo. */
export function groupBySymbol(trades: readonly Trade[]): Map<string, Trade[]> {
  const groups = new Map<string, Trade[]>()
  const ordered = [...trades].sort((a, b) => a.date.localeCompare(b.date))
  for (const trade of ordered) {
    const bucket = groups.get(trade.symbol)
    if (bucket) bucket.push(trade)
    else groups.set(trade.symbol, [trade])
  }
  return groups
}
