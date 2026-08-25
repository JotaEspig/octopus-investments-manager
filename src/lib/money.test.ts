import { describe, expect, it } from 'vitest'
import { equals, parseNumber, round, roundMoney, safeDivide } from './money'

describe('round', () => {
  it('arredonda meio-para-cima mesmo nos casos que o float estraga', () => {
    // 1.005 é guardado como 1.00499999999999989 — sem a correção, daria 1.00.
    expect(round(1.005, 2)).toBe(1.01)
    expect(round(2.675, 2)).toBe(2.68)
    expect(round(1.0049, 2)).toBe(1.0)
  })

  it('trata negativo simetricamente', () => {
    expect(round(-1.005, 2)).toBe(-1.01)
    expect(round(-2.5, 0)).toBe(-3)
  })

  it('devolve 0 para valores não finitos', () => {
    expect(round(Number.NaN, 2)).toBe(0)
    expect(round(Number.POSITIVE_INFINITY, 2)).toBe(0)
  })

  it('não acumula erro somando muitos aportes', () => {
    let total = 0
    for (let i = 0; i < 1000; i += 1) total += 1000.01
    expect(roundMoney(total)).toBe(1000010)
  })
})

describe('equals', () => {
  it('ignora diferença abaixo do centavo', () => {
    expect(equals(0.1 + 0.2, 0.3)).toBe(true)
    expect(equals(10.004, 10.0)).toBe(true)
    expect(equals(10.006, 10.0)).toBe(false)
  })
})

describe('safeDivide', () => {
  it('devolve 0 em vez de Infinity ou NaN', () => {
    expect(safeDivide(10, 0)).toBe(0)
    expect(safeDivide(0, 0)).toBe(0)
    expect(safeDivide(10, 4)).toBe(2.5)
  })
})

describe('parseNumber', () => {
  it('entende o formato brasileiro e o americano', () => {
    expect(parseNumber('1.234,56')).toBe(1234.56)
    expect(parseNumber('1,234.56')).toBe(1234.56)
    expect(parseNumber('231.40')).toBe(231.4)
    expect(parseNumber('231,40')).toBe(231.4)
  })

  it('limpa símbolo de moeda e espaço', () => {
    expect(parseNumber('R$ 1.000,00')).toBe(1000)
    expect(parseNumber('US$ 231.40')).toBe(231.4)
  })

  it('devolve 0 para vazio e lixo', () => {
    expect(parseNumber('')).toBe(0)
    expect(parseNumber('   ')).toBe(0)
    expect(parseNumber(null)).toBe(0)
    expect(parseNumber(undefined)).toBe(0)
    expect(parseNumber('#N/A')).toBe(0)
  })

  it('passa número adiante', () => {
    expect(parseNumber(42.5)).toBe(42.5)
    expect(parseNumber(Number.NaN)).toBe(0)
  })
})
