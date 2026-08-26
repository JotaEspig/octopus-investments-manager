import { z } from 'zod'
import {
  ASSET_CLASSES,
  CURRENCIES,
  FIXED_INCOME_INDEXERS,
  TRADE_KINDS,
} from '@/domain/types'

/**
 * Validação compartilhada entre o formulário e a API.
 *
 * O mesmo schema roda nos dois lados de propósito: a interface não é uma
 * camada de conveniência sobre uma API permissiva — o que o formulário recusa,
 * a rota também recusa, e uma chamada direta por curl não consegue gravar
 * lixo na planilha.
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato aaaa-mm-dd')

/**
 * Ticker ou id de contrato.
 *
 * Aqui uma lista de permitidos É a ferramenta certa, porque o campo tem forma
 * conhecida: `AAPL`, `PETR4`, `BRK.B`, `RF-CDB-BANCO-XP-2028`. Um ticker com
 * `=` não é um ticker digitado errado, é lixo. E este valor vira critério de
 * busca nas fórmulas da planilha — caractere estranho aqui quebra o `SUMIFS`
 * que monta a posição.
 *
 * Para texto livre (nome, emissor, observação) a resposta é outra: neutralizar
 * na escrita, não bloquear. Ver `escapeSheetsFormula` em `sheets/repositories`.
 */
const symbol = z
  .string()
  .trim()
  .min(1, 'Informe o ativo')
  .max(40)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9.\-_]*$/,
    'Use apenas letras, números, ponto, hífen e sublinhado',
  )
  .transform((value) => value.toUpperCase())

export const tradeInputSchema = z
  .object({
    date: isoDate,
    kind: z.enum(TRADE_KINDS),
    symbol,
    quantity: z.number().positive('Quantidade deve ser maior que zero'),
    unitPrice: z.number().nonnegative('Preço não pode ser negativo'),
    currency: z.enum(CURRENCIES),
    fees: z.number().nonnegative().default(0),
    fxRate: z.number().positive('Câmbio deve ser maior que zero'),
    note: z.string().trim().max(200).default(''),
  })
  .refine((trade) => trade.currency !== 'BRL' || trade.fxRate === 1, {
    message: 'Operação em BRL deve ter câmbio 1',
    path: ['fxRate'],
  })

export type TradeInput = z.infer<typeof tradeInputSchema>

/**
 * Classe e corretora são obrigatórias e sem padrão — nem aqui, nem no
 * formulário.
 *
 * Classe pré-selecionada vira ativo cadastrado na classe errada, e classe
 * errada desloca a alocação inteira sem ninguém notar. Corretora com valor
 * sugerido vira histórico dizendo que tudo está num lugar onde não está.
 *
 * A regra vale nos dois lados: o que o formulário exige, a rota também exige.
 */
export const assetInputSchema = z.object({
  symbol,
  name: z.string().trim().min(1, 'Informe o nome do ativo').max(120),
  assetClass: z.enum(ASSET_CLASSES, { message: 'Escolha a classe do ativo' }),
  currency: z.enum(CURRENCIES),
  // A mensagem no construtor cobre também o campo AUSENTE; sozinho, o `min`
  // só pega o campo vazio e deixa vazar o texto padrão em inglês do zod.
  broker: z.string({ message: 'Informe a corretora' }).trim().min(1, 'Informe a corretora').max(60),
})

export type AssetInput = z.infer<typeof assetInputSchema>

export const fixedIncomeInputSchema = z
  .object({
    symbol,
    name: z.string().trim().min(1, 'Informe o nome do papel').max(120),
    issuer: z.string().trim().min(1, 'Informe o emissor').max(80),
    indexer: z.enum(FIXED_INCOME_INDEXERS),
    /**
     * Fração, não porcentagem. `1.1` é 110% do CDI; `0.13` é 13% a.a. no
     * prefixado; `0.06` é IPCA + 6% a.a.
     */
    rate: z.number().positive('Taxa deve ser maior que zero'),
    issueDate: isoDate,
    maturity: isoDate,
    dailyLiquidity: z.boolean().default(false),
    fgc: z.boolean().default(false),
  })
  .refine((contract) => contract.maturity > contract.issueDate, {
    message: 'Vencimento deve ser depois da aplicação',
    path: ['maturity'],
  })

export type FixedIncomeInput = z.infer<typeof fixedIncomeInputSchema>

/**
 * Corpo do POST /api/trades. Um ativo novo pode vir junto da primeira
 * operação — é o caminho normal: você compra algo que ainda não está
 * cadastrado e não deveria precisar de dois passos para isso.
 */
export const createTradeSchema = z.object({
  trade: tradeInputSchema,
  newAsset: assetInputSchema.optional(),
  newContract: fixedIncomeInputSchema.optional(),
})

export type CreateTradeBody = z.infer<typeof createTradeSchema>

/** Traduz o erro do zod para `{ campo: mensagem }`, que é o que o formulário exibe. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {}
  for (const issue of error.issues) {
    const path = issue.path.join('.')
    if (!result[path]) result[path] = issue.message
  }
  return result
}
