/**
 * Aritmética de dinheiro.
 *
 * Usamos `number` (float 64) com arredondamento explícito nas fronteiras, não
 * uma biblioteca decimal. É uma decisão consciente para esta escala: um float
 * de 64 bits representa exatamente inteiros até 2^53, então os erros só
 * aparecem na 15ª casa — muito abaixo do centavo, mesmo somando décadas de
 * aportes. O que NÃO se pode fazer é comparar dois valores com `===` sem
 * arredondar antes; use `equals()`.
 */

/** Casas decimais por natureza do número. */
export const DECIMALS = {
  /** Dinheiro: centavos. */
  money: 2,
  /** Preço unitário: ações fracionárias e cotas de RF pedem mais casas. */
  price: 8,
  /** Quantidade: idem. */
  quantity: 8,
  /** Fração/percentual guardado como fração (0,0825 = 8,25%). */
  rate: 8,
} as const

/**
 * Arredonda meio-para-cima em valor absoluto, e não meio-para-o-par como faz o
 * `toFixed` de algumas engines. O `Number.EPSILON` corrige o caso clássico em
 * que 1.005 é representado como 1.00499999999999989.
 */
export function round(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** decimals
  const scaled = value * factor
  const corrected = scaled + Math.sign(scaled) * Number.EPSILON * Math.abs(scaled)
  return Math.round(corrected) / factor
}

export const roundMoney = (value: number) => round(value, DECIMALS.money)
export const roundPrice = (value: number) => round(value, DECIMALS.price)
export const roundQuantity = (value: number) => round(value, DECIMALS.quantity)
export const roundRate = (value: number) => round(value, DECIMALS.rate)

/** Iguais até a casa indicada. Nunca compare dinheiro com `===`. */
export function equals(a: number, b: number, decimals: number = DECIMALS.money): boolean {
  return round(a, decimals) === round(b, decimals)
}

/** Divisão que devolve 0 em vez de `Infinity`/`NaN` quando o denominador é zero. */
export function safeDivide(numerator: number, denominator: number): number {
  if (!denominator || !Number.isFinite(denominator)) return 0
  const result = numerator / denominator
  return Number.isFinite(result) ? result : 0
}

/** Interpreta o que vem da planilha: aceita `"1.234,56"`, `"1,234.56"` e número. */
export function parseNumber(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0
  if (typeof raw !== 'string') return 0

  const text = raw.trim().replace(/[R$\s%]|US\$/g, '')
  if (!text) return 0

  // A última pontuação encontrada é o separador decimal; o resto é milhar.
  const lastComma = text.lastIndexOf(',')
  const lastDot = text.lastIndexOf('.')
  const normalized =
    lastComma > lastDot
      ? text.replace(/\./g, '').replace(',', '.')
      : text.replace(/,/g, '')

  const value = Number(normalized)
  return Number.isFinite(value) ? value : 0
}
