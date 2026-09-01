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

import {
  ASSET_CLASSES,
  ASSET_CLASS_LABELS,
  FIXED_INCOME_INDEXER_LABELS,
  OBJECTIVES,
  OBJECTIVE_LABELS,
  type AssetClass,
  type Currency,
  type Objective,
} from '@/domain/types'

/** Gravada em `Config`. O instalador compara e avisa quando a planilha está velha. */
export const SCHEMA_VERSION = 7

/**
 * Chave em `Config` com o carimbo da última execução do Apps Script.
 *
 * Em UTC ISO 8601 — é dado que máquina lê, e ali ambiguidade de fuso custa
 * caro. O que a pessoa vê convertido para o horário dela é responsabilidade de
 * quem exibe.
 */
export const APPS_SCRIPT_LAST_RUN = 'apps_script_last_run'

/**
 * Chave em `Config` com o modo privacidade (oculta valores absolutos).
 *
 * Fonte de verdade durável: o checkbox do Painel escreve aqui via `onEdit` do
 * Apps Script, e a formatação condicional de todas as abas lê daqui pelo
 * intervalo nomeado `PRIVACIDADE` — não do checkbox em si, que uma
 * reinstalação poderia recriar.
 */
export const PRIVACY_MODE_KEY = 'privacy_mode'

/**
 * Locale da planilha: define como datas e moeda aparecem, e também qual
 * dialeto de fórmula o Sheets espera (ver `FORMULA_TOKEN` abaixo).
 */
export const SPREADSHEET_LOCALE = 'pt_BR'

/** Usado quando o sistema não consegue informar o próprio fuso. */
export const FALLBACK_TIME_ZONE = 'America/Sao_Paulo'

/**
 * Fuso da planilha — DETECTADO da máquina, não presumido.
 *
 * O Sheets não tem tipo de data com fuso: uma célula guarda um número que
 * significa "relógio de parede no fuso DA PLANILHA". Então `=NOW()` devolve a
 * hora naquele fuso — e com a planilha em `Etc/GMT`, o Painel mostrava três
 * horas no futuro para quem está no Brasil.
 *
 * Como não existe "guardar UTC e exibir local" dentro da mesma célula, o certo
 * é a planilha viver no fuso de quem a lê. Detectar, em vez de fixar
 * `America/Sao_Paulo`, faz isso valer em qualquer lugar — é o que torna a hora
 * exibida a hora DA PESSOA, e não a de uma constante no código.
 *
 * Os carimbos que máquina lê (`exportedAt` da exportação, `updatedAt` do MCP)
 * seguem em UTC ISO 8601, que é onde gravar em UTC de fato importa.
 */
export function resolveTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_TIME_ZONE
  } catch {
    return FALLBACK_TIME_ZONE
  }
}

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
 *
 * As abas de DADOS que revelam valor de carteira (posição, aporte, patrimônio)
 * levam 👁️ no nome: é o sinal, na própria barra de abas, de que ali os valores
 * aparecem em texto claro — o modo privacidade só mascara as abas de
 * apresentação (`Painel` e as de classe), nunca a base em si.
 *
 * `Ativos` (cadastro: ticker/nome/classe/moeda/corretora, sem quantidade nem
 * valor), `Cotações` (preço de mercado, o mesmo que o GOOGLEFINANCE mostra
 * pra qualquer um) e `CDI` (taxa pública do Banco Central) ficam de fora — não
 * têm quantidade nem valor de carteira, só dado de mercado ou cadastro.
 *
 * `Config` também fica de fora, mas por outro motivo: é ela que
 * `readSchemaVersion`/`writeSchemaVersion` leem ANTES de qualquer migração
 * rodar, para descobrir em que versão a planilha está — se o nome dela também
 * mudasse aqui, o código novo procuraria por uma aba que a migração ainda não
 * criou, e `readSchemaVersion` voltaria `null` para todo mundo que ainda não
 * migrou (medido: foi exatamente o que aconteceu ao testar).
 */
