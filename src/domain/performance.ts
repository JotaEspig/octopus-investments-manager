import { netValue } from './average-cost'
import { calendarDaysBetween, type CdiEntry } from './fixed-income'
import type { Trade } from './types'

/**
 * Evolução da carteira comparada ao CDI — o gráfico e o quadro de rendimento
 * do Painel.
 *
 * Duas perguntas diferentes, com duas contas diferentes:
 *
 * 1. "E se o MESMO dinheiro tivesse ido todo pro CDI?" — a linha cinza do
 *    gráfico. Parte do patrimônio no início da janela e soma cada aporte
 *    (e subtrai cada resgate) na data em que ele aconteceu, cada um rendendo
 *    CDI dali em diante. É comparável em REAIS com a linha da carteira.
 *
 * 2. "Quanto a carteira rendeu?" — o quadro no topo do Painel. Com aporte
 *    mensal, `patrimônio final ÷ inicial` mede quanto você DEPOSITOU, não
 *    quanto rendeu. Por isso é rentabilidade ponderada pelo tempo (TWR): o
 *    histórico é fatiado nos snapshots e cada fatia desconta o aporte que
 *    entrou nela. É a mesma conta que fundos e o próprio CDI divulgam, e é o
 *    que torna os dois percentuais comparáveis lado a lado.
 *
 * Espelhado em fórmula no Painel (`src/sheets/schema.ts`, `evolution*`) e
 * conferido por `npm run verify:sheet`. Se divergir, o certo é aqui.
 */

/** Um snapshot do patrimônio (aba `Histórico`). */
export interface HistoryPoint {
  /** ISO `yyyy-mm-dd`. */
  date: string
  totalBRL: number
}

/** Tamanho da janela do gráfico e da primeira linha do quadro. */
export const PERFORMANCE_WINDOW_MONTHS = 12

/**
 * Abaixo de um ano o CAGR não é mostrado: anualizar três meses bons projeta um
 * número que a carteira nunca entregou.
 */
export const MIN_DAYS_FOR_CAGR = 365

/**
 * Dinheiro que ENTROU na carteira, em reais: compra soma, venda e provento
 * subtraem.
 *
 * Provento subtrai porque sai do patrimônio que o histórico mede — o
 * dividendo cai na conta, não fica dentro do ativo. Reinvestido, ele volta
 * como uma compra. É o mesmo sinal (invertido) dos fluxos do XIRR.
 */
export function netContributionBRL(trade: Trade): number {
  const amountBRL = netValue(trade) * (trade.fxRate || 1)
  return trade.kind === 'buy' ? amountBRL : -amountBRL
}

/** Aporte líquido no intervalo `(from, to]`. `from` nulo = desde sempre. */
export function contributionsBetween(trades: readonly Trade[], from: string | null, to: string): number {
  return trades
    .filter((trade) => (from === null || trade.date > from) && trade.date <= to)
    .reduce((sum, trade) => sum + netContributionBRL(trade), 0)
}

/**
 * Fator acumulado do CDI no intervalo `(from, to]` — o dia do aporte não
 * rende, a mesma convenção da marcação na curva.
 */
export function cdiFactor(series: readonly CdiEntry[], from: string, to: string): number {
  return series
    .filter((entry) => entry.date > from && entry.date <= to)
    .reduce((factor, entry) => factor * (1 + entry.rateDaily), 1)
}

/**
 * `date` menos `months` meses, com o dia preso ao fim do mês — igual ao
 * `EDATE` da planilha (29/02 menos 12 meses = 28/02).
 */
