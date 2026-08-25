import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION } from './schema'
import { MIGRATIONS, pendingMigrations } from './migrations'

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

describe('a migração para a v2', () => {
  it('é aditiva — não transforma dado gravado', () => {
    // A v2 só acrescentou coluna em aba de apresentação e uma tabela no
    // Painel, ambas reconstruídas pelo instalador. Se um dia isso mudar, o
    // teste falha e alguém precisa reconsiderar o `touchesData`.
    const v2 = MIGRATIONS.find((migration) => migration.to === 2)!
    expect(v2.touchesData).toBe(false)
  })
})
