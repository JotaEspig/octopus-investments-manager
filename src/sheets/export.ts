import { createHash } from 'node:crypto'
import type { sheets_v4 } from 'googleapis'
import { summarizePerformance, type PerformanceSummary } from '@/domain/returns'
import type { PortfolioSummary, Position } from '@/domain/types'
import { today } from '@/lib/dates'
import { explainSheetsError, type SheetsContext } from './client'
import { checkDataSheetDrift, readSchemaVersion, type SheetDrift } from './migrations'
import { loadPortfolio } from './portfolio'
import { DASHBOARD, DATA_SHEETS, VIEW_SHEETS, ref } from './schema'

/**
 * EXPORTAÇÃO — tirar da planilha um arquivo que se sustenta sozinho.
 *
 * Duas regras guiam o desenho:
 *
 * 1. **Fidelidade acima de conveniência.** O dump usa o cabeçalho REAL de cada
 *    aba e a contagem REAL de colunas, lidas da planilha — não a expectativa do
 *    `schema.ts`. Uma coluna que você acrescentou à mão aparece na exportação;
 *    uma que o schema espera e a planilha não tem, não é inventada. O arquivo
 *    descreve o que existe, não o que deveria existir.
 *
 * 2. **Falha parcial não derruba o todo.** Cada aba é lida e convertida em
 *    isolamento. Uma aba ilegível vira uma entrada com `error` preenchido e o
 *    resto do arquivo sai completo — porque um backup que só funciona quando
 *    está tudo bem não é backup.
 *
 * O que NÃO vai no arquivo: caminho da chave, e-mail da service account, ou
 * qualquer coisa de credencial. Só o que está dentro da planilha, mais
 * metadados de identificação.
 *
 * Fórmulas não são exportadas — só os valores que elas produziram. Elas são
 * reproduzíveis a partir do `schema.ts` com `npm run sheet:install`; os DADOS
 * é que são insubstituíveis.
 */

export const EXPORT_FORMAT = 'octopus-carteira-export'
export const EXPORT_FORMAT_VERSION = 1

/** Quanto do arquivo é irrecuperável se perdido. */
export type SheetKind = 'data' | 'view'

export interface ExportedSheet {
  title: string
  /** `data` é o que não se recupera; `view` é derivado e o instalador refaz. */
  kind: SheetKind
  headers: string[]
  rows: Array<Record<string, unknown>>
  rowCount: number
  /** Preenchido quando esta aba falhou. As outras continuam válidas. */
  error?: string
}

