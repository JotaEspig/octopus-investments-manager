/**
 * Datas trafegam como ISO `yyyy-mm-dd` no código e como `dd/mm/yyyy` na
 * planilha — o locale dela é pt_BR, e é nesse formato que o Sheets reconhece
 * o texto como data em vez de guardar uma string.
 */

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/
const BR = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/

export function toSheetDate(iso: string): string {
  const match = ISO.exec(iso.trim())
  if (!match) return iso
  const [, year, month, day] = match
  return `${day}/${month}/${year}`
}

/** Aceita `dd/mm/yyyy`, ISO, ou o número serial do Sheets. Devolve ISO ou string vazia. */
export function fromSheetDate(raw: unknown): string {
  if (typeof raw === 'number') return fromSerial(raw)

  const text = String(raw ?? '').trim()
  if (!text) return ''
  if (ISO.test(text)) return text

  const match = BR.exec(text)
  if (match) {
    const [, day, month, year] = match
    return `${year}-${month!.padStart(2, '0')}-${day!.padStart(2, '0')}`
  }

  // Algumas células voltam como "24/08/2026 00:00:00" ou ISO com hora.
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? '' : toISO(parsed)
}

/**
 * O Sheets conta dias desde 30/12/1899 (a "epoch" herdada do Lotus 1-2-3,
 * inclusive o bug do ano bissexto de 1900).
 */
function fromSerial(serial: number): string {
  const epoch = Date.UTC(1899, 11, 30)
  return toISO(new Date(epoch + Math.round(serial) * 86_400_000))
}

export function toISO(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function today(): string {
  return toISO(new Date())
}

/** `yyyy-mm` — chave de agrupamento mensal do histórico. */
export function monthKey(iso: string): string {
  return iso.slice(0, 7)
}
