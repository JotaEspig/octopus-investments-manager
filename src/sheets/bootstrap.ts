import type { sheets_v4 } from 'googleapis'
import { ASSET_CLASSES, ASSET_CLASS_LABELS } from '@/domain/types'
import {
  CONFIG_FX_ROW,
  CONFIG_ROWS,
  DASHBOARD,
  DASHBOARD_ALLOCATION_HEADERS,
  DASHBOARD_ASSETS_HEADERS,
  DATA_SHEETS,
  DIALECT_PROBE,
  DIALECT_PROBE_EXPECTED,
  HISTORY_CHART_ROWS,
  NAMED_RANGE,
  SCHEMA_VERSION,
  SHEET,
  SPREADSHEET_LOCALE,
  SPREADSHEET_TIME_ZONE,
  VIEW_FIRST_ROW,
  VIEW_ROWS,
  VIEW_SHEETS,
  dashboardAssetsFormula,
  localizeValue,
  ref,
  type DataSheetSpec,
  type FormulaDialect,
  type ViewSheetSpec,
} from './schema'
import { explainSheetsError, type SheetsContext } from './client'
import { applyStyling } from './styling'
import {
  BLOCKED_BY_DRIFT,
  BLOCKED_BY_MIGRATION,
  checkDataSheetDrift,
  planMigrations,
  runMigrations,
} from './migrations'

/**
 * Instalador da planilha — a ESTRUTURA.
 *
 * Cria abas, escreve cabeçalhos e fórmulas, define intervalos nomeados e os
 * gráficos do Painel. A aparência é responsabilidade de `styling.ts`, chamado
 * no fim: assim `npm run sheet:style` repinta sem tocar em conteúdo, e mexer
 * no visual não arrisca quebrar um cálculo.
 *
 * É **idempotente** — rodar de novo conserta o que estiver faltando, não
 * duplica nada e não encosta nos dados já cadastrados.
 *
 * O que ele deliberadamente NÃO reescreve:
 * - linhas de dados em `Operações`, `Ativos`, `Contratos RF`, `CDI`, `Histórico`
 * - chaves de `Config` que já existem (as metas de alocação são suas para editar)
 * - fórmulas de `Cotações` (a escapatória quando o GOOGLEFINANCE falha)
 * - gráficos já criados (preservam ajuste manual de posição e cor)
 */

export interface BootstrapReport {
  actions: string[]
  warnings: string[]
  spreadsheetUrl: string
  spreadsheetTitle: string
}

/** Nomes que o Google dá à aba única de uma planilha nova. */
const DEFAULT_SHEET_TITLES = new Set(['Sheet1', 'Página1', 'Planilha1', 'Folha1'])

export function columnLetter(index: number): string {
  let letter = ''
  let value = index
  while (value >= 0) {
    letter = String.fromCharCode((value % 26) + 65) + letter
    value = Math.floor(value / 26) - 1
  }
  return letter
}

