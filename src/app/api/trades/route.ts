import { NextResponse, type NextRequest } from 'next/server'
import { errorResponse } from '@/lib/api'
import { createTradeSchema } from '@/lib/schemas'
import { getSheetsContext } from '@/sheets/client'
import { appendAsset, appendContract, appendTrade, readPortfolioData } from '@/sheets/repositories'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 15

/** Extrato, mais recente primeiro. É o que a tela mostra abaixo do formulário. */
export async function GET(request: NextRequest) {
  try {
    const limit = Number(request.nextUrl.searchParams.get('limit') ?? DEFAULT_LIMIT)
    const data = await readPortfolioData(getSheetsContext())

    const trades = [...data.trades]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_LIMIT)

    return NextResponse.json({ trades, total: data.trades.length })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * Registra uma operação.
 *
 * Um ativo ou contrato ainda não cadastrado pode vir no mesmo corpo: comprar
 * algo novo é o caminho normal e não deveria exigir dois passos. O ativo é
 * criado primeiro para que a operação nunca fique órfã se a segunda escrita
 * falhar — o inverso deixaria uma operação apontando para nada.
 */
export async function POST(request: NextRequest) {
  try {
    const body = createTradeSchema.parse(await request.json())
    const context = getSheetsContext()

    if (body.newAsset) await appendAsset(context, body.newAsset)
    if (body.newContract) await appendContract(context, body.newContract)

    const trade = await appendTrade(context, body.trade)
    return NextResponse.json({ trade }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
