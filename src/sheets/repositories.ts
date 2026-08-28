import type { sheets_v4 } from 'googleapis'
import type {
  Asset,
  AssetClass,
  Currency,
  FixedIncomeContract,
  FixedIncomeIndexer,
  Objective,
  Trade,
  TradeKind,
} from '@/domain/types'
import { fromSheetDate, toSheetDate } from '@/lib/dates'
import { parseNumber } from '@/lib/money'
import type { AssetInput, FixedIncomeInput, TradeInput } from '@/lib/schemas'
import { explainSheetsError, type SheetsContext } from './client'
import {
  ASSETS_SHEET,
  CONFIG_SHEET,
  FIXED_INCOME_SHEET,
  QUOTES_SHEET,
  SHEET,
  TARGET_GOAL_KEY_PREFIX,
  TARGET_KEY_PREFIX,
  TRADES_SHEET,
  ref,
  type DataSheetSpec,
} from './schema'
import { columnLetter } from './bootstrap'

/**
 * Leitura e escrita das abas de dados.
 *
 * Nenhum intervalo é escrito à mão aqui: a posição de cada coluna vem de
 * `schema.ts`, então reordenar uma coluna lá conserta este arquivo de graça.
 *
 * Escreve-se APENAS nas abas de dados. As abas de apresentação são derivadas
 * por fórmula e o código nunca encosta nelas.
 */

/**
 * Como pedimos os valores ao Sheets.
 *
 * `UNFORMATTED_VALUE` traz números crus (e não "R$ 1.000,00"), e
 * `FORMATTED_STRING` traz datas como `dd/mm/yyyy` em vez do número serial —
 * a combinação que dá o menor trabalho de parsing dos dois lados.
 */
const READ_OPTIONS = {
  valueRenderOption: 'UNFORMATTED_VALUE' as const,
  dateTimeRenderOption: 'FORMATTED_STRING' as const,
}

type Row = unknown[]

/** Índice (0-based) de uma coluna pelo `key` do schema. */
function indexOf(spec: DataSheetSpec, key: string): number {
  const index = spec.columns.findIndex((column) => column.key === key)
  if (index < 0) throw new Error(`Coluna "${key}" não existe em ${spec.title} (schema.ts)`)
  return index
}

/** Intervalo das colunas que o código escreve, da linha `row` até ela mesma. */
function writableRange(spec: DataSheetSpec, row: number): string {
  return ref(spec.title, `A${row}:${columnLetter(spec.writableColumns - 1)}${row}`)
}

/** Intervalo de leitura: da linha 2 ao fim, cobrindo todas as colunas. */
function dataRange(spec: DataSheetSpec): string {
  return ref(spec.title, `A2:${columnLetter(spec.columns.length - 1)}`)
}

const text = (row: Row, index: number) => String(row[index] ?? '').trim()
const bool = (row: Row, index: number) => /^(sim|true|1|x)$/i.test(text(row, index))

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

function toTrade(row: Row): Trade | null {
  const id = text(row, indexOf(TRADES_SHEET, 'id'))
  if (!id) return null
  return {
    id,
    date: fromSheetDate(row[indexOf(TRADES_SHEET, 'date')]),
    kind: text(row, indexOf(TRADES_SHEET, 'kind')) as TradeKind,
    symbol: text(row, indexOf(TRADES_SHEET, 'symbol')),
    quantity: parseNumber(row[indexOf(TRADES_SHEET, 'quantity')]),
    unitPrice: parseNumber(row[indexOf(TRADES_SHEET, 'unitPrice')]),
    currency: (text(row, indexOf(TRADES_SHEET, 'currency')) || 'BRL') as Currency,
    fees: parseNumber(row[indexOf(TRADES_SHEET, 'fees')]),
    fxRate: parseNumber(row[indexOf(TRADES_SHEET, 'fxRate')]) || 1,
    note: text(row, indexOf(TRADES_SHEET, 'note')),
  }
}

