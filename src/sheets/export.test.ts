import { describe, expect, it } from 'vitest'
import {
  canonicalJson,
  checksumOf,
  csvField,
  escapeFormulaInjection,
  normalizeHeaders,
  safeFilename,
  toCsv,
  type ExportedSheet,
} from './export'

function sheet(headers: string[], rows: Array<Record<string, unknown>>): ExportedSheet {
  return { title: 'Operações', kind: 'data', headers, rows, rowCount: rows.length }
}

describe('normalizeHeaders', () => {
  it('preserva os cabeçalhos e apara o espaço', () => {
    expect(normalizeHeaders(['ID', '  Data  ', 'Tipo'])).toEqual(['ID', 'Data', 'Tipo'])
  })

  it('dá nome a coluna sem cabeçalho, usando a LETRA real', () => {
    // Descartar a coluna perderia dados em silêncio; nomeá-la pela letra deixa
    // dar para achar na planilha.
    expect(normalizeHeaders(['ID', '', 'Tipo'])).toEqual(['ID', 'Coluna B', 'Tipo'])
    expect(normalizeHeaders(['', '', ''])).toEqual(['Coluna A', 'Coluna B', 'Coluna C'])
  })

  it('desambigua cabeçalho repetido em vez de sobrescrever', () => {
    expect(normalizeHeaders(['Valor', 'Valor', 'Valor'])).toEqual([
      'Valor',
      'Valor (2)',
      'Valor (3)',
    ])
  })

  it('usa a letra certa passando de Z', () => {
    const headers = normalizeHeaders(Array.from({ length: 28 }, () => ''))
    expect(headers[25]).toBe('Coluna Z')
    expect(headers[26]).toBe('Coluna AA')
    expect(headers[27]).toBe('Coluna AB')
  })
})

/**
 * Injeção de CSV é um problema de segurança de verdade: um campo que começa
 * com `=` vira fórmula ATIVA quando o arquivo é aberto no Excel ou no Sheets.
 */