/** Ordem das abas: painel, seções por classe, depois os dados. */
function desiredSheetOrder(): string[] {
  return [DASHBOARD.title, ...VIEW_SHEETS.map((view) => view.title), ...DATA_SHEETS.map((s) => s.title)]
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
        ['Total (R$)', `=SUM(${totalColumnLetter}${VIEW_FIRST_ROW}:${totalColumnLetter}${lastRow})`],
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
    {
      range: ref(DASHBOARD.title, `A${DASHBOARD.assetsTitleRow}`),
      values: [['Ativos — participação dentro da própria classe']],
    },
    {
      range: ref(DASHBOARD.title, `A${DASHBOARD.assetsHeaderRow}:D${DASHBOARD.assetsHeaderRow}`),
      values: [DASHBOARD_ASSETS_HEADERS],
    },
    {
      range: ref(DASHBOARD.title, `A${DASHBOARD.assetsFirstRow}`),
      values: [[dashboardAssetsFormula()]],
    },
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
// Dialeto das fórmulas
// ---------------------------------------------------------------------------

/**
 * Descobre se esta planilha espera `;` ou `,` entre argumentos, escrevendo uma
 * fórmula-sonda e lendo o resultado.
 *
 * Detectar em vez de presumir custa duas requisições e elimina o modo de falha
 * mais silencioso do projeto: um locale inesperado transformaria cada fórmula
 * num `#ERROR!`, com a planilha parecendo instalada.
 *
 * A sonda vai numa célula bem longe (`Z1` de `Config`) e é apagada em seguida.
 */
async function detectDialect(
  context: SheetsContext,
  probeCell: string,
): Promise<{ dialect: FormulaDialect; probed: boolean }> {
  const { api, spreadsheetId } = context

  for (const dialect of ['semicolon', 'comma'] as const) {
    await api.spreadsheets.values.update({
      spreadsheetId,
      range: probeCell,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[localizeValue(DIALECT_PROBE, dialect)]] as never },
    })

    const read = await api.spreadsheets.values.get({ spreadsheetId, range: probeCell })
    if (String(read.data.values?.[0]?.[0] ?? '') === DIALECT_PROBE_EXPECTED) {
      await api.spreadsheets.values.clear({ spreadsheetId, range: probeCell, requestBody: {} })
      return { dialect, probed: true }
    }
  }

  await api.spreadsheets.values.clear({ spreadsheetId, range: probeCell, requestBody: {} })
  throw new Error(
    'A planilha rejeitou a fórmula-sonda nos dois dialetos (`;` e `,`). Isso indica que ela ' +
      'espera nomes de função localizados (SE em vez de IF). Mude o locale da planilha para ' +
      'português (Brasil) ou inglês em Arquivo → Configurações e rode de novo.',
  )
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
  // Precisa vir ANTES de qualquer fórmula: é ele que decide o dialeto.
  const setupRequests: sheets_v4.Schema$Request[] = []
  if (meta.properties?.locale !== SPREADSHEET_LOCALE) {
    setupRequests.push({
      updateSpreadsheetProperties: {
        properties: { locale: SPREADSHEET_LOCALE, timeZone: SPREADSHEET_TIME_ZONE },
        fields: 'locale,timeZone',
      },
    })
    actions.push(`Locale ajustado para ${SPREADSHEET_LOCALE}`)
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

  // --- 3. Migrações pendentes ---------------------------------------------
  //
  // Antes de reescrever qualquer cabeçalho: se uma versão anterior organizava
  // os dados de outro jeito, escrever o cabeçalho novo por cima das linhas
  // antigas as desalinharia em silêncio. Migração destrutiva exige o comando
  // dedicado, que faz backup e pede confirmação.
  const plan = await planMigrations(context)
  if (plan.touchesData) throw new Error(BLOCKED_BY_MIGRATION)

  if (plan.pending.length > 0) {
    const migrated = await runMigrations(context, { backup: false })
    actions.push(`Migrado da v${migrated.from} para a v${migrated.to}`)
  }

  // Cinto além do suspensório: a checagem acima confia em alguém ter subido a
  // versão. Esta olha a planilha de verdade e pega o caso mais provável de
  // todos — mexer numa coluna e esquecer de versionar a mudança.
  const drift = await checkDataSheetDrift(context)
  const broken = drift.filter((entry) => entry.drift.kind === 'breaking')
  if (broken.length > 0) {
    const details = broken
      .map((entry) => `  · ${entry.title}: ${(entry.drift as { reason: string }).reason}`)
      .join('\n')
    throw new Error(`${BLOCKED_BY_DRIFT}\n\n${details}`)
  }

  for (const entry of drift) {
    if (entry.drift.kind === 'additive') {
      actions.push(`${entry.title}: coluna(s) nova(s) — ${entry.drift.added.join(', ')}`)
    }
  }

  // --- 4. Dialeto ---------------------------------------------------------
  const { dialect } = await detectDialect(context, ref(SHEET.config, 'Z1'))
  actions.push(
    `Dialeto de fórmula detectado: separador "${dialect === 'semicolon' ? ';' : ','}"`,
  )

  // --- 5. Conteúdo --------------------------------------------------------
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
        data: valueRanges.map((entry) => ({
          range: entry.range,
          values: entry.values.map((row) =>
            row.map((cell) => localizeValue(cell, dialect)),
          ) as never,
        })),
      },
    })
  } catch (error) {
    throw new Error(explainSheetsError(error, context))
  }
  actions.push(`Fórmulas e cabeçalhos escritos (${valueRanges.length} intervalos)`)

  // --- 6. Intervalos nomeados, gráficos e ordem ---------------------------
  const structureRequests: sheets_v4.Schema$Request[] = []

  // O Painel referencia os totais por NOME, não por célula: mexer no layout de
  // uma aba de classe não quebra o painel.
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
      structureRequests.push({
        updateNamedRange: {
          namedRange: { namedRangeId: existingId, name: target.name, range },
          fields: 'range',
        },
      })
    } else {
      structureRequests.push({ addNamedRange: { namedRange: { name: target.name, range } } })
      actions.push(`Intervalo nomeado criado: ${target.name}`)
    }
  }

  // Gráficos: só na primeira vez. Recriar apagaria ajustes manuais.
  const dashboardCharts = sheetsByTitle.get(DASHBOARD.title)?.charts ?? []
  const dashboardId = sheetId(DASHBOARD.title)
  const historyId = sheetId(SHEET.history)
  if (dashboardCharts.length === 0 && dashboardId !== null && historyId !== null) {
    structureRequests.push(...chartRequests(dashboardId, historyId))
    actions.push('Gráficos criados: pizza de alocação e linha do patrimônio')
  } else if (dashboardCharts.length > 0) {
    actions.push(`Gráficos preservados (${dashboardCharts.length} já existiam)`)
  }

  for (const [index, title] of order.entries()) {
    const id = sheetId(title)
    const current = sheetsByTitle.get(title)?.properties?.index
    if (id === null || current === index) continue
    structureRequests.push({
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
      structureRequests.push({ deleteSheet: { sheetId: id } })
      actions.push(`Aba padrão vazia removida: ${title}`)
    } else {
      warnings.push(`A aba "${title}" tem conteúdo e foi mantida. Apague à mão se não precisar dela.`)
    }
  }

  if (structureRequests.length > 0) {
    try {
      await api.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: structureRequests },
      })
    } catch (error) {
      throw new Error(explainSheetsError(error, context))
    }
  }

  // --- 7. Aparência -------------------------------------------------------
  const style = await applyStyling(context)
  actions.push(...style.actions)

  return {
    actions,
    warnings,
    spreadsheetTitle: fresh.properties?.title ?? 'planilha',
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
  }
}