export const SHEET = {
  trades: '👁️ Operações',
  assets: 'Ativos',
  fixedIncome: '👁️ Contratos RF',
  quotes: 'Cotações',
  cdi: 'CDI',
  history: '👁️ Histórico',
  config: 'Config',
  dashboard: 'Painel',
} as const

/** Uma aba de apresentação por classe de ativo. */
export const VIEW_SHEET: Record<AssetClass, string> = {
  us_stock: 'Ações EUA',
  etf: 'ETFs',
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

/**
 * Moeda nativa de cada classe. `'mixed'` quando a classe aceita ativos em mais
 * de uma moeda (ETF: tanto o americano quanto o listado na B3 vivem na mesma
 * classe) — nesse caso a moeda é lida do CADASTRO DO ATIVO, linha a linha, em
 * vez de presumida pela classe inteira.
 */
export const CLASS_CURRENCY: Record<AssetClass, Currency | 'mixed'> = {
  us_stock: 'USD',
  etf: 'mixed',
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
  writableColumns: 6,
  columns: [
    { key: 'symbol', header: 'Ativo', width: 110 },
    { key: 'name', header: 'Nome', width: 240 },
    { key: 'assetClass', header: 'Classe', width: 120 },
    { key: 'currency', header: 'Moeda', width: 70 },
    { key: 'broker', header: 'Corretora', width: 120 },
    // Coluna nova no fim (v6): finalidade do ativo, independente da classe.
    // Vazia em ativo cadastrado antes desta coluna existir — nunca preenchida
    // retroativamente por suposição.
    { key: 'objective', header: 'Objetivo', width: 170 },
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
    /**
     * Coluna nova no fim (v6), DEPOIS das duas que o Apps Script possui.
     * `apps-script/Code.gs` lê e escreve `Contratos RF` por índice fixo
     * (`readRows(contractSheet, 11)`, `getRange(2, 10, …)`) — colocar
     * `objective` aqui, depois delas, é o que garante que ele nunca a vê nem
     * a pisa. Escrita própria em `repositories.ts` via célula avulsa, não pelo
     * `writableColumns` contíguo (que termina em `fgc`).
     */
    { key: 'objective', header: 'Objetivo', width: 170 },
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

/**
 * Snapshot semanal do patrimônio. É o que dá o gráfico de evolução. Linhas
 * antigas (de quando o snapshot era mensal) convivem normalmente com as novas
 * semanais — o gráfico só reflete a densidade real de cada período.
 */
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
/**
 * Prefixo das chaves de meta de alocação POR OBJETIVO em `Config`.
 *
 * Precisa ser um prefixo distinto de `TARGET_KEY_PREFIX` (`target_`), e
 * checado ANTES dele na leitura (`repositories.ts`): `target_goal_x` também
 * começa com `target_`, então checar a ordem errada classificaria a meta de
 * objetivo como se fosse meta de classe.
 */
export const TARGET_GOAL_KEY_PREFIX = 'target_goal_'

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
  { key: 'target_etf', value: '0,40', description: 'Meta de alocação — ETFs (EUA e B3).' },
  { key: 'target_us_stock', value: '0,20', description: 'Meta de alocação — Ações EUA (satélite).' },
  { key: 'target_br_stock', value: '0', description: 'Meta de alocação — Ações Brasil.' },
  { key: 'target_br_fii', value: '0', description: 'Meta de alocação — FIIs.' },
  {
    key: APPS_SCRIPT_LAST_RUN,
    value: '',
    description:
      'Última execução do Apps Script (UTC ISO). Escrito por ele; é como se descobre que o ' +
      'gatilho diário parou — o Google desativa gatilhos após falhas repetidas.',
  },
  {
    key: PRIVACY_MODE_KEY,
    value: 'FALSO',
    description:
      'Oculta valores absolutos (R$) no Painel e nas abas de classe, mantendo percentuais. ' +
      'Ligado pelo checkbox no Painel — não edite aqui direto, o checkbox é quem escreve.',
  },
  /**
   * As metas por objetivo (v6) vêm DEPOIS de `privacy_mode` de propósito —
   * nunca no meio. `CONFIG_FX_ROW`/`CONFIG_PRIVACY_ROW` (abaixo) acham a
   * linha pelo ÍNDICE deste array, e o instalador só ACRESCENTA chave
   * ausente no fim do que já está gravado, nunca reordena. Inserir aqui no
   * meio (antes de `privacy_mode`) deslocaria o índice calculado para a
   * planilha JÁ instalada, cuja `privacy_mode` continua fisicamente na
   * linha antiga — foi exatamente esse descompasso que quebrou o modo
   * privacidade numa instalação real (a fórmula de máscara passou a ler a
   * meta de um objetivo, não o checkbox).
   */
  ...OBJECTIVES.map((objective) => ({
    key: `${TARGET_GOAL_KEY_PREFIX}${objective}`,
    value: '0',
    description: `Meta de alocação por objetivo — ${OBJECTIVE_LABELS[objective]}.`,
  })),
]

/**
 * Linha (1-based) de `Config` onde mora o câmbio — vira o intervalo nomeado
 * `CAMBIO`, que as abas em USD usam para converter. O `2 +` é o cabeçalho.
 */
export const CONFIG_FX_ROW = 2 + CONFIG_ROWS.findIndex((row) => row.key === 'usd_brl')

/** Linha (1-based) de `Config` onde mora o modo privacidade — vira `PRIVACIDADE`. */
export const CONFIG_PRIVACY_ROW = 2 + CONFIG_ROWS.findIndex((row) => row.key === PRIVACY_MODE_KEY)

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
  etf: 'TOTAL_ETF',
  br_stock: 'TOTAL_BR_STOCK',
  br_fii: 'TOTAL_BR_FII',
  fixed_income: 'TOTAL_FIXED_INCOME',
}

/** Cabeçalho da coluna somada para dar o total da aba. Sempre em reais. */
const TOTAL_HEADER = 'Valor (R$)'

/** Participação do ativo dentro da própria classe — o que você pediu ver. */
const CLASS_SHARE_HEADER = '% da classe'

/** Objetivo do ativo, projetado de `Ativos`/`Contratos RF` — usado para somar por objetivo no Painel. */
const OBJECTIVE_HEADER = 'Objetivo'

/** Moeda do ativo, só na aba de classe com moeda mista (ETF) — ver `CLASS_CURRENCY`. */
export const CURRENCY_HEADER = 'Moeda'

const trades = (range: string) => ref(SHEET.trades, range)
const assets = (range: string) => ref(SHEET.assets, range)
const quotes = (range: string) => ref(SHEET.quotes, range)
const contracts = (range: string) => ref(SHEET.fixedIncome, range)

/** `IF(A{row}="";"";<expr>)` — não polui a aba com zeros nas linhas vazias. */
const guarded = (row: number, expression: string) => `=IF($A${row}="";"";${expression})`

/**
 * Troca a chave crua (`"liquidity"`, `"cdi"`…) pelo rótulo em português, com
 * fallback pro próprio valor cru quando não bate com nenhuma chave conhecida —
 * vazio (ativo ainda não classificado) ou uma chave futura sem rótulo ainda.
 */
const translated = (expression: string, labels: Record<string, string>) => {
  const cases = Object.entries(labels)
    .map(([key, label]) => `"${key}";"${label}"`)
    .join(';')
  return `SWITCH(${expression};${cases};${expression})`
}

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
  const classCurrency = CLASS_CURRENCY[assetClass]
  const mixed = classCurrency === 'mixed'
  const isUsd = classCurrency === 'USD'

  /**
   * Classe `mixed` (ETF): moeda nativa não é uma constante da aba, é lida do
   * cadastro do ativo linha a linha — por isso as colunas "nativas" abaixo
   * usam `'price'` (número puro, sem símbolo de moeda) em vez de `'native'`,
   * mesmo padrão já usado em `Operações`/`Cotações` para colunas que também
   * misturam moeda por linha.
   */
  const nativeFormat: ColumnFormat | 'native' = mixed ? 'price' : 'native'

  const assetCurrency = (row: number) => `VLOOKUP($A${row};${assets('$A:$D')};4;FALSE)`
  const toBRL = (row: number, expression: string) =>
    mixed
      ? `IF(${assetCurrency(row)}="USD";${expression}*CAMBIO;${expression})`
      : isUsd
        ? `${expression}*CAMBIO`
        : expression

  const columns: ViewColumnSpec[] = [
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
      format: nativeFormat,
      width: 120,
      formula: (row) =>
        guarded(row, `IFERROR(${sumTrades('K', row, 'buy')}/${sumTrades('E', row, 'buy')};0)`),
    },
    {
      header: 'Cotação',
      format: nativeFormat,
      width: 110,
      formula: (row) => guarded(row, `IFERROR(VLOOKUP($A${row};${quotes('$A:$B')};2;FALSE);0)`),
    },
    {
      header: 'Custo total',
      format: nativeFormat,
      width: 130,
      formula: (row) => guarded(row, `$C${row}*$D${row}`),
    },
    {
      header: 'Valor de mercado',
      format: nativeFormat,
      width: 150,
      formula: (row) => guarded(row, `$C${row}*$E${row}`),
    },
    {
      header: 'Proventos',
      format: nativeFormat,
      width: 110,
      formula: (row) =>
        guarded(row, `${sumTrades('K', row, 'dividend')}+${sumTrades('K', row, 'interest')}`),
    },
    {
      header: 'Rendimento',
      format: nativeFormat,
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
      formula: (row) => guarded(row, toBRL(row, `$G${row}`)),
    },
    {
      // Peso do ativo DENTRO da classe, não na carteira inteira: "BBAS3 é 20%
      // das minhas ações brasileiras". Para o peso na carteira toda, o Painel.
      header: CLASS_SHARE_HEADER,
      format: 'percent',
      width: 110,
      formula: (row) => guarded(row, `IFERROR($K${row}/${TOTAL_RANGE_NAME[assetClass]};0)`),
    },
    {
      // Acrescentada NO FIM de propósito: todo formula() anterior nesta lista
      // referencia coluna por letra literal ($C, $G, $K…); inserir no meio
      // deslocaria todas elas. O Painel soma esta coluna por objetivo — ver
      // `objectiveTotalFormula`.
      header: OBJECTIVE_HEADER,
      width: 170,
      formula: (row) =>
        guarded(row, translated(`IFERROR(VLOOKUP($A${row};${assets('$A:$F')};6;FALSE);"")`, OBJECTIVE_LABELS)),
    },
  ]

  // Só a classe de moeda mista ganha esta coluna, e sempre NO FIM — pelo
  // mesmo motivo de `OBJECTIVE_HEADER` acima, nenhuma fórmula anterior
  // referencia sua letra.
  if (mixed) {
    columns.push({
      header: CURRENCY_HEADER,
      width: 90,
      formula: (row) => guarded(row, `IFERROR(${assetCurrency(row)};"")`),
    })
  }

  return columns
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
    formula: (row) =>
      guarded(
        row,
        translated(`IFERROR(VLOOKUP($A${row};${contracts('$A:$D')};4;FALSE);"")`, FIXED_INCOME_INDEXER_LABELS),
      ),
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
  {
    // Acrescentada no fim pelo mesmo motivo de `marketColumns`. `Contratos RF`
    // guarda `objective` na coluna L (depois de `marketValue`/`updatedAt`, que
    // são do Apps Script) — ver o comentário em `FIXED_INCOME_SHEET`.
    header: OBJECTIVE_HEADER,
    width: 170,
    formula: (row) =>
      guarded(row, translated(`IFERROR(VLOOKUP($A${row};${contracts('$A:$L')};12;FALSE);"")`, OBJECTIVE_LABELS)),
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
  /**
   * Checkbox de modo privacidade — de propósito longe da coluna de valores
   * (A/B), num canto isolado da linha do título, para não parecer mais um
   * dado da lista.
   */
  privacyRow: 1,
  /** Coluna (0-based) do rótulo "Ocultar valores". */
  privacyLabelColumn: 5,
  /** Coluna (0-based) do checkbox em si. */
  privacyCheckboxColumn: 6,
  /** Linha do cabeçalho da tabela de alocação por classe. */
  allocationHeaderRow: 7,
  /** Primeira linha de classe. */
  allocationFirstRow: 8,
  /**
   * Tabela de alocação por OBJETIVO — logo ABAIXO da de classe (mesma
   * largura de 5 colunas, A:E), com uma linha em branco entre as duas.
   * `allocationFirstRow` tem 5 linhas de classe (8–12); esta começa na 14
   * para deixar a 13 como respiro.
   */
  objectivesHeaderRow: 14,
  objectivesFirstRow: 15,
  /**
   * Tabela de ativos — logo abaixo da de objetivo, mesma coluna (A:D). Os
   * gráficos NÃO ficam nesta coluna (ver `chartsColumn` abaixo), então a
   * tabela de ativos não precisa reservar espaço vertical pra eles: vem
   * direto depois da tabela de objetivo (que termina na 21) mais uma linha
   * de respiro.
   */
  assetsTitleRow: 23,
  assetsHeaderRow: 24,
  assetsFirstRow: 25,
  /**
   * Coluna (0-based) onde os dois gráficos ficam, empilhados à DIREITA das
   * tabelas — pizza de alocação em cima, linha de patrimônio embaixo. Longe
   * de A:E (as tabelas) e de F/G (controle de privacidade, linha 1 só).
   */
  chartsColumn: 6,
  /** Linha de âncora da pizza de alocação — alinhada com o bloco de totais. */
  allocationChartRow: 3,
  /**
   * Linha de âncora do histórico, abaixo da pizza. O gap replica a folga que
   * o layout anterior já usava entre o topo do gráfico e o que vinha depois
   * (~19 linhas) — suficiente pro tamanho padrão de gráfico do Sheets.
   */
  historyChartRow: 22,
} as const

