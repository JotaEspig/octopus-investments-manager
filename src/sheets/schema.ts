/**
 * CONTRATO DA PLANILHA — fonte única de verdade sobre a estrutura do Google Sheets.
 *
 * Tudo o que descreve a planilha mora aqui: nomes de aba, ordem das colunas,
 * fórmulas, formatação e intervalos nomeados. O `bootstrap.ts` constrói a
 * planilha a partir deste arquivo e os repositórios leem/escrevem por estas
 * definições — nenhum outro módulo pode conter um "A2:J" solto.
 *
 * Mudou uma coluna de lugar? Suba `SCHEMA_VERSION` E registre a migração em
 * `migrations.ts` — o instalador se recusa a passar por cima de dados gravados.
 */

import { ASSET_CLASSES, ASSET_CLASS_LABELS, type AssetClass, type Currency } from '@/domain/types'

/** Gravada em `Config`. O instalador compara e avisa quando a planilha está velha. */
export const SCHEMA_VERSION = 2

/**
 * Locale e fuso da planilha: definem como datas e moeda aparecem, e também
 * qual dialeto de fórmula o Sheets espera (ver `FORMULA_TOKEN` abaixo).
 */
export const SPREADSHEET_LOCALE = 'pt_BR'
export const SPREADSHEET_TIME_ZONE = 'America/Sao_Paulo'

/**
 * DIALETO DAS FÓRMULAS — e por que ele é detectado, não presumido.
 *
 * O Sheets interpreta uma fórmula conforme o locale da planilha, e locales
 * diferentes usam pontuação diferente:
 *
 *                      argumentos   coluna de matriz   linha de matriz
 *   pt_BR                  ;              \                  ;
 *   en_US                  ,              ,                  ;
 *
 * Reparem que `;` significa coisas diferentes nos dois — por isso não dá para
 * converter um no outro com um replace ingênuo. As fórmulas deste arquivo são
 * escritas no dialeto `;` e os dois pontos ambíguos (só a tabela de ativos do
 * Painel usa literal de matriz) são marcados com tokens.
 *
 * O bootstrap descobre o dialeto certo escrevendo uma fórmula-sonda e lendo o
 * resultado, em vez de apostar. Sem isso, um locale inesperado encheria a
 * planilha de `#ERROR!` em silêncio.
 */
export const FORMULA_TOKEN = {
  arg: '\u0001',
  arrayColumn: '\u0002',
  arrayRow: '\u0003',
} as const

export type FormulaDialect = 'semicolon' | 'comma'

export const FORMULA_DIALECTS: Record<
  FormulaDialect,
  { arg: string; arrayColumn: string; arrayRow: string }
> = {
  semicolon: { arg: ';', arrayColumn: '\\', arrayRow: ';' },
  comma: { arg: ',', arrayColumn: ',', arrayRow: ';' },
}

/** Fórmula-sonda: se voltar `OK`, o dialeto está certo. */
export const DIALECT_PROBE = '=IF(1=1;"OK";"FAIL")'
export const DIALECT_PROBE_EXPECTED = 'OK'

/**
 * Traduz uma fórmula do dialeto de escrita para o da planilha.
 *
 * A ordem importa: o `;` genérico é trocado ANTES dos tokens, senão a troca
 * seguinte reverteria o separador de linha de matriz que acabou de ser posto.
 */
export function localizeFormula(formula: string, dialect: FormulaDialect): string {
  const separators = FORMULA_DIALECTS[dialect]
  const withArgs = separators.arg === ';' ? formula : formula.replaceAll(';', separators.arg)
  return withArgs
    .replaceAll(FORMULA_TOKEN.arg, separators.arg)
    .replaceAll(FORMULA_TOKEN.arrayColumn, separators.arrayColumn)
    .replaceAll(FORMULA_TOKEN.arrayRow, separators.arrayRow)
}

/** Aplica `localizeFormula` só no que é fórmula; texto e número passam intactos. */
export function localizeValue(value: unknown, dialect: FormulaDialect): unknown {
  return typeof value === 'string' && value.startsWith('=')
    ? localizeFormula(value, dialect)
    : value
}

