import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { ConfigError } from './env'
import { fieldErrors } from './schemas'
import { SheetsAuthError } from '@/sheets/client'
import { FxError } from './fx'

/**
 * Tradução de erro para resposta HTTP.
 *
 * Cada tipo de falha vira o status que descreve de fato o que aconteceu, e a
 * mensagem que sai é a que já foi escrita para ser acionável — nada de
 * "Internal Server Error" quando o problema é um compartilhamento esquecido.
 */
export function errorResponse(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: 'Dados inválidos', fields: fieldErrors(error) },
      { status: 422 },
    )
  }
  if (error instanceof ConfigError || error instanceof SheetsAuthError) {
    // Setup incompleto: não é culpa da requisição.
    return NextResponse.json({ error: error.message, setup: true }, { status: 503 })
  }
  if (error instanceof FxError) {
    return NextResponse.json({ error: error.message }, { status: 502 })
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status: 500 },
  )
}
