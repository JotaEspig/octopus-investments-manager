import { NextResponse, type NextRequest } from 'next/server'
import { errorResponse } from '@/lib/api'
import { getSheetsContext } from '@/sheets/client'
import { deleteTrade } from '@/sheets/repositories'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Desfazer um lançamento errado.
 *
 * Não é como se registra uma venda — para isso existe o tipo `sell`. Isto
 * apaga a linha de quem digitou a quantidade errada, e por isso a interface só
 * oferece o botão nas operações recentes.
 */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const removed = await deleteTrade(getSheetsContext(), id)
    if (!removed) {
      return NextResponse.json({ error: `Operação ${id} não encontrada` }, { status: 404 })
    }
    return NextResponse.json({ removed: id })
  } catch (error) {
    return errorResponse(error)
  }
}
