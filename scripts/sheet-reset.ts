/**
 * `npm run sheet:reset` — apaga TUDO na planilha.
 *
 * Destrutivo e irreversível. Existe para o caso de você querer recomeçar do
 * zero depois de testar com dados de mentira, ou quando o schema mudou tanto
 * que reinstalar por cima não resolve.
 *
 * A confirmação é por digitação do nome da planilha, no estilo do GitHub para
 * apagar repositório. Digitar "s" é reflexo; digitar o nome exige ler o que
 * está na tela — e o que está na tela é a contagem do que será perdido.
 *
 * Não há flag `--force`, de propósito: uma porta dos fundos aqui anularia o
 * único mecanismo que protege anos de histórico de aportes.
 */

import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { config as loadDotenv } from 'dotenv'
import { getSheetsContext } from '../src/sheets/client'
import { previewReset, resetSpreadsheet } from '../src/sheets/reset'

loadDotenv({ path: '.env.local', quiet: true })

const RED = '\u001b[31m'
const BOLD = '\u001b[1m'
const DIM = '\u001b[2m'
const RESET = '\u001b[0m'

async function main() {
  const context = getSheetsContext()
  const preview = await previewReset(context)

  if (preview.alreadyBlank) {
    console.log(`\nA planilha "${preview.spreadsheetTitle}" já está vazia. Nada a fazer.\n`)
    return
  }

  console.log(`\n${RED}${BOLD}  ⚠  ISTO APAGA TUDO E NÃO TEM VOLTA  ⚠${RESET}\n`)
  console.log(`  Planilha: ${BOLD}${preview.spreadsheetTitle}${RESET}`)
  console.log(`  ${DIM}${preview.spreadsheetUrl}${RESET}\n`)

  console.log(`  Serão apagadas ${preview.sheets.length} abas:`)
  for (const sheet of preview.sheets) {
    console.log(`    · ${sheet.title}`)
  }

  console.log('\n  Você vai perder:')
  console.log(`    ${RED}${String(preview.trades).padStart(5)}${RESET} operações registradas`)
  console.log(`    ${RED}${String(preview.assets).padStart(5)}${RESET} ativos cadastrados`)
  console.log(`    ${RED}${String(preview.contracts).padStart(5)}${RESET} contratos de renda fixa`)
  console.log(
    `\n  ${DIM}Também somem o histórico do patrimônio e a série do CDI já baixada.${RESET}`,
  )
  console.log(
    `  ${DIM}O Apps Script colado na planilha NÃO é apagado — ele vive fora das abas.${RESET}\n`,
  )

  const readline = createInterface({ input: stdin, output: stdout })
  const answer = await readline.question(
    `  Para confirmar, digite o nome da planilha (${BOLD}${preview.spreadsheetTitle}${RESET}): `,
  )
  readline.close()

  if (answer.trim() !== preview.spreadsheetTitle) {
    console.log('\n  Cancelado. Nada foi apagado.\n')
    process.exitCode = 1
    return
  }

  console.log('\n  Apagando…')
  const result = await resetSpreadsheet(context)

  console.log(`  ✓ ${result.deleted.length} aba(s) removida(s). A planilha está em branco.\n`)
  console.log('  Para reconstruir do zero:')
  console.log('    npm run sheet:install\n')
}

main().catch((error: unknown) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
