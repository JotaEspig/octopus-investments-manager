import type { sheets_v4 } from 'googleapis'
import { ASSET_CLASSES, OBJECTIVES, type AssetClass } from '@/domain/types'
import { explainSheetsError, type SheetsContext } from './client'
import {
  CLASS_CURRENCY,
  CONFIG_PRIVACY_ROW,
  DASHBOARD,
  DATA_SHEETS,
  NUMBER_FORMAT,
  SHEET,
  VIEW_FIRST_ROW,
  VIEW_ROWS,
  VIEW_SHEETS,
  type ColumnFormat,
} from './schema'

/**
 * ESTILIZAÇÃO DA PLANILHA — tudo o que é aparência mora aqui.
 *
 * `bootstrap.ts` cuida da estrutura (abas, fórmulas, intervalos nomeados,
 * gráficos); este módulo cuida de como aquilo se parece. A separação é o que
 * permite `npm run sheet:style` repintar a planilha sem tocar num único dado —
 * e permite você mexer no visual sem risco de quebrar um cálculo.
 *
 * É idempotente e SUBSTITUTIVO: listras e formatação condicional antigas são
 * removidas antes das novas, então rodar dez vezes dá o mesmo resultado de
 * rodar uma. Nenhum valor de célula é lido ou escrito.
 */

// ---------------------------------------------------------------------------
// Paleta
// ---------------------------------------------------------------------------

type Rgb = { red: number; green: number; blue: number }

const rgb = (hex: string): Rgb => ({
  red: Number.parseInt(hex.slice(1, 3), 16) / 255,
  green: Number.parseInt(hex.slice(3, 5), 16) / 255,
  blue: Number.parseInt(hex.slice(5, 7), 16) / 255,
})

/**
 * Uma cor por classe de ativo, usada na aba, no título e no cabeçalho.
 *
 * O objetivo é reconhecer a seção pela cor antes de ler o nome — por isso são
 * matizes bem distintos entre si, e não variações do mesmo azul. Todos escuros
 * o bastante para texto branco por cima passar em contraste.
 */
const CLASS_COLOR: Record<AssetClass, string> = {
  us_stock: '#1B4F91', // azul
  etf: '#0F6E62', // teal
  br_stock: '#B06010', // âmbar
  br_fii: '#6A3D9A', // roxo
  fixed_income: '#1F6B3B', // verde
}

const PALETTE = {
  /** Painel: mais escuro que as seções, para ler como "o topo". */
  dashboard: '#16283F',
  /** Abas de dados: cinza. São bastidor, não devem competir por atenção. */
  data: '#5A6672',
  headerText: '#FFFFFF',
  /** Listra alternada — quase imperceptível, só o suficiente para guiar a linha. */
  bandEven: '#FFFFFF',
  bandOdd: '#F4F7FA',
  border: '#C9D3DE',
  positive: '#137333',
  negative: '#B3261E',
  /** Fundo dos rótulos do bloco de totais do Painel. */
  highlight: '#E8EFF7',
  /** Controle de modo privacidade — grafite quase neutro, para não competir
   * com nenhum dos dois emojis (👁️/🙈) e ainda destacar por contraste puro
   * contra o resto do Painel. */
  privacyAccent: '#1E293B',
} as const

// ---------------------------------------------------------------------------
// Alinhamento
// ---------------------------------------------------------------------------

type Alignment = 'LEFT' | 'CENTER' | 'RIGHT'

/**
 * Alinhamento por natureza do dado, não por gosto: número à direita para as
 * casas decimais alinharem na vertical e dar para comparar magnitude batendo o
 * olho; data ao centro porque tem largura fixa; texto à esquerda.
 */
const ALIGNMENT: Record<ColumnFormat, Alignment> = {
  text: 'LEFT',
  boolean: 'CENTER',
  date: 'CENTER',
  datetime: 'CENTER',
  quantity: 'RIGHT',
  price: 'RIGHT',
  brl: 'RIGHT',
  usd: 'RIGHT',
  percent: 'RIGHT',
  factor: 'RIGHT',
}

// ---------------------------------------------------------------------------
// Requisições reutilizáveis
// ---------------------------------------------------------------------------

const grid = (
  sheetId: number,
  startRow: number,
  endRow: number | null,
  startColumn: number,
  endColumn: number,
): sheets_v4.Schema$GridRange => ({
  sheetId,
  startRowIndex: startRow,
  ...(endRow === null ? {} : { endRowIndex: endRow }),
  startColumnIndex: startColumn,
  endColumnIndex: endColumn,
})

