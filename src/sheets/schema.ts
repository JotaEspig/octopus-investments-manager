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
import { MIN_DAYS_FOR_CAGR, PERFORMANCE_WINDOW_MONTHS } from '@/domain/performance'

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

/**
 * Intervalos nomeados globais. Ficam aqui em cima, e não junto do Painel, por
 * ordem de inicialização: as fórmulas das abas de classe são montadas ainda na
 * carga do módulo (ver `VIEW_SHEETS`) e já citam `CAMBIO`.
 */
export const NAMED_RANGE = {
  fx: 'CAMBIO',
  total: 'PATRIMONIO_TOTAL',
} as const

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

export type ColumnAlign = 'LEFT' | 'CENTER' | 'RIGHT'

export interface ViewColumnSpec {
  header: string
  format?: ColumnFormat | 'native'
  width?: number
  /**
   * Sobrepõe o alinhamento padrão do `format` (texto à esquerda, número à
   * direita — ver `ALIGNMENT` em `styling.ts`). Usado só quando o dado É texto
   * mas a leitura pede alinhamento de coluna categórica, como "Objetivo" e
   * "Moeda".
   */
  align?: ColumnAlign
  /** Fórmula da linha `row`. A coluna A recebe apenas a de `VIEW_FIRST_ROW`. */
  formula: (row: number) => string
}

/**
 * O que basta para montar uma fórmula que varre uma aba de classe. É um tipo à
 * parte porque `sumInBRL` precisa dele ENQUANTO o `ViewSheetSpec` ainda está
 * sendo montado — as fórmulas agregadas nascem junto com a aba.
 */
interface ViewLayout {
  title: string
  assetClass: AssetClass
  columns: ViewColumnSpec[]
}

export interface ViewSheetSpec extends ViewLayout {
  /** Coluna (0-based) somada para dar o total da aba, sempre em BRL. */
  totalColumn: number
  /** Coluna (0-based) do "Rendimento %" — a linha 1 traz o da classe inteira. */
  returnColumn: number
  /** Coluna (0-based) do ganho e do custo, o numerador e o denominador do rendimento %. */
  gainColumn: number
  costColumn: number
  /** Nome ASCII do intervalo nomeado com o total — o Painel lê por aqui. */
  totalRangeName: string
  /** Nome ASCII do intervalo nomeado com o rendimento % da classe — idem. */
  returnRangeName: string
  /** Fórmula do rendimento % da classe inteira, escrita na linha 1. */
  classReturnFormula: string
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

/**
 * Intervalo nomeado com o rendimento % de cada aba de classe — o par do
 * `TOTAL_RANGE_NAME` acima, e pelo mesmo motivo: o Painel lê o número por
 * NOME, então mexer no layout de uma aba não quebra o Painel.
 */
const RETURN_RANGE_NAME: Record<AssetClass, string> = {
  us_stock: 'RETORNO_US_STOCK',
  etf: 'RETORNO_ETF',
  br_stock: 'RETORNO_BR_STOCK',
  br_fii: 'RETORNO_BR_FII',
  fixed_income: 'RETORNO_FIXED_INCOME',
}

/** Cabeçalho da coluna somada para dar o total da aba. Sempre em reais. */
const TOTAL_HEADER = 'Valor (R$)'

/** Participação do ativo dentro da própria classe — o que você pediu ver. */
const CLASS_SHARE_HEADER = '% da classe'

/**
 * Rendimento em porcentagem. Na linha de cada ativo é o dele; na LINHA 1 é o
 * da classe inteira (ver `classReturnFormula`), logo acima da coluna que já
 * mostra a mesma conta ativo a ativo.
 */
export const RETURN_PERCENT_HEADER = 'Rendimento %'

/**
 * Numerador e denominador do rendimento %, nos dois nomes que os dois layouts
 * usam: `marketColumns` chama de "Rendimento" e "Custo total"; a renda fixa,
 * que não tem cotação nem quantidade, chama de "Rendimento (R$)" e
 * "Aplicado (R$)". Os agregados (classe e Painel) somam ESTAS colunas,
 * localizadas por cabeçalho — nunca por letra.
 */
export const GAIN_HEADERS = ['Rendimento', 'Rendimento (R$)']
const COST_HEADERS = ['Custo total', 'Aplicado (R$)']

/**
 * Largura da coluna-chave (A) de TODA aba de classe — ticker em umas,
 * id de contrato em outra. Uma constante só porque elas precisam bater: ao
 * trocar de aba, a lista tem que continuar começando no mesmo lugar.
 */
const VIEW_KEY_COLUMN_WIDTH = 110

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
      ? `IF(${assetCurrency(row)}="USD";${expression}*${NAMED_RANGE.fx};${expression})`
      : isUsd
        ? `${expression}*${NAMED_RANGE.fx}`
        : expression

