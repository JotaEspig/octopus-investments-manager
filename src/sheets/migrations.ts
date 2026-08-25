import type { sheets_v4 } from 'googleapis'
import { explainSheetsError, type SheetsContext } from './client'
import { DATA_SHEETS, SCHEMA_VERSION, SHEET, ref } from './schema'

/**
 * MIGRAÇÕES DE SCHEMA — como a planilha de alguém sobe de versão sem perder
 * histórico.
 *
 * O `sheet:install` é idempotente e reescreve as abas de apresentação inteiras,
 * então ele absorve de graça qualquer mudança ADITIVA: coluna nova numa aba de
 * apresentação, aba nova, chave nova em `Config`. Foi assim que a v2 entrou.
 *
 * O que ele NÃO sabe fazer é mexer em dados já gravados. Se uma coluna nova
 * entrasse no MEIO de `Operações`, ele escreveria o cabeçalho na ordem nova e
 * deixaria as linhas antigas na ordem velha — corrupção silenciosa, que num
 * sistema de dinheiro é o pior desfecho possível.
 *
 * Daí este módulo. Cada versão que exige transformar dados registra uma
 * migração aqui; `sheet:migrate` aplica as pendentes em ordem, e o
 * `sheet:install` se recusa a rodar por cima enquanto houver alguma pendente
 * que toque em dados.
 *
 * **Resetar nunca é a resposta.** O reset existe para recomeçar do zero por
 * vontade própria, não para contornar uma mudança de versão.
 */

export interface MigrationContext {
  sheets: SheetsContext
  /** Id da aba pelo título, já resolvido. `null` quando a aba não existe. */
  sheetId: (title: string) => number | null
  /** Envia requisições numa tacada e devolve as respostas já desembrulhadas. */
  batch: (
    requests: sheets_v4.Schema$Request[],
  ) => Promise<sheets_v4.Schema$BatchUpdateSpreadsheetResponse>
}

export interface Migration {
  /** Versão que esta migração PRODUZ. */
  to: number
  title: string
  /** O que muda, em uma frase, para aparecer no plano antes de confirmar. */
  description: string
  /**
   * `true` quando a migração transforma linhas já gravadas.
   *
   * É o que decide se a operação precisa de backup e de confirmação — e o que
   * faz o `sheet:install` travar em vez de passar por cima.
   */
  touchesData: boolean
  /** Devolve as ações executadas, para o relatório. */
  apply: (context: MigrationContext) => Promise<string[]>
}

// ---------------------------------------------------------------------------
// Primitivas para mudanças destrutivas
//
// Não são usadas por nenhuma migração ainda — existem para que a primeira
// mudança que quebre compatibilidade seja escrita em três linhas, e não
// improvisada com a planilha de alguém no meio.
// ---------------------------------------------------------------------------

/**
 * Insere uma coluna vazia numa aba de dados, empurrando o resto para a direita.
 *
 * `inheritFromBefore: false` faz a coluna nova nascer sem herdar a formatação
 * da vizinha — o `sheet:style` cuida disso depois.
 */
export async function insertColumn(
  context: MigrationContext,
  sheetTitle: string,
  atIndex: number,
): Promise<void> {
  const sheetId = requireSheet(context, sheetTitle)
  await context.batch([
    {
      insertDimension: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: atIndex, endIndex: atIndex + 1 },
        inheritFromBefore: false,
      },
    },
  ])
}

export async function deleteColumn(
  context: MigrationContext,
  sheetTitle: string,
  atIndex: number,
): Promise<void> {
  const sheetId = requireSheet(context, sheetTitle)
  await context.batch([
    {
      deleteDimension: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: atIndex, endIndex: atIndex + 1 },
      },
    },
  ])
}

/**
 * Move uma coluna, levando os dados junto.
 *
 * O `destinationIndex` da API é medido ANTES da remoção da origem, que é a
 * pegadinha clássica: mover da 2 para a 5 exige pedir 6.
 */
export async function moveColumn(
  context: MigrationContext,
  sheetTitle: string,
  fromIndex: number,
  toIndex: number,
): Promise<void> {
  const sheetId = requireSheet(context, sheetTitle)
  await context.batch([
    {
      moveDimension: {
        source: { sheetId, dimension: 'COLUMNS', startIndex: fromIndex, endIndex: fromIndex + 1 },
        destinationIndex: toIndex > fromIndex ? toIndex + 1 : toIndex,
      },
    },
  ])
}

export async function renameSheet(
  context: MigrationContext,
  from: string,
  to: string,
): Promise<void> {
  const sheetId = requireSheet(context, from)
  await context.batch([
    { updateSheetProperties: { properties: { sheetId, title: to }, fields: 'title' } },
  ])
}

