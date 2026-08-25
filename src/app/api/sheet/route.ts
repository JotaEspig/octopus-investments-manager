import { NextResponse } from 'next/server'
import { bootstrapSpreadsheet } from '@/sheets/bootstrap'
import { getSheetsContext } from '@/sheets/client'
import { diagnose } from '@/sheets/diagnose'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Estado do setup: o que já está pronto e o que falta. */
export async function GET() {
  try {
    return NextResponse.json(await diagnose())
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}

/** Instala/atualiza a estrutura da planilha. Idempotente — pode rodar de novo. */
export async function POST() {
  try {
    return NextResponse.json(await bootstrapSpreadsheet(getSheetsContext()))
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
