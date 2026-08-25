/**
 * `npm run sheet:migrate` — sobe a planilha de versão sem perder histórico.
 *
 * Mostra o plano antes de agir. Migrações puramente aditivas passam direto;
 * as que transformam linhas já gravadas fazem backup das abas de dados e
 * pedem confirmação, porque são as únicas capazes de estragar algo.
 *
 * `--dry-run` mostra o plano e sai — útil para saber o que viria pela frente
 * antes de decidir atualizar o código.
 */

import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { config as loadDotenv } from 'dotenv'
import { getSheetsContext } from '../src/sheets/client'
import { listBackups, planMigrations, runMigrations } from '../src/sheets/migrations'

loadDotenv({ path: '.env.local', quiet: true })

const BOLD = '\u001b[1m'
const DIM = '\u001b[2m'
const YELLOW = '\u001b[33m'
const RESET = '\u001b[0m'

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const context = getSheetsContext()
  const plan = await planMigrations(context)

  if (plan.freshInstall) {
    console.log('\n  Planilha ainda não instalada. Rode `npm run sheet:install`.\n')
    process.exitCode = 1
    return
  }

  console.log(`\n  Planilha na v${plan.currentVersion} · código na v${plan.targetVersion}\n`)

  if (plan.pending.length === 0) {
    console.log('  ✓ Nada pendente. A planilha está atualizada.\n')

    const backups = await listBackups(context)
    if (backups.length > 0) {
      console.log(`  ${DIM}Há ${backups.length} aba(s) de backup de migrações anteriores.`)
      console.log(`  Estão ocultas e podem ser apagadas quando você quiser:${RESET}`)
      for (const name of backups) console.log(`    ${DIM}· ${name}${RESET}`)
      console.log('')
    }
    return
  }

  console.log(`  ${BOLD}Migrações pendentes${RESET}\n`)
  for (const migration of plan.pending) {
    const mark = migration.touchesData ? `${YELLOW}transforma dados${RESET}` : `${DIM}aditiva${RESET}`
    console.log(`    v${migration.to}  ${migration.title}  (${mark})`)
    console.log(`          ${DIM}${migration.description}${RESET}`)
  }
  console.log('')

  if (dryRun) {
    console.log(`  ${DIM}--dry-run: nada foi executado.${RESET}\n`)
    return
  }

  if (plan.touchesData) {
    console.log(
      `  ${YELLOW}Alguma destas transforma linhas já gravadas.${RESET} As abas de dados serão`,
    )
    console.log('  duplicadas e ocultadas antes, como rede de segurança.\n')

    const readline = createInterface({ input: stdin, output: stdout })
    const answer = await readline.question('  Continuar? (digite "sim"): ')
    readline.close()

    if (answer.trim().toLowerCase() !== 'sim') {
      console.log('\n  Cancelado. Nada foi alterado.\n')
      process.exitCode = 1
      return
    }
    console.log('')
  }

  const result = await runMigrations(context)
  for (const action of result.actions) console.log(`  ✓ ${action}`)

  if (result.backups.length > 0) {
    console.log(`\n  ${DIM}Backups criados (ocultos):${RESET}`)
    for (const name of result.backups) console.log(`    ${DIM}· ${name}${RESET}`)
    console.log(`  ${DIM}Confira o resultado antes de apagá-los.${RESET}`)
  }

  console.log(`\n  Planilha agora na v${result.to}.`)
  console.log('  Rode `npm run sheet:install` para reconstruir as abas de apresentação,')
  console.log('  e `npm run verify:sheet` para confirmar que tudo bate.\n')
}

main().catch((error: unknown) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