/**
 * Quantas linhas de fórmula cada aba de apresentação replica — o teto de
 * ativos por classe. Cem é folgado para uma carteira pessoal; se um dia
 * estourar, as abas param de listar em silêncio, e é por isso que
 * `verify:sheet` confere a contagem.
 */
export const VIEW_ROWS = 100

/** Primeira linha de dados nas abas de apresentação (1 = título, 2 = cabeçalho). */
export const VIEW_FIRST_ROW = 3

// ---------------------------------------------------------------------------
// Nomes das abas
// ---------------------------------------------------------------------------

/**
 * Rótulos em português porque são o que você lê dentro da planilha — a decisão
 * de nomear identificadores em inglês vale para o código, não para a interface.
 */
export const SHEET = {
  trades: 'Operações',
  assets: 'Ativos',
  fixedIncome: 'Contratos RF',
  quotes: 'Cotações',
  cdi: 'CDI',
  history: 'Histórico',
  config: 'Config',
  dashboard: 'Painel',
} as const

/** Uma aba de apresentação por classe de ativo. */
export const VIEW_SHEET: Record<AssetClass, string> = {
  us_stock: 'Ações EUA',
  us_etf: 'ETFs',
  br_stock: 'Ações BR',
  br_fii: 'FIIs',
  fixed_income: 'Renda Fixa',
}

/** Envolve em aspas simples quando o nome tem espaço ou acento. */
export function ref(sheet: string, range: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(sheet) ? `${sheet}!${range}` : `'${sheet}'!${range}`
}

// ---------------------------------------------------------------------------
// Formatos
// ---------------------------------------------------------------------------

export type ColumnFormat =
  | 'text'
  | 'date'
  | 'datetime'
  | 'quantity'
  | 'price'
  | 'brl'
  | 'usd'
  | 'percent'
  | 'factor'
  | 'boolean'

/** Padrões do Sheets. `null` = deixar como texto simples. */
export const NUMBER_FORMAT: Record<ColumnFormat, { type: string; pattern: string } | null> = {
  text: null,
  boolean: null,
  date: { type: 'DATE', pattern: 'dd/mm/yyyy' },
  datetime: { type: 'DATE_TIME', pattern: 'dd/mm/yyyy hh:mm' },
  /**
   * Quantidade usa o formato automático, e não um padrão com casas opcionais.
   *
   * Motivo medido na planilha: o Sheets imprime o separador decimal sempre que
   * o padrão tem QUALQUER `#` depois da vírgula — `#,##0.########` mostra 69
   * como "69,", com a vírgula solta parecendo defeito. `General` dá "69" para
   * inteiro e "1,75" para fracionário, que é o que se quer numa coluna que
   * precisa aguentar ação fracionária. O preço é perder o separador de milhar,
   * irrelevante para quantidade de ativo.
   */
  quantity: { type: 'NUMBER', pattern: 'General' },
  price: { type: 'NUMBER', pattern: '#,##0.0000' },
  brl: { type: 'CURRENCY', pattern: '"R$" #,##0.00' },
  usd: { type: 'CURRENCY', pattern: '"US$" #,##0.00' },
  percent: { type: 'PERCENT', pattern: '0.00%' },
  // CDI diário tem ordem de 0,0005 — precisão alta ou vira zero na tela.
  factor: { type: 'NUMBER', pattern: '0.00000000' },
}

/** Moeda nativa de cada classe. Define o formato das colunas em moeda nativa. */
export const CLASS_CURRENCY: Record<AssetClass, Currency> = {
  us_stock: 'USD',
  us_etf: 'USD',
  br_stock: 'BRL',
  br_fii: 'BRL',
  fixed_income: 'BRL',
}

// ---------------------------------------------------------------------------
// Abas de dados
// ---------------------------------------------------------------------------

export interface ColumnSpec {
  /** Chave do campo no objeto TypeScript correspondente. */
  key: string
  header: string
  format?: ColumnFormat
  width?: number
  /**
   * Coluna derivada: o cabeçalho **é** uma fórmula que também preenche a coluna
   * inteira via ARRAYFORMULA. O código nunca escreve nestas colunas.
   */
  arrayFormula?: string
}

