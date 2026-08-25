import type { sheets_v4 } from 'googleapis'
import { ASSET_CLASSES, ASSET_CLASS_LABELS } from '@/domain/types'
import {
  CONFIG_FX_ROW,
  CONFIG_ROWS,
  CONFIG_SHEET,
  DASHBOARD,
  DASHBOARD_ALLOCATION_HEADERS,
  DATA_SHEETS,
  HISTORY_CHART_ROWS,
  NAMED_RANGE,
  NUMBER_FORMAT,
  SCHEMA_VERSION,
  SHEET,
  SPREADSHEET_LOCALE,
  SPREADSHEET_TIME_ZONE,
  VIEW_FIRST_ROW,
  VIEW_ROWS,
  VIEW_SHEETS,
  CLASS_CURRENCY,
  ref,
  type ColumnFormat,
  type DataSheetSpec,
  type ViewSheetSpec,
} from './schema'
import { explainSheetsError, type SheetsContext } from './client'

/**
 * Instalador da planilha.
 *
 * Constrói toda a estrutura a partir de `schema.ts`: abas, cabeçalhos,
 * fórmulas, formatação, intervalos nomeados e gráficos. É **idempotente** —
 * rodar de novo conserta o que estiver faltando e não duplica nada nem toca
 * nos dados já cadastrados.
 *
 * O que ele deliberadamente NÃO reescreve:
 * - linhas de dados em `Operações`, `Ativos`, `Contratos RF`, `CDI`, `Histórico`
 * - chaves de `Config` que já existem (as metas de alocação são suas para editar)
 * - fórmulas de `Cotações` (a escapatória quando o GOOGLEFINANCE falha)
 */

export interface BootstrapReport {
  actions: string[]
  warnings: string[]
  spreadsheetUrl: string
  spreadsheetTitle: string
}

/** Nomes que o Google dá à aba única de uma planilha nova. */
const DEFAULT_SHEET_TITLES = new Set(['Sheet1', 'Página1', 'Planilha1', 'Folha1'])

const HEADER_BACKGROUND = { red: 0.937, green: 0.945, blue: 0.961 }

export function columnLetter(index: number): string {
  let letter = ''
  let value = index
  while (value >= 0) {
    letter = String.fromCharCode((value % 26) + 65) + letter
    value = Math.floor(value / 26) - 1
  }
  return letter
}

/** Ordem das abas na planilha: painel, seções por classe, depois os dados. */
function desiredSheetOrder(): string[] {
  return [DASHBOARD.title, ...VIEW_SHEETS.map((view) => view.title), ...DATA_SHEETS.map((s) => s.title)]
}

function numberFormatRequest(
  sheetId: number,
  columnIndex: number,
  firstDataRow: number,
  format: ColumnFormat,
): sheets_v4.Schema$Request | null {
  const pattern = NUMBER_FORMAT[format]
  if (!pattern) return null
  return {
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: firstDataRow - 1,
        startColumnIndex: columnIndex,
        endColumnIndex: columnIndex + 1,
      },
      cell: { userEnteredFormat: { numberFormat: pattern } },
      fields: 'userEnteredFormat.numberFormat',
    },
  }
}

function headerStyleRequest(sheetId: number, headerRow: number, columnCount: number): sheets_v4.Schema$Request {
  return {
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: headerRow - 1,
        endRowIndex: headerRow,
        startColumnIndex: 0,
        endColumnIndex: columnCount,
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: HEADER_BACKGROUND,
          textFormat: { bold: true },
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat)',
    },
  }
}

function widthRequests(sheetId: number, widths: Array<number | undefined>): sheets_v4.Schema$Request[] {
  return widths.flatMap((width, index) =>
    width
      ? [
          {
            updateDimensionProperties: {
              range: { sheetId, dimension: 'COLUMNS', startIndex: index, endIndex: index + 1 },
              properties: { pixelSize: width },
              fields: 'pixelSize',
            },
          },
        ]
      : [],
  )
}

// ---------------------------------------------------------------------------
// Conteúdo
// ---------------------------------------------------------------------------

interface ValueRange {
  range: string
  values: unknown[][]
}

/** Cabeçalhos das abas de dados; colunas derivadas recebem a própria ARRAYFORMULA. */
function dataSheetHeader(spec: DataSheetSpec): ValueRange {
  const header = spec.columns.map((column) => column.arrayFormula ?? column.header)
  return { range: ref(spec.title, `A1:${columnLetter(spec.columns.length - 1)}1`), values: [header] }
}

