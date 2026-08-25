/**
 * Carteira — motor da planilha.
 *
 * Este script roda DENTRO da planilha, na nuvem do Google, por um gatilho
 * diário. É ele que mantém a planilha viva quando a interface está desligada —
 * que é o estado normal, já que ela só roda na sua máquina.
 *
 * Faz três coisas que o GOOGLEFINANCE não sabe fazer:
 *
 *   1. Busca a série do CDI no Banco Central (SGS 12).
 *   2. Marca a renda fixa na curva — CDB e Tesouro não têm ticker nem cotação.
 *   3. Grava o patrimônio na aba Histórico, que é o que alimenta o gráfico de
 *      12 meses. A planilha sozinha só sabe o "agora"; sem isto não há série.
 *
 * INSTALAÇÃO (uma vez):
 *   1. Na planilha: Extensões → Apps Script
 *   2. Cole este arquivo inteiro por cima do Code.gs que estiver lá e salve
 *   3. Recarregue a planilha — vai aparecer o menu "Carteira"
 *   4. Carteira → Ativar atualização diária (autoriza e cria o gatilho)
 *
 * Por que colar à mão: um script vinculado à planilha pertence a VOCÊ, não à
 * service account, então a API não consegue criá-lo. E a API do Apps Script
 * não cria gatilhos — só código rodando dentro do próprio script cria.
 *
 * ⚠️ Este arquivo duplica de propósito a lógica de src/domain/fixed-income.ts.
 * É o preço de a planilha funcionar sem o app. Mexeu numa fórmula aqui, mexa
 * lá também — `npm run verify:sheet` acusa se as duas divergirem.
 */

// Devem bater exatamente com src/sheets/schema.ts.
const SHEETS = {
  trades: 'Operações',
  fixedIncome: 'Contratos RF',
  cdi: 'CDI',
  history: 'Histórico',
  dashboard: 'Painel',
}

const CLASS_TOTAL_RANGES = [
  'TOTAL_US_STOCK',
  'TOTAL_US_ETF',
  'TOTAL_BR_STOCK',
  'TOTAL_BR_FII',
  'TOTAL_FIXED_INCOME',
]

/** Série 12 do SGS: CDI diário em % ao dia. Aberta, sem chave nem cadastro. */
const SGS_CDI_URL = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados'

/** Base 252 dias úteis — convenção da B3, não 365 corridos. */
const BUSINESS_DAYS_PER_YEAR = 252

/** Quanto de série buscar quando a aba CDI está vazia. */
const INITIAL_HISTORY_YEARS = 3

// ---------------------------------------------------------------------------
// Menu e gatilho
// ---------------------------------------------------------------------------

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Carteira')
    .addItem('Atualizar agora', 'dailyUpdate')
    .addItem('Gravar snapshot do mês', 'snapshotMonthly')
    .addSeparator()
    .addItem('Ativar atualização diária', 'installTriggers')
    .addItem('Desativar atualização diária', 'removeTriggers')
    .addToUi()
}

function installTriggers() {
  removeTriggers()
  ScriptApp.newTrigger('dailyUpdate').timeBased().everyDays(1).atHour(20).create()
  SpreadsheetApp.getUi().alert(
    'Atualização diária ativada.\n\n' +
      'Roda todo dia por volta das 20h: busca o CDI no Banco Central, marca a ' +
      'renda fixa na curva e atualiza o histórico do patrimônio.',
  )
}

function removeTriggers() {
  const triggers = ScriptApp.getProjectTriggers()
  for (let i = 0; i < triggers.length; i += 1) {
    if (triggers[i].getHandlerFunction() === 'dailyUpdate') ScriptApp.deleteTrigger(triggers[i])
  }
}

/** O que o gatilho executa. */
function dailyUpdate() {
  fetchCdi()
  repriceFixedIncome()
  snapshotMonthly()
}

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

function sheetByName(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name)
  if (!sheet) throw new Error('Aba não encontrada: ' + name + '. Rode `npm run sheet:install`.')
  return sheet
}

/** Datas trafegam como `yyyy-mm-dd` para poder comparar com `<` e `>`. */
function toIso(value) {
  if (value instanceof Date) return Utilities.formatDate(value, 'UTC', 'yyyy-MM-dd')
  const text = String(value || '').trim()
  if (!text) return ''
  const br = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (br) return br[3] + '-' + pad(br[2]) + '-' + pad(br[1])
  return text.slice(0, 10)
}

function pad(value) {
  return ('0' + value).slice(-2)
}

