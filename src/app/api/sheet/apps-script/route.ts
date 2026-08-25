import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Serve o `Code.gs` para a página de setup, que oferece um botão de copiar.
 *
 * Este é o único passo do setup que a service account não consegue automatizar:
 * um script vinculado à planilha pertence a você, não a ela, então a API do
 * Google não pode criá-lo — e a API do Apps Script tampouco cria gatilhos.
 */
export async function GET() {
  try {
    const path = join(process.cwd(), 'apps-script', 'Code.gs')
    return new NextResponse(readFileSync(path, 'utf8'), {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  } catch (error) {
    return NextResponse.json(
      { error: `Não foi possível ler apps-script/Code.gs: ${String(error)}` },
      { status: 500 },
    )
  }
}