/**
 * Conteúdo de uma aba de apresentação.
 *
 * A coluna A recebe UMA fórmula (o FILTER que derrama a lista de ativos para
 * baixo) e as demais recebem uma fórmula por linha. Por isso A4 em diante fica
 * em branco: se houvesse algo ali, o derrame bateria e viraria #REF!.
 */
function viewSheetContent(spec: ViewSheetSpec): ValueRange[] {
  const lastColumn = columnLetter(spec.columns.length - 1)
  const totalColumnLetter = columnLetter(spec.totalColumn)
  const lastRow = VIEW_FIRST_ROW + VIEW_ROWS - 1

  const rows: unknown[][] = []
  for (let row = VIEW_FIRST_ROW; row <= lastRow; row += 1) {
    rows.push(spec.columns.slice(1).map((column) => column.formula(row)))
  }

  return [
    { range: ref(spec.title, 'A1'), values: [[spec.title]] },
    {
      range: ref(spec.title, `${columnLetter(spec.totalColumn - 1)}1:${totalColumnLetter}1`),
      values: [
        [
          'Total (R$)',
          `=SUM(${totalColumnLetter}${VIEW_FIRST_ROW}:${totalColumnLetter}${lastRow})`,
        ],
      ],
    },
    {
      range: ref(spec.title, `A2:${lastColumn}2`),
      values: [spec.columns.map((column) => column.header)],
    },
    {
      range: ref(spec.title, `A${VIEW_FIRST_ROW}`),
      values: [[spec.columns[0]!.formula(VIEW_FIRST_ROW)]],
    },
    { range: ref(spec.title, `B${VIEW_FIRST_ROW}:${lastColumn}${lastRow}`), values: rows },
  ]
}

function dashboardContent(): ValueRange[] {
  const firstRow = DASHBOARD.allocationFirstRow
  const lastRow = firstRow + ASSET_CLASSES.length - 1

  const allocationRows = ASSET_CLASSES.map((assetClass, index) => {
    const row = firstRow + index
    const view = VIEW_SHEETS.find((candidate) => candidate.assetClass === assetClass)!
    return [
      ASSET_CLASS_LABELS[assetClass],
      `=${view.totalRangeName}`,
      `=IFERROR($B${row}/$B$${DASHBOARD.totalRow};0)`,
      `=IFERROR(VLOOKUP("target_${assetClass}";${ref(SHEET.config, '$A:$B')};2;FALSE);0)`,
      `=$C${row}-$D${row}`,
    ]
  })

  return [
    { range: ref(DASHBOARD.title, 'A1'), values: [['Carteira']] },
    {
      range: ref(DASHBOARD.title, `A${DASHBOARD.totalRow}:B${DASHBOARD.updatedRow}`),
      values: [
        ['Patrimônio total (R$)', `=SUM(B${firstRow}:B${lastRow})`],
        ['Câmbio USD/BRL', `=${NAMED_RANGE.fx}`],
        ['Atualizado em', '=NOW()'],
      ],
    },
    {
      range: ref(DASHBOARD.title, `A${DASHBOARD.allocationHeaderRow}:E${DASHBOARD.allocationHeaderRow}`),
      values: [DASHBOARD_ALLOCATION_HEADERS],
    },
    { range: ref(DASHBOARD.title, `A${firstRow}:E${lastRow}`), values: allocationRows },
  ]
}

// ---------------------------------------------------------------------------
// Gráficos
// ---------------------------------------------------------------------------

function chartRequests(dashboardId: number, historyId: number): sheets_v4.Schema$Request[] {
  const firstRow = DASHBOARD.allocationFirstRow
  const lastRow = firstRow + ASSET_CLASSES.length

  const gridRange = (sheetId: number, r1: number, r2: number, c1: number, c2: number) => ({
    sheetId,
    startRowIndex: r1,
    endRowIndex: r2,
    startColumnIndex: c1,
    endColumnIndex: c2,
  })

  return [
    {
      addChart: {
        chart: {
          spec: {
            title: 'Alocação por classe',
            pieChart: {
              legendPosition: 'RIGHT_LEGEND',
              domain: {
                sourceRange: { sources: [gridRange(dashboardId, firstRow - 1, lastRow - 1, 0, 1)] },
              },
              series: {
                sourceRange: { sources: [gridRange(dashboardId, firstRow - 1, lastRow - 1, 1, 2)] },
              },
            },
          },
          position: {
            overlayPosition: {
              anchorCell: { sheetId: dashboardId, rowIndex: DASHBOARD.chartRow - 1, columnIndex: 0 },
            },
          },
        },
      },
    },
    {
      addChart: {
        chart: {
          spec: {
            title: 'Patrimônio — últimos meses',
            basicChart: {
              chartType: 'LINE',
              legendPosition: 'BOTTOM_LEGEND',
              headerCount: 1,
              axis: [
                { position: 'BOTTOM_AXIS', title: 'Mês' },
                { position: 'LEFT_AXIS', title: 'R$' },
              ],
              domains: [
                {
                  domain: {
                    sourceRange: { sources: [gridRange(historyId, 0, HISTORY_CHART_ROWS, 0, 1)] },
                  },
                },
              ],
              series: [
                {
                  series: {
                    sourceRange: { sources: [gridRange(historyId, 0, HISTORY_CHART_ROWS, 1, 2)] },
                  },
                  targetAxis: 'LEFT_AXIS',
                },
              ],
            },
          },
          position: {
            overlayPosition: {
              anchorCell: { sheetId: dashboardId, rowIndex: DASHBOARD.chartRow - 1, columnIndex: 6 },
            },
          },
        },
      },
    },
  ]
}