function tabColor(sheetId: number, hex: string): sheets_v4.Schema$Request {
  return {
    updateSheetProperties: {
      properties: { sheetId, tabColor: rgb(hex) },
      fields: 'tabColor',
    },
  }
}

function headerRow(
  sheetId: number,
  row: number,
  columnCount: number,
  hex: string,
): sheets_v4.Schema$Request[] {
  return [
    {
      repeatCell: {
        range: grid(sheetId, row - 1, row, 0, columnCount),
        cell: {
          userEnteredFormat: {
            backgroundColor: rgb(hex),
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
            wrapStrategy: 'CLIP',
            textFormat: { bold: true, fontSize: 10, foregroundColor: rgb(PALETTE.headerText) },
          },
        },
        fields:
          'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)',
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'ROWS', startIndex: row - 1, endIndex: row },
        properties: { pixelSize: 32 },
        fields: 'pixelSize',
      },
    },
  ]
}

function titleCell(sheetId: number, row: number, hex: string, size: number): sheets_v4.Schema$Request {
  return {
    repeatCell: {
      range: grid(sheetId, row - 1, row, 0, 1),
      cell: {
        userEnteredFormat: {
          verticalAlignment: 'MIDDLE',
          textFormat: { bold: true, fontSize: size, foregroundColor: rgb(hex) },
        },
      },
      fields: 'userEnteredFormat(verticalAlignment,textFormat)',
    },
  }
}

function columnStyle(
  sheetId: number,
  columnIndex: number,
  firstDataRow: number,
  format: ColumnFormat | undefined,
  width: number | undefined,
): sheets_v4.Schema$Request[] {
  const requests: sheets_v4.Schema$Request[] = []
  const resolved = format ?? 'text'
  const numberFormat = NUMBER_FORMAT[resolved]

  requests.push({
    repeatCell: {
      range: grid(sheetId, firstDataRow - 1, null, columnIndex, columnIndex + 1),
      cell: {
        userEnteredFormat: {
          horizontalAlignment: ALIGNMENT[resolved],
          verticalAlignment: 'MIDDLE',
          ...(numberFormat ? { numberFormat } : {}),
        },
      },
      fields: numberFormat
        ? 'userEnteredFormat(horizontalAlignment,verticalAlignment,numberFormat)'
        : 'userEnteredFormat(horizontalAlignment,verticalAlignment)',
    },
  })

  if (width) {
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: columnIndex, endIndex: columnIndex + 1 },
        properties: { pixelSize: width },
        fields: 'pixelSize',
      },
    })
  }

  return requests
}

/** Listras alternadas na área de dados. */
function banding(
  sheetId: number,
  firstDataRow: number,
  lastRow: number | null,
  columnCount: number,
): sheets_v4.Schema$Request {
  return {
    addBanding: {
      bandedRange: {
        range: grid(sheetId, firstDataRow - 1, lastRow, 0, columnCount),
        rowProperties: {
          firstBandColor: rgb(PALETTE.bandEven),
          secondBandColor: rgb(PALETTE.bandOdd),
        },
      },
    },
  }
}

/** Linha fina abaixo do cabeçalho, para separar sem poluir com grade cheia. */
function headerUnderline(sheetId: number, row: number, columnCount: number): sheets_v4.Schema$Request {
  return {
    updateBorders: {
      range: grid(sheetId, row - 1, row, 0, columnCount),
      bottom: { style: 'SOLID_MEDIUM', color: rgb(PALETTE.border) },
    },
  }
}

/** Verde para ganho, vermelho para perda. */
function returnColors(sheetId: number, columnIndex: number): sheets_v4.Schema$Request[] {
  const range = grid(sheetId, VIEW_FIRST_ROW - 1, VIEW_FIRST_ROW + VIEW_ROWS - 1, columnIndex, columnIndex + 1)

  const rule = (type: string, hex: string) => ({
    addConditionalFormatRule: {
      rule: {
        ranges: [range],
        booleanRule: {
          condition: { type, values: [{ userEnteredValue: '0' }] },
          format: { textFormat: { bold: true, foregroundColor: rgb(hex) } },
        },
      },
    },
  })

  return [rule('NUMBER_GREATER', PALETTE.positive), rule('NUMBER_LESS', PALETTE.negative)]
}

