/**
 * `npm run verify:sheet` — confere se a planilha e o código concordam.
 *
 * POR QUE ISTO EXISTE. O preço médio é calculado em dois lugares: nas fórmulas
 * das abas de apresentação (para a planilha funcionar no celular sem nada
 * rodando) e em `src/domain/` (a autoridade, usada pela API e pelo MCP). É uma
 * duplicação consciente, e toda duplicação consciente precisa de um guarda —
 * senão vira divergência silenciosa, que num sistema de dinheiro é o pior tipo
 * de bug: você confia no número errado por meses.
 *
 * Confere:
 *   1. Fórmulas com erro (#ERROR!, #NAME?, #REF!) — o sintoma clássico de
 *      locale trocado, em que o Sheets espera `,` e escrevemos `;`
 *   2. Posição, preço médio, valor de mercado e rendimento %, ativo a ativo
 *   3. Total do Painel contra a soma calculada aqui
 *   4. Se alguma classe estourou o teto de linhas das abas de apresentação
 *   5. Valor e rendimento % por objetivo, no Painel
 *   6. Rendimento % por classe — o da linha 1 de cada aba e o do Painel, que
 *      lê aquela mesma célula pelo intervalo nomeado
 *
 * Sai com código 1 em qualquer divergência, para poder virar um passo de CI.
 */

import { config as loadDotenv } from 'dotenv'
import { getSheetsContext } from '../src/sheets/client'
import { loadPortfolio } from '../src/sheets/portfolio'
import { DASHBOARD, VIEW_FIRST_ROW, VIEW_ROWS, VIEW_SHEETS, ref } from '../src/sheets/schema'
import { columnLetter } from '../src/sheets/bootstrap'
import { parseNumber } from '../src/lib/money'
import { ASSET_CLASS_LABELS, OBJECTIVE_LABELS, OBJECTIVES, type Position } from '../src/domain/types'

/**
 * Diferença tolerada num percentual, em pontos fracionários (0,0001 = 0,01 p.p.).
 * Um centavo de diferença num total pequeno vira muita porcentagem.
 */
const PERCENT_TOLERANCE = 0.0001

loadDotenv({ path: '.env.local', quiet: true })

/** Um centavo. Abaixo disso é arredondamento, não divergência. */
const TOLERANCE = 0.01

const FORMULA_ERRORS = ['#ERROR!', '#NAME?', '#REF!', '#VALUE!', '#DIV/0!', '#NUM!']

interface Divergence {
  where: string
  what: string
  sheet: number
  code: number
}

const divergences: Divergence[] = []
const notes: string[] = []

function compare(where: string, what: string, sheetValue: number, codeValue: number) {
  if (Math.abs(sheetValue - codeValue) > TOLERANCE) {
    divergences.push({ where, what, sheet: sheetValue, code: codeValue })
  }
}

function headerIndex(headers: string[], name: string): number {
  return headers.indexOf(name)
}

function comparePercent(where: string, what: string, sheetValue: number, codeValue: number) {
  if (Math.abs(sheetValue - codeValue) > PERCENT_TOLERANCE) {
    divergences.push({ where, what, sheet: sheetValue, code: codeValue })
  }
}

/**
 * Rendimento % de um conjunto de posições, do jeito que a planilha agrega:
 * ganho ÷ custo, os dois convertidos ao câmbio de HOJE (`currentFxRate`).
 *
 * Não é a média das porcentagens — é a razão das somas, então uma posição
 * grande pesa mais. E é o rendimento na MOEDA DO ATIVO: o câmbio multiplica
 * numerador e denominador e se cancela. O rendimento em reais de verdade
 * (`returnBRL`, que usa o câmbio de cada compra) não tem como ser calculado
 * pela fórmula da planilha sem uma coluna de custo em reais.
 *
 * Nota: a aba `Renda Fixa` chama de "Rendimento (R$)" a diferença entre valor
 * bruto e aplicado, sem somar proventos de `interest` — se um contrato um dia
 * pagar juros em dinheiro, esta conferência acusa, e o certo será dar à aba
 * uma coluna de proventos, não afrouxar isto aqui.
 */
