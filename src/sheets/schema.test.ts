import { describe, expect, it } from 'vitest'
import { ASSET_CLASSES } from '@/domain/types'
import {
  DIALECT_PROBE,
  FALLBACK_TIME_ZONE,
  FORMULA_TOKEN,
  VIEW_FIRST_ROW,
  VIEW_SHEETS,
  dashboardAssetsFormula,
  localizeFormula,
  localizeValue,
  ref,
  resolveTimeZone,
} from './schema'

/**
 * O contrato da planilha não pode ser testado contra o Google sem uma planilha
 * de verdade — mas a parte que gera texto de fórmula é pura, e é justamente
 * onde mora o erro mais caro: uma pontuação trocada enche a planilha de
 * `#ERROR!` sem ninguém perceber.
 */

/** Sobrou token de controle? Então alguma tradução não aconteceu. */
function hasLeftoverTokens(formula: string): boolean {
  return Object.values(FORMULA_TOKEN).some((token) => formula.includes(token))
}

function isBalanced(formula: string): boolean {
  const pairs: Record<string, string> = { ')': '(', '}': '{' }
  const stack: string[] = []
  let insideString = false

  for (const character of formula) {
    if (character === '"') insideString = !insideString
    if (insideString) continue
    if (character === '(' || character === '{') stack.push(character)
    if (character in pairs && stack.pop() !== pairs[character]) return false
  }
  return stack.length === 0 && !insideString
}

/**
 * O Sheets não tem data com fuso: a célula guarda relógio de parede no fuso da
 * planilha. Com a planilha em `Etc/GMT`, o `=NOW()` do Painel aparecia três
 * horas no futuro para quem está no Brasil — foi assim que o bug apareceu.
 */
describe('resolveTimeZone', () => {
  it('devolve um fuso IANA válido', () => {
    const zone = resolveTimeZone()
    expect(zone).toMatch(/^[A-Za-z]+\/[A-Za-z_+\-0-9/]+$|^UTC$/)
    // Se for válido, o Intl aceita sem lançar.
    expect(() => new Intl.DateTimeFormat('pt-BR', { timeZone: zone })).not.toThrow()
  })

  it('o fallback também é um fuso válido', () => {
    expect(() => new Intl.DateTimeFormat('pt-BR', { timeZone: FALLBACK_TIME_ZONE })).not.toThrow()
  })

  it('nunca devolve vazio', () => {
    expect(resolveTimeZone().length).toBeGreaterThan(0)
  })
})

describe('localizeFormula', () => {
  it('mantém o dialeto ponto-e-vírgula intacto', () => {
    expect(localizeFormula('=IF(A1>0;"sim";"não")', 'semicolon')).toBe('=IF(A1>0;"sim";"não")')
  })

  it('converte para vírgula sem estragar o separador de LINHA de matriz', () => {
    // O caso que um replace ingênuo erra: `;` significa "argumento" fora da
    // matriz e "próxima linha" dentro dela. Em en_US o primeiro vira `,` e o
    // segundo continua `;`.
    const formula = `=SORT({A1${FORMULA_TOKEN.arrayColumn}B1${FORMULA_TOKEN.arrayRow}A2${FORMULA_TOKEN.arrayColumn}B2};1;TRUE)`
    expect(localizeFormula(formula, 'comma')).toBe('=SORT({A1,B1;A2,B2},1,TRUE)')
  })

  it('usa contrabarra na coluna de matriz no dialeto pt_BR', () => {
    const formula = `={A1${FORMULA_TOKEN.arrayColumn}B1${FORMULA_TOKEN.arrayRow}A2${FORMULA_TOKEN.arrayColumn}B2}`
    expect(localizeFormula(formula, 'semicolon')).toBe('={A1\\B1;A2\\B2}')
  })

  it('não sobra nenhum token depois de traduzir', () => {
    const formula = `={A${FORMULA_TOKEN.arrayColumn}B${FORMULA_TOKEN.arrayRow}C${FORMULA_TOKEN.arg}D}`
    for (const dialect of ['semicolon', 'comma'] as const) {
      expect(hasLeftoverTokens(localizeFormula(formula, dialect))).toBe(false)
    }
  })
})

