/**
 * `npm run sheet:style` — repinta a planilha.
 *
 * Só aparência: cor de aba por classe, cabeçalhos coloridos, alinhamento por
 * natureza do dado, listras, bordas e destaque de ganho/perda. Nenhum valor de
 * célula é lido ou escrito, então é seguro rodar com a carteira cheia.
 *
 * Substitutivo e idempotente: listras e regras condicionais antigas são
 * removidas antes das novas, então rodar dez vezes dá o mesmo resultado de
 * rodar uma. Se você mexeu no visual à mão e quer voltar ao padrão, é este
 * comando.
 */

import { config as loadDotenv } from 'dotenv'
import { getSheetsContext } from '../src/sheets/client'
import { applyStyling } from '../src/sheets/styling'

loadDotenv({ path: '.env.local', quiet: true })

async function main() {
  console.log('\nEstilizando\n')
  const report = await applyStyling(getSheetsContext())

  for (const action of report.actions) console.log(`  ✓ ${action}`)

  console.log(`\n  ${report.spreadsheetUrl}\n`)
}

main().catch((error: unknown) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
