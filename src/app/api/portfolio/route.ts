import { NextResponse, type NextRequest } from 'next/server'
import { ASSET_CLASSES, type AssetClass } from '@/domain/types'
import { errorResponse } from '@/lib/api'
import { loadPortfolio } from '@/sheets/portfolio'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Carteira consolidada. `?class=us_etf` filtra por classe.
 *
 * O servidor MCP não passa por aqui — ele importa `loadPortfolio` direto, para
 * responder ao agente mesmo com o `next dev` desligado. Esta rota existe para
 * a interface e para depurar à mão com curl.
 */
export async function GET(request: NextRequest) {
  try {
    const requested = request.nextUrl.searchParams.get('class')
    if (requested && !ASSET_CLASSES.includes(requested as AssetClass)) {
      return NextResponse.json(
        { error: `Classe inválida: ${requested}. Use uma de ${ASSET_CLASSES.join(', ')}.` },
        { status: 400 },
      )
    }

    const { positions, summary } = await loadPortfolio()
    const filtered = requested
      ? positions.filter((position) => position.assetClass === requested)
      : positions

    return NextResponse.json({ summary, positions: filtered })
  } catch (error) {
    return errorResponse(error)
  }
}
