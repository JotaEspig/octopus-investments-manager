/**
 * Tipos do domínio. Nada aqui faz I/O — este módulo é importado tanto pela API
 * do Next quanto pelo servidor MCP, e é o que os testes cobrem.
 */

/** Classes de ativo suportadas. O valor é o que vai gravado na planilha. */
export const ASSET_CLASSES = ['us_stock', 'etf', 'br_stock', 'br_fii', 'fixed_income'] as const
export type AssetClass = (typeof ASSET_CLASSES)[number]

export const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  us_stock: 'Ações EUA',
  etf: 'ETFs',
  br_stock: 'Ações BR',
  br_fii: 'FIIs',
  fixed_income: 'Renda Fixa',
}

export const CURRENCIES = ['BRL', 'USD'] as const
export type Currency = (typeof CURRENCIES)[number]

/**
 * Objetivo do ativo — segunda dimensão de classificação, independente da
 * classe. Cadastrado no ativo (não na operação): um ativo pertence a
 * exatamente um objetivo.
 *
 * Planilhas anteriores a esta funcionalidade não têm o dado: `''` é "ainda não
 * classificado", nunca um oitavo objetivo — não preencher em massa por
 * suposição.
 */
export const OBJECTIVES = [
  'liquidity',
  'passive_income',
  'inflation_protection',
  'predictable_yield',
  'systemic_protection',
  'growth',
  'speculative',
] as const
export type Objective = (typeof OBJECTIVES)[number]

export const OBJECTIVE_LABELS: Record<Objective, string> = {
  liquidity: 'Liquidez / Reserva',
  passive_income: 'Renda passiva',
  inflation_protection: 'Proteção — inflação',
  predictable_yield: 'Previsibilidade de fluxo',
  systemic_protection: 'Proteção — sistêmica/moeda',
  growth: 'Crescimento / valorização',
  speculative: 'Assimétrico / especulativo',
}

/**
 * Tipos de operação.
 * - `buy`/`sell`  — movimentam posição e custo médio
 * - `dividend`    — provento em dinheiro de renda variável
 * - `interest`    — juros/resgate de rendimento de renda fixa
 *
 * `dividend` e `interest` entram no rendimento acumulado mas **não** alteram
 * posição nem preço médio.
 */
export const TRADE_KINDS = ['buy', 'sell', 'dividend', 'interest'] as const
export type TradeKind = (typeof TRADE_KINDS)[number]

export const TRADE_KIND_LABELS: Record<TradeKind, string> = {
  buy: 'Compra',
  sell: 'Venda',
  dividend: 'Dividendo',
  interest: 'Juros',
}

/** Indexadores de renda fixa. */
export const FIXED_INCOME_INDEXERS = ['cdi', 'prefixed', 'ipca'] as const
export type FixedIncomeIndexer = (typeof FIXED_INCOME_INDEXERS)[number]

export const FIXED_INCOME_INDEXER_LABELS: Record<FixedIncomeIndexer, string> = {
  cdi: '% do CDI',
  prefixed: 'Prefixado',
  ipca: 'IPCA +',
}

/**
 * Uma linha do livro-razão. `Operações` é append-only: posições e preço médio
 * são projeções desta lista, nunca campos armazenados.
 */
export interface Trade {
  id: string
  /** ISO `yyyy-mm-dd`. */
  date: string
  kind: TradeKind
  /** Chave do ativo: ticker (`AAPL`) ou id do contrato de RF (`rf-cdb-xp-2028`). */
  symbol: string
  quantity: number
  unitPrice: number
  currency: Currency
  /** Corretagem, emolumentos e afins, na moeda da operação. */
  fees: number
  /** Cotação da moeda em BRL na data da operação. Sempre 1 quando `currency` é BRL. */
  fxRate: number
  note: string
}

/** Ativo com cotação de mercado. Contratos de renda fixa vivem em `FixedIncomeContract`. */
export interface Asset {
  symbol: string
  name: string
  assetClass: AssetClass
  currency: Currency
  broker: string
  /** `''` em ativos cadastrados antes desta coluna existir. */
  objective: Objective | ''
}

