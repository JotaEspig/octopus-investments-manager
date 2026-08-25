import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION, TRADES_SHEET } from './schema'
import {
  MIGRATIONS,
  applyInOrder,
  compareHeaders,
  pendingMigrations,
  type Migration,
} from './migrations'

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
 * Sair da v2 e chegar na v4 NÃO é um salto: é v2→v3→v4, uma etapa por vez.
 *
 * Nenhuma migração precisa saber de onde o usuário veio — a v4 só sabe
 * transformar uma planilha v3, e é o encadeamento que garante que ela receba
 * uma. Se cada migração tivesse que lidar com "veio da v1? da v2?", cada nova
 * versão multiplicaria os caminhos possíveis.
 */
describe('corrente de v2 até v4', () => {
  const fake = (to: number, touchesData = false): Migration => ({
    to,
    title: `Migração v${to}`,
    description: `Descrição suficientemente longa da migração para a v${to}.`,
    touchesData,
    apply: async () => [`aplicou v${to}`],
  })

  const registry = [fake(2), fake(3, true), fake(4)]

  it('devolve as duas etapas intermediárias, em ordem', () => {
    expect(pendingMigrations(2, registry, 4).map((m) => m.to)).toEqual([3, 4])
  })

  it('quem está na v3 só pega a v4', () => {
    expect(pendingMigrations(3, registry, 4).map((m) => m.to)).toEqual([4])
  })

  it('não avança além da versão que o código conhece', () => {
    // Código na v3, registro já com a v4: a v4 fica de fora.
    expect(pendingMigrations(2, registry, 3).map((m) => m.to)).toEqual([3])
  })

  it('basta UMA etapa tocar dados para a corrente inteira exigir cuidado', () => {
    const pending = pendingMigrations(2, registry, 4)
    expect(pending.some((m) => m.touchesData)).toBe(true)
  })

  it('aplica na ordem e grava a versão DEPOIS de cada etapa', async () => {
    const order: string[] = []
    const chain = await applyInOrder(pendingMigrations(2, registry, 4), {
      apply: async (migration) => {
        order.push(`apply:${migration.to}`)
        return ['ok']
      },
      record: async (version) => {
        order.push(`record:${version}`)
      },
    })

    // O intercalado é o ponto: gravar só no fim tornaria a operação
    // não-retomável.
    expect(order).toEqual(['apply:3', 'record:3', 'apply:4', 'record:4'])
    expect(chain.applied).toEqual([3, 4])
    expect(chain.failedAt).toBeNull()
  })

  it('falhando na v4, a planilha fica registrada na v3 — e retoma daí', async () => {
    const recorded: number[] = []
    const chain = await applyInOrder(pendingMigrations(2, registry, 4), {
      apply: async (migration) => {
        if (migration.to === 4) throw new Error('a API do Google caiu no meio')
        return ['ok']
      },
      record: async (version) => {
        recorded.push(version)
      },
    })

    expect(chain.applied).toEqual([3])
    expect(chain.failedAt).toBe(4)
    // A v3 ficou gravada: rodar de novo NÃO a reaplica sobre dados que ela já
    // transformou, que é como se duplicaria uma correção.
    expect(recorded).toEqual([3])
    expect(chain.actions.at(-1)).toContain('a API do Google caiu no meio')
  })

  it('falhando na PRIMEIRA etapa, nada é gravado', async () => {
    const recorded: number[] = []
    const chain = await applyInOrder(pendingMigrations(2, registry, 4), {
      apply: async () => {
        throw new Error('falhou logo de cara')
      },
      record: async (version) => {
        recorded.push(version)
      },
    })

    expect(chain.applied).toEqual([])
    expect(chain.failedAt).toBe(3)
    expect(recorded).toEqual([])
  })

  it('um buraco no registro seria fatal — e é o que o teste do registro impede', () => {
    // Sem a v3, sair da v2 aplicaria a v4 sobre uma planilha v2. A v4 espera
    // uma v3 e transformaria a estrutura errada.
    const comBuraco = [fake(2), fake(4)]
    expect(pendingMigrations(2, comBuraco, 4).map((m) => m.to)).toEqual([4])
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
