import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION, TRADES_SHEET } from './schema'
import { MIGRATIONS, compareHeaders, pendingMigrations } from './migrations'

/**
 * O registro de migrações é a única defesa contra alguém subir
 * `SCHEMA_VERSION` e esquecer de dizer o que mudou. Estes testes falham no
 * momento do esquecimento, e não meses depois na planilha de alguém.
 */

describe('registro de migrações', () => {
  it('tem uma entrada para cada versão desde a v2', () => {
    // A v1 é a instalação original: não há de onde migrar.
    const expected = Array.from({ length: SCHEMA_VERSION - 1 }, (_, index) => index + 2)
    expect(MIGRATIONS.map((migration) => migration.to)).toEqual(expected)
  })

  it('não pula nem repete versão', () => {
    const versions = MIGRATIONS.map((migration) => migration.to)
    expect(new Set(versions).size).toBe(versions.length)
    expect([...versions].sort((a, b) => a - b)).toEqual(versions)
  })

  it('nenhuma passa da versão que o código conhece', () => {
    for (const migration of MIGRATIONS) {
      expect(migration.to).toBeLessThanOrEqual(SCHEMA_VERSION)
    }
  })

  it('toda migração se explica', () => {
    // A descrição vai para a tela antes da confirmação — vazia, o usuário
    // confirmaria uma transformação sobre a qual não sabe nada.
    for (const migration of MIGRATIONS) {
      expect(migration.title.length).toBeGreaterThan(0)
      expect(migration.description.length).toBeGreaterThan(20)
    }
  })
})

describe('pendingMigrations', () => {
  it('devolve o que falta a partir da versão instalada', () => {
    expect(pendingMigrations(1).map((m) => m.to)).toEqual([2])
    expect(pendingMigrations(SCHEMA_VERSION)).toEqual([])
  })

  it('devolve vazio para uma planilha à frente do código', () => {
    // Acontece quando se roda uma versão antiga do repo contra uma planilha já
    // migrada. Melhor não fazer nada do que tentar "voltar".
    expect(pendingMigrations(SCHEMA_VERSION + 5)).toEqual([])
  })

  it('vem em ordem crescente, para aplicar uma versão por vez', () => {
    const versions = pendingMigrations(0).map((m) => m.to)
    expect([...versions].sort((a, b) => a - b)).toEqual(versions)
  })
})

/**
 * A deriva estrutural é a defesa que NÃO depende de ninguém lembrar de subir a
 * versão. Cada caso aqui é uma forma real de estragar dados.
 */
describe('compareHeaders', () => {
  const base = ['ID', 'Data', 'Tipo', 'Ativo']

  it('aceita cabeçalho idêntico', () => {
    expect(compareHeaders(base, [...base])).toEqual({ kind: 'identical' })
  })

  it('trata aba vazia como aba nova, não como problema', () => {
    expect(compareHeaders(base, [])).toEqual({ kind: 'empty' })
    expect(compareHeaders(base, ['', '', ''])).toEqual({ kind: 'empty' })
  })

  it('aceita coluna nova NO FIM — as linhas antigas só ficam com a célula vazia', () => {
    expect(compareHeaders([...base, 'Moeda'], base)).toEqual({
      kind: 'additive',
      added: ['Moeda'],
    })
  })

  it('recusa remoção de coluna', () => {
    // O schema perdeu "Ativo", mas a planilha ainda tem dados nela.
    const drift = compareHeaders(['ID', 'Data', 'Tipo'], base)
    expect(drift.kind).toBe('breaking')
    expect((drift as { reason: string }).reason).toContain('Ativo')
  })

  it('recusa coluna inserida no MEIO', () => {
    const drift = compareHeaders(['ID', 'Data', 'Corretora', 'Tipo', 'Ativo'], base)
    expect(drift.kind).toBe('breaking')
    expect((drift as { reason: string }).reason).toContain('coluna 3')
  })

  it('recusa reordenação', () => {
    const drift = compareHeaders(['ID', 'Tipo', 'Data', 'Ativo'], base)
    expect(drift.kind).toBe('breaking')
    expect((drift as { reason: string }).reason).toContain('coluna 2')
  })

  it('recusa renomeação, que de fora parece inofensiva', () => {
    const drift = compareHeaders(['ID', 'Data', 'Operação', 'Ativo'], base)
    expect(drift.kind).toBe('breaking')
  })

  it('ignora células vazias à direita do cabeçalho', () => {
    expect(compareHeaders(base, [...base, '', ''])).toEqual({ kind: 'identical' })
  })

  it('reconhece a aba Operações real como idêntica a si mesma', () => {
    const headers = TRADES_SHEET.columns.map((column) => column.header)
    expect(compareHeaders(headers, headers)).toEqual({ kind: 'identical' })
  })
})

describe('a migração para a v2', () => {
  it('é aditiva — não transforma dado gravado', () => {
    // A v2 só acrescentou coluna em aba de apresentação e uma tabela no
    // Painel, ambas reconstruídas pelo instalador. Se um dia isso mudar, o
    // teste falha e alguém precisa reconsiderar o `touchesData`.
    const v2 = MIGRATIONS.find((migration) => migration.to === 2)!
    expect(v2.touchesData).toBe(false)
  })
})