describe('localizeValue', () => {
  it('só mexe no que é fórmula', () => {
    expect(localizeValue('=IF(1;2;3)', 'comma')).toBe('=IF(1,2,3)')
    expect(localizeValue('CDB Banco XP; 2028', 'comma')).toBe('CDB Banco XP; 2028')
    expect(localizeValue(1234.56, 'comma')).toBe(1234.56)
    expect(localizeValue(null, 'comma')).toBeNull()
  })
})

describe('sonda de dialeto', () => {
  it('é escrita no dialeto ponto-e-vírgula e traduz para os dois', () => {
    expect(localizeFormula(DIALECT_PROBE, 'semicolon')).toBe('=IF(1=1;"OK";"FAIL")')
    expect(localizeFormula(DIALECT_PROBE, 'comma')).toBe('=IF(1=1,"OK","FAIL")')
  })
})

describe('abas de apresentação', () => {
  it('cobre todas as classes de ativo', () => {
    expect(VIEW_SHEETS.map((spec) => spec.assetClass).sort()).toEqual([...ASSET_CLASSES].sort())
  })

  it('todas têm a coluna de participação na classe', () => {
    for (const spec of VIEW_SHEETS) {
      expect(spec.columns.map((column) => column.header)).toContain('% da classe')
    }
  })

  it('o total aponta para "Valor (R$)", não para a última coluna', () => {
    // A coluna "% da classe" entrou DEPOIS do total; se o índice fosse
    // `length - 1`, o intervalo nomeado passaria a somar porcentagens.
    for (const spec of VIEW_SHEETS) {
      expect(spec.columns[spec.totalColumn]!.header).toBe('Valor (R$)')
      expect(spec.totalColumn).toBeLessThan(spec.columns.length - 1)
    }
  })

  it('a participação divide pelo total da PRÓPRIA classe', () => {
    for (const spec of VIEW_SHEETS) {
      const column = spec.columns.find((candidate) => candidate.header === '% da classe')!
      const formula = column.formula(VIEW_FIRST_ROW)
      expect(formula).toContain(spec.totalRangeName)
      // Divide a coluna de valor em reais, não a de moeda nativa.
      expect(formula).toContain('$K')
    }
  })

  it('gera fórmulas equilibradas em toda linha', () => {
    for (const spec of VIEW_SHEETS) {
      for (const column of spec.columns) {
        const formula = column.formula(VIEW_FIRST_ROW)
        expect(isBalanced(formula), `${spec.title} · ${column.header}`).toBe(true)
      }
    }
  })
})

describe('dashboardAssetsFormula', () => {
  const formula = dashboardAssetsFormula()

  it('empilha as cinco seções', () => {
    for (const spec of VIEW_SHEETS) {
      expect(formula).toContain(ref(spec.title, '$A$3'))
    }
  })

  it('ordena pela coluna de valor, decrescente', () => {
    expect(formula).toContain('SORT(FILTER(dados;INDEX(dados;;3)>0);3;FALSE)')
  })

  it('fica equilibrada e sem tokens nos dois dialetos', () => {
    for (const dialect of ['semicolon', 'comma'] as const) {
      const localized = localizeFormula(formula, dialect)
      expect(hasLeftoverTokens(localized)).toBe(false)
      expect(isBalanced(localized), dialect).toBe(true)
    }
  })

  it('dá a cada bloco um fallback de 4 colunas', () => {
    // Sem o fallback, uma classe sem ativos devolve #N/A e derruba a pilha
    // inteira — a tabela some por causa de uma seção vazia.
    const separator = FORMULA_TOKEN.arrayColumn
    const fallback = `{""${separator}""${separator}0${separator}0}`
    expect(formula.split(fallback)).toHaveLength(VIEW_SHEETS.length + 1)
  })
})
