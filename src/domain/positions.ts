import { roundMoney, safeDivide } from '@/lib/money'
import { costBasis, groupBySymbol } from './average-cost'
import {
  ASSET_CLASSES,
  ASSET_CLASS_LABELS,
  type Asset,
  type AssetClass,
  type FixedIncomeContract,
  type PortfolioSummary,
  type Position,
  type Trade,
} from './types'

/**
 * Projeta o livro-razão em posições consolidadas.
 *
 * Este módulo é a AUTORIDADE sobre os números: as abas de apresentação da
 * planilha calculam o mesmo por fórmula, para funcionarem sem o app rodando, e
 * `npm run verify:sheet` confere se as duas contas batem. Divergiu, o certo é
 * aqui.
 *
 * MODELAGEM DA RENDA FIXA — não tem cotação nem "quantidade" natural, então a
 * operação guarda `quantity` = reais aplicados e `unitPrice` = 1. Aplicar
 * R$ 1.000 num CDB é `quantity: 1000, unitPrice: 1`; um resgate parcial de
 * R$ 300 é uma venda de 300. Assim o mesmo cálculo de custo médio serve para as
 * duas naturezas, e `Aplicado (R$)` na planilha bate com `totalCostBRL` aqui.
 */

export interface PortfolioInput {
  assets: readonly Asset[]
  trades: readonly Trade[]
  /** Cotação atual por ticker, na moeda do ativo. */
  quotes: ReadonlyMap<string, number>
  /** Câmbio USD/BRL de hoje — converte o valor de MERCADO, não o custo. */
  fxRate: number
  contracts: readonly FixedIncomeContract[]
  /** Metas de alocação lidas de `Config`, como fração. */
  targets: ReadonlyMap<AssetClass, number>
}

export function buildPositions(input: PortfolioInput): Position[] {
  const byName = new Map(input.assets.map((asset) => [asset.symbol, asset]))
  const contractsBySymbol = new Map(input.contracts.map((contract) => [contract.symbol, contract]))
  const grouped = groupBySymbol(input.trades)

  const positions: Position[] = []

  for (const [symbol, trades] of grouped) {
    const asset = byName.get(symbol)
    const contract = contractsBySymbol.get(symbol)
    if (!asset && !contract) continue

    const assetClass: AssetClass = asset?.assetClass ?? 'fixed_income'
    const basis = costBasis(trades)

    // Renda fixa não tem cotação: o valor atual é a marcação na curva que o
    // Apps Script grava no contrato.
    const isFixedIncome = assetClass === 'fixed_income'
    const currency = isFixedIncome ? 'BRL' : (asset?.currency ?? 'BRL')
    const currentFxRate = currency === 'USD' ? input.fxRate : 1

    const currentPrice = isFixedIncome
      ? safeDivide(contract?.marketValue ?? 0, basis.quantity)
      : (input.quotes.get(symbol) ?? 0)

    const marketValueNative = isFixedIncome
      ? (contract?.marketValue ?? 0)
      : basis.quantity * currentPrice
    const marketValueBRL = marketValueNative * currentFxRate

    const returnNativeAbsolute = marketValueNative - basis.totalCostNative + basis.incomeNative
    const returnBRLAbsolute = marketValueBRL - basis.totalCostBRL + basis.incomeBRL

    positions.push({
      symbol,
      name: asset?.name ?? contract?.name ?? symbol,
      assetClass,
      currency,
      quantity: basis.quantity,
      avgPriceNative: basis.avgPriceNative,
      avgPriceBRL: basis.avgPriceBRL,
      totalCostNative: basis.totalCostNative,
      totalCostBRL: basis.totalCostBRL,
      currentPrice,
      currentFxRate,
      marketValueNative: roundMoney(marketValueNative),
      marketValueBRL: roundMoney(marketValueBRL),
      incomeNative: basis.incomeNative,
      incomeBRL: basis.incomeBRL,
      returnNative: {
        absolute: roundMoney(returnNativeAbsolute),
        percent: safeDivide(returnNativeAbsolute, basis.totalCostNative),
      },
      returnBRL: {
        absolute: roundMoney(returnBRLAbsolute),
        percent: safeDivide(returnBRLAbsolute, basis.totalCostBRL),
      },
    })
  }

  // Maior posição primeiro: é a ordem em que se olha uma carteira.
  return positions.sort((a, b) => b.marketValueBRL - a.marketValueBRL)
}

export function buildSummary(
  positions: readonly Position[],
  targets: ReadonlyMap<AssetClass, number>,
  updatedAt: string,
): PortfolioSummary {
  const totals = new Map<AssetClass, number>()
  for (const position of positions) {
    totals.set(position.assetClass, (totals.get(position.assetClass) ?? 0) + position.marketValueBRL)
  }

  const totalBRL = roundMoney([...totals.values()].reduce((sum, value) => sum + value, 0))

  return {
    totalBRL,
    byClass: ASSET_CLASSES.map((assetClass) => {
      const valueBRL = roundMoney(totals.get(assetClass) ?? 0)
      const share = safeDivide(valueBRL, totalBRL)
      const target = targets.get(assetClass) ?? null
      return {
        assetClass,
        label: ASSET_CLASS_LABELS[assetClass],
        valueBRL,
        share,
        target,
        drift: target === null ? null : share - target,
      }
    }),
    positionCount: positions.filter((position) => position.quantity > 0).length,
    updatedAt,
  }
}