function aggregateReturn(positions: readonly Position[]): number {
  let gain = 0
  let cost = 0
  for (const position of positions) {
    gain += position.returnNative.absolute * position.currentFxRate
    cost += position.totalCostNative * position.currentFxRate
  }
  return cost === 0 ? 0 : gain / cost
}

async function main() {
  const context = getSheetsContext()
  const { positions, summary } = await loadPortfolio()

  // A ordem importa: as respostas voltam na ordem dos pedidos, e é dela que
  // saem os índices usados na leitura (`rowsAt`, `classReturnAt`, `afterViews`).
  const dashboardColumn = (column: number, firstRow: number, rows: number) =>
    ref(DASHBOARD.title, `${columnLetter(column)}${firstRow}:${columnLetter(column)}${firstRow + rows - 1}`)

  const ranges = [
    ...VIEW_SHEETS.map((spec) =>
      ref(
        spec.title,
        `A${VIEW_FIRST_ROW}:${columnLetter(spec.columns.length - 1)}${VIEW_FIRST_ROW + VIEW_ROWS - 1}`,
      ),
    ),
    // Linha 1 de cada aba: o rendimento % da classe inteira.
    ...VIEW_SHEETS.map((spec) => ref(spec.title, `${columnLetter(spec.returnColumn)}1`)),
    ref(DASHBOARD.title, `B${DASHBOARD.totalRow}`),
    ref(
      DASHBOARD.title,
      `B${DASHBOARD.objectivesFirstRow}:B${DASHBOARD.objectivesFirstRow + OBJECTIVES.length - 1}`,
    ),
    dashboardColumn(DASHBOARD.returnColumn, DASHBOARD.allocationFirstRow, VIEW_SHEETS.length),
    dashboardColumn(DASHBOARD.returnColumn, DASHBOARD.objectivesFirstRow, OBJECTIVES.length),
  ]

  const response = await context.api.spreadsheets.values.batchGet({
    spreadsheetId: context.spreadsheetId,
    ranges,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  })

  const valueRanges = response.data.valueRanges ?? []
  const rowsAt = (index: number) => (valueRanges[index]?.values ?? []) as unknown[][]
  const classReturnAt = (index: number) => parseNumber(rowsAt(VIEW_SHEETS.length + index)[0]?.[0])
  const afterViews = VIEW_SHEETS.length * 2
  const bySymbol = new Map<string, Position>(positions.map((p) => [p.symbol, p]))

  // Total por classe, para conferir a coluna "% da classe" das abas.
  const classTotals = new Map<string, number>()
  for (const position of positions) {
    classTotals.set(
      position.assetClass,
      (classTotals.get(position.assetClass) ?? 0) + position.marketValueBRL,
    )
  }

  VIEW_SHEETS.forEach((spec, index) => {
    const rows = (valueRanges[index]?.values ?? []) as unknown[][]
    const headers = spec.columns.map((column) => column.header)

    const symbolColumn = 0
    const valueColumn = headerIndex(headers, 'Valor (R$)')
    const quantityColumn = headerIndex(headers, 'Posição')
    const avgColumn = headerIndex(headers, 'Preço médio')
    const appliedColumn = headerIndex(headers, 'Aplicado (R$)')
    const shareColumn = headerIndex(headers, '% da classe')
    const classTotal = classTotals.get(spec.assetClass) ?? 0

    const listed = rows.filter((row) => String(row[symbolColumn] ?? '').trim() !== '')

    // 1. Fórmulas quebradas
    for (const row of rows) {
      for (const [column, cell] of row.entries()) {
        if (typeof cell === 'string' && FORMULA_ERRORS.some((error) => cell.startsWith(error))) {
          divergences.push({
            where: `${spec.title}!${columnLetter(column)}`,
            what: `fórmula com erro: ${cell}`,
            sheet: Number.NaN,
            code: Number.NaN,
          })
          break
        }
      }
    }

    // 4. Teto de linhas
    if (listed.length >= VIEW_ROWS) {
      divergences.push({
        where: spec.title,
        what: `a aba lista ${listed.length} ativos e o teto é ${VIEW_ROWS} — aumente VIEW_ROWS em schema.ts`,
        sheet: listed.length,
        code: VIEW_ROWS,
      })
    }

    // 2. Ativo a ativo
    for (const row of listed) {
      const symbol = String(row[symbolColumn]).trim()
      const position = bySymbol.get(symbol)

      if (!position) {
        // A aba lista todo ativo cadastrado; sem operação, não há posição.
        notes.push(`${spec.title}: ${symbol} está cadastrado mas não tem operação`)
        continue
      }

      const label = `${spec.title} · ${symbol}`
      if (valueColumn >= 0) {
        compare(label, 'valor de mercado (R$)', parseNumber(row[valueColumn]), position.marketValueBRL)
      }
      if (quantityColumn >= 0) {
        compare(label, 'posição', parseNumber(row[quantityColumn]), position.quantity)
      }
      if (avgColumn >= 0) {
        compare(label, 'preço médio', parseNumber(row[avgColumn]), position.avgPriceNative)
      }
      if (appliedColumn >= 0) {
        compare(label, 'aplicado (R$)', parseNumber(row[appliedColumn]), position.totalCostBRL)
      }
      if (shareColumn >= 0 && classTotal > 0) {
        // Participação na PRÓPRIA classe.
        comparePercent(label, '% da classe', parseNumber(row[shareColumn]), position.marketValueBRL / classTotal)
      }
      // Rendimento na moeda do ativo — é o que a coluna mostra, e é de onde a
      // tabela de ativos do Painel copia o número.
      comparePercent(
        label,
        'rendimento %',
        parseNumber(row[spec.returnColumn]),
        position.returnNative.percent,
      )
    }
  })

  // 3. Total do Painel
  compare(DASHBOARD.title, 'patrimônio total', parseNumber(rowsAt(afterViews)[0]?.[0]), summary.totalBRL)

  // 5. Tabela de alocação por objetivo — mesma duplicação consciente da
  // tabela por classe, guardada pelo mesmo motivo.
  const objectiveValues = rowsAt(afterViews + 1)
  const objectiveReturns = rowsAt(afterViews + 3)
  OBJECTIVES.forEach((objective, index) => {
    const sheetValue = parseNumber(objectiveValues[index]?.[0])
    const codeValue = summary.byObjective.find((entry) => entry.objective === objective)?.valueBRL ?? 0
    compare(`${DASHBOARD.title} · objetivo`, OBJECTIVE_LABELS[objective], sheetValue, codeValue)

    comparePercent(
      `${DASHBOARD.title} · objetivo`,
      `rendimento % — ${OBJECTIVE_LABELS[objective]}`,
      parseNumber(objectiveReturns[index]?.[0]),
      aggregateReturn(positions.filter((position) => position.objective === objective)),
    )
  })

  // 6. Rendimento % por classe, nos DOIS lugares em que ele aparece: a linha 1
  // da aba e a coluna do Painel, que lê aquela célula pelo intervalo nomeado.
  // Conferir os dois é o que pega um intervalo nomeado apontando para a
  // coluna errada — o Painel mostraria um número plausível e errado.
  const allocationReturns = rowsAt(afterViews + 2)
  VIEW_SHEETS.forEach((spec, index) => {
    const expected = aggregateReturn(positions.filter((p) => p.assetClass === spec.assetClass))
    comparePercent(spec.title, 'rendimento % da classe', classReturnAt(index), expected)
    comparePercent(
      `${DASHBOARD.title} · classe`,
      `rendimento % — ${ASSET_CLASS_LABELS[spec.assetClass]}`,
      parseNumber(allocationReturns[index]?.[0]),
      expected,
    )
  })

  report(positions.length)
}

function report(positionCount: number) {
  console.log(`\nVerificação — ${positionCount} posição(ões) calculada(s) pelo código\n`)

  for (const note of notes) console.log(`  · ${note}`)
  if (notes.length > 0) console.log('')

  if (divergences.length === 0) {
    console.log('  ✓ Planilha e código concordam em tudo.\n')
    return
  }

  for (const divergence of divergences) {
    console.log(`  ✗ ${divergence.where} — ${divergence.what}`)
    if (Number.isFinite(divergence.sheet)) {
      console.log(`      planilha: ${divergence.sheet}   código: ${divergence.code}`)
    }
  }
  console.log(
    `\n  ${divergences.length} divergência(s). A autoridade é src/domain/ — ` +
      'a fórmula da planilha é que precisa ser corrigida.\n',
  )
  process.exit(1)
}

main().catch((error: unknown) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
