import { missingHistoryMonths } from '@/domain/history'
import { fromSheetDate, today } from '@/lib/dates'
import { tryLoadConfig } from '@/lib/env'
import { explainSheetsError, getSheetsContext, readServiceAccountKey } from './client'
import {
  APPS_SCRIPT_LAST_RUN,
  DASHBOARD,
  DATA_SHEETS,
  SCHEMA_VERSION,
  SHEET,
  VIEW_SHEETS,
  ref,
} from './schema'

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

/** Quantos dias sem rodar antes de virar aviso. Folga para falha isolada do BCB. */
const STALE_AFTER_DAYS = 2

/**
 * Traduz o carimbo do Apps Script em diagnóstico.
 *
 * Puro, para poder ser testado sem planilha — e porque a regra ("a partir de
 * quantos dias isso vira problema?") é justamente o tipo de coisa que se quer
 * poder ajustar sem medo.
 *
 * Nunca ter rodado é diferente de ter parado: o primeiro é setup incompleto, o
 * segundo é gatilho quebrado. A mensagem distingue os dois porque a ação é
 * diferente.
 */
export function appsScriptHealth(
  lastRun: string | null,
  now: Date,
): { status: CheckStatus; detail: string; daysAgo: number | null } {
  if (!lastRun || !String(lastRun).trim()) {
    return {
      status: 'warn',
      detail:
        'Nunca rodou. Cole apps-script/Code.gs na planilha e clique em ' +
        'Carteira → Ativar atualização diária — sem isso, nada se atualiza sozinho.',
      daysAgo: null,
    }
  }

  const when = Date.parse(String(lastRun))
  if (Number.isNaN(when)) {
    return { status: 'warn', detail: `Carimbo ilegível: "${lastRun}"`, daysAgo: null }
  }

  const daysAgo = Math.floor((now.getTime() - when) / 86_400_000)
  const local = new Date(when).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

  if (daysAgo > STALE_AFTER_DAYS) {
    return {
      status: 'warn',
      detail:
        `Não roda há ${daysAgo} dias (última: ${local}). O Google desativa gatilhos após ` +
        'falhas repetidas — confira o e-mail da conta e reative pelo menu Carteira.',
      daysAgo,
    }
  }

  return {
    status: 'ok',
    detail: daysAgo === 0 ? `Rodou hoje, às ${local}` : `Última execução: ${local}`,
    daysAgo,
  }
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

  // Uma leitura só de `Config` inteira, procurando as chaves pelo NOME. Ler
  // `B2` presumiria a posição da linha, e chave nova entrando antes quebraria.
  let schemaVersion: number | null = null
  let lastRun: string | null = null

  if (titles.has(SHEET.config)) {
    try {
      const values = await context.api.spreadsheets.values.get({
        spreadsheetId: config.spreadsheetId,
        range: ref(SHEET.config, 'A2:B'),
      })
      for (const row of values.data.values ?? []) {
        const key = String(row[0] ?? '').trim()
        if (key === 'schema_version') schemaVersion = Number(row[1])
        if (key === APPS_SCRIPT_LAST_RUN) lastRun = String(row[1] ?? '')
      }
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

  // O motor é o que mantém a planilha viva com tudo desligado. Sem ele, os
  // números continuam ali parecendo certos — só velhos.
  const health = appsScriptHealth(lastRun, new Date())
  checks.push({ label: 'Motor (Apps Script)', status: health.status, detail: health.detail })

  // O histórico é a única coisa que não se recupera sozinha. Descobrir o
  // buraco é metade do conserto; a outra metade é o backfill no Apps Script.
  if (titles.has(SHEET.trades) && titles.has(SHEET.history)) {
    try {
      const values = await context.api.spreadsheets.values.batchGet({
        spreadsheetId: config.spreadsheetId,
        ranges: [ref(SHEET.trades, 'B2:B'), ref(SHEET.history, 'A2:A')],
        valueRenderOption: 'UNFORMATTED_VALUE',
        dateTimeRenderOption: 'FORMATTED_STRING',
      })

      const [tradeDates, historyDates] = (values.data.valueRanges ?? []).map((range) =>
        (range.values ?? []).map((row) => fromSheetDate(row[0])).filter(Boolean),
      )

      const first = [...(tradeDates ?? [])].sort()[0] ?? null
      const missing = missingHistoryMonths(first, historyDates ?? [], today())

      if (missing.length > 0) {
        checks.push({
          label: 'Histórico do patrimônio',
          status: 'warn',
          detail:
            `${missing.length} mês(es) sem snapshot: ${missing.join(', ')}. ` +
            'Na planilha, use Carteira → Reconstruir meses faltantes.',
        })
      } else if (first) {
        checks.push({
          label: 'Histórico do patrimônio',
          status: 'ok',
          detail: `Sem buracos desde ${first.slice(0, 7)}`,
        })
      }
    } catch {
      // Sem histórico legível não há o que reportar — não é motivo de alarme.
    }
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
