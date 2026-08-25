import { NextResponse } from 'next/server'
import { summarizePerformance } from '@/domain/returns'
import { errorResponse } from '@/lib/api'
import { today } from '@/lib/dates'
import { loadPortfolio } from '@/sheets/portfolio'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Rentabilidade da carteira: aportado, valor atual, ganho, retorno simples e
 * XIRR.
 *
 * O retorno simples vai junto de propósito — a distância entre ele e o XIRR é a
 * informação: quanto maior, mais o desempenho estava sendo subestimado por
 * ignorar que boa parte do dinheiro entrou há pouco tempo.
 */
export async function GET() {
  try {
    const { data, summary } = await loadPortfolio()
    const performance = summarizePerformance(data.trades, summary.totalBRL, today())
    return NextResponse.json({ performance, summary })
  } catch (error) {
    return errorResponse(error)
  }
}
