import { NextResponse, type NextRequest } from 'next/server'
import { errorResponse } from '@/lib/api'
import { today } from '@/lib/dates'
import { getSheetsContext } from '@/sheets/client'
import { buildExport, listExportableSheets, safeFilename, toCsv } from '@/sheets/export'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Exportação da planilha.
 *
 *   GET /api/export                      → JSON completo (tudo)
 *   GET /api/export?format=csv&sheet=X   → uma aba em CSV
 *   GET /api/export?format=list          → nomes das abas, para o seletor
 *
 * JSON é o formato completo: todas as abas, a carteira calculada, checksum e
 * avisos. CSV é por aba porque um CSV não comporta várias tabelas sem virar
 * um formato inventado — quem quer abrir no Excel quer uma aba de cada vez.
 */
export async function GET(request: NextRequest) {
  try {
    const format = request.nextUrl.searchParams.get('format') ?? 'json'
    const requested = request.nextUrl.searchParams.get('sheet')
    const context = getSheetsContext()

    // Só metadados: o seletor da interface não precisa pagar o dump inteiro.
    if (format === 'list') {
      return NextResponse.json({ sheets: await listExportableSheets(context) })
    }

    if (format !== 'json' && format !== 'csv') {
      return NextResponse.json(
        { error: `Formato "${format}" não existe. Use json, csv ou list.` },
        { status: 400 },
      )
    }

    const snapshot = await buildExport(context)
    const stamp = today()

    if (format === 'csv') {
      if (!requested) {
        return NextResponse.json(
          {
            error: 'Informe qual aba exportar em CSV.',
            available: snapshot.sheets.map((sheet) => sheet.title),
          },
          { status: 400 },
        )
      }

      const sheet = snapshot.sheets.find((candidate) => candidate.title === requested)
      if (!sheet) {
        return NextResponse.json(
          { error: `Aba "${requested}" não existe.`, available: snapshot.sheets.map((s) => s.title) },
          { status: 404 },
        )
      }
      if (sheet.error) {
        return NextResponse.json({ error: `Aba "${requested}": ${sheet.error}` }, { status: 502 })
      }

      return new NextResponse(toCsv(sheet), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="carteira-${safeFilename(sheet.title)}-${stamp}.csv"`,
        },
      })
    }

    return new NextResponse(JSON.stringify(snapshot, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="carteira-${stamp}.json"`,
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