export interface DataSheetSpec {
  title: string
  columns: ColumnSpec[]
  /** Colunas que o código escreve, sempre o prefixo contíguo antes das derivadas. */
  writableColumns: number
}

/**
 * Livro-razão. Append-only: posição e preço médio são projeções desta aba,
 * nunca campos guardados.
 *
 * `Valor líquido` embute as taxas do lado certo — na compra elas aumentam o
 * custo de aquisição, na venda reduzem o que entrou. É a regra da RFB, e é essa
 * coluna que alimenta o preço médio nas abas de apresentação.
 */
export const TRADES_SHEET: DataSheetSpec = {
  title: SHEET.trades,
  writableColumns: 10,
  columns: [
    { key: 'id', header: 'ID', width: 190 },
    { key: 'date', header: 'Data', format: 'date', width: 100 },
    { key: 'kind', header: 'Tipo', width: 90 },
    { key: 'symbol', header: 'Ativo', width: 140 },
    { key: 'quantity', header: 'Quantidade', format: 'quantity', width: 110 },
    { key: 'unitPrice', header: 'Preço unitário', format: 'price', width: 120 },
    { key: 'currency', header: 'Moeda', width: 70 },
    { key: 'fees', header: 'Taxas', format: 'price', width: 90 },
    { key: 'fxRate', header: 'Câmbio', format: 'price', width: 90 },
    { key: 'note', header: 'Observação', width: 200 },
    {
      key: 'netValue',
      header: 'Valor líquido',
      format: 'price',
      width: 120,
      arrayFormula:
        '={"Valor líquido"; ARRAYFORMULA(IF($A$2:$A="";"";' +
        'IF($C$2:$C="buy"; $E$2:$E*$F$2:$F+$H$2:$H; $E$2:$E*$F$2:$F-$H$2:$H)))}',
    },
    {
      key: 'netValueBRL',
      header: 'Valor líquido (R$)',
      format: 'brl',
      width: 140,
      arrayFormula:
        '={"Valor líquido (R$)"; ARRAYFORMULA(IF($A$2:$A="";"";$K$2:$K*$I$2:$I))}',
    },
  ],
}

export const ASSETS_SHEET: DataSheetSpec = {
  title: SHEET.assets,
  writableColumns: 5,
  columns: [
    { key: 'symbol', header: 'Ativo', width: 110 },
    { key: 'name', header: 'Nome', width: 240 },
    { key: 'assetClass', header: 'Classe', width: 120 },
    { key: 'currency', header: 'Moeda', width: 70 },
    { key: 'broker', header: 'Corretora', width: 120 },
  ],
}

/**
 * Contratos de renda fixa. Não têm cotação: `Valor bruto` é marcado na curva
 * diariamente pelo Apps Script — é o único campo da planilha que o app lê mas
 * não calcula.
 */
export const FIXED_INCOME_SHEET: DataSheetSpec = {
  title: SHEET.fixedIncome,
  writableColumns: 9,
  columns: [
    { key: 'symbol', header: 'ID', width: 190 },
    { key: 'name', header: 'Nome', width: 220 },
    { key: 'issuer', header: 'Emissor', width: 160 },
    { key: 'indexer', header: 'Indexador', width: 100 },
    { key: 'rate', header: 'Taxa', format: 'percent', width: 90 },
    { key: 'issueDate', header: 'Aplicação', format: 'date', width: 100 },
    { key: 'maturity', header: 'Vencimento', format: 'date', width: 110 },
    { key: 'dailyLiquidity', header: 'Liquidez diária', width: 120 },
    { key: 'fgc', header: 'FGC', width: 70 },
    { key: 'marketValue', header: 'Valor bruto (R$)', format: 'brl', width: 140 },
    { key: 'updatedAt', header: 'Marcado em', format: 'datetime', width: 150 },
  ],
}

/**
 * Cotações. A coluna `Preço` guarda uma FÓRMULA por ativo, não um número —
 * é a escapatória para quando o GOOGLEFINANCE falha num FII ou ETF brasileiro:
 * edita-se a célula e nada no código muda.
 */
