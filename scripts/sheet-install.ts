/**
 * `npm run sheet:install` — constrói a estrutura da planilha.
 *
 * Mesmo código que a página /setup executa; existe como CLI para poder rodar
 * sem subir o Next (e para ser o primeiro teste de que a service account tem
 * mesmo acesso à planilha).
 */

import { config as loadDotenv } from 'dotenv'
import { bootstrapSpreadsheet } from '../src/sheets/bootstrap'
import { getSheetsContext } from '../src/sheets/client'
import { diagnose } from '../src/sheets/diagnose'

// O Next carrega .env.local sozinho; num script avulso é preciso pedir.
loadDotenv({ path: '.env.local', quiet: true })

const SYMBOL: Record<string, string> = { ok: '✓', warn: '!', error: '✗' }

async function main() {
  console.log('\nDiagnóstico\n')
  const before = await diagnose()
  for (const check of before.checks) {
    console.log(`  ${SYMBOL[check.status]} ${check.label.padEnd(26)} ${check.detail}`)
  }

  if (before.checks.some((check) => check.status === 'error')) {
    console.error('\nCorrija os itens acima antes de instalar. Passo a passo no README.\n')
    process.exit(1)
  }

  console.log('\nInstalando\n')
  const report = await bootstrapSpreadsheet(getSheetsContext())
  for (const action of report.actions) console.log(`  ✓ ${action}`)
  for (const warning of report.warnings) console.log(`  ! ${warning}`)

  console.log(`\nPronto — ${report.spreadsheetTitle}`)
  console.log(`  ${report.spreadsheetUrl}\n`)
}

main().catch((error: unknown) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