/**
 * `ConditionalFormatRule.format` só aceita negrito/itálico/tachado/cor do
 * texto/cor de fundo — não dá para trocar o número por um texto tipo "•••"
 * via formatação condicional (a API rejeita `numberFormat` ali). O truque
 * possível dentro dessa restrição é pintar o texto da MESMA cor do fundo: a
 * célula vira um retângulo sólido, sem nenhum glifo visível.
 *
 * É só aparência: o valor por trás continua o número de verdade, e é isso que
 * permite outras fórmulas (ordenação, soma, % da carteira) continuarem
 * funcionando com o modo privacidade ligado. Limitação conhecida: selecionar
 * a célula no Sheets troca o fundo pelo azul de seleção, e o texto reaparece
 * — não é uma máscara à prova de clique, é para não expor valor na tela.
 *
 * O fundo do "bloco oculto" acompanha a cor da linha (listra clara/escura ou
 * o destaque do total), só um pouco mais escuro — para a listra continuar
 * guiando o olho mesmo com o valor escondido, em vez de virar uma faixa cinza
 * uniforme.
 */
function darken(hex: string, factor = 0.9): Rgb {
  const color = rgb(hex)
  return { red: color.red * factor, green: color.green * factor, blue: color.blue * factor }
}

/**
 * `INDIRECT`, não referência direta nem named range.
 *
 * Medido na planilha: `CUSTOM_FORMULA` da API do Sheets rejeita tanto named
 * range (`Invalid ConditionValue.userEnteredValue`) quanto referência direta
 * entre abas (`=Config!$B$10`) — só passa pela validação quando a referência
 * entre abas vem embrulhada em `INDIRECT`.
 *
 * Por isso `AND`/`MOD` (que precisam do separador `;` ou `,` conforme o
 * dialeto da planilha, e esta função não sabe qual foi detectado) também
 * ficam de fora: a condição de paridade da linha usa só `ISEVEN`/`ISODD`
 * (um argumento só) combinados por operador (`*`, `>`), que não dependem de
 * dialeto nenhum.
 */
const PRIVACY_CONDITION = `INDIRECT("${SHEET.config}!B${CONFIG_PRIVACY_ROW}")`
const PRIVACY_FORMULA = `=${PRIVACY_CONDITION}`

/**
 * Colunas de valor absoluto nas abas de classe. Fica de fora, de propósito:
 * `Rendimento %`, `% da classe`, `Taxa`, `Vencimento` — o que já é relativo
 * ou não é sensível continua visível com o modo privacidade ligado.
 */
const PRIVACY_MASKED_HEADERS = [
  'Posição',
  'Preço médio',
  'Cotação',
  'Custo total',
  'Valor de mercado',
  'Proventos',
  'Rendimento',
  'Aplicado (R$)',
  'Valor bruto (R$)',
  'Rendimento (R$)',
]

/**
 * Máscara para um bloco de UMA cor só (linha de total/destaque, sem listra
 * alternada) — fundo levemente mais escuro que `baseHex`.
 */
function privacyMaskFlat(range: sheets_v4.Schema$GridRange, baseHex: string): sheets_v4.Schema$Request {
  const masked = darken(baseHex)
  return {
    addConditionalFormatRule: {
      rule: {
        ranges: [range],
        booleanRule: {
          condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: PRIVACY_FORMULA }] },
          format: { backgroundColor: masked, textFormat: { foregroundColor: masked } },
        },
      },
    },
  }
}

/**
 * Máscara para um corpo de tabela com listra alternada: DUAS regras, uma por
 * paridade de linha, cada uma um pouco mais escura que a cor da listra que
 * ela substitui — a alternância continua visível, só mais escura.
 *
 * `firstDataRow` é a mesma linha passada para `banding()`: é ela que recebe
 * `firstBandColor`, e é em relação a ela que a paridade é calculada.
 */
function privacyMaskBanded(range: sheets_v4.Schema$GridRange, firstDataRow: number): sheets_v4.Schema$Request[] {
  const variants: Array<[string, string]> = [
    [`ISEVEN(ROW()-${firstDataRow})`, PALETTE.bandEven],
    [`ISODD(ROW()-${firstDataRow})`, PALETTE.bandOdd],
  ]

  return variants.map(([parity, baseHex]) => {
    const masked = darken(baseHex)
    return {
      addConditionalFormatRule: {
        rule: {
          ranges: [range],
          booleanRule: {
            condition: {
              type: 'CUSTOM_FORMULA',
              values: [{ userEnteredValue: `=(${PRIVACY_CONDITION})*(${parity})>0` }],
            },
            format: { backgroundColor: masked, textFormat: { foregroundColor: masked } },
          },
        },
      },
    }
  })
}

/**
 * Remove listras e regras condicionais existentes.
 *
 * Sem isto, cada execução do `sheet:style` empilharia uma camada nova e a
 * planilha ficaria progressivamente mais lenta — e a formatação condicional
 * antiga continuaria valendo por baixo.
 */
