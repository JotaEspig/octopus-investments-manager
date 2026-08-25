import { readFileSync } from 'node:fs'
import { google } from 'googleapis'
import type { sheets_v4 } from 'googleapis'
import { loadConfig, type CarteiraConfig } from '@/lib/env'

/**
 * Cliente autenticado do Google Sheets.
 *
 * Usa uma service account: a chave JSON fica no disco, não há refresh token
 * para expirar e nada precisa de browser — o que importa porque o mesmo código
 * roda no Next e no servidor MCP, que é lançado sem interação nenhuma.
 */

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets']

export interface ServiceAccountKey {
  client_email: string
  private_key: string
}

export class SheetsAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SheetsAuthError'
  }
}

export function readServiceAccountKey(path: string): ServiceAccountKey {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    throw new SheetsAuthError(
      `Chave da service account não encontrada em ${path}. ` +
        'Baixe o JSON no Google Cloud (IAM → Service Accounts → Keys) e salve nesse caminho.',
    )
  }

  let parsed: Partial<ServiceAccountKey>
  try {
    parsed = JSON.parse(raw) as Partial<ServiceAccountKey>
  } catch {
    throw new SheetsAuthError(`${path} não é um JSON válido. Baixe a chave de novo.`)
  }

  if (!parsed.client_email || !parsed.private_key) {
    throw new SheetsAuthError(
      `${path} não parece uma chave de service account (faltam client_email/private_key).`,
    )
  }

  return { client_email: parsed.client_email, private_key: parsed.private_key }
}

export interface SheetsContext {
  api: sheets_v4.Sheets
  spreadsheetId: string
  serviceAccountEmail: string
}

/** Monta o cliente a partir do `.env.local` ou de `~/.config/carteira/config.json`. */
export function getSheetsContext(config: CarteiraConfig = loadConfig()): SheetsContext {
  const key = readServiceAccountKey(config.serviceAccountPath)

  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: SCOPES,
  })

  return {
    api: google.sheets({ version: 'v4', auth }),
    spreadsheetId: config.spreadsheetId,
    serviceAccountEmail: key.client_email,
  }
}

/**
 * Traduz os erros da API do Google para algo acionável. Os dois que realmente
 * acontecem no dia a dia são o compartilhamento esquecido e o ID errado.
 */
export function explainSheetsError(error: unknown, context: { serviceAccountEmail?: string }): string {
  const status = (error as { status?: number; code?: number })?.status ?? (error as { code?: number })?.code
  const message = error instanceof Error ? error.message : String(error)

  if (status === 403) {
    return (
      'A service account não tem acesso à planilha. Abra a planilha, clique em Compartilhar e ' +
      `adicione ${context.serviceAccountEmail ?? 'o client_email do JSON'} como Editor.`
    )
  }
  if (status === 404) {
    return 'Planilha não encontrada. Confira o CARTEIRA_SPREADSHEET_ID — é o trecho da URL entre /d/ e /edit.'
  }
  if (status === 429) {
    return 'Limite de requisições do Google atingido (300/min). Espere um minuto e tente de novo.'
  }
  return message
}