export interface CarteiraExport {
  format: typeof EXPORT_FORMAT
  formatVersion: number
  exportedAt: string
  spreadsheet: { id: string; title: string; url: string }
  schemaVersion: number | null
  integrity: {
    /** SHA-256 do bloco `sheets`, para detectar arquivo truncado ou editado. */
    checksum: string
    /** Como recalcular o checksum — o arquivo se explica sozinho. */
    algorithm: string
    rowCounts: Record<string, number>
    /** Deriva estrutural no momento da exportação. */
    drift: SheetDrift[]
  }
  sheets: ExportedSheet[]
  /** Visão calculada. `null` quando o cálculo falhou — o dump continua válido. */
  portfolio: {
    summary: PortfolioSummary
    positions: Position[]
    performance: PerformanceSummary
  } | null
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Cabeçalhos
// ---------------------------------------------------------------------------

function columnLabel(index: number): string {
  let letter = ''
  let value = index
  while (value >= 0) {
    letter = String.fromCharCode((value % 26) + 65) + letter
    value = Math.floor(value / 26) - 1
  }
  return letter
}

/**
 * Transforma a linha 1 em chaves utilizáveis, sem perder coluna nenhuma.
 *
 * Cabeçalho vazio vira `Coluna C` (a letra real, para dar para achar na
 * planilha) e cabeçalho repetido ganha sufixo. Descartar qualquer um dos dois
 * casos silenciosamente faria a exportação perder dados sem avisar.
 */
export function normalizeHeaders(raw: readonly unknown[]): string[] {
  const seen = new Map<string, number>()

  return raw.map((cell, index) => {
    const base = String(cell ?? '').trim() || `Coluna ${columnLabel(index)}`
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return count === 0 ? base : `${base} (${count + 1})`
  })
}

/** Remove colunas e linhas totalmente vazias no fim, sem tocar nos buracos do meio. */
function trimTrailing(grid: unknown[][]): unknown[][] {
  const rows = grid.map((row) => [...row])

  const isBlank = (cell: unknown) => cell === null || cell === undefined || String(cell).trim() === ''

  let width = 0
  for (const row of rows) {
    for (let index = row.length - 1; index >= 0; index -= 1) {
      if (!isBlank(row[index])) {
        width = Math.max(width, index + 1)
        break
      }
    }
  }

  const trimmed = rows.map((row) => {
    const next = row.slice(0, width)
    while (next.length < width) next.push('')
    return next
  })

  while (trimmed.length > 0 && trimmed[trimmed.length - 1]!.every(isBlank)) trimmed.pop()

  return trimmed
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

interface SheetTarget {
  title: string
  kind: SheetKind
  /** Largura real da grade, lida da planilha. Nunca chutada. */
  columnCount: number
}

function toExportedSheet(target: SheetTarget, values: unknown[][] | undefined): ExportedSheet {
  const grid = trimTrailing(values ?? [])

  if (grid.length === 0) {
    return { title: target.title, kind: target.kind, headers: [], rows: [], rowCount: 0 }
  }

  const headers = normalizeHeaders(grid[0]!)
  const rows = grid.slice(1).map((row) => {
    const record: Record<string, unknown> = {}
    headers.forEach((header, index) => {
      record[header] = row[index] ?? ''
    })
    return record
  })

  return { title: target.title, kind: target.kind, headers, rows, rowCount: rows.length }
}

/**
 * Abas exportáveis, com uma leitura só de metadados.
 *
 * Existe para o seletor da interface não precisar de um `buildExport` inteiro
 * — e para a lista vir da PLANILHA, não do `schema.ts`. Se você criou uma aba
 * à mão, ela aparece; se apagou uma, ela some.
 */
export async function listExportableSheets(context: SheetsContext): Promise<string[]> {
  const meta = (
    await context.api.spreadsheets.get({
      spreadsheetId: context.spreadsheetId,
      includeGridData: false,
    })
  ).data

  return (meta.sheets ?? [])
    .filter((sheet) => !sheet.properties?.hidden)
    .map((sheet) => sheet.properties?.title ?? '')
    .filter((title) => title !== '')
}

export async function buildExport(context: SheetsContext): Promise<CarteiraExport> {
  const { api, spreadsheetId } = context
  const warnings: string[] = []

  let meta: sheets_v4.Schema$Spreadsheet
  try {
    meta = (await api.spreadsheets.get({ spreadsheetId, includeGridData: false })).data
  } catch (error) {
    // Sem os metadados não há o que exportar — é a única falha fatal.
    throw new Error(explainSheetsError(error, context))
  }

  const kindByTitle = new Map<string, SheetKind>()
  for (const spec of DATA_SHEETS) kindByTitle.set(spec.title, 'data')
  for (const spec of VIEW_SHEETS) kindByTitle.set(spec.title, 'view')
  kindByTitle.set(DASHBOARD.title, 'view')

  const targets: SheetTarget[] = (meta.sheets ?? [])
    .filter((sheet) => !sheet.properties?.hidden)
    .map((sheet) => ({
      title: sheet.properties?.title ?? '',
      kind: kindByTitle.get(sheet.properties?.title ?? '') ?? 'data',
      // A largura vem da grade real. Ler `A1:ZZ` desperdiçaria cota e ler até a
      // largura do schema esconderia coluna acrescentada à mão.
      columnCount: sheet.properties?.gridProperties?.columnCount ?? 26,
    }))
    .filter((target) => target.title !== '')

  let sheets: ExportedSheet[] = []
  try {
    const response = await api.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: targets.map((target) => ref(target.title, `A1:${columnLabel(target.columnCount - 1)}`)),
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING',
    })

    const valueRanges = response.data.valueRanges ?? []
    sheets = targets.map((target, index) =>
      toExportedSheet(target, valueRanges[index]?.values as unknown[][] | undefined),
    )
  } catch (error) {
    // Falha em bloco: registra em cada aba e segue com o resto do arquivo.
    const message = explainSheetsError(error, context)
    warnings.push(`Não foi possível ler o conteúdo das abas: ${message}`)
    sheets = targets.map((target) => ({
      title: target.title,
      kind: target.kind,
      headers: [],
      rows: [],
      rowCount: 0,
      error: message,
    }))
  }