/** Contrato de renda fixa. Não tem cotação — é marcado na curva. */
export interface FixedIncomeContract {
  /** Mesma chave usada em `Trade.symbol`. */
  symbol: string
  name: string
  issuer: string
  indexer: FixedIncomeIndexer
  /**
   * Depende do indexador:
   * - `cdi`      — fração do CDI (1.1 = 110% do CDI)
   * - `prefixed` — taxa anual (0.13 = 13% a.a.)
   * - `ipca`     — cupom real anual acima do IPCA (0.06 = IPCA + 6% a.a.)
   */
  rate: number
  issueDate: string
  maturity: string
  dailyLiquidity: boolean
  /** Coberto pelo FGC (até R$ 250 mil por CPF/instituição). */
  fgc: boolean
  /**
   * Valor bruto atual, marcado na curva. Escrito diariamente pelo Apps Script —
   * é o único campo da planilha que o código do app não calcula.
   */
  marketValue: number
  /** `''` em contratos cadastrados antes desta coluna existir. */
  objective: Objective | ''
}

/**
 * Cotação corrente, produzida pelas fórmulas GOOGLEFINANCE da aba `Cotações`.
 *
 * A fórmula viva mora na célula, uma por ativo — é de propósito. Quando o
 * GOOGLEFINANCE falha (acontece com FII e ETF brasileiro), a saída é editar
 * aquela célula à mão sem tocar em código.
 */
export interface Quote {
  symbol: string
  price: number
  currency: Currency
}

/** Snapshot mensal do patrimônio, gravado pelo Apps Script na aba `Histórico`. */
export interface HistoryPoint {
  date: string
  totalBRL: number
  byClass: Record<AssetClass, number>
}

/** Um par valor-absoluto/percentual, para não confundir os dois por aí. */
export interface Return {
  absolute: number
  /** Fração, não porcentagem: 0.082 é 8,2%. */
  percent: number
}

/**
 * Posição consolidada de um ativo, projetada a partir das operações.
 *
 * Tudo aparece em duas moedas de propósito: `*Native` conta como o ativo se
 * comportou, `*BRL` conta o que você de fato ganhou — a diferença entre os dois
 * é o câmbio, e para quem investe na Avenue ela costuma ser maior que o próprio
 * desempenho do ativo.
 */
export interface Position {
  symbol: string
  name: string
  assetClass: AssetClass
  /** `''` quando o ativo/contrato ainda não foi classificado por objetivo. */
  objective: Objective | ''
  currency: Currency
  quantity: number
  /** Preço médio na moeda do ativo (regra da RFB: venda não o altera). */
  avgPriceNative: number
  /** Custo médio por unidade em BRL, ao câmbio de cada compra. */
  avgPriceBRL: number
  totalCostNative: number
  totalCostBRL: number
  currentPrice: number
  /** Câmbio usado para converter o valor de mercado (o de hoje, não o das compras). */
  currentFxRate: number
  marketValueNative: number
  marketValueBRL: number
  /** Dividendos e juros já recebidos, na moeda do ativo. */
  incomeNative: number
  incomeBRL: number
  /** Ganho/perda incluindo proventos. */
  returnNative: Return
  returnBRL: Return
}

/** Visão da carteira inteira. É o que o agente consulta via MCP. */
export interface PortfolioSummary {
  totalBRL: number
  byClass: Array<{
    assetClass: AssetClass
    label: string
    valueBRL: number
    /** Fração do patrimônio total. */
    share: number
    /** Meta definida na aba `Config`, se houver. */
    target: number | null
    /** `share - target`, em pontos percentuais fracionários. Positivo = acima da meta. */
    drift: number | null
  }>
  /**
   * Mesma forma de `byClass`, agrupado por objetivo. Posições sem objetivo
   * classificado (`''`) ficam de fora — a soma pode não bater com `totalBRL`
   * até que toda a carteira esteja classificada.
   */
  byObjective: Array<{
    objective: Objective
    label: string
    valueBRL: number
    share: number
    target: number | null
    drift: number | null
  }>
  positionCount: number
  updatedAt: string
}