  const columns: ViewColumnSpec[] = [
    {
      // Uma fórmula só, escrita na primeira linha: o FILTER "derrama" a lista
      // de ativos da classe para baixo e as abas crescem sozinhas conforme a
      // carteira cresce.
      header: 'Ativo',
      width: VIEW_KEY_COLUMN_WIDTH,
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
      header: RETURN_PERCENT_HEADER,
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
      width: 200,
      align: 'RIGHT',
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
      align: 'RIGHT',
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
    width: VIEW_KEY_COLUMN_WIDTH,
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
    header: RETURN_PERCENT_HEADER,
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
    width: 200,
    align: 'RIGHT',
    formula: (row) =>
      guarded(row, translated(`IFERROR(VLOOKUP($A${row};${contracts('$A:$L')};12;FALSE);"")`, OBJECTIVE_LABELS)),
  },
]

/** Intervalo absoluto de uma coluna inteira de aba de apresentação. */
function viewColumnRange(title: string, columnIndex: number): string {
  const letter = columnLetterOfSchema(columnIndex)
  return ref(title, `$${letter}$${VIEW_FIRST_ROW}:$${letter}$${VIEW_FIRST_ROW + VIEW_ROWS - 1}`)
}

/**
 * Soma uma coluna de dinheiro de uma aba de classe EM REAIS, ao câmbio de
 * HOJE — opcionalmente só as linhas de um objetivo.
 *
 * As colunas de dinheiro das abas de classe estão na moeda do ativo, então
 * somar ETF americano com CDB exige uma moeda comum. Converter ao câmbio de
 * hoje (e não ao de cada compra) é deliberado: no rendimento %, numerador e
 * denominador recebem o MESMO câmbio, que se cancela — então o percentual
 * daqui é idêntico ao que a própria aba já mostra linha a linha na coluna
 * "Rendimento %", e as duas telas nunca discordam.
 *
 * O preço disso é que este número é o rendimento DO ATIVO, na moeda dele, e
 * não o do investidor em reais. Para esse, que usa o câmbio de cada compra, a
 * autoridade é `src/domain/` (`returnBRL`) — é o que o app e o MCP devolvem.
 */
function sumInBRL(layout: ViewLayout, columnIndex: number, objectiveLabel?: string): string {
  const columnOf = (header: string) =>
    viewColumnRange(
      layout.title,
      layout.columns.findIndex((column) => column.header === header),
    )
  const values = viewColumnRange(layout.title, columnIndex)
  const objectives = columnOf(OBJECTIVE_HEADER)
  const currency = CLASS_CURRENCY[layout.assetClass]

  // Classe de moeda mista: a moeda é de cada linha, então a conversão também.
  // `"<>USD"` pega o que está em reais e também as linhas vazias — que somam
  // zero, porque a célula de valor delas é "" e não número.
  if (currency === 'mixed') {
    const currencies = columnOf(CURRENCY_HEADER)
    const byCurrency = (match: string) =>
      objectiveLabel === undefined
        ? `SUMIF(${currencies};"${match}";${values})`
        : `SUMIFS(${values};${objectives};"${objectiveLabel}";${currencies};"${match}")`
    return `(${byCurrency('USD')}*${NAMED_RANGE.fx}+${byCurrency('<>USD')})`
  }

  const sum =
    objectiveLabel === undefined
      ? `SUM(${values})`
      : `SUMIF(${objectives};"${objectiveLabel}";${values})`
  return currency === 'USD' ? `(${sum}*${NAMED_RANGE.fx})` : `(${sum})`
}

/**
 * Rendimento % de um conjunto de linhas: ganho ÷ custo, os dois em reais.
 *
 * É a mesma conta da coluna "Rendimento %" um nível acima — e NÃO a média das
 * porcentagens, que daria o mesmo peso a uma posição de mil reais e a uma de
 * cem. Cada parte é uma aba; o rendimento de um objetivo atravessa as cinco.
 */
function aggregateReturnFormula(parts: Array<{ gain: string; cost: string }>): string {
  const gain = parts.map((part) => part.gain).join('+')
  const cost = parts.map((part) => part.cost).join('+')
  return `=IFERROR((${gain})/(${cost});0)`
}

export const VIEW_SHEETS: ViewSheetSpec[] = ASSET_CLASSES.map((assetClass) => {
  const title = VIEW_SHEET[assetClass]
  const columns = assetClass === 'fixed_income' ? fixedIncomeColumns : marketColumns(assetClass)

  const columnOf = (headers: string[], what: string) => {
    const index = columns.findIndex((column) => headers.includes(column.header))
    if (index < 0) throw new Error(`Aba ${title} sem a coluna de ${what}`)
    return index
  }

  const totalColumn = columnOf([TOTAL_HEADER], TOTAL_HEADER)
  const returnColumn = columnOf([RETURN_PERCENT_HEADER], RETURN_PERCENT_HEADER)
  const gainColumn = columnOf(GAIN_HEADERS, 'ganho')
  const costColumn = columnOf(COST_HEADERS, 'custo')

  const layout: ViewLayout = { title, assetClass, columns }

  return {
    ...layout,
    totalColumn,
    returnColumn,
    gainColumn,
    costColumn,
    totalRangeName: TOTAL_RANGE_NAME[assetClass],
    returnRangeName: RETURN_RANGE_NAME[assetClass],
    classReturnFormula: aggregateReturnFormula([
      { gain: sumInBRL(layout, gainColumn), cost: sumInBRL(layout, costColumn) },
    ]),
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
  /**
   * Coluna (0-based) do rótulo "Modo privacidade". Fica logo DEPOIS da última
   * coluna das tabelas (A:F) — andou de F para G quando a coluna de rendimento
   * entrou, para o controle continuar fora do bloco de tabelas.
   */
  privacyLabelColumn: 6,
  /** Coluna (0-based) do checkbox em si. Espelhada em `apps-script/Code.gs`. */
  privacyCheckboxColumn: 7,
  /** Linha do cabeçalho da tabela de alocação por classe. */
  allocationHeaderRow: 7,
  /** Primeira linha de classe. */
  allocationFirstRow: 8,
  /**
   * Tabela de alocação por OBJETIVO — logo ABAIXO da de classe (mesma
   * largura, A:F — ver `DASHBOARD_TABLE_COLUMNS`), com uma linha em branco
   * entre as duas.
   * `allocationFirstRow` tem 5 linhas de classe (8–12); esta começa na 14
   * para deixar a 13 como respiro.
   */
  objectivesHeaderRow: 14,
  objectivesFirstRow: 15,
  /** Coluna (0-based) do "Desvio" — só a tabela de classe e a de objetivo têm. */
  driftColumn: 4,
  /**
   * Coluna (0-based) do "Rendimento %" nas TRÊS tabelas — a última de cada
   * uma, sempre a mesma, para as três lerem como uma coluna só de cima a baixo.
   */
  returnColumn: 5,
  /**
   * Tabela de ativos — logo abaixo da de objetivo, mesma coluna (A:F). Os
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
   * tabelas — linha de patrimônio em cima, pizza de alocação embaixo. Longe
   * de A:F (as tabelas) e de G/H (controle de privacidade, linha 1 só).
   */
  chartsColumn: 7,
  /**
   * Quadro de rendimento × CDI — no TOPO, à direita do bloco de totais e
   * acima dos dois gráficos: é a primeira leitura de "como a carteira vai",
   * e os gráficos abaixo detalham.
   */
  performanceHeaderRow: 3,
  /** Linha dos últimos 12 meses; a do histórico total vem logo abaixo. */
  performanceFirstRow: 4,
  /**
   * Linha de âncora do gráfico de patrimônio × CDI — logo abaixo do quadro de
   * rendimento (3–5), com a 6 de respiro: os dois contam a mesma história
   * (como a carteira vai contra o CDI), então ficam juntos.
   */
  historyChartRow: 7,
  /**
   * Linha de âncora da pizza de alocação, abaixo do patrimônio. O gráfico tem
   * 371 px no tamanho padrão do Sheets; da 7 até a 23 (com os cabeçalhos de
   * 32 px das tabelas no caminho) são 379 px, então o de cima termina na 23 e
   * a 24 fica de respiro.
   */
  allocationChartRow: 25,
  /**
   * Coluna (0-based) do rótulo do quadro. Uma à direita de `chartsColumn`: a
   * H é a do checkbox de privacidade, estreita demais (40 px) para rótulo.
   */
  performanceColumn: 8,
  /**
   * Coluna (0-based) da série que o gráfico de patrimônio desenha — janela de
   * 12 meses e a linha "mesmo dinheiro no CDI". Fica bem à direita, longe da
   * vista (T), porque é dado de bastidor do gráfico, não leitura.
   */
  evolutionDataColumn: 19,
  /** Cabeçalho da série (vira a legenda do gráfico); os pontos vêm abaixo. */
  evolutionDataRow: 1,
} as const

export const DASHBOARD_ALLOCATION_HEADERS = [
  'Classe',
  'Valor (R$)',
  '% atual',
  'Meta',
  'Desvio',
  RETURN_PERCENT_HEADER,
]

export const DASHBOARD_OBJECTIVE_HEADERS = [
  'Objetivo',
  'Valor (R$)',
  '% atual',
  'Meta',
  'Desvio',
  RETURN_PERCENT_HEADER,
]

/** Participação do ativo no patrimônio total, não na classe. */
const PORTFOLIO_SHARE_HEADER = '% da carteira'

export const DASHBOARD_ASSETS_HEADERS = [
  'Ativo',
  'Valor (R$)',
  'Classe',
  PORTFOLIO_SHARE_HEADER,
  OBJECTIVE_HEADER,
  RETURN_PERCENT_HEADER,
]

/**
 * Largura das três tabelas do Painel, em colunas (A:F). As três andam juntas
 * de propósito — é o que faz elas lerem como uma coluna só de cima a baixo, e
 * o que `styling.ts` usa para pintar cabeçalho, listra e borda sem número solto.
 */
export const DASHBOARD_TABLE_COLUMNS = DASHBOARD_ALLOCATION_HEADERS.length

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
 * rótulo (ver `translated` em `marketColumns`), e a de rendimento % é a mesma
 * célula que a aba de classe mostra — copiada, não recalculada.
 *
 * É o único ponto do projeto que usa literal de matriz, e portanto o único que
 * depende dos separadores ambíguos — daí os tokens em vez de pontuação literal.
 */
export function dashboardAssetsFormula(): string {
  const c = FORMULA_TOKEN.arrayColumn

  const blocks = VIEW_SHEETS.map((spec) => {
    const symbols = viewColumnRange(spec.title, 0)
    const values = viewColumnRange(spec.title, spec.totalColumn)
    const objectives = viewColumnRange(
      spec.title,
      spec.columns.findIndex((column) => column.header === OBJECTIVE_HEADER),
    )
    const returns = viewColumnRange(spec.title, spec.returnColumn)
    const label = ASSET_CLASS_LABELS[spec.assetClass]

    // O fallback mantém as 6 colunas quando a classe está vazia: sem ele, um
    // FILTER sem resultado devolve #N/A e derruba a pilha inteira.
    return (
      `IFERROR(FILTER(` +
      `{${symbols}${c}${values}${c}IF(${symbols}<>"";"${label}";"")${c}` +
      `IFERROR(${values}/${NAMED_RANGE.total};0)${c}${objectives}${c}${returns}};` +
      `${symbols}<>"");` +
      `{""${c}0${c}""${c}0${c}""${c}0})`
    )
  })

  const stack = `{${blocks.join(FORMULA_TOKEN.arrayRow)}}`
  // LET evita repetir a pilha inteira duas vezes (uma para filtrar, outra para
  // ordenar). FILTER descarta as linhas de fallback das classes vazias.
  return `=IFERROR(LET(dados;${stack};SORT(FILTER(dados;INDEX(dados;;2)>0);2;FALSE));"")`
}

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

/**
 * Rendimento % de um objetivo, atravessando as cinco abas de classe.
 *
 * Mesmo motivo do `objectiveTotalFormula` acima: o objetivo cruza as classes,
 * então não há um intervalo nomeado por objetivo — é ganho e custo somados aba
 * a aba, cada uma convertida em reais por `sumInBRL`, e a divisão no fim. Uma
 * posição grande pesa mais que uma pequena, como tem que ser.
 */
export function objectiveReturnFormula(objective: Objective): string {
  const label = OBJECTIVE_LABELS[objective]
  return aggregateReturnFormula(
    VIEW_SHEETS.map((spec) => ({
      gain: sumInBRL(spec, spec.gainColumn, label),
      cost: sumInBRL(spec, spec.costColumn, label),
    })),
  )
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
 * Título do gráfico de patrimônio. Duplicado em `apps-script/Code.gs` (não dá
 * para importar TypeScript lá) — é como o `onEdit` acha o gráfico certo para
 * esconder o eixo Y quando o modo privacidade liga.
 */
export const HISTORY_CHART_TITLE = 'Patrimônio — últimos meses'

/** Título do gráfico de pizza — usado para achá-lo de novo e reposicioná-lo a cada instalação. */
export const CLASS_ALLOCATION_CHART_TITLE = 'Alocação por classe'

// ---------------------------------------------------------------------------
// Evolução: patrimônio × CDI
// ---------------------------------------------------------------------------

/**
 * Cabeçalho da série do gráfico de patrimônio — as duas últimas viram a
 * legenda do gráfico, por isso são nome de linha, não de coluna técnica.
 */
export const EVOLUTION_DATA_HEADERS = ['Semana', 'Carteira', 'Mesmo dinheiro 100% no CDI']

/**
 * Teto de pontos da janela de 12 meses. O snapshot é um por semana (53 num
 * ano) — a folga cobre o histórico antigo que ainda tenha linha mensal
 * misturada. O gráfico lê exatamente estas linhas.
 */
export const EVOLUTION_CHART_ROWS = 60

export const DASHBOARD_PERFORMANCE_HEADERS = ['Rendimento', 'Carteira', 'CDI', 'CAGR (a.a.)']

/**
 * Pedaços comuns às fórmulas de evolução — o espelho em fórmula de
 * `src/domain/performance.ts`. Cada fórmula é um `LET` autocontido (o Sheets
 * não compartilha variável entre células), e as variáveis têm sempre o mesmo
 * nome para dar para ler uma contra a outra:
 *
 *   hd/hv  datas (sem hora) e patrimônio do Histórico, em ordem
 *   wd/wv  o mesmo, só os últimos 12 meses (`EDATE` — igual a `subtractMonths`)
 *   td/ta  data e aporte líquido em reais de cada operação (`netContributionBRL`)
 *   cd/cl  data e LOG ACUMULADO do CDI: o fator de `(a, b]` é EXP(L(b) − L(a)),
 *          com L(x) = XLOOKUP da última data ≤ x — o mesmo `cdiFactor`, sem
 *          multiplicar a série inteira de novo para cada ponto
 *
 * Toda fórmula daqui vai dentro de `ARRAYFORMULA`: fora dela, `INT(coluna)` e
 * `IF(coluna="buy";…)` devolvem só o PRIMEIRO elemento, sem erro nenhum —
 * medido na planilha, a série do gráfico saía com um ponto só.
 */
function evolutionPrelude(): string {
  const col = (spec: DataSheetSpec, key: string) => {
    const letter = columnLetterOfSchema(spec.columns.findIndex((column) => column.key === key))
    return ref(spec.title, `$${letter}$2:$${letter}`)
  }
  const historyDate = col(HISTORY_SHEET, 'date')
  const historyBlock = ref(
    HISTORY_SHEET.title,
    `$${columnLetterOfSchema(0)}$2:$${columnLetterOfSchema(HISTORY_SHEET.columns.findIndex((c) => c.key === 'totalBRL'))}`,
  )
  const tradeId = col(TRADES_SHEET, 'id')
  const tradeDate = col(TRADES_SHEET, 'date')
  const tradeKind = col(TRADES_SHEET, 'kind')
  const tradeBRL = col(TRADES_SHEET, 'netValueBRL')
  const cdiDate = col(CDI_SHEET, 'date')
  const cdiRate = col(CDI_SHEET, 'rateDaily')
  const totalIndex = HISTORY_SHEET.columns.findIndex((c) => c.key === 'totalBRL') + 1

  return (
    `h;SORT(FILTER(${historyBlock};${historyDate}<>"");1;TRUE);` +
    `hd;INT(INDEX(h;;1));hv;INDEX(h;;${totalIndex});` +
    `ws;EDATE(MAX(hd);-${PERFORMANCE_WINDOW_MONTHS});` +
    `wd;FILTER(hd;hd>=ws);wv;FILTER(hv;hd>=ws);` +
    // Sem operação, um aporte zero na data zero: não soma nada e não quebra.
    `td;IFERROR(INT(FILTER(${tradeDate};${tradeId}<>""));0);` +
    `ta;IFERROR(FILTER(IF(${tradeKind}="buy";${tradeBRL};-${tradeBRL});${tradeId}<>"");0);` +
    `tmin;IFERROR(MIN(FILTER(${tradeDate};${tradeId}<>""));INDEX(hd;1));` +
    `inc;INT(MIN(tmin;INDEX(hd;1)));` +
    `full;INDEX(wd;1)=INDEX(hd;1);` +
    // Sem CDI, log zero: o fator vira 1 em vez de derrubar a fórmula. `INT`
    // porque o Apps Script grava a data do CDI com hora (09:00, medido) — sem
    // ele, o dia do aporte não casa com a própria data e rende um dia a mais.
    `cd;IFERROR(INT(FILTER(${cdiDate};${cdiDate}<>""));0);` +
    `cl;IFERROR(SCAN(0;FILTER(${cdiRate};${cdiDate}<>"");LAMBDA(a;r;a+LN(1+r)));0);`
  )
}

/** L(x) do prelúdio: log acumulado do CDI até a data `x`, inclusive. */
function cdiLog(date: string): string {
  return `XLOOKUP(${date};cd;cl;0;-1)`
}

/**
 * A série do gráfico: semana, carteira e "mesmo dinheiro no CDI"
 * (`performanceWindow` + `cdiBenchmarkSeries`). Uma fórmula só, que derrama
 * as três colunas para baixo.
 */
export function evolutionSeriesFormula(): string {
  return (
    `=IFERROR(ARRAYFORMULA(LET(${evolutionPrelude()}` +
    `dini;INDEX(wd;1);vini;INDEX(wv;1);lini;${cdiLog('dini')};` +
    `tl;MAP(td;LAMBDA(t;${cdiLog('t')}));` +
    `eq;MAP(wd;LAMBDA(d;LET(ld;${cdiLog('d')};` +
    `vini*EXP(ld-lini)+SUMPRODUCT((td>dini)*(td<=d)*ta*EXP(ld-tl)))));` +
    `HSTACK(wd;wv;eq)));"")`
  )
}

/**
 * Rentabilidade ponderada pelo tempo (`timeWeightedReturn`) sobre as datas
 * `dates`/valores `values` do prelúdio. `inception` é uma expressão booleana:
 * verdadeira, a primeira fatia vai do primeiro aporte ao primeiro snapshot.
 *
 * `INDEX(…;MAX(1;i-1))` em vez de `i-1`: `INDEX(x;0)` devolve a coluna
 * inteira, e o `IF` do Sheets não garante que o ramo descartado não seja
 * avaliado.
 */
function twrExpression(dates: string, values: string, inception: string): string {
  return (
    `LET(f;MAP(SEQUENCE(ROWS(${dates}));LAMBDA(i;LET(` +
    `dant;IF(i=1;-1;INDEX(${dates};MAX(1;i-1)));` +
    `vant;IF(i=1;0;INDEX(${values};MAX(1;i-1)));` +
    `base;vant+SUMPRODUCT((td>dant)*(td<=INDEX(${dates};i))*ta);` +
    `IF(OR(base<=0;AND(i=1;NOT(${inception})));"";INDEX(${values};i)/base))));` +
    `IF(COUNT(f)=0;"";PRODUCT(f)-1))`
  )
}

/**
 * As duas linhas do quadro de rendimento (`performanceOverview`): rótulo,
 * carteira, CDI e — só no histórico total — CAGR.
 *
 * Com menos de 12 meses de histórico, a primeira linha é o histórico inteiro e
 * dá exatamente o mesmo número da segunda.
 */
export function performanceRowFormulas(): string[][] {
  const wrap = (body: string) => `=IFERROR(ARRAYFORMULA(LET(${evolutionPrelude()}${body}));"")`
  const monthYear = (date: string) => `TEXT(MONTH(${date});"00")&"/"&YEAR(${date})`
  const end = 'MAX(hd)'
  const totalTwr = twrExpression('hd', 'hv', 'TRUE')

  return [
    [
      wrap(`IF(full;"Desde "&${monthYear('inc')}&" (menos de 12 meses)";"Últimos 12 meses")`),
      wrap(`IF(full;${totalTwr};${twrExpression('wd', 'wv', 'FALSE')})`),
      wrap(`EXP(${cdiLog(end)}-${cdiLog('IF(full;inc;INDEX(wd;1))')})-1`),
      '',
    ],
    [
      wrap(`"Histórico total (desde "&${monthYear('inc')}&")"`),
      wrap(totalTwr),
      wrap(`EXP(${cdiLog(end)}-${cdiLog('inc')})-1`),
      // Menos de um ano não se anualiza (`MIN_DAYS_FOR_CAGR`).
      wrap(
        `LET(r;${totalTwr};dias;${end}-inc;` +
          `IF(dias<${MIN_DAYS_FOR_CAGR};"menos de 1 ano";IF(OR(r="";r<=-1);"";(1+r)^(365/dias)-1)))`,
      ),
    ],
  ]
}
