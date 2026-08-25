import { toISO } from './dates'

/**
 * Câmbio USD/BRL pela PTAX do Banco Central.
 *
 * API aberta, sem chave e sem cadastro. Usamos a **cotação de venda**, que é a
 * referência para converter aquisições em moeda estrangeira.
 *
 * Duas ressalvas honestas:
 * - A PTAX do dia só é publicada no fim da tarde. Cadastrando uma compra na
 *   manhã do próprio dia, a resposta virá do último dia útil disponível — o
 *   campo é editável no formulário justamente por isso.
 * - Para apuração de IR de ativos no exterior a RFB tem regras próprias sobre
 *   qual PTAX usar em cada situação. Este número serve para acompanhar a
 *   carteira, não para preencher declaração sem conferir.
 *
 * Doc: https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/aplicacao
 */

const ENDPOINT = 'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarDia'

/** Fim de semana, feriado e o dia antes da publicação — 10 dias cobrem qualquer emenda. */
const MAX_LOOKBACK_DAYS = 10

const TIMEOUT_MS = 6000

export interface FxQuote {
  rate: number
  /** Data efetiva da cotação — pode ser anterior à pedida em fim de semana. */
  date: string
  source: 'ptax'
}

export class FxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FxError'
  }
}

interface PtaxResponse {
  value?: Array<{ cotacaoVenda?: number; dataHoraCotacao?: string }>
}

/** A PTAX espera `MM-DD-YYYY`, não o formato brasileiro. */
function toPtaxDate(iso: string): string {
  const [year, month, day] = iso.split('-')
  return `${month}-${day}-${year}`
}

async function fetchOneDay(iso: string): Promise<number | null> {
  const url =
    `${ENDPOINT}(dataCotacao=@dataCotacao)?@dataCotacao='${toPtaxDate(iso)}'` +
    `&$top=1&$format=json&$select=cotacaoVenda,dataHoraCotacao`

  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!response.ok) throw new FxError(`Banco Central respondeu ${response.status}`)

  const body = (await response.json()) as PtaxResponse
  const rate = body.value?.[0]?.cotacaoVenda
  return typeof rate === 'number' && rate > 0 ? rate : null
}

/**
 * PTAX de venda da data pedida, ou do dia útil anterior mais próximo.
 * Sem data, usa hoje.
 */
export async function fetchPtax(iso?: string): Promise<FxQuote> {
  const start = iso ? new Date(`${iso}T12:00:00Z`) : new Date()
  if (Number.isNaN(start.getTime())) throw new FxError(`Data inválida: ${iso}`)

  for (let back = 0; back <= MAX_LOOKBACK_DAYS; back += 1) {
    const candidate = new Date(start)
    candidate.setUTCDate(candidate.getUTCDate() - back)
    const date = toISO(candidate)

    const rate = await fetchOneDay(date)
    if (rate !== null) return { rate, date, source: 'ptax' }
  }

  throw new FxError(
    `Sem PTAX publicada nos ${MAX_LOOKBACK_DAYS} dias anteriores a ${iso ?? 'hoje'}. ` +
      'Informe o câmbio à mão.',
  )
}
