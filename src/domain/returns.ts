import { roundMoney, safeDivide } from '@/lib/money'
import { netValue } from './average-cost'
import { calendarDaysBetween } from './fixed-income'
import type { Trade } from './types'

/**
 * Rentabilidade da carteira.
 *
 * A pergunta "quanto rendeu?" só tem resposta honesta com XIRR quando os
 * aportes são mensais e de tamanhos diferentes. O retorno simples
 * (`valor/custo − 1`) trata igual dinheiro que ficou cinco anos investido e
 * dinheiro que entrou mês passado, e num plano de aportes mensais isso
 * SUBESTIMA bastante o desempenho real.
 *
 * XIRR é a taxa anual que zera o valor presente de todos os fluxos nas datas em
 * que eles de fato aconteceram.
 */

export interface CashFlow {
  /** ISO `yyyy-mm-dd`. */
  date: string
  /** Negativo = dinheiro saiu do bolso · Positivo = dinheiro voltou. */
  amount: number
}

/** XIRR usa 365 dias corridos — diferente da base 252 da renda fixa. */
const DAYS_PER_YEAR = 365

const MAX_ITERATIONS = 100
const TOLERANCE = 1e-9

/** Uma taxa abaixo de -100% não tem significado financeiro. */
const MIN_RATE = -0.9999
const MAX_RATE = 100

function presentValue(flows: readonly CashFlow[], rate: number, origin: string): number {
  return flows.reduce((sum, flow) => {
    const years = calendarDaysBetween(origin, flow.date) / DAYS_PER_YEAR
    return sum + flow.amount / (1 + rate) ** years
  }, 0)
}

function derivative(flows: readonly CashFlow[], rate: number, origin: string): number {
  return flows.reduce((sum, flow) => {
    const years = calendarDaysBetween(origin, flow.date) / DAYS_PER_YEAR
    if (years === 0) return sum
    return sum - (years * flow.amount) / (1 + rate) ** (years + 1)
  }, 0)
}

/**
 * Taxa interna de retorno anualizada.
 *
 * Newton-Raphson com bisseção de reserva: Newton converge em poucas iterações
 * no caso normal, mas diverge quando o fluxo tem mais de uma troca de sinal —
 * e uma carteira com aportes e resgates alternados tem várias. A bisseção é
 * lenta e infalível, então serve de rede.
 *
 * Devolve `null` quando não há resposta: fluxo sem entrada e saída, ou sem raiz
 * no intervalo. Melhor não responder do que responder um número inventado.
 */
export function xirr(flows: readonly CashFlow[], guess = 0.1): number | null {
  const relevant = flows.filter((flow) => flow.amount !== 0)
  if (relevant.length < 2) return null
  if (!relevant.some((f) => f.amount > 0) || !relevant.some((f) => f.amount < 0)) return null

  const origin = relevant.reduce(
    (earliest, flow) => (flow.date < earliest ? flow.date : earliest),
    relevant[0]!.date,
  )

  let rate = guess
  for (let i = 0; i < MAX_ITERATIONS; i += 1) {
    const value = presentValue(relevant, rate, origin)
    if (Math.abs(value) < TOLERANCE) return rate

    const slope = derivative(relevant, rate, origin)
    if (slope === 0 || !Number.isFinite(slope)) break

    const next = rate - value / slope
    if (!Number.isFinite(next) || next <= MIN_RATE) break
    if (Math.abs(next - rate) < TOLERANCE) return next
    rate = next
  }

  return bisect(relevant, origin)
}

function bisect(flows: readonly CashFlow[], origin: string): number | null {
  let low = MIN_RATE
  let high = MAX_RATE
  let lowValue = presentValue(flows, low, origin)
  if (lowValue * presentValue(flows, high, origin) > 0) return null

  for (let i = 0; i < 200; i += 1) {
    const middle = (low + high) / 2
    const value = presentValue(flows, middle, origin)
    if (Math.abs(value) < TOLERANCE || high - low < TOLERANCE) return middle
    if (value * lowValue < 0) {
      high = middle
    } else {
      low = middle
      lowValue = value
    }
  }
  return (low + high) / 2
}

/**
 * Fluxos de caixa da carteira, em reais.
 *
 * Compra sai do bolso (negativo), venda e provento voltam (positivo), e o valor
 * de mercado de hoje entra como um resgate hipotético na data de hoje — é o que
 * torna a taxa comparável com um CDB.
 *
 * Tudo convertido ao câmbio de CADA operação: é o que você efetivamente
 * desembolsou, e é justamente aí que o efeito do dólar aparece na conta.
 */
export function portfolioCashFlows(
  trades: readonly Trade[],
  currentValueBRL: number,
  asOf: string,
): CashFlow[] {
  const flows: CashFlow[] = trades.map((trade) => {
    const amountBRL = netValue(trade) * (trade.fxRate || 1)
    return {
      date: trade.date,
      amount: trade.kind === 'buy' ? -amountBRL : amountBRL,
    }
  })

  if (currentValueBRL > 0) flows.push({ date: asOf, amount: currentValueBRL })
  return flows
}

export interface PerformanceSummary {
  /** Soma dos aportes, líquida de resgates, em reais. */
  investedBRL: number
  currentValueBRL: number
  /** `valor − investido`, incluindo proventos já recebidos. */
  gainBRL: number
  /** Retorno simples, ignorando as datas dos aportes. */
  simpleReturn: number
  /** Taxa anualizada considerando quando cada real entrou. `null` se indeterminada. */
  annualizedReturn: number | null
  firstTradeDate: string | null
}

export function summarizePerformance(
  trades: readonly Trade[],
  currentValueBRL: number,
  asOf: string,
): PerformanceSummary {
  let invested = 0
  let returned = 0

  for (const trade of trades) {
    const amountBRL = netValue(trade) * (trade.fxRate || 1)
    if (trade.kind === 'buy') invested += amountBRL
    else returned += amountBRL
  }

  const net = invested - returned
  const gain = currentValueBRL - net

  const dates = trades.map((trade) => trade.date).filter(Boolean).sort()

  return {
    investedBRL: roundMoney(net),
    currentValueBRL: roundMoney(currentValueBRL),
    gainBRL: roundMoney(gain),
    simpleReturn: safeDivide(gain, net),
    annualizedReturn: xirr(portfolioCashFlows(trades, currentValueBRL, asOf)),
    firstTradeDate: dates[0] ?? null,
  }
}
