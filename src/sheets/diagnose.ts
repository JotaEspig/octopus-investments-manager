import { tryLoadConfig } from '@/lib/env'
import { explainSheetsError, getSheetsContext, readServiceAccountKey } from './client'
import { DASHBOARD, DATA_SHEETS, SCHEMA_VERSION, SHEET, VIEW_SHEETS, ref } from './schema'

/**
 * Diagnóstico do setup — o que a página `/setup` mostra antes de deixar
 * instalar. Cada passo do setup manual vira um check, na ordem em que quebra
 * na prática: config → chave → acesso → estrutura.
 */

export type CheckStatus = 'ok' | 'warn' | 'error'

export interface Check {
  label: string
  status: CheckStatus
  detail: string
}

export interface Diagnosis {
  ready: boolean
  checks: Check[]
  serviceAccountEmail: string | null
  spreadsheetUrl: string | null
  spreadsheetTitle: string | null
  schemaVersion: number | null
  expectedSchemaVersion: number
  missingSheets: string[]
}

export async function diagnose(): Promise<Diagnosis> {
  const checks: Check[] = []
  const expectedSchemaVersion = SCHEMA_VERSION
  const empty: Diagnosis = {
    ready: false,
    checks,
    serviceAccountEmail: null,
    spreadsheetUrl: null,
    spreadsheetTitle: null,
    schemaVersion: null,
    expectedSchemaVersion,
    missingSheets: [],
  }

  const loaded = tryLoadConfig()
  if ('error' in loaded) {
    checks.push({ label: 'Configuração', status: 'error', detail: loaded.error })
    return empty
  }
  const config = loaded.config
  checks.push({
    label: 'Configuração',
    status: 'ok',
    detail: `Planilha ${config.spreadsheetId.slice(0, 12)}… · chave em ${config.serviceAccountPath}`,
  })

  let serviceAccountEmail: string
  try {
    serviceAccountEmail = readServiceAccountKey(config.serviceAccountPath).client_email
  } catch (error) {
    checks.push({
      label: 'Chave da service account',
      status: 'error',
      detail: error instanceof Error ? error.message : String(error),
    })
    return empty
  }
  checks.push({ label: 'Chave da service account', status: 'ok', detail: serviceAccountEmail })

  const context = getSheetsContext(config)
  const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${config.spreadsheetId}/edit`

  let title: string
  let titles: Set<string>
  try {
    const meta = await context.api.spreadsheets.get({
      spreadsheetId: config.spreadsheetId,
      includeGridData: false,
    })
    title = meta.data.properties?.title ?? 'planilha'
    titles = new Set((meta.data.sheets ?? []).map((sheet) => sheet.properties?.title ?? ''))
  } catch (error) {
    checks.push({
      label: 'Acesso à planilha',
      status: 'error',
      detail: explainSheetsError(error, { serviceAccountEmail }),
    })
    return { ...empty, serviceAccountEmail, spreadsheetUrl }
  }
  checks.push({ label: 'Acesso à planilha', status: 'ok', detail: `"${title}" acessível como Editor` })

  const required = [DASHBOARD.title, ...VIEW_SHEETS.map((v) => v.title), ...DATA_SHEETS.map((s) => s.title)]
  const missingSheets = required.filter((sheetTitle) => !titles.has(sheetTitle))

  checks.push(
    missingSheets.length === 0
      ? { label: 'Estrutura', status: 'ok', detail: `${required.length} abas presentes` }
      : {
          label: 'Estrutura',
          status: 'warn',
          detail: `Faltam ${missingSheets.length} aba(s): ${missingSheets.join(', ')}`,
        },
  )

  let schemaVersion: number | null = null
  if (titles.has(SHEET.config)) {
    try {
      const values = await context.api.spreadsheets.values.get({
        spreadsheetId: config.spreadsheetId,
        range: ref(SHEET.config, 'A2:B2'),
      })
      const row = values.data.values?.[0]
      if (row?.[0] === 'schema_version') schemaVersion = Number(row[1])
    } catch {
      // Config existe mas está vazia — a instalação preenche.
    }
  }

  if (schemaVersion !== null) {
    checks.push(
      schemaVersion === expectedSchemaVersion
        ? { label: 'Versão do schema', status: 'ok', detail: `v${schemaVersion}` }
        : {
            label: 'Versão do schema',
            status: 'warn',
            detail: `Planilha em v${schemaVersion}, código em v${expectedSchemaVersion}. Reinstale para atualizar.`,
          },
    )
  }

  return {
    ready: missingSheets.length === 0 && schemaVersion === expectedSchemaVersion,
    checks,
    serviceAccountEmail,
    spreadsheetUrl,
    spreadsheetTitle: title,
    schemaVersion,
    expectedSchemaVersion,
    missingSheets,
  }
}
