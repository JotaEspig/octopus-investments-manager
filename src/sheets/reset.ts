import type { sheets_v4 } from 'googleapis'
import { explainSheetsError, type SheetsContext } from './client'
import { ASSETS_SHEET, FIXED_INCOME_SHEET, SHEET, TRADES_SHEET, ref } from './schema'

/**
 * RESET — devolve a planilha ao estado virgem.
 *
 * Apaga TODAS as abas e deixa uma em branco, como se a planilha tivesse
 * acabado de ser criada. É destrutivo e irreversível: o Google Sheets tem
 * histórico de versões, mas contar com isso não é plano.
 *
 * O módulo expõe as duas metades separadas de propósito — `previewReset` diz o
 * que será perdido e `resetSpreadsheet` executa. Quem chama é obrigado a
 * passar pela primeira para montar a confirmação, e não existe caminho em que
 * a destruição aconteça sem alguém ter visto a contagem antes.
 */

/** Nome da aba que sobra. É o padrão do Google para planilha nova em pt_BR. */
const BLANK_SHEET_TITLE = 'Página1'

/** Nome temporário durante a troca — precisa ser único para não colidir. */
const TEMP_SHEET_TITLE = '__reset_em_andamento__'

export interface ResetPreview {
  spreadsheetTitle: string
  spreadsheetUrl: string
  /** Abas atuais e quantas linhas de conteúdo cada uma tem. */
  sheets: Array<{ title: string; rows: number }>
  /** Contagens do que dói perder de verdade — o resto é derivado. */
  trades: number
  assets: number
  contracts: number
  alreadyBlank: boolean
}

async function countRows(context: SheetsContext, title: string, titles: Set<string>): Promise<number> {
  if (!titles.has(title)) return 0
  try {
    const response = await context.api.spreadsheets.values.get({
      spreadsheetId: context.spreadsheetId,
      range: ref(title, 'A2:A'),
    })
    return (response.data.values ?? []).length
  } catch {
    return 0
  }
}

export async function previewReset(context: SheetsContext): Promise<ResetPreview> {
  const { api, spreadsheetId } = context

  let meta: sheets_v4.Schema$Spreadsheet
  try {
    meta = (await api.spreadsheets.get({ spreadsheetId, includeGridData: false })).data
  } catch (error) {
    throw new Error(explainSheetsError(error, context))
  }

  const sheets = (meta.sheets ?? []).map((sheet) => ({
    title: sheet.properties?.title ?? '(sem nome)',
    rows: Math.max(0, (sheet.properties?.gridProperties?.rowCount ?? 0) as number),
  }))
  const titles = new Set(sheets.map((sheet) => sheet.title))

  const [trades, assets, contracts] = await Promise.all([
    countRows(context, TRADES_SHEET.title, titles),
    countRows(context, ASSETS_SHEET.title, titles),
    countRows(context, FIXED_INCOME_SHEET.title, titles),
  ])

  return {
    spreadsheetTitle: meta.properties?.title ?? 'planilha',
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    sheets,
    trades,
    assets,
    contracts,
    alreadyBlank: !titles.has(SHEET.trades) && sheets.length <= 1,
  }
}

export interface ResetResult {
  deleted: string[]
}

/**
 * Executa o reset.
 *
 * Uma planilha não pode ficar sem nenhuma aba, então a ordem é: cria uma aba
 * temporária, apaga todas as outras, e só então renomeia a temporária. Fazer
 * na ordem inversa deixaria a planilha num estado que a API recusa.
 */
export async function resetSpreadsheet(context: SheetsContext): Promise<ResetResult> {
  const { api, spreadsheetId } = context

  let meta: sheets_v4.Schema$Spreadsheet
  try {
    meta = (await api.spreadsheets.get({ spreadsheetId, includeGridData: false })).data
  } catch (error) {
    throw new Error(explainSheetsError(error, context))
  }

  const existing = (meta.sheets ?? [])
    .map((sheet) => ({
      id: sheet.properties?.sheetId,
      title: sheet.properties?.title ?? '',
    }))
    .filter((sheet): sheet is { id: number; title: string } => typeof sheet.id === 'number')

  try {
    const created = await api.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: TEMP_SHEET_TITLE, index: 0 } } }],
      },
    })

    const tempId = created.data.replies?.[0]?.addSheet?.properties?.sheetId
    if (typeof tempId !== 'number') throw new Error('Não foi possível criar a aba temporária.')

    // Intervalos nomeados morrem junto com as abas, mas os que sobrarem
    // apontando para o nada atrapalhariam a reinstalação.
    const requests: sheets_v4.Schema$Request[] = [
      ...(meta.namedRanges ?? [])
        .filter((named) => named.namedRangeId)
        .map((named) => ({ deleteNamedRange: { namedRangeId: named.namedRangeId! } })),
      ...existing.map((sheet) => ({ deleteSheet: { sheetId: sheet.id } })),
      {
        updateSheetProperties: {
          properties: { sheetId: tempId, title: BLANK_SHEET_TITLE, index: 0 },
          fields: 'title,index',
        },
      },
    ]

    await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } })

    return { deleted: existing.map((sheet) => sheet.title) }
  } catch (error) {
    throw new Error(explainSheetsError(error, context))
  }
}
