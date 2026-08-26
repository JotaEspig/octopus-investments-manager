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
  assets: 'Ativos',
  fixedIncome: 'Contratos RF',
  quotes: 'Cotações',
  cdi: 'CDI',
  history: 'Histórico',
  config: 'Config',
  dashboard: 'Painel',
}

/** Chave em `Config` com o carimbo da última execução. Igual ao schema.ts. */
const LAST_RUN_KEY = 'apps_script_last_run'

const CLASS_TOTAL_RANGES = [
  'TOTAL_US_STOCK',
  'TOTAL_US_ETF',
  'TOTAL_BR_STOCK',
  'TOTAL_BR_FII',
  'TOTAL_FIXED_INCOME',
]

/**
 * Ordem das colunas de classe no `Histórico`. Espelha `ASSET_CLASSES` de
 * `src/domain/types.ts` — trocar a ordem lá sem trocar aqui embaralha o
 * histórico em silêncio.
 */
const CLASS_ORDER = ['us_stock', 'us_etf', 'br_stock', 'br_fii', 'fixed_income']

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
    .addItem('Reconstruir meses faltantes', 'backfillHistoryWithFeedback')
    .addSeparator()
    .addItem('Ativar atualização diária', 'installTriggers')
    .addItem('Desativar atualização diária', 'removeTriggers')
    .addSeparator()
    .addItem('Reparar fórmulas de cotação', 'repairQuotes')
    .addToUi()
}

/**
 * Instala DOIS gatilhos, e o segundo é rede de segurança.
 *
 * O diário faz o trabalho. O de abertura existe porque o histórico é a única
 * coisa que se perde de forma irreversível: se o gatilho diário quebrar (o
 * Google desativa após falhas repetidas) e o mês virar sem nenhum snapshot,
 * aquele mês some. Como você abre a planilha para olhar a carteira, essa
 * abertura vira a segunda chance.
 */
function installTriggers() {
  removeTriggers()

  ScriptApp.newTrigger('dailyUpdate').timeBased().everyDays(1).atHour(20).create()
  ScriptApp.newTrigger('onOpenSafetyNet')
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onOpen()
    .create()

  SpreadsheetApp.getUi().alert(
    'Atualização diária ativada.\n\n' +
      'Roda todo dia por volta das 20h: atualiza as cotações, busca o CDI no ' +
      'Banco Central, marca a renda fixa na curva e grava o histórico.\n\n' +
      'Também gravamos o snapshot ao abrir a planilha, caso o mês vire sem o ' +
      'gatilho ter rodado.',
  )
}