function clearDecorations(sheet: sheets_v4.Schema$Sheet): sheets_v4.Schema$Request[] {
  const sheetId = sheet.properties?.sheetId
  if (sheetId === null || sheetId === undefined) return []

  const requests: sheets_v4.Schema$Request[] = []

  for (const banded of sheet.bandedRanges ?? []) {
    if (banded.bandedRangeId != null) {
      requests.push({ deleteBanding: { bandedRangeId: banded.bandedRangeId } })
    }
  }

  // De trás para frente: apagar por índice reindexa o que vem depois.
  const ruleCount = (sheet.conditionalFormats ?? []).length
  for (let index = ruleCount - 1; index >= 0; index -= 1) {
    requests.push({ deleteConditionalFormatRule: { sheetId, index } })
  }

  return requests
}

/**
 * Zera TODA a formatação de célula de uma aba — cor de fundo, texto, borda,
 * formato numérico.
 *
 * `clearDecorations` (acima) só cuida de listra e formatação condicional;
 * `userEnteredFormat` posto por `repeatCell` (fundo do cabeçalho, número,
 * etc.) fica pra sempre se ninguém apagar explicitamente. No Painel isso já
 * causou sobra visível: quando uma tabela muda de linha ou coluna entre
 * versões (a de objetivo já esteve ao lado da de classe, em H:L), a
 * formatação da posição antiga não é reescrita e continua lá — células
 * pintadas onde não deveria ter nada. Só o Painel precisa disto hoje, porque
 * é a única aba cujo layout já mudou de posição; `DATA_SHEETS`/`VIEW_SHEETS`
 * só crescem no fim.
 */
function clearAllCellFormat(sheetId: number): sheets_v4.Schema$Request {
  return {
    repeatCell: {
      range: { sheetId },
      cell: { userEnteredFormat: {} },
      fields: 'userEnteredFormat',
    },
  }
}

/**
 * Volta toda linha/coluna da aba para o tamanho padrão do Sheets (21px de
 * altura, 100px de largura).
 *
 * Mesmo motivo de `clearAllCellFormat`: `updateDimensionProperties` marca a
 * linha/coluna pelo ÍNDICE, não pelo conteúdo — uma linha que um dia foi
 * cabeçalho (32px de altura) e deixou de ser continua com 32px pra sempre,
 * porque nada nunca pede pra ela voltar ao padrão. Foi assim que a linha 35
 * (cabeçalho da tabela de ativos numa posição de layout anterior a esta
 * funcionalidade) ficou mais alta que as vizinhas mesmo depois de a tabela
 * mudar de lugar.
 */
function resetDimensions(sheetId: number): sheets_v4.Schema$Request[] {
  return [
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'ROWS' },
        properties: { pixelSize: 21 },
        fields: 'pixelSize',
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS' },
        properties: { pixelSize: 100 },
        fields: 'pixelSize',
      },
    },
  ]
}

/** Contorno no PERÍMETRO do intervalo, sem linha entre colunas ou linhas internas. */
function outerBorder(range: sheets_v4.Schema$GridRange): sheets_v4.Schema$Request {
  const style = { style: 'SOLID' as const, color: rgb(PALETTE.border) }
  return {
    updateBorders: {
      range,
      top: style,
      bottom: style,
      left: style,
      right: style,
    },
  }
}

// ---------------------------------------------------------------------------
// Estilização
// ---------------------------------------------------------------------------

export interface StyleReport {
  actions: string[]
  spreadsheetUrl: string
}