export const QUOTES_SHEET: DataSheetSpec = {
  title: SHEET.quotes,
  writableColumns: 3,
  columns: [
    { key: 'symbol', header: 'Ativo', width: 110 },
    { key: 'price', header: 'Preço', format: 'price', width: 120 },
    { key: 'currency', header: 'Moeda', width: 70 },
  ],
}

/** Série do CDI, alimentada pelo Apps Script a partir do BCB SGS. */
export const CDI_SHEET: DataSheetSpec = {
  title: SHEET.cdi,
  writableColumns: 2,
  columns: [
    { key: 'date', header: 'Data', format: 'date', width: 100 },
    { key: 'rateDaily', header: 'CDI diário', format: 'factor', width: 130 },
  ],
}

/** Snapshot mensal do patrimônio. É o que dá o gráfico de 12 meses. */
export const HISTORY_SHEET: DataSheetSpec = {
  title: SHEET.history,
  writableColumns: 2 + ASSET_CLASSES.length,
  columns: [
    { key: 'date', header: 'Data', format: 'date', width: 100 },
    { key: 'totalBRL', header: 'Patrimônio (R$)', format: 'brl', width: 150 },
    ...ASSET_CLASSES.map((assetClass) => ({
      key: assetClass,
      header: VIEW_SHEET[assetClass],
      format: 'brl' as ColumnFormat,
      width: 130,
    })),
  ],
}

export const CONFIG_SHEET: DataSheetSpec = {
  title: SHEET.config,
  writableColumns: 3,
  columns: [
    { key: 'key', header: 'Chave', width: 200 },
    { key: 'value', header: 'Valor', width: 160 },
    { key: 'description', header: 'Descrição', width: 420 },
  ],
}

export const DATA_SHEETS: DataSheetSpec[] = [
  TRADES_SHEET,
  ASSETS_SHEET,
  FIXED_INCOME_SHEET,
  QUOTES_SHEET,
  CDI_SHEET,
  HISTORY_SHEET,
  CONFIG_SHEET,
]

// ---------------------------------------------------------------------------
// Conteúdo inicial de `Config`
// ---------------------------------------------------------------------------

/**
 * Metas de alocação do perfil moderado (doc 02 do projeto de estratégia):
 * 40% renda fixa · 40% ETFs · 20% satélite. O satélite ficou inteiro em ações
 * EUA porque a carteira não tem classe "caixa" — a reserva de oportunidade não
 * aparece na pizza enquanto não estiver alocada.
 */
export const CONFIG_ROWS: Array<{ key: string; value: string; description: string }> = [
  {
    key: 'schema_version',
    value: String(SCHEMA_VERSION),
    description: 'Versão do contrato. O instalador avisa quando esta planilha está atrás do código.',
  },
  {
    key: 'usd_brl',
    value: '=GOOGLEFINANCE("CURRENCY:USDBRL")',
    description: 'Câmbio de hoje. Converte o valor de mercado dos ativos em USD. Delay de ~20 min.',
  },
  { key: 'target_fixed_income', value: '0,40', description: 'Meta de alocação — Renda Fixa.' },
  { key: 'target_us_etf', value: '0,40', description: 'Meta de alocação — ETFs EUA.' },
  { key: 'target_us_stock', value: '0,20', description: 'Meta de alocação — Ações EUA (satélite).' },
  { key: 'target_br_stock', value: '0', description: 'Meta de alocação — Ações Brasil.' },
  { key: 'target_br_fii', value: '0', description: 'Meta de alocação — FIIs.' },
]

/**
 * Linha (1-based) de `Config` onde mora o câmbio — vira o intervalo nomeado
 * `CAMBIO`, que as abas em USD usam para converter. O `2 +` é o cabeçalho.
 */
export const CONFIG_FX_ROW = 2 + CONFIG_ROWS.findIndex((row) => row.key === 'usd_brl')

/** Prefixo das chaves de meta de alocação em `Config`. */
export const TARGET_KEY_PREFIX = 'target_'

// ---------------------------------------------------------------------------
// Abas de apresentação
// ---------------------------------------------------------------------------

export interface ViewColumnSpec {
  header: string
  format?: ColumnFormat | 'native'
  width?: number
  /** Fórmula da linha `row`. A coluna A recebe apenas a de `VIEW_FIRST_ROW`. */
  formula: (row: number) => string
}

