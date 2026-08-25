import { NextResponse, type NextRequest } from 'next/server'
import { errorResponse } from '@/lib/api'
import { fetchPtax } from '@/lib/fx'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * PTAX de venda do dia pedido (ou do dia útil anterior mais próximo).
 *
 * Preenche o campo de câmbio do formulário, que continua editável: a PTAX do
 * próprio dia só sai no fim da tarde, então cadastrar uma compra de manhã traz
 * a do dia anterior — e às vezes você quer o câmbio efetivo da corretora, que
 * não é a PTAX.
 */
export async function GET(request: NextRequest) {
  try {
    const date = request.nextUrl.searchParams.get('date') ?? undefined
    return NextResponse.json(await fetchPtax(date))
  } catch (error) {
    return errorResponse(error)
  }
}