describe('escapeFormulaInjection', () => {
  it('neutraliza os gatilhos de fórmula em texto', () => {
    expect(escapeFormulaInjection('=1+1')).toBe("'=1+1")
    expect(escapeFormulaInjection('=HYPERLINK("http://x","clique")')).toBe(
      '\'=HYPERLINK("http://x","clique")',
    )
    expect(escapeFormulaInjection('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(escapeFormulaInjection('+1')).toBe("'+1")
    expect(escapeFormulaInjection('-cmd')).toBe("'-cmd")
  })

  it('NÃO estraga número negativo', () => {
    // A defesa só vale para string. Um number nunca vira fórmula, então
    // -1234.56 tem que sair intacto — senão a exportação corromperia valores.
    expect(escapeFormulaInjection(-1234.56)).toBe(-1234.56)
    expect(escapeFormulaInjection(0)).toBe(0)
  })

  it('deixa texto comum em paz', () => {
    expect(escapeFormulaInjection('BBAS3')).toBe('BBAS3')
    expect(escapeFormulaInjection('Banco do Brasil')).toBe('Banco do Brasil')
    expect(escapeFormulaInjection('')).toBe('')
  })
})

describe('csvField', () => {
  it('protege separador, aspas e quebra de linha', () => {
    expect(csvField('sem nada')).toBe('sem nada')
    expect(csvField('com,vírgula')).toBe('"com,vírgula"')
    expect(csvField('com "aspas"')).toBe('"com ""aspas"""')
    expect(csvField('duas\nlinhas')).toBe('"duas\nlinhas"')
  })

  it('trata vazio e ausente como campo vazio', () => {
    expect(csvField(null)).toBe('')
    expect(csvField(undefined)).toBe('')
    expect(csvField('')).toBe('')
  })

  it('combina a defesa de injeção com as aspas', () => {
    expect(csvField('=A1,B1')).toBe('"\'=A1,B1"')
  })
})

describe('toCsv', () => {
  const exported = sheet(
    ['Ativo', 'Quantidade', 'Observação'],
    [
      { Ativo: 'BBAS3', Quantidade: 69, Observação: 'Inicialização' },
      { Ativo: 'AAPL', Quantidade: 1.75, Observação: 'com, vírgula' },
    ],
  )

  it('começa com BOM, para o Excel não estragar os acentos', () => {
    // Sem BOM, "Observação" abre como "ObservaÃ§Ã£o".
    expect(toCsv(exported).startsWith('﻿')).toBe(true)
  })

  it('usa CRLF, conforme a RFC 4180', () => {
    const lines = toCsv(exported).split('\r\n')
    expect(lines[0]).toBe('﻿Ativo,Quantidade,Observação')
    expect(lines[1]).toBe('BBAS3,69,Inicialização')
    expect(lines[2]).toBe('AAPL,1.75,"com, vírgula"')
  })

  it('respeita a ordem das colunas do cabeçalho, não a ordem do objeto', () => {
    const desordenado = sheet(
      ['Ativo', 'Quantidade'],
      [{ Quantidade: 10, Ativo: 'MSFT' }],
    )
    expect(toCsv(desordenado)).toContain('MSFT,10')
  })

  it('emite campo vazio para chave ausente na linha', () => {
    const incompleto = sheet(['Ativo', 'Quantidade', 'Taxas'], [{ Ativo: 'PG' }])
    expect(toCsv(incompleto).split('\r\n')[1]).toBe('PG,,')
  })

  it('aba sem linhas gera só o cabeçalho', () => {
    expect(toCsv(sheet(['A', 'B'], []))).toBe('﻿A,B\r\n')
  })
})

describe('canonicalJson', () => {
  it('ordena as chaves, para o mesmo dado dar sempre o mesmo texto', () => {
    // Um checksum que depende da ordem de inserção só é verificável por quem o
    // gerou — ou seja, não é verificável.
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
    expect(canonicalJson({ a: 2, b: 1 })).toBe('{"a":2,"b":1}')
  })

  it('preserva a ordem de array, que é significativa', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]')
  })

  it('desce em estrutura aninhada', () => {
    expect(canonicalJson({ z: { y: 1, x: 2 }, a: [{ n: 1, m: 2 }] })).toBe(
      '{"a":[{"m":2,"n":1}],"z":{"x":2,"y":1}}',
    )
  })

  it('normaliza ausente e nulo', () => {
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}')
    expect(canonicalJson(null)).toBe('null')
  })
})

describe('checksumOf', () => {
  it('é estável para o mesmo conteúdo', () => {
    const a = sheet(['A'], [{ A: 1 }])
    expect(checksumOf([a])).toBe(checksumOf([sheet(['A'], [{ A: 1 }])]))
  })

  it('não depende da ordem em que as chaves foram inseridas', () => {
    const um = sheet(['A', 'B'], [{ A: 1, B: 2 }])
    const outro = sheet(['A', 'B'], [{ B: 2, A: 1 } as Record<string, unknown>])
    expect(checksumOf([um])).toBe(checksumOf([outro]))
  })

  it('muda quando qualquer valor muda', () => {
    const original = checksumOf([sheet(['A'], [{ A: 1 }])])
    expect(checksumOf([sheet(['A'], [{ A: 2 }])])).not.toBe(original)
    expect(checksumOf([sheet(['A'], [])])).not.toBe(original)
  })

  it('distingue "1" de 1 — tipo faz parte do conteúdo', () => {
    expect(checksumOf([sheet(['A'], [{ A: 1 }])])).not.toBe(
      checksumOf([sheet(['A'], [{ A: '1' }])]),
    )
  })
})

describe('safeFilename', () => {
  it('tira acento e espaço do nome da aba', () => {
    expect(safeFilename('Operações')).toBe('operacoes')
    expect(safeFilename('Contratos RF')).toBe('contratos-rf')
    expect(safeFilename('Ações EUA')).toBe('acoes-eua')
  })

  it('nunca devolve nome vazio', () => {
    expect(safeFilename('...')).toBe('export')
    expect(safeFilename('')).toBe('export')
  })
})