function toAsset(row: Row): Asset | null {
  const symbol = text(row, indexOf(ASSETS_SHEET, 'symbol'))
  if (!symbol) return null
  return {
    symbol,
    name: text(row, indexOf(ASSETS_SHEET, 'name')),
    assetClass: text(row, indexOf(ASSETS_SHEET, 'assetClass')) as AssetClass,
    currency: (text(row, indexOf(ASSETS_SHEET, 'currency')) || 'BRL') as Currency,
    broker: text(row, indexOf(ASSETS_SHEET, 'broker')),
    // '' em ativo cadastrado antes desta coluna existir — nunca um objetivo.
    objective: text(row, indexOf(ASSETS_SHEET, 'objective')) as Objective | '',
  }
}

function toContract(row: Row): FixedIncomeContract | null {
  const symbol = text(row, indexOf(FIXED_INCOME_SHEET, 'symbol'))
  if (!symbol) return null
  return {
    symbol,
    name: text(row, indexOf(FIXED_INCOME_SHEET, 'name')),
    issuer: text(row, indexOf(FIXED_INCOME_SHEET, 'issuer')),
    indexer: text(row, indexOf(FIXED_INCOME_SHEET, 'indexer')) as FixedIncomeIndexer,
    rate: parseNumber(row[indexOf(FIXED_INCOME_SHEET, 'rate')]),
    issueDate: fromSheetDate(row[indexOf(FIXED_INCOME_SHEET, 'issueDate')]),
    maturity: fromSheetDate(row[indexOf(FIXED_INCOME_SHEET, 'maturity')]),
    dailyLiquidity: bool(row, indexOf(FIXED_INCOME_SHEET, 'dailyLiquidity')),
    fgc: bool(row, indexOf(FIXED_INCOME_SHEET, 'fgc')),
    marketValue: parseNumber(row[indexOf(FIXED_INCOME_SHEET, 'marketValue')]),
    objective: text(row, indexOf(FIXED_INCOME_SHEET, 'objective')) as Objective | '',
  }
}

export interface PortfolioData {
  trades: Trade[]
  assets: Asset[]
  contracts: FixedIncomeContract[]
  quotes: Map<string, number>
  fxRate: number
  targets: Map<AssetClass, number>
  objectiveTargets: Map<Objective, number>
}

/**
 * Lê tudo o que a carteira precisa numa única viagem à API.
 *
 * É um `batchGet` de propósito: o servidor MCP chama isto a cada pergunta do
 * agente, e seis requisições separadas encostariam no limite de 60/min por
 * usuário numa conversa um pouco mais longa.
 */