export interface ViewSheetSpec {
  title: string
  assetClass: AssetClass
  columns: ViewColumnSpec[]
  /** Coluna (0-based) somada para dar o total da aba, sempre em BRL. */
  totalColumn: number
  /** Nome ASCII do intervalo nomeado com o total — o Painel lê por aqui. */
  totalRangeName: string
}

/**
 * Intervalo nomeado com o total de cada aba de classe.
 *
 * O Painel e a coluna "% da classe" referenciam o total por NOME, não por
 * célula: mexer no layout de uma aba não quebra quem depende dela.
 */
const TOTAL_RANGE_NAME: Record<AssetClass, string> = {
  us_stock: 'TOTAL_US_STOCK',
  us_etf: 'TOTAL_US_ETF',
  br_stock: 'TOTAL_BR_STOCK',
  br_fii: 'TOTAL_BR_FII',
  fixed_income: 'TOTAL_FIXED_INCOME',
}

/** Cabeçalho da coluna somada para dar o total da aba. Sempre em reais. */
const TOTAL_HEADER = 'Valor (R$)'

/** Participação do ativo dentro da própria classe — o que você pediu ver. */
const CLASS_SHARE_HEADER = '% da classe'

const trades = (range: string) => ref(SHEET.trades, range)
const assets = (range: string) => ref(SHEET.assets, range)
const quotes = (range: string) => ref(SHEET.quotes, range)
const contracts = (range: string) => ref(SHEET.fixedIncome, range)

/** `IF(A{row}="";"";<expr>)` — não polui a aba com zeros nas linhas vazias. */
const guarded = (row: number, expression: string) => `=IF($A${row}="";"";${expression})`

/** Soma da coluna `col` de `Operações` para um ativo e um tipo de operação. */
const sumTrades = (col: string, row: number, kind: string) =>
  `SUMIFS(${trades(`$${col}:$${col}`)};${trades('$D:$D')};$A${row};${trades('$C:$C')};"${kind}")`

/**
 * Colunas comuns às classes com cotação de mercado (ações, ETFs, FIIs).
 *
 * O preço médio é `Σ(valor líquido das compras) ÷ Σ(quantidade comprada)` —
 * a regra da RFB, em que a venda reduz a posição mas **não** mexe no preço
 * médio. As taxas já entram porque `Valor líquido` (coluna K de `Operações`)
 * as soma no custo de aquisição.
 */
function marketColumns(assetClass: AssetClass): ViewColumnSpec[] {
  const isUsd = CLASS_CURRENCY[assetClass] === 'USD'
  const toBRL = (expression: string) => (isUsd ? `${expression}*CAMBIO` : expression)

  return [
    {
      // Uma fórmula só, escrita na primeira linha: o FILTER "derrama" a lista
      // de ativos da classe para baixo e as abas crescem sozinhas conforme a
      // carteira cresce.
      header: 'Ativo',
      width: 110,
      formula: () =>
        `=IFERROR(SORT(FILTER(${assets('$A$2:$A')};` +
        `${assets('$C$2:$C')}="${assetClass}";${assets('$A$2:$A')}<>""));"")`,
    },
    {
      header: 'Nome',
      width: 220,
      formula: (row) => guarded(row, `IFERROR(VLOOKUP($A${row};${assets('$A:$B')};2;FALSE);"")`),
    },
    {
      header: 'Posição',
      format: 'quantity',
      width: 100,
      formula: (row) => guarded(row, `${sumTrades('E', row, 'buy')}-${sumTrades('E', row, 'sell')}`),
    },
    {
      header: 'Preço médio',
      format: 'native',
      width: 120,
      formula: (row) =>
        guarded(row, `IFERROR(${sumTrades('K', row, 'buy')}/${sumTrades('E', row, 'buy')};0)`),
    },
    {
      header: 'Cotação',
      format: 'native',
      width: 110,
      formula: (row) => guarded(row, `IFERROR(VLOOKUP($A${row};${quotes('$A:$B')};2;FALSE);0)`),
    },
    {
      header: 'Custo total',
      format: 'native',
      width: 130,
      formula: (row) => guarded(row, `$C${row}*$D${row}`),
    },
    {
      header: 'Valor de mercado',
      format: 'native',
      width: 150,
      formula: (row) => guarded(row, `$C${row}*$E${row}`),
    },
    {
      header: 'Proventos',
      format: 'native',
      width: 110,
      formula: (row) =>
        guarded(row, `${sumTrades('K', row, 'dividend')}+${sumTrades('K', row, 'interest')}`),
    },
    {
      header: 'Rendimento',
      format: 'native',
      width: 120,
      formula: (row) => guarded(row, `$G${row}-$F${row}+$H${row}`),
    },
    {
      header: 'Rendimento %',
      format: 'percent',
      width: 120,
      formula: (row) => guarded(row, `IFERROR($I${row}/$F${row};0)`),
    },
    {
      header: TOTAL_HEADER,
      format: 'brl',
      width: 140,
      formula: (row) => guarded(row, toBRL(`$G${row}`)),
    },
    {
      // Peso do ativo DENTRO da classe, não na carteira inteira: "BBAS3 é 20%
      // das minhas ações brasileiras". Para o peso na carteira toda, o Painel.
      header: CLASS_SHARE_HEADER,
      format: 'percent',
      width: 110,
      formula: (row) => guarded(row, `IFERROR($K${row}/${TOTAL_RANGE_NAME[assetClass]};0)`),
    },
  ]
}