/** O SGS espera `dd/MM/yyyy`. */
function toSgsDate(iso) {
  const parts = iso.split('-')
  return parts[2] + '/' + parts[1] + '/' + parts[0]
}

function todayIso() {
  return Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd')
}

function addYears(iso, years) {
  const date = new Date(iso + 'T00:00:00Z')
  date.setUTCFullYear(date.getUTCFullYear() + years)
  return Utilities.formatDate(date, 'UTC', 'yyyy-MM-dd')
}

/** Lê a partir da linha 2 e descarta as linhas em branco do fim. */
function readRows(sheet, columns) {
  const lastRow = sheet.getLastRow()
  if (lastRow < 2) return []
  return sheet.getRange(2, 1, lastRow - 1, columns).getValues()
}

// ---------------------------------------------------------------------------
// 1. CDI
// ---------------------------------------------------------------------------

/**
 * Busca as observações que faltam na aba CDI e as anexa.
 *
 * Incremental: só pede ao Banco Central o intervalo posterior ao último dia já
 * gravado. Numa execução diária isso é uma linha.
 *
 * A série publica a taxa em PERCENTUAL ao dia ("0.051660"); guardamos como
 * FRAÇÃO (0,0005166), que é o que a fórmula de marcação espera.
 */
function fetchCdi() {
  const sheet = sheetByName(SHEETS.cdi)
  const existing = readRows(sheet, 2)

  let lastDate = ''
  for (let i = 0; i < existing.length; i += 1) {
    const iso = toIso(existing[i][0])
    if (iso > lastDate) lastDate = iso
  }

  const today = todayIso()
  const from = lastDate ? nextDay(lastDate) : addYears(today, -INITIAL_HISTORY_YEARS)
  if (from > today) return 0

  const url =
    SGS_CDI_URL + '?formato=json&dataInicial=' + toSgsDate(from) + '&dataFinal=' + toSgsDate(today)

  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true })
  if (response.getResponseCode() !== 200) {
    throw new Error('Banco Central respondeu ' + response.getResponseCode() + ' na série do CDI.')
  }

  const body = response.getContentText()
  // Fora do horário de publicação a série pode vir vazia — não é erro.
  if (!body || body.trim() === '' || body.trim() === '[]') return 0

  const data = JSON.parse(body)
  const rows = []
  for (let i = 0; i < data.length; i += 1) {
    const iso = toIso(data[i].data)
    if (iso <= lastDate) continue
    rows.push([new Date(iso + 'T12:00:00Z'), Number(data[i].valor) / 100])
  }

  if (rows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 2).setValues(rows)
  }
  return rows.length
}

function nextDay(iso) {
  const date = new Date(iso + 'T00:00:00Z')
  date.setUTCDate(date.getUTCDate() + 1)
  return Utilities.formatDate(date, 'UTC', 'yyyy-MM-dd')
}

// ---------------------------------------------------------------------------
// 2. Marcação na curva
// ---------------------------------------------------------------------------

/**
 * Atualiza o valor bruto de cada contrato de renda fixa.
 *
 * Cada aplicação é marcada a partir da SUA data, e não de uma data única do
 * contrato — quem aporta no mesmo CDB em meses diferentes teria o rendimento
 * distorcido de outro jeito.
 *
 * Limitação declarada: um resgate parcial é subtraído pelo valor de face, o que
 * subestima ligeiramente o saldo. Aplicar e resgatar no vencimento — o caso
 * normal — é exato.
 */
function repriceFixedIncome() {
  const contractSheet = sheetByName(SHEETS.fixedIncome)
  const contracts = readRows(contractSheet, 11)
  if (contracts.length === 0) return 0

  const series = readCdiSeries()
  const applications = readApplicationsBySymbol()
  const today = todayIso()
  const now = new Date()

  const values = []
  for (let i = 0; i < contracts.length; i += 1) {
    const symbol = String(contracts[i][0] || '').trim()
    if (!symbol) {
      values.push(['', ''])
      continue
    }

    const indexer = String(contracts[i][3] || 'cdi').trim()
    const rate = Number(contracts[i][4]) || 0
    const entries = applications[symbol] || []

    let gross = 0
    for (let j = 0; j < entries.length; j += 1) {
      const entry = entries[j]
      gross +=
        entry.kind === 'buy'
          ? markToCurve(entry.amount, indexer, rate, entry.date, today, series)
          : -entry.amount
    }

    values.push([Math.max(0, round2(gross)), now])
  }

  contractSheet.getRange(2, 10, values.length, 2).setValues(values)
  return values.length
}