export async function readPortfolioData(context: SheetsContext): Promise<PortfolioData> {
  const ranges = [
    dataRange(TRADES_SHEET),
    dataRange(ASSETS_SHEET),
    dataRange(FIXED_INCOME_SHEET),
    dataRange(QUOTES_SHEET),
    dataRange(CONFIG_SHEET),
  ]

  let response: sheets_v4.Schema$BatchGetValuesResponse
  try {
    const result = await context.api.spreadsheets.values.batchGet({
      spreadsheetId: context.spreadsheetId,
      ranges,
      ...READ_OPTIONS,
    })
    response = result.data
  } catch (error) {
    throw new Error(explainSheetsError(error, context))
  }

  const [tradeRows, assetRows, contractRows, quoteRows, configRows] = (
    response.valueRanges ?? []
  ).map((range) => (range.values ?? []) as Row[])

  const quotes = new Map<string, number>()
  for (const row of quoteRows ?? []) {
    const symbol = text(row, indexOf(QUOTES_SHEET, 'symbol'))
    if (symbol) quotes.set(symbol, parseNumber(row[indexOf(QUOTES_SHEET, 'price')]))
  }

  const config = new Map<string, unknown>()
  for (const row of configRows ?? []) {
    const key = text(row, indexOf(CONFIG_SHEET, 'key'))
    if (key) config.set(key, row[indexOf(CONFIG_SHEET, 'value')])
  }

  const targets = new Map<AssetClass, number>()
  const objectiveTargets = new Map<Objective, number>()
  for (const [key, value] of config) {
    // `target_goal_x` também começa com `target_` — checar o prefixo mais
    // específico primeiro é o que impede a meta de objetivo de ser lida como
    // se fosse meta de classe.
    if (key.startsWith(TARGET_GOAL_KEY_PREFIX)) {
      objectiveTargets.set(key.slice(TARGET_GOAL_KEY_PREFIX.length) as Objective, parseNumber(value))
    } else if (key.startsWith(TARGET_KEY_PREFIX)) {
      targets.set(key.slice(TARGET_KEY_PREFIX.length) as AssetClass, parseNumber(value))
    }
  }

  return {
    trades: (tradeRows ?? []).map(toTrade).filter((trade): trade is Trade => trade !== null),
    assets: (assetRows ?? []).map(toAsset).filter((asset): asset is Asset => asset !== null),
    contracts: (contractRows ?? [])
      .map(toContract)
      .filter((contract): contract is FixedIncomeContract => contract !== null),
    quotes,
    fxRate: parseNumber(config.get('usd_brl')) || 1,
    targets,
    objectiveTargets,
  }
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

/**
 * Primeira linha livre, medida pela coluna A.
 *
 * Não usamos `values.append` porque `Operações` tem colunas derivadas por
 * ARRAYFORMULA que se estendem até o fim da grade — o append enxergaria isso
 * como "tabela" e escreveria lá embaixo, na linha 1001.
 */
async function nextRow(context: SheetsContext, spec: DataSheetSpec): Promise<number> {
  const response = await context.api.spreadsheets.values.get({
    spreadsheetId: context.spreadsheetId,
    range: ref(spec.title, 'A:A'),
  })
  return (response.data.values?.length ?? 1) + 1
}

/**
 * Fórmula que o CÓDIGO quer que seja fórmula.
 *
 * Existe para separar as duas intenções que passam pelo mesmo cano: a fórmula
 * de cotação que precisa ser interpretada, e o texto do usuário que nunca deve
 * ser. Sem essa marca explícita, ou o `GOOGLEFINANCE` viraria texto ou uma
 * anotação viraria fórmula — e o segundo erro é o perigoso.
 */
class SheetFormula {
  constructor(readonly text: string) {}
}

export const formula = (text: string) => new SheetFormula(text)

/**
 * Caracteres que fazem o Google Sheets interpretar a célula como FÓRMULA.
 *
 * Menos que no CSV de propósito: medido na planilha, o Sheets só dispara com
 * `=` e `+`. `@` não é gatilho aqui e `-` apenas coage número — `-- ajuste
 * manual` continua texto. Escapar a mais poluiria anotações legítimas.
 */
const SHEETS_FORMULA_TRIGGERS = ['=', '+']

/**
 * Neutraliza injeção de fórmula na ESCRITA.
 *
 * O apóstrofo é o marcador de "isto é texto" do Sheets: ele não faz parte do
 * valor, some na exibição e a leitura devolve a string original. Verificado na
 * planilha — `'=1+1` volta como `=1+1`, e não como `2`.
 *
 * Sem isto, gravar com `USER_ENTERED` faria uma anotação como
 * `=HYPERLINK("http://x";"clique")` virar link ativo dentro do livro-razão.
 */
export function escapeSheetsFormula(value: unknown): unknown {
  if (typeof value !== 'string') return value
  return SHEETS_FORMULA_TRIGGERS.includes(value.charAt(0)) ? `'${value}` : value
}

/**
 * `USER_ENTERED` é necessário para o Sheets reconhecer `25/08/2026` como data
 * em vez de texto. O preço é que ele interpreta TUDO — por isso cada valor
 * passa pelo neutralizador, e só o que veio marcado como `formula()` escapa
 * dele.
 */
async function writeRow(context: SheetsContext, spec: DataSheetSpec, values: unknown[]) {
  const row = await nextRow(context, spec)
  const safe = values.map((value) =>
    value instanceof SheetFormula ? value.text : escapeSheetsFormula(value),
  )

  try {
    await context.api.spreadsheets.values.update({
      spreadsheetId: context.spreadsheetId,
      range: writableRange(spec, row),
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [safe] as never },
    })
  } catch (error) {
    throw new Error(explainSheetsError(error, context))
  }
  return row
}

/** Id legível: dá para achar a operação na planilha só de bater o olho. */
export function newTradeId(input: TradeInput): string {
  const random = Math.random().toString(36).slice(2, 7)
  return `${input.date}-${input.kind}-${input.symbol}-${random}`.toLowerCase()
}

export async function appendTrade(context: SheetsContext, input: TradeInput): Promise<Trade> {
  const trade: Trade = { ...input, id: newTradeId(input) }
  await writeRow(context, TRADES_SHEET, [
    trade.id,
    toSheetDate(trade.date),
    trade.kind,
    trade.symbol,
    trade.quantity,
    trade.unitPrice,
    trade.currency,
    trade.fees,
    trade.fxRate,
    trade.note,
  ])
  return trade
}