// ---------------------------------------------------------------------------
// Instalador
// ---------------------------------------------------------------------------

export async function bootstrapSpreadsheet(context: SheetsContext): Promise<BootstrapReport> {
  const { api, spreadsheetId } = context
  const actions: string[] = []
  const warnings: string[] = []

  let meta: sheets_v4.Schema$Spreadsheet
  try {
    const response = await api.spreadsheets.get({ spreadsheetId, includeGridData: false })
    meta = response.data
  } catch (error) {
    throw new Error(explainSheetsError(error, context))
  }

  // --- 1. Locale ----------------------------------------------------------
  // Precisa vir ANTES de qualquer fórmula: é o locale que decide se o Sheets
  // lê `;` ou `,` como separador de argumentos.
  const setupRequests: sheets_v4.Schema$Request[] = []
  if (meta.properties?.locale !== SPREADSHEET_LOCALE) {
    setupRequests.push({
      updateSpreadsheetProperties: {
        properties: { locale: SPREADSHEET_LOCALE, timeZone: SPREADSHEET_TIME_ZONE },
        fields: 'locale,timeZone',
      },
    })
    actions.push(`Locale ajustado para ${SPREADSHEET_LOCALE} (define o separador das fórmulas)`)
  }

  // --- 2. Abas faltantes --------------------------------------------------
  const existingTitles = new Set((meta.sheets ?? []).map((sheet) => sheet.properties?.title ?? ''))
  const order = desiredSheetOrder()

  for (const [index, title] of order.entries()) {
    if (existingTitles.has(title)) continue
    setupRequests.push({
      addSheet: {
        properties: {
          title,
          index,
          gridProperties: { frozenRowCount: title === DASHBOARD.title ? 1 : 2 },
        },
      },
    })
    actions.push(`Aba criada: ${title}`)
  }

  if (setupRequests.length > 0) {
    try {
      await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: setupRequests } })
    } catch (error) {
      throw new Error(explainSheetsError(error, context))
    }
  }

  // Reler para pegar os sheetIds recém-criados.
  const fresh = (await api.spreadsheets.get({ spreadsheetId, includeGridData: false })).data
  const sheetsByTitle = new Map<string, sheets_v4.Schema$Sheet>()
  for (const sheet of fresh.sheets ?? []) {
    if (sheet.properties?.title) sheetsByTitle.set(sheet.properties.title, sheet)
  }
  const sheetId = (title: string) => sheetsByTitle.get(title)?.properties?.sheetId ?? null

  // --- 3. Conteúdo --------------------------------------------------------
  const valueRanges: ValueRange[] = [
    ...DATA_SHEETS.map(dataSheetHeader),
    ...VIEW_SHEETS.flatMap(viewSheetContent),
    ...dashboardContent(),
  ]

  // `Config` guarda as metas de alocação, que são suas para editar: só as
  // chaves ausentes são escritas, nunca as que já existem.
  const configured = new Set<string>()
  try {
    const existing = await api.spreadsheets.values.get({
      spreadsheetId,
      range: ref(SHEET.config, 'A2:A'),
    })
    for (const row of existing.data.values ?? []) {
      if (row[0]) configured.add(String(row[0]))
    }
  } catch {
    // Aba recém-criada: nada configurado ainda.
  }

  const missingConfig = CONFIG_ROWS.filter((row) => !configured.has(row.key))
  if (missingConfig.length > 0) {
    const startRow = 2 + configured.size
    valueRanges.push({
      range: ref(SHEET.config, `A${startRow}:C${startRow + missingConfig.length - 1}`),
      values: missingConfig.map((row) => [row.key, row.value, row.description]),
    })
    actions.push(`Config: ${missingConfig.length} chave(s) adicionada(s)`)
  }

  if (configured.has('schema_version')) {
    const stored = (
      await api.spreadsheets.values.get({ spreadsheetId, range: ref(SHEET.config, 'B2') })
    ).data.values?.[0]?.[0]
    if (String(stored) !== String(SCHEMA_VERSION)) {
      valueRanges.push({ range: ref(SHEET.config, 'B2'), values: [[SCHEMA_VERSION]] })
      actions.push(`Schema atualizado: v${stored} → v${SCHEMA_VERSION}`)
    }
  }

  try {
    await api.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        // USER_ENTERED faz o Sheets interpretar as fórmulas em vez de gravar texto.
        valueInputOption: 'USER_ENTERED',
        data: valueRanges.map((entry) => ({ range: entry.range, values: entry.values as never })),
      },
    })
  } catch (error) {
    throw new Error(explainSheetsError(error, context))
  }
  actions.push(`Fórmulas e cabeçalhos escritos (${valueRanges.length} intervalos)`)

  // --- 4. Formatação, intervalos nomeados e gráficos ----------------------
  const formatRequests: sheets_v4.Schema$Request[] = []

  for (const spec of DATA_SHEETS) {
    const id = sheetId(spec.title)
    if (id === null) continue
    formatRequests.push(headerStyleRequest(id, 1, spec.columns.length))
    formatRequests.push(...widthRequests(id, spec.columns.map((column) => column.width)))
    for (const [index, column] of spec.columns.entries()) {
      const request = column.format ? numberFormatRequest(id, index, 2, column.format) : null
      if (request) formatRequests.push(request)
    }
  }

  for (const spec of VIEW_SHEETS) {
    const id = sheetId(spec.title)
    if (id === null) continue
    formatRequests.push(headerStyleRequest(id, 2, spec.columns.length))
    formatRequests.push(...widthRequests(id, spec.columns.map((column) => column.width)))
    formatRequests.push({
      repeatCell: {
        range: { sheetId: id, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 13 } } },
        fields: 'userEnteredFormat.textFormat',
      },
    })
    for (const [index, column] of spec.columns.entries()) {
      // `native` vira R$ ou US$ conforme a moeda da classe da aba.
      const format: ColumnFormat | undefined =
        column.format === 'native'
          ? CLASS_CURRENCY[spec.assetClass] === 'USD'
            ? 'usd'
            : 'brl'
          : column.format
      const request = format ? numberFormatRequest(id, index, VIEW_FIRST_ROW, format) : null
      if (request) formatRequests.push(request)
    }

    // O total da aba mora na linha 1 e é sempre em reais, mesmo nas classes
    // cotadas em dólar — é ele que o Painel soma.
    formatRequests.push({
      repeatCell: {
        range: {
          sheetId: id,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: spec.totalColumn,
          endColumnIndex: spec.totalColumn + 1,
        },
        cell: { userEnteredFormat: { numberFormat: NUMBER_FORMAT.brl!, textFormat: { bold: true } } },
        fields: 'userEnteredFormat(numberFormat,textFormat)',
      },
    })
  }

  const dashboardId = sheetId(DASHBOARD.title)
  if (dashboardId !== null) {
    formatRequests.push(headerStyleRequest(dashboardId, DASHBOARD.allocationHeaderRow, 5))
    formatRequests.push({
      repeatCell: {
        range: { sheetId: dashboardId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 16 } } },
        fields: 'userEnteredFormat.textFormat',
      },
    })
    formatRequests.push(...widthRequests(dashboardId, [200, 150, 110, 110, 110]))

    const firstRow = DASHBOARD.allocationFirstRow
    const lastRow = firstRow + ASSET_CLASSES.length
    const money = NUMBER_FORMAT.brl!
    const percent = NUMBER_FORMAT.percent!
    formatRequests.push(
      {
        repeatCell: {
          range: { sheetId: dashboardId, startRowIndex: firstRow - 1, endRowIndex: lastRow - 1, startColumnIndex: 1, endColumnIndex: 2 },
          cell: { userEnteredFormat: { numberFormat: money } },
          fields: 'userEnteredFormat.numberFormat',
        },
      },
      {
        repeatCell: {
          range: { sheetId: dashboardId, startRowIndex: firstRow - 1, endRowIndex: lastRow - 1, startColumnIndex: 2, endColumnIndex: 5 },
          cell: { userEnteredFormat: { numberFormat: percent } },
          fields: 'userEnteredFormat.numberFormat',
        },
      },
      {
        repeatCell: {
          range: { sheetId: dashboardId, startRowIndex: DASHBOARD.totalRow - 1, endRowIndex: DASHBOARD.totalRow, startColumnIndex: 1, endColumnIndex: 2 },
          cell: { userEnteredFormat: { numberFormat: money, textFormat: { bold: true, fontSize: 13 } } },
          fields: 'userEnteredFormat(numberFormat,textFormat)',
        },
      },
      {
        repeatCell: {
          range: { sheetId: dashboardId, startRowIndex: DASHBOARD.updatedRow - 1, endRowIndex: DASHBOARD.updatedRow, startColumnIndex: 1, endColumnIndex: 2 },
          cell: { userEnteredFormat: { numberFormat: NUMBER_FORMAT.datetime! } },
          fields: 'userEnteredFormat.numberFormat',
        },
      },
    )
  }

  // Intervalos nomeados: o Painel referencia os totais por nome, não por célula,
  // para que mexer no layout de uma aba de classe não quebre o painel.
  const existingNamed = new Map<string, string>()
  for (const named of fresh.namedRanges ?? []) {
    if (named.name && named.namedRangeId) existingNamed.set(named.name, named.namedRangeId)
  }

  const namedTargets: Array<{ name: string; sheetTitle: string; row: number; column: number }> = [
    { name: NAMED_RANGE.fx, sheetTitle: SHEET.config, row: CONFIG_FX_ROW, column: 1 },
    { name: NAMED_RANGE.total, sheetTitle: DASHBOARD.title, row: DASHBOARD.totalRow, column: 1 },
    ...VIEW_SHEETS.map((spec) => ({
      name: spec.totalRangeName,
      sheetTitle: spec.title,
      row: 1,
      column: spec.totalColumn,
    })),
  ]

  for (const target of namedTargets) {
    const id = sheetId(target.sheetTitle)
    if (id === null) continue
    const range = {
      sheetId: id,
      startRowIndex: target.row - 1,
      endRowIndex: target.row,
      startColumnIndex: target.column,
      endColumnIndex: target.column + 1,
    }
    const existingId = existingNamed.get(target.name)
    if (existingId) {
      formatRequests.push({
        updateNamedRange: { namedRange: { namedRangeId: existingId, name: target.name, range }, fields: 'range' },
      })
    } else {
      formatRequests.push({ addNamedRange: { namedRange: { name: target.name, range } } })
      actions.push(`Intervalo nomeado criado: ${target.name}`)
    }
  }

  // Gráficos: só na primeira vez. Recriar a cada instalação apagaria qualquer
  // ajuste de posição ou cor que você tivesse feito.
  const dashboardCharts = sheetsByTitle.get(DASHBOARD.title)?.charts ?? []
  const historyId = sheetId(SHEET.history)
  if (dashboardCharts.length === 0 && dashboardId !== null && historyId !== null) {
    formatRequests.push(...chartRequests(dashboardId, historyId))
    actions.push('Gráficos criados: pizza de alocação e linha do patrimônio')
  } else if (dashboardCharts.length > 0) {
    actions.push(`Gráficos preservados (${dashboardCharts.length} já existiam)`)
  }

  // Ordem das abas.
  for (const [index, title] of order.entries()) {
    const id = sheetId(title)
    const current = sheetsByTitle.get(title)?.properties?.index
    if (id === null || current === index) continue
    formatRequests.push({
      updateSheetProperties: { properties: { sheetId: id, index }, fields: 'index' },
    })
  }

  // Aba padrão vazia deixada pelo Google na criação da planilha.
  for (const sheet of fresh.sheets ?? []) {
    const title = sheet.properties?.title ?? ''
    const id = sheet.properties?.sheetId
    if (!DEFAULT_SHEET_TITLES.has(title) || id === null || id === undefined) continue
    const used = await api.spreadsheets.values.get({ spreadsheetId, range: ref(title, 'A1:Z50') })
    if ((used.data.values ?? []).length === 0) {
      formatRequests.push({ deleteSheet: { sheetId: id } })
      actions.push(`Aba padrão vazia removida: ${title}`)
    } else {
      warnings.push(`A aba "${title}" tem conteúdo e foi mantida. Apague à mão se não precisar dela.`)
    }
  }

  if (formatRequests.length > 0) {
    try {
      await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: formatRequests } })
    } catch (error) {
      throw new Error(explainSheetsError(error, context))
    }
    actions.push('Formatação, intervalos nomeados e ordem das abas aplicados')
  }

  return {
    actions,
    warnings,
    spreadsheetTitle: fresh.properties?.title ?? 'planilha',
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
  }
}
