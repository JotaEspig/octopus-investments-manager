import { monthKey } from '@/lib/dates'

/**
 * Buracos no histórico do patrimônio.
 *
 * O histórico é a ÚNICA coisa irreversível do projeto. CDI e renda fixa se
 * recuperam sozinhos, porque são recalculados da série inteira a cada
 * execução. O patrimônio de um mês passado não — ninguém guarda "quanto valia
 * a carteira em julho".
 *
 * Só que dá para reconstruir, e o Apps Script sabe fazer isso
 * (`backfillHistory`): a posição de qualquer data sai do livro-razão, o preço
 * daquela data sai do GOOGLEFINANCE histórico, e a renda fixa sai da marcação
 * na curva. Esta função é a metade que DESCOBRE o buraco — sem ela, o usuário
 * não saberia que precisa rodar aquilo.
 */

/**
 * Meses entre o primeiro aporte e hoje que não têm linha no histórico.
 *
 * O mês CORRENTE fica de fora de propósito: ele é responsabilidade do snapshot
 * diário, que usa cotação de agora em vez de histórica. Tratá-lo como buraco
 * faria o diagnóstico reclamar todo primeiro dia do mês.
 */
export function missingHistoryMonths(
  firstTradeDate: string | null,
  recordedDates: readonly string[],
  today: string,
): string[] {
  if (!firstTradeDate) return []

  const currentMonth = monthKey(today)
  const recorded = new Set(recordedDates.filter(Boolean).map(monthKey))

  const missing: string[] = []
  let cursor = monthKey(firstTradeDate)

  // Guarda contra data absurda no livro-razão: 1200 meses são 100 anos.
  for (let steps = 0; cursor <= currentMonth && steps < 1200; steps += 1) {
    if (cursor !== currentMonth && !recorded.has(cursor)) missing.push(cursor)
    cursor = nextMonth(cursor)
  }

  return missing
}

/** `2026-12` → `2027-01`. */
export function nextMonth(yyyymm: string): string {
  const year = Number(yyyymm.slice(0, 4))
  const month = Number(yyyymm.slice(5, 7))
  return month >= 12
    ? `${year + 1}-01`
    : `${yyyymm.slice(0, 4)}-${String(month + 1).padStart(2, '0')}`
}

/** Último dia do mês, em ISO. É a data que o backfill usa para cotar. */
export function lastDayOfMonth(yyyymm: string): string {
  const year = Number(yyyymm.slice(0, 4))
  const month = Number(yyyymm.slice(5, 7))
  // Dia 0 do mês seguinte é o último deste — e o JS acerta o ano bissexto.
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
}