/**
 * Fórmula de cotação do ativo.
 *
 * Sem `IFERROR` de propósito: se o GOOGLEFINANCE não conhecer o papel, a célula
 * mostra `#N/A` e você VÊ o problema. As abas de apresentação já tratam o erro
 * como zero, então o painel não quebra — mas `Cotações` continua denunciando.
 */
export function quoteFormula(symbol: string, assetClass: AssetClass): string {
  const isBrazilian = assetClass === 'br_stock' || assetClass === 'br_fii'
  const ticker = isBrazilian ? `BVMF:${symbol}` : symbol
  return `=GOOGLEFINANCE("${ticker}";"price")`
}

export async function appendAsset(context: SheetsContext, input: AssetInput): Promise<Asset> {
  await writeRow(context, ASSETS_SHEET, [
    input.symbol,
    input.name,
    input.assetClass,
    input.currency,
    input.broker,
    input.objective,
  ])
  await writeRow(context, QUOTES_SHEET, [
    input.symbol,
    // A única fórmula que este módulo grava de propósito.
    formula(quoteFormula(input.symbol, input.assetClass)),
    input.currency,
  ])
  return input
}

/**
 * Escreve uma célula avulsa fora do intervalo contíguo de `writableColumns`.
 *
 * Existe só para `objective` em `Contratos RF`: a coluna fica depois de
 * `marketValue`/`updatedAt`, que são do Apps Script, então não dá para incluí-
 * la no `writeRow` de uma tacada sem sobrescrever colunas que não são nossas.
 */
async function writeCell(
  context: SheetsContext,
  spec: DataSheetSpec,
  key: string,
  row: number,
  value: unknown,
): Promise<void> {
  const column = columnLetter(indexOf(spec, key))
  await context.api.spreadsheets.values.update({
    spreadsheetId: context.spreadsheetId,
    range: ref(spec.title, `${column}${row}`),
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[escapeSheetsFormula(value)]] as never },
  })
}

export async function appendContract(
  context: SheetsContext,
  input: FixedIncomeInput,
): Promise<FixedIncomeInput> {
  const row = await writeRow(context, FIXED_INCOME_SHEET, [
    input.symbol,
    input.name,
    input.issuer,
    input.indexer,
    input.rate,
    toSheetDate(input.issueDate),
    toSheetDate(input.maturity),
    input.dailyLiquidity ? 'sim' : 'não',
    input.fgc ? 'sim' : 'não',
  ])
  await writeCell(context, FIXED_INCOME_SHEET, 'objective', row, input.objective)
  return input
}

/**
 * Apaga fisicamente a linha da operação.
 *
 * É o "desfazer" de quem digitou errado, não a forma de registrar uma venda —
 * para isso existe o tipo `sell`. O livro-razão é append-only como modelo; esta
 * é a válvula de escape para o erro de digitação, e por isso a interface só a
 * oferece nas últimas operações.
 */
export async function deleteTrade(context: SheetsContext, id: string): Promise<boolean> {
  const response = await context.api.spreadsheets.values.get({
    spreadsheetId: context.spreadsheetId,
    range: ref(TRADES_SHEET.title, 'A:A'),
  })
  const rows = (response.data.values ?? []) as Row[]
  const index = rows.findIndex((row, position) => position > 0 && text(row, 0) === id)
  if (index < 0) return false

  const meta = await context.api.spreadsheets.get({
    spreadsheetId: context.spreadsheetId,
    includeGridData: false,
  })
  const sheetId = (meta.data.sheets ?? []).find(
    (sheet) => sheet.properties?.title === TRADES_SHEET.title,
  )?.properties?.sheetId
  if (sheetId === null || sheetId === undefined) return false

  await context.api.spreadsheets.batchUpdate({
    spreadsheetId: context.spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: { sheetId, dimension: 'ROWS', startIndex: index, endIndex: index + 1 },
          },
        },
      ],
    },
  })
  return true
}

/** URL da planilha, para os botões "abrir planilha". */
export function spreadsheetUrl(context: SheetsContext): string {
  return `https://docs.google.com/spreadsheets/d/${context.spreadsheetId}/edit`
}
