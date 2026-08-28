import { buildPositions, buildSummary } from '@/domain/positions'
import type { PortfolioSummary, Position } from '@/domain/types'
import { getSheetsContext, type SheetsContext } from './client'
import { readPortfolioData, type PortfolioData } from './repositories'

/**
 * Ponto único onde a planilha vira carteira.
 *
 * A rota `/api/portfolio` e o servidor MCP chamam esta função em vez de cada
 * um montar a sua — assim o agente e a interface nunca respondem números
 * diferentes para a mesma pergunta.
 */

export interface Portfolio {
  positions: Position[]
  summary: PortfolioSummary
  data: PortfolioData
}

export async function loadPortfolio(
  context: SheetsContext = getSheetsContext(),
): Promise<Portfolio> {
  const data = await readPortfolioData(context)

  const positions = buildPositions({
    assets: data.assets,
    trades: data.trades,
    quotes: data.quotes,
    fxRate: data.fxRate,
    contracts: data.contracts,
    targets: data.targets,
    objectiveTargets: data.objectiveTargets,
  })

  return {
    positions,
    summary: buildSummary(positions, data.targets, new Date().toISOString(), data.objectiveTargets),
    data,
  }
}