/**
 * Renda fixa não tem cotação nem quantidade: a posição é o valor aplicado e o
 * valor atual vem da marcação na curva que o Apps Script grava em `Contratos RF`.
 * Por isso esta aba tem colunas próprias em vez de reaproveitar `marketColumns`.
 */
const fixedIncomeColumns: ViewColumnSpec[] = [
  {
    header: 'Contrato',
    width: 190,
    formula: () =>
      `=IFERROR(SORT(FILTER(${contracts('$A$2:$A')};${contracts('$A$2:$A')}<>""));"")`,
  },
  {
    header: 'Nome',
    width: 220,
    formula: (row) => guarded(row, `IFERROR(VLOOKUP($A${row};${contracts('$A:$B')};2;FALSE);"")`),
  },
  {
    header: 'Emissor',
    width: 160,
    formula: (row) => guarded(row, `IFERROR(VLOOKUP($A${row};${contracts('$A:$C')};3;FALSE);"")`),
  },
  {
    header: 'Indexador',
    width: 100,
    formula: (row) => guarded(row, `IFERROR(VLOOKUP($A${row};${contracts('$A:$D')};4;FALSE);"")`),
  },
  {
    header: 'Taxa',
    format: 'percent',
    width: 90,
    formula: (row) => guarded(row, `IFERROR(VLOOKUP($A${row};${contracts('$A:$E')};5;FALSE);0)`),
  },
  {
    header: 'Vencimento',
    format: 'date',
    width: 110,
    formula: (row) => guarded(row, `IFERROR(VLOOKUP($A${row};${contracts('$A:$G')};7;FALSE);"")`),
  },
  {
    header: 'Aplicado (R$)',
    format: 'brl',
    width: 140,
    formula: (row) => guarded(row, `${sumTrades('L', row, 'buy')}-${sumTrades('L', row, 'sell')}`),
  },
  {
    header: 'Valor bruto (R$)',
    format: 'brl',
    width: 150,
    formula: (row) => guarded(row, `IFERROR(VLOOKUP($A${row};${contracts('$A:$J')};10;FALSE);0)`),
  },
  {
    header: 'Rendimento (R$)',
    format: 'brl',
    width: 150,
    formula: (row) => guarded(row, `$H${row}-$G${row}`),
  },
  {
    header: 'Rendimento %',
    format: 'percent',
    width: 120,
    formula: (row) => guarded(row, `IFERROR($I${row}/$G${row};0)`),
  },
  {
    header: TOTAL_HEADER,
    format: 'brl',
    width: 140,
    formula: (row) => guarded(row, `$H${row}`),
  },
  {
    header: CLASS_SHARE_HEADER,
    format: 'percent',
    width: 110,
    formula: (row) => guarded(row, `IFERROR($K${row}/${TOTAL_RANGE_NAME.fixed_income};0)`),
  },
]

