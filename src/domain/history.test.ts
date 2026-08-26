import { describe, expect, it } from 'vitest'
import { lastDayOfMonth, missingHistoryMonths, nextMonth } from './history'

/**
 * O histórico é a única coisa que se perde de vez. Estes testes cobrem a
 * metade que DESCOBRE o buraco — a que o conserta vive no Apps Script, porque
 * precisa do GOOGLEFINANCE histórico.
 */

describe('nextMonth', () => {
  it('anda um mês', () => {
    expect(nextMonth('2026-01')).toBe('2026-02')
    expect(nextMonth('2026-09')).toBe('2026-10')
  })

  it('vira o ano em dezembro', () => {
    expect(nextMonth('2026-12')).toBe('2027-01')
  })
})

describe('lastDayOfMonth', () => {
  it('acerta meses de 30 e 31 dias', () => {
    expect(lastDayOfMonth('2026-01')).toBe('2026-01-31')
    expect(lastDayOfMonth('2026-04')).toBe('2026-04-30')
    expect(lastDayOfMonth('2026-12')).toBe('2026-12-31')
  })

  it('acerta fevereiro, inclusive bissexto', () => {
    expect(lastDayOfMonth('2026-02')).toBe('2026-02-28')
    expect(lastDayOfMonth('2028-02')).toBe('2028-02-29')
  })
})

describe('missingHistoryMonths', () => {
  const hoje = '2026-08-25'

  it('não reclama de carteira sem operação', () => {
    expect(missingHistoryMonths(null, [], hoje)).toEqual([])
  })

  it('acha o buraco entre meses gravados', () => {
    const faltando = missingHistoryMonths(
      '2026-04-10',
      ['2026-04-30', '2026-07-31'],
      hoje,
    )
    expect(faltando).toEqual(['2026-05', '2026-06'])
  })

  it('IGNORA o mês corrente — ele é do snapshot diário', () => {
    // Sem isso, o diagnóstico reclamaria todo dia 1º.
    const faltando = missingHistoryMonths('2026-08-01', [], hoje)
    expect(faltando).toEqual([])
  })

  it('pega tudo quando o gatilho nunca rodou', () => {
    const faltando = missingHistoryMonths('2026-05-15', [], hoje)
    expect(faltando).toEqual(['2026-05', '2026-06', '2026-07'])
  })

  it('não reclama quando está tudo gravado', () => {
    const faltando = missingHistoryMonths(
      '2026-06-01',
      ['2026-06-30', '2026-07-31'],
      hoje,
    )
    expect(faltando).toEqual([])
  })

  it('atravessa a virada de ano', () => {
    const faltando = missingHistoryMonths('2025-11-20', [], '2026-02-10')
    expect(faltando).toEqual(['2025-11', '2025-12', '2026-01'])
  })

  it('aceita data gravada em qualquer dia do mês', () => {
    // O snapshot grava o dia em que rodou, não o último do mês.
    const faltando = missingHistoryMonths('2026-06-01', ['2026-06-14', '2026-07-03'], hoje)
    expect(faltando).toEqual([])
  })

  it('não trava com data absurda no livro-razão', () => {
    // Erro de digitação no ano não pode virar laço infinito.
    const faltando = missingHistoryMonths('1900-01-01', [], hoje)
    expect(faltando.length).toBeLessThanOrEqual(1200)
    expect(faltando[0]).toBe('1900-01')
  })
})