function removeTriggers() {
  const handlers = ['dailyUpdate', 'onOpenSafetyNet']
  const triggers = ScriptApp.getProjectTriggers()
  for (let i = 0; i < triggers.length; i += 1) {
    if (handlers.indexOf(triggers[i].getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(triggers[i])
  }
}

/**
 * Roda ao abrir a planilha. Só age se o mês corrente ainda não tem linha —
 * abrir a planilha não pode custar meio minuto de recálculo toda vez.
 */
function onOpenSafetyNet() {
  if (hasSnapshotFor(todayIso().slice(0, 7))) return
  snapshotMonthly()
}

function hasSnapshotFor(month) {
  const rows = readRows(sheetByName(SHEETS.history), 1)
  for (let i = 0; i < rows.length; i += 1) {
    if (toIso(rows[i][0]).slice(0, 7) === month) return true
  }
  return false
}

/**
 * O que o gatilho executa.
 *
 * A ORDEM importa. As cotações vêm primeiro porque o snapshot depende delas: o
 * `GOOGLEFINANCE` só recalcula com a planilha ABERTA, e o gatilho roda com ela
 * fechada. Sem forçar, o histórico seria construído sobre preço congelado do
 * último dia em que alguém abriu — e sem nenhum sinal disso.
 *
 * O carimbo vai por último, e só se tudo passou: um `last_run` gravado após
 * falha diria que está tudo bem quando não está.
 */
function dailyUpdate() {
  refreshQuotes()
  fetchCdi()
  repriceFixedIncome()
  snapshotMonthly()
  recordLastRun()
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
// 0. Cotações
// ---------------------------------------------------------------------------

/**
 * Força o GOOGLEFINANCE a buscar preço novo.
 *
 * O PROBLEMA. O Sheets só recalcula `GOOGLEFINANCE` enquanto a planilha está
 * aberta no navegador. Com ela fechada — que é o normal — o valor fica
 * congelado. Como o gatilho roda de madrugada com ninguém olhando, o snapshot
 * mensal gravaria a cotação do último dia em que alguém abriu a planilha.
 *
 * A SOLUÇÃO. Apagar a fórmula e reescrevê-la obriga o Sheets a reavaliá-la, e
 * aí ele busca preço novo. Não existe API para "recalcule agora"; reescrever é
 * o caminho.
 *
 * O RISCO, e como ele é contido. Entre apagar e reescrever há uma janela de
 * milissegundos em que a coluna fica vazia. Se o script morrer exatamente ali
 * (timeout, cota), as fórmulas somem. Por isso: elas são lidas para a memória
 * ANTES de qualquer escrita, a restauração acontece em `finally`, e o menu tem
 * "Reparar fórmulas de cotação" para reconstruí-las a partir de `Ativos` caso
 * o pior aconteça.
 */
function refreshQuotes() {
  const sheet = sheetByName(SHEETS.quotes)
  const lastRow = sheet.getLastRow()
  if (lastRow < 2) return 0

  const range = sheet.getRange(2, 2, lastRow - 1, 1)
  const formulas = range.getFormulas()

  // Sem fórmula nenhuma não há o que atualizar — e apagar seria só destruir.
  let count = 0
  for (let i = 0; i < formulas.length; i += 1) {
    if (String(formulas[i][0] || '').charAt(0) === '=') count += 1
  }
  if (count === 0) return 0

  try {
    range.clearContent()
    SpreadsheetApp.flush()
  } finally {
    range.setFormulas(formulas)
    SpreadsheetApp.flush()
  }

  return count
}

/**
 * Reconstrói as fórmulas de cotação a partir de `Ativos`.
 *
 * Rede de segurança do `refreshQuotes`, e também a saída para quando uma
 * fórmula é apagada sem querer. Espelha `quoteFormula()` de
 * `src/sheets/repositories.ts` — ativo brasileiro leva o prefixo `BVMF:`.
 */
function repairQuotes() {
  const assets = readRows(sheetByName(SHEETS.assets), 4)
  const quotes = sheetByName(SHEETS.quotes)

  const rows = []
  for (let i = 0; i < assets.length; i += 1) {
    const symbol = String(assets[i][0] || '').trim()
    if (!symbol) continue

    const assetClass = String(assets[i][2] || '').trim()
    const brazilian = assetClass === 'br_stock' || assetClass === 'br_fii'
    const ticker = brazilian ? 'BVMF:' + symbol : symbol

    rows.push([symbol, '=GOOGLEFINANCE("' + ticker + '";"price")', String(assets[i][3] || 'BRL')])
  }

  if (rows.length === 0) return 0

  quotes.getRange(2, 1, rows.length, 3).setValues(rows)
  SpreadsheetApp.flush()
  return rows.length
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

// ---------------------------------------------------------------------------
// 3b. Backfill do histórico
// ---------------------------------------------------------------------------

/**
 * Reconstrói meses que ficaram sem snapshot.
 *
 * O HISTÓRICO É A ÚNICA COISA IRREVERSÍVEL do projeto. CDI e renda fixa se
 * recuperam sozinhos porque são recalculados da série inteira; o patrimônio de
 * um mês passado, não — ninguém guarda "quanto valia a carteira em julho".
 *
 * Mas dá para reconstruir, porque as três peças existem:
 *   · a POSIÇÃO em qualquer data sai do livro-razão, que tem as datas
 *   · o PREÇO daquela data sai do GOOGLEFINANCE, que aceita data histórica
 *   · a RENDA FIXA sai da marcação na curva até aquela data
 *
 * Rode pelo menu depois de descobrir que o gatilho ficou parado. É idempotente:
 * só preenche mês ausente, nunca reescreve o que já existe.
 */
/** Versão de menu: diz o que fez, porque pelo menu não há retorno para ler. */
function backfillHistoryWithFeedback() {
  const missing = missingMonths()

  if (missing.length === 0) {
    SpreadsheetApp.getUi().alert('Nenhum mês faltando — o histórico está completo.')
    return
  }

  const filled = backfillHistory()
  SpreadsheetApp.getUi().alert(
    filled +
      ' mês(es) reconstruído(s):\n\n' +
      missing.join(', ') +
      '\n\nValores calculados com a cotação de fechamento de cada data e a ' +
      'posição que o livro-razão tinha naquele momento.',
  )
}

function backfillHistory() {
  const missing = missingMonths()
  if (missing.length === 0) {
    return 0
  }

  // Área de rascunho isolada, em vez de um canto da Config: fórmula histórica
  // precisa de espaço e não pode esbarrar em dado de verdade.
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet()
  const scratch = spreadsheet.insertSheet('__backfill__')

  const rows = []
  try {
    for (let i = 0; i < missing.length; i += 1) {
      const asOf = lastDayOfMonth(missing[i])
      rows.push(portfolioValueAt(asOf, scratch))
    }
  } finally {
    spreadsheet.deleteSheet(scratch)
  }

  const sheet = sheetByName(SHEETS.history)
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows)
  sortHistory()

  return rows.length
}

/** Meses entre o primeiro aporte e hoje que não têm linha no histórico. */
function missingMonths() {
  const trades = readRows(sheetByName(SHEETS.trades), 2)

  let first = ''
  for (let i = 0; i < trades.length; i += 1) {
    const iso = toIso(trades[i][1])
    if (iso && (first === '' || iso < first)) first = iso
  }
  if (!first) return []

  const existing = {}
  const history = readRows(sheetByName(SHEETS.history), 1)
  for (let i = 0; i < history.length; i += 1) {
    existing[toIso(history[i][0]).slice(0, 7)] = true
  }

  const missing = []
  const today = todayIso().slice(0, 7)
  let cursor = first.slice(0, 7)

  while (cursor <= today) {
    // O mês corrente fica de fora: ele é do `snapshotMonthly`, que usa cotação
    // de agora em vez de histórica.
    if (cursor !== today && !existing[cursor]) missing.push(cursor)
    cursor = nextMonth(cursor)
  }

  return missing
}

function nextMonth(yyyymm) {
  const year = Number(yyyymm.slice(0, 4))
  const month = Number(yyyymm.slice(5, 7))
  return month === 12 ? year + 1 + '-01' : yyyymm.slice(0, 4) + '-' + pad(month + 1)
}

function lastDayOfMonth(yyyymm) {
  const year = Number(yyyymm.slice(0, 4))
  const month = Number(yyyymm.slice(5, 7))
  // Dia 0 do mês seguinte é o último dia deste.
  const date = new Date(Date.UTC(year, month, 0))
  return Utilities.formatDate(date, 'UTC', 'yyyy-MM-dd')
}

/**
 * Patrimônio numa data passada, na forma de linha do `Histórico`.
 *
 * Escreve as fórmulas de cotação histórica em bloco na aba de rascunho, lê o
 * resultado e descarta — uma ida à rede por mês, e não por ativo.
 */
function portfolioValueAt(asOf, scratch) {
  const assets = readRows(sheetByName(SHEETS.assets), 4)
  const symbols = []
  const formulas = []

  for (let i = 0; i < assets.length; i += 1) {
    const symbol = String(assets[i][0] || '').trim()
    if (!symbol) continue
    const assetClass = String(assets[i][2] || '').trim()
    const brazilian = assetClass === 'br_stock' || assetClass === 'br_fii'
    symbols.push({ symbol: symbol, assetClass: assetClass })
    formulas.push([historicalCloseFormula(brazilian ? 'BVMF:' + symbol : symbol, asOf)])
  }

  // Câmbio da data vai na última linha do bloco.
  formulas.push([historicalCloseFormula('CURRENCY:USDBRL', asOf)])

  scratch.getRange(1, 1, formulas.length, 1).setFormulas(formulas)
  SpreadsheetApp.flush()
  const prices = scratch.getRange(1, 1, formulas.length, 1).getValues()
  scratch.clear()

  const fx = Number(prices[formulas.length - 1][0]) || 0

  const byClass = {}
  for (let i = 0; i < CLASS_ORDER.length; i += 1) byClass[CLASS_ORDER[i]] = 0

  for (let i = 0; i < symbols.length; i += 1) {
    const quantity = quantityAt(symbols[i].symbol, asOf)
    if (quantity <= 0) continue

    const price = Number(prices[i][0]) || 0
    const usd = symbols[i].assetClass === 'us_stock' || symbols[i].assetClass === 'us_etf'
    const value = quantity * price * (usd ? fx : 1)

    if (byClass[symbols[i].assetClass] !== undefined) byClass[symbols[i].assetClass] += value
  }

  byClass.fixed_income = fixedIncomeValueAt(asOf)

  const row = [new Date(asOf + 'T12:00:00Z')]
  let total = 0
  for (let i = 0; i < CLASS_ORDER.length; i += 1) total += byClass[CLASS_ORDER[i]]
  row.push(round2(total))
  for (let i = 0; i < CLASS_ORDER.length; i += 1) row.push(round2(byClass[CLASS_ORDER[i]]))

  return row
}

/**
 * Fechamento na data, ou no pregão anterior mais próximo.
 *
 * A janela de 7 dias cobre fim de semana e feriado; `LET` liga a chamada uma
 * vez e `ROWS` pega a última linha, que é a mais recente do intervalo.
 */
function historicalCloseFormula(ticker, asOf) {
  const parts = asOf.split('-')
  const date = 'DATE(' + Number(parts[0]) + ';' + Number(parts[1]) + ';' + Number(parts[2]) + ')'
  return (
    '=IFERROR(LET(h;GOOGLEFINANCE("' + ticker + '";"close";' + date + '-7;' + date + ');' +
    'INDEX(h;ROWS(h);2));0)'
  )
}

/** Posição de um ativo numa data: compras menos vendas até ali. */
function quantityAt(symbol, asOf) {
  const rows = readRows(sheetByName(SHEETS.trades), 5)
  let quantity = 0

  for (let i = 0; i < rows.length; i += 1) {
    if (String(rows[i][3] || '').trim() !== symbol) continue
    if (toIso(rows[i][1]) > asOf) continue

    const kind = String(rows[i][2] || '').trim()
    const amount = Number(rows[i][4]) || 0
    if (kind === 'buy') quantity += amount
    else if (kind === 'sell') quantity -= amount
  }

  return quantity
}

/** Renda fixa marcada na curva até a data — reaproveita `markToCurve`. */
function fixedIncomeValueAt(asOf) {
  const contracts = readRows(sheetByName(SHEETS.fixedIncome), 11)
  if (contracts.length === 0) return 0

  const series = readCdiSeries()
  const applications = readApplicationsBySymbol()
  let total = 0

  for (let i = 0; i < contracts.length; i += 1) {
    const symbol = String(contracts[i][0] || '').trim()
    if (!symbol) continue

    const indexer = String(contracts[i][3] || 'cdi').trim()
    const rate = Number(contracts[i][4]) || 0
    const entries = applications[symbol] || []

    for (let j = 0; j < entries.length; j += 1) {
      if (entries[j].date > asOf) continue
      total +=
        entries[j].kind === 'buy'
          ? markToCurve(entries[j].amount, indexer, rate, entries[j].date, asOf, series)
          : -entries[j].amount
    }
  }

  return Math.max(0, total)
}

/** Ordena o histórico por data — o backfill anexa no fim, fora de ordem. */
function sortHistory() {
  const sheet = sheetByName(SHEETS.history)
  const lastRow = sheet.getLastRow()
  if (lastRow < 3) return
  sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).sort({ column: 1, ascending: true })
}

// ---------------------------------------------------------------------------
// 4. Carimbo da execução
// ---------------------------------------------------------------------------

/**
 * Grava em `Config` quando o script rodou pela última vez, em UTC ISO 8601.
 *
 * Existe porque o gatilho pode parar sem ninguém perceber: o Google desativa
 * gatilhos após falhas repetidas e avisa por um e-mail fácil de não ver. Sem
 * este carimbo, a única forma de descobrir seria abrir o editor do Apps Script
 * — e a planilha continuaria parecendo certa, só velha.
 *
 * Com ele, `/setup` e `npm run verify:sheet` conseguem dizer "não roda há 12
 * dias".
 *
 * UTC e não local: é dado que máquina lê. Quem exibe converte.
 */
function recordLastRun() {
  const sheet = sheetByName(SHEETS.config)
  const rows = readRows(sheet, 1)

  const stamp = Utilities.formatDate(new Date(), 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'")

  for (let i = 0; i < rows.length; i += 1) {
    if (String(rows[i][0] || '').trim() === LAST_RUN_KEY) {
      sheet.getRange(i + 2, 2).setValue(stamp)
      return stamp
    }
  }

  // Chave ausente: planilha anterior à v3 do schema. Acrescenta em vez de
  // falhar — o instalador colocaria no lugar certo depois.
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, 3).setValues([
    [LAST_RUN_KEY, stamp, 'Última execução do Apps Script (UTC ISO).'],
  ])
  return stamp
}
