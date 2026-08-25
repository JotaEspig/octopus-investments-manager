import { NextResponse } from 'next/server'
import { errorResponse } from '@/lib/api'
import { getSheetsContext } from '@/sheets/client'
import { readPortfolioData, spreadsheetUrl } from '@/sheets/repositories'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Alimenta o seletor de ativo do formulário — ações/ETFs e contratos de RF juntos. */
export async function GET() {
  try {
    const context = getSheetsContext()
    const data = await readPortfolioData(context)

    return NextResponse.json({
      assets: data.assets,
      contracts: data.contracts.map(({ symbol, name, issuer, indexer, maturity }) => ({
        symbol,
        name,
        issuer,
        indexer,
        maturity,
      })),
      spreadsheetUrl: spreadsheetUrl(context),
    })
  } catch (error) {
    return errorResponse(error)
  }
}