export const DASHBOARD_ALLOCATION_HEADERS = ['Classe', 'Valor (R$)', '% atual', 'Meta', 'Desvio']

export const DASHBOARD_OBJECTIVE_HEADERS = ['Objetivo', 'Valor (R$)', '% atual', 'Meta', 'Desvio']

/** Participação do ativo no patrimônio total, não na classe. */
const PORTFOLIO_SHARE_HEADER = '% da carteira'

export const DASHBOARD_ASSETS_HEADERS = [
  'Ativo',
  'Valor (R$)',
  'Classe',
  PORTFOLIO_SHARE_HEADER,
  OBJECTIVE_HEADER,
]

/**
 * Tabela de todos os ativos no Painel, ordenada por valor.
 *
 * Uma fórmula só: empilha as abas de classe num literal de matriz, descarta as
 * linhas vazias e ordena decrescente. A coluna de porcentagem é a participação
 * do ativo no PATRIMÔNIO TOTAL — diferente da "% da classe" de cada aba, então
 * "BBAS3 5%" aqui quer dizer 5% da carteira inteira, não 5% das ações brasileiras.
 *
 * Valor vem antes de Classe (coluna B, depois C) para bater com a ordem das
 * outras tabelas do Painel (Classe/Objetivo já seguem valor-antes-de-categoria
 * em espírito). `SORT`/`FILTER` abaixo se referem à coluna 2 ("Valor (R$)")
 * por índice — mudar a ordem exige mudar esse índice junto. A coluna Objetivo
 * já sai traduzida porque lê o "Objetivo" de cada aba de classe, que já é
 * rótulo (ver `translated` em `marketColumns`).
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
    const label = ASSET_CLASS_LABELS[spec.assetClass]
    const objectiveColumn = columnLetterOfSchema(
      spec.columns.findIndex((column) => column.header === OBJECTIVE_HEADER),
    )
    const objectives = ref(spec.title, `$${objectiveColumn}$${VIEW_FIRST_ROW}:$${objectiveColumn}$${lastRow}`)

    // O fallback mantém 5 colunas quando a classe está vazia: sem ele, um
    // FILTER sem resultado devolve #N/A e derruba a pilha inteira.
    return (
      `IFERROR(FILTER(` +
      `{${symbols}${c}${values}${c}IF(${symbols}<>"";"${label}";"")${c}IFERROR(${values}/${NAMED_RANGE.total};0)${c}${objectives}};` +
      `${symbols}<>"");` +
      `{""${c}0${c}""${c}0${c}""})`
    )
  })

  const stack = `{${blocks.join(FORMULA_TOKEN.arrayRow)}}`
  // LET evita repetir a pilha inteira duas vezes (uma para filtrar, outra para
  // ordenar). FILTER descarta as linhas de fallback das classes vazias.
  return `=IFERROR(LET(dados;${stack};SORT(FILTER(dados;INDEX(dados;;2)>0);2;FALSE));"")`
}

export const NAMED_RANGE = {
  fx: 'CAMBIO',
  total: 'PATRIMONIO_TOTAL',
} as const

/**
 * Total em BRL de um objetivo, somado através das cinco abas de classe.
 *
 * Ao contrário do total por classe (que tem intervalo nomeado próprio, porque
 * é a soma de UMA aba), o objetivo cruza as classes — o mesmo objetivo aparece
 * em ações, ETFs e renda fixa. Por isso é um SUMIF por aba, somados: cada aba
 * já projeta o objetivo do ativo na coluna "Objetivo" (`OBJECTIVE_HEADER`,
 * sempre a última — ver `marketColumns`/`fixedIncomeColumns`) e a coluna
 * "Valor (R$)" continua em `$K`, intocada pela adição.
 *
 * A coluna "Objetivo" de cada aba guarda o RÓTULO traduzido (`OBJECTIVE_LABELS`),
 * não a chave crua — o `SUMIF` compara contra o rótulo pelo mesmo motivo.
 */