/**
 * Reescreve uma coluna inteira aplicando uma função a cada célula.
 *
 * Para os casos em que o formato do VALOR mudou e não a posição dele — trocar
 * o código de uma classe de ativo, normalizar um ticker, converter unidade.
 */
export async function transformColumn(
  context: MigrationContext,
  sheetTitle: string,
  columnLetter: string,
  transform: (value: unknown, row: number) => unknown,
): Promise<number> {
  const { api, spreadsheetId } = context.sheets
  const range = ref(sheetTitle, `${columnLetter}2:${columnLetter}`)

  const current = await api.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  })

  const rows = current.data.values ?? []
  if (rows.length === 0) return 0

  const updated = rows.map((row, index) => [transform(row[0], index + 2)])

  await api.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: updated as never },
  })

  return updated.length
}

function requireSheet(context: MigrationContext, title: string): number {
  const id = context.sheetId(title)
  if (id === null) throw new Error(`Aba "${title}" não existe — migração não pode continuar.`)
  return id
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

const BACKUP_PREFIX = '_bkp'

/**
 * Duplica as abas de DADOS antes de uma migração destrutiva.
 *
 * As cópias ficam ocultas e dentro da própria planilha — sem depender da API
 * do Drive, que exigiria um escopo maior só para isto. Abas de apresentação
 * não são copiadas: elas são derivadas, o `sheet:install` as reconstrói.
 *
 * Se algo der errado no meio, a recuperação é manual e simples: apagar a aba
 * quebrada e renomear a cópia de volta.
 */
export async function backupDataSheets(
  context: MigrationContext,
  label: string,
): Promise<string[]> {
  const { api, spreadsheetId } = context.sheets
  const meta = (await api.spreadsheets.get({ spreadsheetId, includeGridData: false })).data
  const existing = new Set((meta.sheets ?? []).map((sheet) => sheet.properties?.title ?? ''))

  const created: string[] = []
  const requests: sheets_v4.Schema$Request[] = []

  for (const spec of DATA_SHEETS) {
    const sourceSheetId = context.sheetId(spec.title)
    if (sourceSheetId === null) continue

    let name = `${BACKUP_PREFIX}_${label}_${spec.title}`
    let attempt = 2
    while (existing.has(name)) {
      name = `${BACKUP_PREFIX}_${label}_${spec.title} (${attempt})`
      attempt += 1
    }
    existing.add(name)

    requests.push({ duplicateSheet: { sourceSheetId, newSheetName: name } })
    created.push(name)
  }

  if (requests.length === 0) return []

  const response = await context.batch(requests)

  // Esconder as cópias para não poluir a barra de abas.
  const hide = (response.replies ?? [])
    .map((reply) => reply.duplicateSheet?.properties?.sheetId)
    .filter((id): id is number => typeof id === 'number')
    .map((sheetId) => ({
      updateSheetProperties: {
        properties: { sheetId, hidden: true },
        fields: 'hidden',
      },
    }))

  if (hide.length > 0) await context.batch(hide)

  return created
}

/** Abas de backup existentes, para o usuário saber que pode apagá-las. */
export async function listBackups(context: SheetsContext): Promise<string[]> {
  const meta = (
    await context.api.spreadsheets.get({
      spreadsheetId: context.spreadsheetId,
      includeGridData: false,
    })
  ).data

  return (meta.sheets ?? [])
    .map((sheet) => sheet.properties?.title ?? '')
    .filter((title) => title.startsWith(`${BACKUP_PREFIX}_`))
}

// ---------------------------------------------------------------------------
// Deriva estrutural
// ---------------------------------------------------------------------------

export type HeaderDrift =
  | { kind: 'empty' }
  | { kind: 'identical' }
  | { kind: 'additive'; added: string[] }
  | { kind: 'breaking'; reason: string }

/**
 * Compara o cabeçalho gravado na planilha com o que o schema descreve hoje.
 *
 * POR QUE ISTO EXISTE. O registro de migrações protege contra "subi a versão e
 * esqueci de registrar" — um teste falha. Mas não protege contra o caso mais
 * provável de todos: **mexer numa coluna e esquecer de subir a versão**. Aí
 * nada detectava, o instalador escrevia o cabeçalho novo sobre linhas na ordem
 * velha, e os dados se desalinhavam em silêncio.
 *
 * Esta função não depende da disciplina de ninguém: olha a planilha de verdade
 * e recusa o que não for compatível.
 *
 * Acrescentar coluna NO FIM é seguro — as linhas antigas ficam com a célula
 * nova vazia. Qualquer outra coisa (renomear, remover, reordenar, inserir no
 * meio) desloca dados e exige migração.
 */
export function compareHeaders(expected: string[], found: readonly unknown[]): HeaderDrift {
  const headers = found.map((header) => String(header ?? '').trim())
  while (headers.length > 0 && headers[headers.length - 1] === '') headers.pop()

  if (headers.length === 0) return { kind: 'empty' }

  const overlap = Math.min(expected.length, headers.length)
  for (let index = 0; index < overlap; index += 1) {
    if (headers[index] !== expected[index]) {
      return {
        kind: 'breaking',
        reason: `coluna ${index + 1} é "${headers[index]}" na planilha e "${expected[index]}" no schema`,
      }
    }
  }

  if (headers.length > expected.length) {
    return {
      kind: 'breaking',
      reason:
        `a planilha tem ${headers.length} colunas e o schema descreve ${expected.length} — ` +
        `sobra "${headers[expected.length]}"`,
    }
  }

  if (headers.length < expected.length) {
    return { kind: 'additive', added: expected.slice(headers.length) }
  }

  return { kind: 'identical' }
}

export interface SheetDrift {
  title: string
  drift: HeaderDrift
}

/** Confere o cabeçalho de todas as abas de dados contra o schema atual. */
export async function checkDataSheetDrift(context: SheetsContext): Promise<SheetDrift[]> {
  // Lê algumas colunas a mais do que o schema descreve, para enxergar coluna
  // que sobrou — é assim que uma remoção é detectada.
  const ranges = DATA_SHEETS.map((spec) =>
    ref(spec.title, `A1:${columnLetterOf(spec.columns.length + 4)}1`),
  )

  const response = await context.api.spreadsheets.values.batchGet({
    spreadsheetId: context.spreadsheetId,
    ranges,
    valueRenderOption: 'FORMATTED_VALUE',
  })

  const valueRanges = response.data.valueRanges ?? []

  return DATA_SHEETS.map((spec, index) => ({
    title: spec.title,
    drift: compareHeaders(
      spec.columns.map((column) => column.header),
      (valueRanges[index]?.values ?? [])[0] ?? [],
    ),
  }))
}

/** Duplicada de `bootstrap` de propósito: importar de lá criaria ciclo. */
function columnLetterOf(index: number): string {
  let letter = ''
  let value = index
  while (value >= 0) {
    letter = String.fromCharCode((value % 26) + 65) + letter
    value = Math.floor(value / 26) - 1
  }
  return letter
}

export const BLOCKED_BY_DRIFT =
  'A estrutura das abas de dados na planilha não bate com o schema do código, e a diferença ' +
  'não é apenas coluna nova no fim. Reinstalar agora escreveria o cabeçalho novo por cima das ' +
  'linhas antigas, desalinhando os dados. Registre uma migração em src/sheets/migrations.ts e ' +
  'rode `npm run sheet:migrate`.'

// ---------------------------------------------------------------------------
// Versão gravada
// ---------------------------------------------------------------------------

/**
 * Lê a versão do schema pela CHAVE, não pela posição da linha.
 *
 * Presumir que `schema_version` mora em `Config!B2` funcionaria hoje e
 * quebraria no dia em que uma chave nova entrasse antes dela — exatamente o
 * tipo de suposição que um mecanismo de migração não pode ter.
 */
export async function readSchemaVersion(context: SheetsContext): Promise<number | null> {
  try {
    const response = await context.api.spreadsheets.values.get({
      spreadsheetId: context.spreadsheetId,
      range: ref(SHEET.config, 'A2:B'),
    })
    for (const row of response.data.values ?? []) {
      if (String(row[0] ?? '').trim() === 'schema_version') {
        const version = Number(row[1])
        return Number.isFinite(version) ? version : null
      }
    }
  } catch {
    // Sem aba Config: planilha ainda não instalada.
  }
  return null
}

export async function writeSchemaVersion(context: SheetsContext, version: number): Promise<void> {
  const response = await context.api.spreadsheets.values.get({
    spreadsheetId: context.spreadsheetId,
    range: ref(SHEET.config, 'A2:A'),
  })

  const rows = response.data.values ?? []
  const index = rows.findIndex((row) => String(row[0] ?? '').trim() === 'schema_version')
  if (index < 0) throw new Error('Chave schema_version não encontrada em Config.')

  await context.api.spreadsheets.values.update({
    spreadsheetId: context.spreadsheetId,
    range: ref(SHEET.config, `B${index + 2}`),
    valueInputOption: 'RAW',
    requestBody: { values: [[version]] as never },
  })
}

// ---------------------------------------------------------------------------
// Registro
// ---------------------------------------------------------------------------

/**
 * Uma entrada por versão que precise de tratamento.
 *
 * Versões puramente aditivas entram como registro sem trabalho: elas não
 * exigem nada, mas ficar de fora da lista deixaria um buraco na numeração e
 * tornaria impossível dizer, olhando só daqui, o que aconteceu entre duas
 * versões.
 */
export const MIGRATIONS: Migration[] = [
  {
    to: 2,
    title: 'Participação do ativo na classe',
    description:
      'Coluna "% da classe" nas cinco seções e tabela de ativos no Painel. ' +
      'Puramente aditiva: só mexe em abas de apresentação, que o instalador reconstrói.',
    touchesData: false,
    apply: async () => ['Nada a transformar — mudança aditiva'],
  },
]

export function pendingMigrations(from: number): Migration[] {
  return MIGRATIONS.filter((migration) => migration.to > from && migration.to <= SCHEMA_VERSION).sort(
    (a, b) => a.to - b.to,
  )
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------

export interface MigrationPlan {
  currentVersion: number | null
  targetVersion: number
  pending: Migration[]
  /** Alguma das pendentes transforma dados já gravados. */
  touchesData: boolean
  /** Planilha nunca instalada: não há o que migrar, e sim o que instalar. */
  freshInstall: boolean
}

export async function planMigrations(context: SheetsContext): Promise<MigrationPlan> {
  const currentVersion = await readSchemaVersion(context)
  const pending = currentVersion === null ? [] : pendingMigrations(currentVersion)

  return {
    currentVersion,
    targetVersion: SCHEMA_VERSION,
    pending,
    touchesData: pending.some((migration) => migration.touchesData),
    freshInstall: currentVersion === null,
  }
}

export interface MigrationResult {
  actions: string[]
  backups: string[]
  from: number
  to: number
}

/**
 * Aplica as migrações pendentes, uma versão por vez.
 *
 * A versão gravada sobe DEPOIS de cada migração individual, não no fim: se a
 * terceira de quatro falhar, a planilha fica registrada na segunda e rodar de
 * novo retoma exatamente de onde parou, em vez de repetir transformações que
 * já aconteceram.
 */
export async function runMigrations(
  context: SheetsContext,
  options: { backup: boolean } = { backup: true },
): Promise<MigrationResult> {
  const plan = await planMigrations(context)

  if (plan.freshInstall) {
    throw new Error('Planilha ainda não instalada. Rode `npm run sheet:install` primeiro.')
  }
  if (plan.pending.length === 0) {
    return { actions: ['Nada pendente'], backups: [], from: plan.currentVersion!, to: plan.currentVersion! }
  }

  const meta = (
    await context.api.spreadsheets.get({
      spreadsheetId: context.spreadsheetId,
      includeGridData: false,
    })
  ).data

  const idsByTitle = new Map<string, number>()
  for (const sheet of meta.sheets ?? []) {
    const title = sheet.properties?.title
    const id = sheet.properties?.sheetId
    if (title && typeof id === 'number') idsByTitle.set(title, id)
  }

  const migrationContext: MigrationContext = {
    sheets: context,
    sheetId: (title) => idsByTitle.get(title) ?? null,
    batch: async (requests) => {
      try {
        const response = await context.api.spreadsheets.batchUpdate({
          spreadsheetId: context.spreadsheetId,
          requestBody: { requests },
        })
        return response.data
      } catch (error) {
        throw new Error(explainSheetsError(error, context))
      }
    },
  }

  const actions: string[] = []
  let backups: string[] = []

  if (options.backup && plan.touchesData) {
    backups = await backupDataSheets(migrationContext, `v${plan.currentVersion}`)
    actions.push(`Backup: ${backups.length} aba(s) de dados duplicada(s) e ocultada(s)`)
  }

  const from = plan.currentVersion!
  for (const migration of plan.pending) {
    const done = await migration.apply(migrationContext)
    actions.push(`v${migration.to} — ${migration.title}`, ...done.map((line) => `   ${line}`))
    await writeSchemaVersion(context, migration.to)
  }

  return { actions, backups, from, to: plan.targetVersion }
}

/** Mensagem de bloqueio usada pelo instalador. Fica aqui para não divergir. */
export const BLOCKED_BY_MIGRATION =
  'Há migração pendente que transforma dados já gravados. Rode `npm run sheet:migrate` ' +
  'antes de reinstalar — o instalador reescreveria os cabeçalhos deixando as suas linhas ' +
  'na ordem antiga.'

/** Prefixo reservado das abas de backup. */
export const BACKUP_SHEET_PREFIX = BACKUP_PREFIX