export const VIEW_SHEETS: ViewSheetSpec[] = ASSET_CLASSES.map((assetClass) => {
  const columns = assetClass === 'fixed_income' ? fixedIncomeColumns : marketColumns(assetClass)
  const totalColumn = columns.findIndex((column) => column.header === TOTAL_HEADER)
  if (totalColumn < 0) throw new Error(`Aba ${VIEW_SHEET[assetClass]} sem a coluna "${TOTAL_HEADER}"`)

  return {
    title: VIEW_SHEET[assetClass],
    assetClass,
    columns,
    totalColumn,
    totalRangeName: TOTAL_RANGE_NAME[assetClass],
  }
})

// ---------------------------------------------------------------------------
// Painel
// ---------------------------------------------------------------------------

/** Onde ficam as coisas no Painel. O bootstrap e os gráficos leem daqui. */
export const DASHBOARD = {
  title: SHEET.dashboard,
  /** Linha (1-based) do "Patrimônio total". */
  totalRow: 3,
  fxRow: 4,
  updatedRow: 5,
  /** Linha do cabeçalho da tabela de alocação. */
  allocationHeaderRow: 7,
  /** Primeira linha de classe. */
  allocationFirstRow: 8,
  /** Linha onde os gráficos são ancorados. */
  chartRow: 15,
  /** A tabela de ativos vem depois dos gráficos, que ocupam ~18 linhas. */
  assetsTitleRow: 34,
  assetsHeaderRow: 35,
  assetsFirstRow: 36,
} as const

export const DASHBOARD_ALLOCATION_HEADERS = ['Classe', 'Valor (R$)', '% atual', 'Meta', 'Desvio']

export const DASHBOARD_ASSETS_HEADERS = ['Ativo', 'Classe', 'Valor (R$)', CLASS_SHARE_HEADER]

/**
 * Tabela de todos os ativos no Painel, ordenada por valor.
 *
 * Uma fórmula só: empilha as abas de classe num literal de matriz, descarta as
 * linhas vazias e ordena decrescente. A coluna de porcentagem é a participação
 * do ativo NA PRÓPRIA CLASSE — cada aba já a calcula, e aqui ela só é
 * transportada, então "BBAS3 20%" quer dizer 20% das ações brasileiras, não 20%
 * do patrimônio.
 *
 * É o único ponto do projeto que usa literal de matriz, e portanto o único que
 * depende dos separadores ambíguos — daí os tokens em vez de pontuação literal.
 */
export function dashboardAssetsFormula(): string {
  const c = FORMULA_TOKEN.arrayColumn
  const lastRow = VIEW_FIRST_ROW + VIEW_ROWS - 1

  const blocks = VIEW_SHEETS.map((spec) => {
    const symbols = ref(spec.title, `$A$${VIEW_FIRST_ROW}:$A$${lastRow}`)
    const values = ref(spec.title, `$K$${VIEW_FIRST_ROW}:$K$${lastRow}`)
    const shares = ref(spec.title, `$L$${VIEW_FIRST_ROW}:$L$${lastRow}`)
    const label = ASSET_CLASS_LABELS[spec.assetClass]

    // O fallback mantém 4 colunas quando a classe está vazia: sem ele, um
    // FILTER sem resultado devolve #N/A e derruba a pilha inteira.
    return (
      `IFERROR(FILTER(` +
      `{${symbols}${c}IF(${symbols}<>"";"${label}";"")${c}${values}${c}${shares}};` +
      `${symbols}<>"");` +
      `{""${c}""${c}0${c}0})`
    )
  })

  const stack = `{${blocks.join(FORMULA_TOKEN.arrayRow)}}`
  // LET evita repetir a pilha inteira duas vezes (uma para filtrar, outra para
  // ordenar). FILTER descarta as linhas de fallback das classes vazias.
  return `=IFERROR(LET(dados;${stack};SORT(FILTER(dados;INDEX(dados;;3)>0);3;FALSE));"")`
}

export const NAMED_RANGE = {
  fx: 'CAMBIO',
  total: 'PATRIMONIO_TOTAL',
} as const

/** Quantas linhas do histórico os gráficos cobrem (12 meses folgados). */
export const HISTORY_CHART_ROWS = 60