export function objectiveTotalFormula(objective: Objective): string {
  const lastRow = VIEW_FIRST_ROW + VIEW_ROWS - 1
  const label = OBJECTIVE_LABELS[objective]
  const terms = VIEW_SHEETS.map((spec) => {
    const objectiveColumn = columnLetterOfSchema(
      spec.columns.findIndex((column) => column.header === OBJECTIVE_HEADER),
    )
    const objectiveRange = ref(spec.title, `$${objectiveColumn}$${VIEW_FIRST_ROW}:$${objectiveColumn}$${lastRow}`)
    const valueRange = ref(spec.title, `$K$${VIEW_FIRST_ROW}:$K$${lastRow}`)
    return `SUMIF(${objectiveRange};"${label}";${valueRange})`
  })
  return `=${terms.join('+')}`
}

/** Duplicada de `bootstrap.columnLetter` de propósito: importar de lá criaria ciclo. */
function columnLetterOfSchema(index: number): string {
  let letter = ''
  let value = index
  while (value >= 0) {
    letter = String.fromCharCode((value % 26) + 65) + letter
    value = Math.floor(value / 26) - 1
  }
  return letter
}

/**
 * Quantas linhas do histórico os gráficos cobrem. O snapshot agora é semanal
 * (um ponto por semana, via `snapshotWeekly` em `apps-script/Code.gs`) — 300
 * linhas cobrem uns 5 anos e meio de folga, a mesma margem generosa que 60
 * linhas representavam quando o snapshot era mensal.
 *
 * O gráfico lê sempre as `HISTORY_CHART_ROWS` primeiras linhas da aba (ver
 * `chartDefinitions`), e o histórico é ordenado por data crescente — por isso
 * este número precisa ser maior que o total de linhas já gravadas, senão o
 * gráfico para de avançar e mostra só a janela mais antiga.
 */
export const HISTORY_CHART_ROWS = 300

/**
 * Título do gráfico de patrimônio. Duplicado em `apps-script/Code.gs` (não dá
 * para importar TypeScript lá) — é como o `onEdit` acha o gráfico certo para
 * esconder o eixo Y quando o modo privacidade liga.
 */
export const HISTORY_CHART_TITLE = 'Patrimônio — últimos meses'

/** Título do gráfico de pizza — usado para achá-lo de novo e reposicioná-lo a cada instalação. */
export const CLASS_ALLOCATION_CHART_TITLE = 'Alocação por classe'
