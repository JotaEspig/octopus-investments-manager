import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

/**
 * Configuração de acesso ao Google Sheets.
 *
 * Vem do `.env.local` quando roda pelo Next, ou de
 * `~/.config/carteira/config.json` quando roda pelo servidor MCP — que é
 * lançado pelo Claude Code de qualquer diretório e por isso não enxerga o
 * `.env.local` do projeto.
 */

export interface CarteiraConfig {
  spreadsheetId: string
  serviceAccountPath: string
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

const CONFIG_FILE = 'carteira/config.json'

function fromConfigFile(): Partial<CarteiraConfig> {
  const base =
    process.env.XDG_CONFIG_HOME ??
    (process.env.HOME ? resolve(process.env.HOME, '.config') : null)
  if (!base) return {}

  try {
    const raw = readFileSync(resolve(base, CONFIG_FILE), 'utf8')
    const parsed = JSON.parse(raw) as Partial<CarteiraConfig>
    return parsed
  } catch {
    // Ausente ou ilegível é o caso normal quando se roda pelo Next.
    return {}
  }
}

export function loadConfig(): CarteiraConfig {
  const file = fromConfigFile()

  const spreadsheetId = process.env.CARTEIRA_SPREADSHEET_ID || file.spreadsheetId || ''
  const rawPath =
    process.env.CARTEIRA_SERVICE_ACCOUNT_PATH || file.serviceAccountPath || './secrets/service-account.json'

  if (!spreadsheetId) {
    throw new ConfigError(
      'CARTEIRA_SPREADSHEET_ID não definido. Copie .env.example para .env.local e preencha o ID da planilha.',
    )
  }

  return {
    spreadsheetId,
    serviceAccountPath: isAbsolute(rawPath) ? rawPath : resolve(process.cwd(), rawPath),
  }
}

/** Igual a `loadConfig`, mas devolve o erro em vez de lançar — usado pelo diagnóstico do /setup. */
export function tryLoadConfig(): { config: CarteiraConfig } | { error: string } {
  try {
    return { config: loadConfig() }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}