  // A visão calculada é conveniência. Se falhar, o dump continua valendo.
  let portfolio: CarteiraExport['portfolio'] = null
  try {
    const loaded = await loadPortfolio(context)
    portfolio = {
      summary: loaded.summary,
      positions: loaded.positions,
      performance: summarizePerformance(loaded.data.trades, loaded.summary.totalBRL, today()),
    }
  } catch (error) {
    warnings.push(
      `Carteira calculada ficou de fora: ${error instanceof Error ? error.message : String(error)}. ` +
        'Os dados brutos das abas estão completos.',
    )
  }

  let drift: SheetDrift[] = []
  try {
    drift = await checkDataSheetDrift(context)
  } catch {
    warnings.push('Não foi possível conferir a deriva estrutural.')
  }

  const schemaVersion = await readSchemaVersion(context).catch(() => null)

  const rowCounts: Record<string, number> = {}
  for (const sheet of sheets) rowCounts[sheet.title] = sheet.rowCount

  const missingData = DATA_SHEETS.filter(
    (spec) => !sheets.some((sheet) => sheet.title === spec.title),
  )
  for (const spec of missingData) {
    warnings.push(`Aba de dados ausente na planilha: ${spec.title}`)
  }

  return {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    spreadsheet: {
      id: spreadsheetId,
      title: meta.properties?.title ?? 'planilha',
      url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    },
    schemaVersion,
    integrity: {
      checksum: checksumOf(sheets),
      algorithm: CHECKSUM_ALGORITHM,
      rowCounts,
      drift,
    },
    sheets,
    portfolio,
    warnings,
  }
}

/**
 * Receita do checksum, gravada dentro do próprio arquivo.
 *
 * Sem isto, o hash só seria verificável por este mesmo código — e um checksum
 * que só quem gerou sabe conferir não protege ninguém. Com a receita escrita, o
 * arquivo se explica sozinho daqui a cinco anos.
 */
export const CHECKSUM_ALGORITHM =
  'sha256 do JSON de `sheets`, com as chaves de cada objeto em ordem alfabética e sem espaços'

/**
 * Serialização determinística: mesma entrada, mesmo texto, sempre.
 *
 * `JSON.stringify` preserva a ordem de inserção das chaves, que depende de
 * como o objeto foi montado. Ordenar as chaves torna o hash reproduzível por
 * qualquer implementação — é o que separa um checksum verificável de um
 * número decorativo.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
}

/**
 * SHA-256 do conteúdo das abas.
 *
 * Responde "este arquivo chegou inteiro?" — download truncado ou edição
 * acidental mudam o hash. **Não é assinatura**: quem editar o arquivo de
 * propósito pode recalcular. Detecta acidente, não má-fé.
 */
export function checksumOf(sheets: readonly ExportedSheet[]): string {
  return createHash('sha256').update(canonicalJson(sheets)).digest('hex')
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * Caracteres que fazem Excel e Google Sheets tratarem o campo como FÓRMULA ao
 * abrir o arquivo.
 *
 * Isto é injeção de CSV, e é um problema de segurança de verdade: uma anotação
 * como `=HYPERLINK(...)` no campo Observação viraria fórmula ativa na máquina
 * de quem abrisse o arquivo.
 */
const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r']

/**
 * Neutraliza injeção de fórmula sem estragar número.
 *
 * A defesa só se aplica a TEXTO. Número negativo continua número — `-1234.56`
 * sai intacto, porque quem chega aqui como `number` nunca vira fórmula. Só
 * string que começa com gatilho recebe o apóstrofo.
 */
export function escapeFormulaInjection(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const first = value.charAt(0)
  return FORMULA_TRIGGERS.includes(first) ? `'${value}` : value
}

/** Aspas conforme a RFC 4180: dobra aspas internas e protege separador e quebra. */
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = String(escapeFormulaInjection(value))
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/**
 * CSV de uma aba.
 *
 * Começa com BOM porque sem ele o Excel abre UTF-8 como Latin-1 e "Operações"
 * vira "OperaÃ§Ãµes". Quebra de linha CRLF, também pela RFC.
 */
export function toCsv(sheet: ExportedSheet): string {
  const lines = [sheet.headers.map(csvField).join(',')]
  for (const row of sheet.rows) {
    lines.push(sheet.headers.map((header) => csvField(row[header])).join(','))
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`
}

/** Nome de arquivo seguro em qualquer sistema, a partir do título da aba. */
export function safeFilename(base: string): string {
  return (
    base
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'export'
  )
}
