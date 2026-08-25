import { roundMoney, safeDivide } from '@/lib/money'
import type { FixedIncomeIndexer } from './types'

/**
 * Marcação na curva de renda fixa e imposto de renda regressivo.
 *
 * Renda fixa não tem cotação: o valor de hoje é o principal corrigido pelo
 * indexador desde a aplicação. Cada indexador tem a sua fórmula, e todas usam
 * a base **252 dias úteis** — convenção da B3, não 365 corridos. Trocar 252 por
 * 365 subestima o rendimento em cerca de 30%.
 *
 * O calendário de dias úteis vem de graça da própria série do CDI: o Banco
 * Central publica exatamente uma observação por dia útil, feriado bancário
 * incluído na conta. Não precisamos manter uma tabela de feriados.
 */

/** Uma observação da série do CDI. `rateDaily` é FRAÇÃO (0,0005166), não percentual. */
export interface CdiEntry {
  /** ISO `yyyy-mm-dd`. */
  date: string
  rateDaily: number
}

export const BUSINESS_DAYS_PER_YEAR = 252

export interface MarkToCurveInput {
  principal: number
  indexer: FixedIncomeIndexer
  /**
   * Fração: `1.1` = 110% do CDI · `0.13` = 13% a.a. prefixado ·
   * `0.06` = IPCA + 6% a.a.
   */
  rate: number
  issueDate: string
  asOf: string
  /** Série do CDI ordenada por data. Também serve de calendário de dias úteis. */
  series: readonly CdiEntry[]
  /**
   * Fator acumulado do IPCA entre a aplicação e `asOf` (1,05 = 5% de inflação).
   * Só usado por papéis IPCA+.
   */
  inflationFactor?: number
}

/** Observações no intervalo `(issueDate, asOf]` — o dia da aplicação não rende. */
export function entriesInPeriod(
  series: readonly CdiEntry[],
  issueDate: string,
  asOf: string,
): CdiEntry[] {
  return series.filter((entry) => entry.date > issueDate && entry.date <= asOf)
}

/** Dias úteis decorridos, contados pela própria série do Banco Central. */
export function businessDays(
  series: readonly CdiEntry[],
  issueDate: string,
  asOf: string,
): number {
  return entriesInPeriod(series, issueDate, asOf).length
}

/**
 * Valor bruto de hoje.
 *
 * **Pós-fixado (% do CDI)** — convenção B3/ANBIMA:
 *
 *     VF = VP × Π [ 1 + (CDI_k × p) ]
 *
 * O percentual contratado multiplica a TAXA DIÁRIA, não o fator. A série 12 do
 * SGS já publica CDI_k em % ao dia; guardamos como fração. Conferência que
 * fecha exato com a série 4389 (CDI anualizado base 252):
 * (1 + 0,0005166)^252 − 1 = 13,90% a.a.
 *
 * **Prefixado:**
 *
 *     VF = VP × (1 + i)^(du/252)
 *
 * **IPCA+:**
 *
 *     VF = VP × fator_IPCA × (1 + cupom)^(du/252)
 *
 * ⚠️ O `fator_IPCA` aqui é uma APROXIMAÇÃO. O VNA oficial de um papel IPCA+ usa
 * o IPCA com defasagem de um mês e projeção pro-rata da ANBIMA entre as
 * divulgações; reproduzir isso exigiria a projeção mensal da ANBIMA, que não é
 * uma API aberta. Para acompanhar a carteira serve; para conferir o extrato da
 * corretora ao centavo, não.
 */
export function markToCurve(input: MarkToCurveInput): number {
  const { principal, indexer, rate, issueDate, asOf, series } = input
  if (principal <= 0) return 0

  const period = entriesInPeriod(series, issueDate, asOf)

  switch (indexer) {
    case 'cdi': {
      const factor = period.reduce((acc, entry) => acc * (1 + entry.rateDaily * rate), 1)
      return roundMoney(principal * factor)
    }
    case 'prefixed': {
      const exponent = period.length / BUSINESS_DAYS_PER_YEAR
      return roundMoney(principal * (1 + rate) ** exponent)
    }
    case 'ipca': {
      const exponent = period.length / BUSINESS_DAYS_PER_YEAR
      const inflation = input.inflationFactor ?? 1
      return roundMoney(principal * inflation * (1 + rate) ** exponent)
    }
  }
}

// ---------------------------------------------------------------------------
// Imposto de renda
// ---------------------------------------------------------------------------

/**
 * Tabela regressiva da renda fixa (Lei 11.033/2004, art. 1º).
 *
 * As faixas contam DIAS CORRIDOS desde a aplicação — não dias úteis, ao
 * contrário da marcação na curva. É retido na fonte no resgate, sobre o
 * rendimento, e a alíquota vale para o resgate inteiro: cruzar de 360 para 361
 * dias derruba de 20% para 17,5% sobre TODO o ganho, não só sobre a parte
 * posterior. Por isso vale a pena olhar o calendário antes de resgatar.
 */
export const IR_BRACKETS: ReadonlyArray<{ upToDays: number; rate: number }> = [
  { upToDays: 180, rate: 0.225 },
  { upToDays: 360, rate: 0.2 },
  { upToDays: 720, rate: 0.175 },
  { upToDays: Number.POSITIVE_INFINITY, rate: 0.15 },
]

export function incomeTaxRate(calendarDays: number): number {
  return IR_BRACKETS.find((bracket) => calendarDays <= bracket.upToDays)!.rate
}

export function calendarDaysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  if (Number.isNaN(start) || Number.isNaN(end)) return 0
  return Math.max(0, Math.round((end - start) / 86_400_000))
}

export interface NetValue {
  gross: number
  gain: number
  taxRate: number
  tax: number
  net: number
  calendarDays: number
  /** Dias até a próxima alíquota menor, ou `null` se já está na de 15%. */
  daysToNextBracket: number | null
}

/** Quanto sobra se resgatar hoje, com o IR retido na fonte. */
export function netOfTax(principal: number, gross: number, issueDate: string, asOf: string): NetValue {
  const calendarDays = calendarDaysBetween(issueDate, asOf)
  const gain = Math.max(0, gross - principal)
  const taxRate = incomeTaxRate(calendarDays)
  const tax = roundMoney(gain * taxRate)

  const nextBracket = IR_BRACKETS.find((bracket) => bracket.upToDays > calendarDays)
  const daysToNextBracket = Number.isFinite(nextBracket?.upToDays)
    ? nextBracket!.upToDays - calendarDays + 1
    : null

  return {
    gross: roundMoney(gross),
    gain: roundMoney(gain),
    taxRate,
    tax,
    net: roundMoney(gross - tax),
    calendarDays,
    daysToNextBracket,
  }
}

/** Taxa anual equivalente, para comparar papéis de prazos diferentes. */
export function annualizedReturn(principal: number, gross: number, businessDaysElapsed: number): number {
  if (principal <= 0 || businessDaysElapsed <= 0) return 0
  const growth = safeDivide(gross, principal)
  if (growth <= 0) return 0
  return growth ** (BUSINESS_DAYS_PER_YEAR / businessDaysElapsed) - 1
}