export async function applyStyling(context: SheetsContext): Promise<StyleReport> {
  const { api, spreadsheetId } = context
  const actions: string[] = []

  let meta: sheets_v4.Schema$Spreadsheet
  try {
    meta = (await api.spreadsheets.get({ spreadsheetId, includeGridData: false })).data
  } catch (error) {
    throw new Error(explainSheetsError(error, context))
  }

  const byTitle = new Map<string, sheets_v4.Schema$Sheet>()
  for (const sheet of meta.sheets ?? []) {
    if (sheet.properties?.title) byTitle.set(sheet.properties.title, sheet)
  }

  const requests: sheets_v4.Schema$Request[] = []

  // --- Abas de dados: cinza, discretas -----------------------------------
  for (const spec of DATA_SHEETS) {
    const sheet = byTitle.get(spec.title)
    const sheetId = sheet?.properties?.sheetId
    if (!sheet || sheetId == null) continue

    requests.push(...clearDecorations(sheet))
    requests.push(tabColor(sheetId, PALETTE.data))
    requests.push(...headerRow(sheetId, 1, spec.columns.length, PALETTE.data))
    requests.push(headerUnderline(sheetId, 1, spec.columns.length))
    requests.push(banding(sheetId, 2, null, spec.columns.length))

    for (const [index, column] of spec.columns.entries()) {
      requests.push(...columnStyle(sheetId, index, 2, column.format, column.width))
    }
  }
  actions.push(`${DATA_SHEETS.length} abas de dados estilizadas`)

  // --- Abas de classe: cada uma com a sua cor ----------------------------
  for (const spec of VIEW_SHEETS) {
    const sheet = byTitle.get(spec.title)
    const sheetId = sheet?.properties?.sheetId
    if (!sheet || sheetId == null) continue

    const color = CLASS_COLOR[spec.assetClass]
    const lastRow = VIEW_FIRST_ROW + VIEW_ROWS - 1

    requests.push(...clearDecorations(sheet))
    requests.push(tabColor(sheetId, color))
    requests.push(titleCell(sheetId, 1, color, 14))
    requests.push(...headerRow(sheetId, 2, spec.columns.length, color))
    requests.push(headerUnderline(sheetId, 2, spec.columns.length))
    requests.push(banding(sheetId, VIEW_FIRST_ROW, lastRow, spec.columns.length))

    for (const [index, column] of spec.columns.entries()) {
      // `native` vira R$ ou US$ conforme a moeda da classe da aba.
      const format: ColumnFormat | undefined =
        column.format === 'native'
          ? CLASS_CURRENCY[spec.assetClass] === 'USD'
            ? 'usd'
            : 'brl'
          : column.format
      requests.push(...columnStyle(sheetId, index, VIEW_FIRST_ROW, format, column.width))
    }

    // Total da aba, na linha 1: destacado, sempre em reais.
    requests.push({
      repeatCell: {
        range: grid(sheetId, 0, 1, spec.totalColumn - 1, spec.totalColumn + 1),
        cell: {
          userEnteredFormat: {
            backgroundColor: rgb(PALETTE.highlight),
            horizontalAlignment: 'RIGHT',
            textFormat: { bold: true, fontSize: 11, foregroundColor: rgb(color) },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,textFormat)',
      },
    })
    requests.push({
      repeatCell: {
        range: grid(sheetId, 0, 1, spec.totalColumn, spec.totalColumn + 1),
        cell: { userEnteredFormat: { numberFormat: NUMBER_FORMAT.brl! } },
        fields: 'userEnteredFormat.numberFormat',
      },
    })

    for (const header of ['Rendimento', 'Rendimento %', 'Rendimento (R$)']) {
      const column = spec.columns.findIndex((candidate) => candidate.header === header)
      if (column >= 0) requests.push(...returnColors(sheetId, column))
    }

    // Modo privacidade: mascara os valores absolutos, mantendo percentuais
    // (`Rendimento %`, `% da classe`) e dados não sensíveis (`Taxa`,
    // `Vencimento`) visíveis. Localiza por cabeçalho, nunca por índice fixo.
    for (const header of PRIVACY_MASKED_HEADERS) {
      const column = spec.columns.findIndex((candidate) => candidate.header === header)
      if (column < 0) continue
      requests.push(
        ...privacyMaskBanded(grid(sheetId, VIEW_FIRST_ROW - 1, lastRow, column, column + 1), VIEW_FIRST_ROW),
      )
    }
    // `TOTAL_HEADER` ("Valor (R$)") não bate com nenhum item de
    // `PRIVACY_MASKED_HEADERS` — é localizado por `spec.totalColumn`, não por
    // texto de cabeçalho, porque o mesmo nome também rotula o total do topo
    // (linha 1, fundo de destaque, mascarado à parte logo abaixo).
    requests.push(
      ...privacyMaskBanded(
        grid(sheetId, VIEW_FIRST_ROW - 1, lastRow, spec.totalColumn, spec.totalColumn + 1),
        VIEW_FIRST_ROW,
      ),
    )
    requests.push(
      privacyMaskFlat(grid(sheetId, 0, 1, spec.totalColumn, spec.totalColumn + 1), PALETTE.highlight),
    )
  }
  actions.push(`${VIEW_SHEETS.length} seções coloridas, uma cor por classe`)

  // --- Painel -------------------------------------------------------------
  const dashboard = byTitle.get(DASHBOARD.title)
  const dashboardId = dashboard?.properties?.sheetId
  if (dashboard && dashboardId != null) {
    const allocationFirst = DASHBOARD.allocationFirstRow
    const allocationLast = allocationFirst + ASSET_CLASSES.length - 1

    requests.push(...clearDecorations(dashboard))
    requests.push(clearAllCellFormat(dashboardId))
    requests.push(...resetDimensions(dashboardId))
    requests.push(tabColor(dashboardId, PALETTE.dashboard))
    requests.push(titleCell(dashboardId, 1, PALETTE.dashboard, 20))
    // Linha do título: fonte 20pt não cabe na altura padrão (21px).
    requests.push({
      updateDimensionProperties: {
        range: { sheetId: dashboardId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 40 },
        fields: 'pixelSize',
      },
    })

    // Bloco de totais: rótulo à esquerda com fundo, valor à direita em destaque.
    requests.push({
      repeatCell: {
        range: grid(dashboardId, DASHBOARD.totalRow - 1, DASHBOARD.updatedRow, 0, 1),
        cell: {
          userEnteredFormat: {
            backgroundColor: rgb(PALETTE.highlight),
            textFormat: { bold: true, foregroundColor: rgb(PALETTE.dashboard) },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat)',
      },
    })
    requests.push({
      repeatCell: {
        range: grid(dashboardId, DASHBOARD.totalRow - 1, DASHBOARD.totalRow, 1, 2),
        cell: {
          userEnteredFormat: {
            numberFormat: NUMBER_FORMAT.brl!,
            horizontalAlignment: 'RIGHT',
            textFormat: { bold: true, fontSize: 16, foregroundColor: rgb(PALETTE.dashboard) },
          },
        },
        fields: 'userEnteredFormat(numberFormat,horizontalAlignment,textFormat)',
      },
    })
    // Linha do patrimônio total: fonte 16pt não cabe na altura padrão (21px).
    requests.push({
      updateDimensionProperties: {
        range: { sheetId: dashboardId, dimension: 'ROWS', startIndex: DASHBOARD.totalRow - 1, endIndex: DASHBOARD.totalRow },
        properties: { pixelSize: 30 },
        fields: 'pixelSize',
      },
    })
    requests.push(
      privacyMaskFlat(
        grid(dashboardId, DASHBOARD.totalRow - 1, DASHBOARD.totalRow, 1, 2),
        PALETTE.highlight,
      ),
    )
    requests.push({
      repeatCell: {
        range: grid(dashboardId, DASHBOARD.fxRow - 1, DASHBOARD.fxRow, 1, 2),
        cell: {
          userEnteredFormat: { numberFormat: NUMBER_FORMAT.price!, horizontalAlignment: 'RIGHT' },
        },
        fields: 'userEnteredFormat(numberFormat,horizontalAlignment)',
      },
    })
    requests.push({
      repeatCell: {
        range: grid(dashboardId, DASHBOARD.updatedRow - 1, DASHBOARD.updatedRow, 1, 2),
        cell: {
          userEnteredFormat: {
            numberFormat: NUMBER_FORMAT.datetime!,
            horizontalAlignment: 'RIGHT',
          },
        },
        fields: 'userEnteredFormat(numberFormat,horizontalAlignment)',
      },
    })

    // Checkbox de modo privacidade: bloco isolado no canto da linha do
    // título, cor de destaque forte para ficar bem visível — não é mais um
    // dado da lista, é um controle.
    const privacyControlRange = grid(
      dashboardId,
      DASHBOARD.privacyRow - 1,
      DASHBOARD.privacyRow,
      DASHBOARD.privacyLabelColumn,
      DASHBOARD.privacyCheckboxColumn + 1,
    )
    requests.push({
      repeatCell: {
        range: privacyControlRange,
        cell: {
          userEnteredFormat: {
            backgroundColor: rgb(PALETTE.privacyAccent),
            verticalAlignment: 'MIDDLE',
            horizontalAlignment: 'CENTER',
            textFormat: { bold: true, foregroundColor: rgb(PALETTE.headerText) },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,verticalAlignment,horizontalAlignment,textFormat)',
      },
    })
    requests.push({
      updateBorders: {
        range: privacyControlRange,
        top: { style: 'SOLID_MEDIUM', color: rgb(PALETTE.privacyAccent) },
        bottom: { style: 'SOLID_MEDIUM', color: rgb(PALETTE.privacyAccent) },
        left: { style: 'SOLID_MEDIUM', color: rgb(PALETTE.privacyAccent) },
        right: { style: 'SOLID_MEDIUM', color: rgb(PALETTE.privacyAccent) },
      },
    })
    // Coluna do rótulo larga o bastante para "🔒 Ocultar valores" caber sem
    // estourar por cima da coluna do checkbox.
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId: dashboardId,
          dimension: 'COLUMNS',
          startIndex: DASHBOARD.privacyLabelColumn,
          endIndex: DASHBOARD.privacyLabelColumn + 1,
        },
        properties: { pixelSize: 190 },
        fields: 'pixelSize',
      },
    })
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId: dashboardId,
          dimension: 'COLUMNS',
          startIndex: DASHBOARD.privacyCheckboxColumn,
          endIndex: DASHBOARD.privacyCheckboxColumn + 1,
        },
        properties: { pixelSize: 40 },
        fields: 'pixelSize',
      },
    })

    requests.push(...headerRow(dashboardId, DASHBOARD.allocationHeaderRow, 5, PALETTE.dashboard))
    requests.push(headerUnderline(dashboardId, DASHBOARD.allocationHeaderRow, 5))
    // `allocationLast`, sem +1: o padrão usado em `VIEW_SHEETS` é bandear até
    // a ÚLTIMA linha de dado, exclusive. Um `+1` aqui vazaria a listra pra
    // dentro da linha em branco que separa esta tabela da de objetivo.
    requests.push(banding(dashboardId, allocationFirst, allocationLast, 5))
    requests.push(
      outerBorder(grid(dashboardId, DASHBOARD.allocationHeaderRow - 1, allocationLast, 0, 5)),
    )

    // Cada linha da alocação recebe a cor da sua classe, casando com a aba.
    ASSET_CLASSES.forEach((assetClass, index) => {
      requests.push({
        repeatCell: {
          range: grid(dashboardId, allocationFirst - 1 + index, allocationFirst + index, 0, 1),
          cell: {
            userEnteredFormat: {
              textFormat: { bold: true, foregroundColor: rgb(CLASS_COLOR[assetClass]) },
            },
          },
          fields: 'userEnteredFormat.textFormat',
        },
      })
    })

    requests.push({
      repeatCell: {
        range: grid(dashboardId, allocationFirst - 1, allocationLast, 1, 2),
        cell: {
          userEnteredFormat: { numberFormat: NUMBER_FORMAT.brl!, horizontalAlignment: 'RIGHT' },
        },
        fields: 'userEnteredFormat(numberFormat,horizontalAlignment)',
      },
    })
    requests.push({
      repeatCell: {
        range: grid(dashboardId, allocationFirst - 1, allocationLast, 2, 5),
        cell: {
          userEnteredFormat: { numberFormat: NUMBER_FORMAT.percent!, horizontalAlignment: 'RIGHT' },
        },
        fields: 'userEnteredFormat(numberFormat,horizontalAlignment)',
      },
    })
    requests.push(
      ...privacyMaskBanded(grid(dashboardId, allocationFirst - 1, allocationLast, 1, 2), allocationFirst),
    )

    // Desvio da meta: verde acima, vermelho abaixo.
    const driftRange = grid(dashboardId, allocationFirst - 1, allocationLast, 4, 5)
    for (const [type, hex] of [
      ['NUMBER_GREATER', PALETTE.positive],
      ['NUMBER_LESS', PALETTE.negative],
    ] as const) {
      requests.push({
        addConditionalFormatRule: {
          rule: {
            ranges: [driftRange],
            booleanRule: {
              condition: { type, values: [{ userEnteredValue: '0' }] },
              format: { textFormat: { bold: true, foregroundColor: rgb(hex) } },
            },
          },
        },
      })
    }

    // Tabela de ativos, abaixo dos gráficos.
    const assetsLast = DASHBOARD.assetsFirstRow + VIEW_ROWS
    requests.push(titleCell(dashboardId, DASHBOARD.assetsTitleRow, PALETTE.dashboard, 13))
    requests.push(...headerRow(dashboardId, DASHBOARD.assetsHeaderRow, 5, PALETTE.dashboard))
    requests.push(headerUnderline(dashboardId, DASHBOARD.assetsHeaderRow, 5))
    requests.push(banding(dashboardId, DASHBOARD.assetsFirstRow, assetsLast, 5))
    requests.push(outerBorder(grid(dashboardId, DASHBOARD.assetsHeaderRow - 1, assetsLast, 0, 5)))
    requests.push({
      repeatCell: {
        range: grid(dashboardId, DASHBOARD.assetsFirstRow - 1, assetsLast, 1, 2),
        cell: {
          userEnteredFormat: { numberFormat: NUMBER_FORMAT.brl!, horizontalAlignment: 'RIGHT' },
        },
        fields: 'userEnteredFormat(numberFormat,horizontalAlignment)',
      },
    })
    requests.push({
      repeatCell: {
        range: grid(dashboardId, DASHBOARD.assetsFirstRow - 1, assetsLast, 3, 4),
        cell: {
          userEnteredFormat: { numberFormat: NUMBER_FORMAT.percent!, horizontalAlignment: 'RIGHT' },
        },
        fields: 'userEnteredFormat(numberFormat,horizontalAlignment)',
      },
    })
    requests.push(
      ...privacyMaskBanded(
        grid(dashboardId, DASHBOARD.assetsFirstRow - 1, assetsLast, 1, 2),
        DASHBOARD.assetsFirstRow,
      ),
    )
    // Classe e Objetivo são texto, mas alinhadas à direita para não destoar
    // das colunas numéricas ao lado.
    for (const columnIndex of [2, 4]) {
      requests.push({
        repeatCell: {
          range: grid(dashboardId, DASHBOARD.assetsFirstRow - 1, assetsLast, columnIndex, columnIndex + 1),
          cell: { userEnteredFormat: { horizontalAlignment: 'RIGHT' } },
          fields: 'userEnteredFormat(horizontalAlignment)',
        },
      })
    }

    for (const [index, width] of [220, 150, 150, 120, 210].entries()) {
      requests.push({
        updateDimensionProperties: {
          range: { sheetId: dashboardId, dimension: 'COLUMNS', startIndex: index, endIndex: index + 1 },
          properties: { pixelSize: width },
          fields: 'pixelSize',
        },
      })
    }

    // Tabela de alocação por objetivo — logo ABAIXO da de classe, mesma
    // largura (A:E). Sem cor por linha, diferente da tabela de classe:
    // objetivo não tem uma aba própria para casar a cor. Coluna A já fica
    // larga o bastante (220px, ajustada mais abaixo para a tabela de
    // ativos) para rótulos longos como "Proteção — sistêmica/moeda".
    const objectivesFirst = DASHBOARD.objectivesFirstRow
    const objectivesLast = objectivesFirst + OBJECTIVES.length - 1

    requests.push(...headerRow(dashboardId, DASHBOARD.objectivesHeaderRow, 5, PALETTE.dashboard))
    requests.push(headerUnderline(dashboardId, DASHBOARD.objectivesHeaderRow, 5))
    // Mesmo motivo do `banding` da tabela de classe: sem +1, pra não vazar
    // listra pra dentro da linha em branco antes da tabela de ativos.
    requests.push(banding(dashboardId, objectivesFirst, objectivesLast, 5))
    requests.push(
      outerBorder(grid(dashboardId, DASHBOARD.objectivesHeaderRow - 1, objectivesLast, 0, 5)),
    )

    requests.push({
      repeatCell: {
        range: grid(dashboardId, objectivesFirst - 1, objectivesLast, 1, 2),
        cell: {
          userEnteredFormat: { numberFormat: NUMBER_FORMAT.brl!, horizontalAlignment: 'RIGHT' },
        },
        fields: 'userEnteredFormat(numberFormat,horizontalAlignment)',
      },
    })
    requests.push({
      repeatCell: {
        range: grid(dashboardId, objectivesFirst - 1, objectivesLast, 2, 5),
        cell: {
          userEnteredFormat: { numberFormat: NUMBER_FORMAT.percent!, horizontalAlignment: 'RIGHT' },
        },
        fields: 'userEnteredFormat(numberFormat,horizontalAlignment)',
      },
    })
    requests.push(
      ...privacyMaskBanded(grid(dashboardId, objectivesFirst - 1, objectivesLast, 1, 2), objectivesFirst),
    )

    const objectivesDriftRange = grid(dashboardId, objectivesFirst - 1, objectivesLast, 4, 5)
    for (const [type, hex] of [
      ['NUMBER_GREATER', PALETTE.positive],
      ['NUMBER_LESS', PALETTE.negative],
    ] as const) {
      requests.push({
        addConditionalFormatRule: {
          rule: {
            ranges: [objectivesDriftRange],
            booleanRule: {
              condition: { type, values: [{ userEnteredValue: '0' }] },
              format: { textFormat: { bold: true, foregroundColor: rgb(hex) } },
            },
          },
        },
      })
    }

    actions.push('Painel estilizado: totais em destaque, alocação por classe e por objetivo, e tabela de ativos')
  }

  // --- Grade off: com listras e bordas ela vira ruído --------------------
  for (const sheet of [...DATA_SHEETS.map((s) => s.title), ...VIEW_SHEETS.map((s) => s.title), DASHBOARD.title]) {
    const sheetId = byTitle.get(sheet)?.properties?.sheetId
    if (sheetId == null) continue
    requests.push({
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { hideGridlines: true } },
        fields: 'gridProperties.hideGridlines',
      },
    })
  }

  try {
    await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } })
  } catch (error) {
    throw new Error(explainSheetsError(error, context))
  }

  actions.push(`${requests.length} ajustes de formatação aplicados`)

  return {
    actions,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
  }
}