export function subtractMonths(date: string, months: number): string {
  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(5, 7)) - 1 - months
  const day = Number(date.slice(8, 10))
  const targetYear = year + Math.floor(month / 12)
  const targetMonth = ((month % 12) + 12) % 12
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
  const clamped = Math.min(day, lastDay)
  return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(clamped).padStart(2, '0')}`
}

/**
 * Os snapshots dos últimos 12 meses, contados a partir do ÚLTIMO snapshot (não
 * de hoje) — ou o histórico inteiro, quando ele ainda não tem 12 meses.
 */
export function performanceWindow(
  history: readonly HistoryPoint[],
  months = PERFORMANCE_WINDOW_MONTHS,
): HistoryPoint[] {
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date))
  const last = sorted[sorted.length - 1]
  if (!last) return []
  const start = subtractMonths(last.date, months)
  return sorted.filter((point) => point.date >= start)
}

/**
 * A linha cinza: quanto valeria, em cada snapshot da janela, o mesmo dinheiro
 * aplicado 100% no CDI. Começa igual à carteira no primeiro ponto — a
 * comparação é do que aconteceu DENTRO da janela.
 */
export function cdiBenchmarkSeries(
  window: readonly HistoryPoint[],
  trades: readonly Trade[],
  cdi: readonly CdiEntry[],
): number[] {
  const first = window[0]
  if (!first) return []

  return window.map((point) => {
    const initial = first.totalBRL * cdiFactor(cdi, first.date, point.date)
    const contributions = trades
      .filter((trade) => trade.date > first.date && trade.date <= point.date)
      .reduce(
        (sum, trade) => sum + netContributionBRL(trade) * cdiFactor(cdi, trade.date, point.date),
        0,
      )
    return initial + contributions
  })
}

/**
 * Rentabilidade ponderada pelo tempo, encadeando os snapshots.
 *
 * Cada fatia `(anterior, atual]` rende `atual ÷ (anterior + aporte da fatia)`
 * — o aporte é tratado como se tivesse entrado no começo da fatia, o que com
 * snapshot semanal é uma aproximação de poucos dias.
 *
 * `fromInception`: a primeira fatia vai do primeiro aporte até o primeiro
 * snapshot (patrimônio anterior = zero), para que o rendimento anterior ao
 * primeiro snapshot também entre. Sem ela, a conta começa no primeiro ponto.
 *
 * Fatia com base não positiva é pulada: não há rendimento a medir sobre zero.
 */
export function timeWeightedReturn(
  points: readonly HistoryPoint[],
  trades: readonly Trade[],
  fromInception: boolean,
): number | null {
  if (points.length === 0) return null

  let growth = 1
  let measured = false
  points.forEach((point, index) => {
    if (index === 0 && !fromInception) return
    const previous = index === 0 ? null : points[index - 1]!
    const base = (previous?.totalBRL ?? 0) + contributionsBetween(trades, previous?.date ?? null, point.date)
    if (base <= 0) return
    growth *= point.totalBRL / base
    measured = true
  })

  return measured ? growth - 1 : null
}

/** CAGR: o retorno total convertido em taxa anual composta. */
export function annualize(totalReturn: number, days: number): number | null {
  if (days < MIN_DAYS_FOR_CAGR || totalReturn <= -1) return null
  return (1 + totalReturn) ** (365 / days) - 1
}

export interface PeriodPerformance {
  /** ISO — início do período (primeiro snapshot da janela, ou primeiro aporte). */
  start: string
  /** ISO — último snapshot. */
  end: string
  portfolioReturn: number | null
  /** CDI acumulado no mesmo período. */
  cdiReturn: number
}

export interface PerformanceOverview {
  lastMonths: PeriodPerformance & {
    /** O histórico ainda não tem 12 meses: a "janela" é o histórico inteiro. */
    isFullHistory: boolean
  }
  total: PeriodPerformance & {
    /** `null` com menos de um ano, ou retorno indeterminado. */
    cagr: number | null
  }
}

export function performanceOverview(
  history: readonly HistoryPoint[],
  trades: readonly Trade[],
  cdi: readonly CdiEntry[],
): PerformanceOverview | null {
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date))
  const window = performanceWindow(sorted)
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  if (!first || !last || !window[0]) return null

  const firstTrade = trades.reduce<string | null>(
    (earliest, trade) => (earliest === null || trade.date < earliest ? trade.date : earliest),
    null,
  )
  const inception = firstTrade !== null && firstTrade < first.date ? firstTrade : first.date
  const total: PeriodPerformance = {
    start: inception,
    end: last.date,
    portfolioReturn: timeWeightedReturn(sorted, trades, true),
    cdiReturn: cdiFactor(cdi, inception, last.date) - 1,
  }

  // Histórico com menos de 12 meses: a primeira linha É o histórico inteiro,
  // e precisa dar exatamente o mesmo número da segunda.
  const isFullHistory = window[0].date === first.date
  const lastMonths: PeriodPerformance = isFullHistory
    ? total
    : {
        start: window[0].date,
        end: last.date,
        portfolioReturn: timeWeightedReturn(window, trades, false),
        cdiReturn: cdiFactor(cdi, window[0].date, last.date) - 1,
      }

  return {
    lastMonths: { ...lastMonths, isFullHistory },
    total: {
      ...total,
      cagr:
        total.portfolioReturn === null
          ? null
          : annualize(total.portfolioReturn, calendarDaysBetween(inception, last.date)),
    },
  }
}