/** Aba CDI como lista ordenada `{ date, rate }`. */
function readCdiSeries() {
  const rows = readRows(sheetByName(SHEETS.cdi), 2)
  const series = []
  for (let i = 0; i < rows.length; i += 1) {
    const iso = toIso(rows[i][0])
    const rate = Number(rows[i][1])
    if (iso && !isNaN(rate)) series.push({ date: iso, rate: rate })
  }
  series.sort(function (a, b) {
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0
  })
  return series
}

/**
 * Aplicações e resgates por contrato, lidos do livro-razão.
 *
 * Renda fixa é modelada com `quantidade` = reais aplicados e `preço` = 1, então
 * a coluna "Valor líquido (R$)" (L) já é o valor da aplicação com as taxas.
 */
function readApplicationsBySymbol() {
  const rows = readRows(sheetByName(SHEETS.trades), 12)
  const bySymbol = {}
  for (let i = 0; i < rows.length; i += 1) {
    const kind = String(rows[i][2] || '').trim()
    if (kind !== 'buy' && kind !== 'sell') continue

    const symbol = String(rows[i][3] || '').trim()
    const date = toIso(rows[i][1])
    const amount = Number(rows[i][11]) || 0
    if (!symbol || !date || amount <= 0) continue

    if (!bySymbol[symbol]) bySymbol[symbol] = []
    bySymbol[symbol].push({ date: date, kind: kind, amount: amount })
  }
  return bySymbol
}

/**
 * Valor bruto hoje de uma aplicação. Espelha src/domain/fixed-income.ts.
 *
 *   pós-fixado:  VF = VP × Π [ 1 + (CDI_k × p) ]     ← p multiplica a TAXA
 *   prefixado:   VF = VP × (1 + i)^(du/252)
 *   IPCA+:       VF = VP × (1 + cupom)^(du/252)      ← sem o fator de inflação
 *
 * O dia da aplicação não rende: a janela é (aplicação, hoje].
 *
 * ⚠️ IPCA+ fica sem a correção monetária porque o VNA oficial usa o IPCA
 * defasado com projeção pro-rata da ANBIMA, que não é uma API aberta. Papel
 * IPCA+ aparece marcado só pelo cupom real — ou seja, SUBESTIMADO.
 */
function markToCurve(principal, indexer, rate, issueDate, asOf, series) {
  if (principal <= 0) return 0

  let count = 0
  let factor = 1
  for (let i = 0; i < series.length; i += 1) {
    const entry = series[i]
    if (entry.date <= issueDate) continue
    if (entry.date > asOf) break
    count += 1
    factor *= 1 + entry.rate * rate
  }

  if (indexer === 'cdi') return principal * factor
  return principal * Math.pow(1 + rate, count / BUSINESS_DAYS_PER_YEAR)
}

function round2(value) {
  return Math.round(value * 100) / 100
}

// ---------------------------------------------------------------------------
// 3. Histórico
// ---------------------------------------------------------------------------

/**
 * Grava o patrimônio do mês corrente na aba Histórico.
 *
 * Faz UPSERT do mês em vez de só anexar: rodando todo dia, o último ponto do
 * gráfico reflete hoje, e cada mês fechado guarda o valor do último dia em que
 * o script rodou.
 */
function snapshotMonthly() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet()
  // As fórmulas do Painel precisam estar recalculadas antes da leitura.
  SpreadsheetApp.flush()

  const total = readNamedNumber(spreadsheet, 'PATRIMONIO_TOTAL')
  const row = [new Date()]
  row.push(round2(total))
  for (let i = 0; i < CLASS_TOTAL_RANGES.length; i += 1) {
    row.push(round2(readNamedNumber(spreadsheet, CLASS_TOTAL_RANGES[i])))
  }

  const sheet = sheetByName(SHEETS.history)
  const existing = readRows(sheet, 1)
  const currentMonth = todayIso().slice(0, 7)

  for (let i = 0; i < existing.length; i += 1) {
    if (toIso(existing[i][0]).slice(0, 7) === currentMonth) {
      sheet.getRange(i + 2, 1, 1, row.length).setValues([row])
      return 'atualizado'
    }
  }

  sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row])
  return 'anexado'
}

function readNamedNumber(spreadsheet, name) {
  const range = spreadsheet.getRangeByName(name)
  if (!range) return 0
  const value = Number(range.getValue())
  return isNaN(value) ? 0 : value
}
