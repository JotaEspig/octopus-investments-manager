#!/usr/bin/env node
/**
 * Servidor MCP da carteira — SOMENTE LEITURA.
 *
 * Dá ao agente `consultor-investimentos` acesso aos números reais da carteira,
 * para ele analisar em vez de perguntar quanto você tem de cada coisa.
 *
 * Três decisões que valem explicação:
 *
 * 1. NÃO passa pela API HTTP. Importa `loadPortfolio` direto, então responde
 *    mesmo com o `next dev` desligado — que é o estado normal da máquina. O
 *    agente continua sem ver célula nenhuma: enxerga tools tipadas, e o cálculo
 *    mora no mesmo `src/domain` que a interface usa.
 *
 * 2. NENHUMA TOOL ESCREVE. O agente analisa, você registra. Deixar um modelo
 *    gravar operações na planilha é um risco que nada aqui compensa — e a
 *    assimetria é o ponto: uma análise errada você percebe lendo, um
 *    lançamento errado contamina preço médio e imposto em silêncio.
 *
 * 3. As descrições contam o que o número SIGNIFICA, não só o que ele é. Um
 *    agente que não sabe que preço médio segue a regra da RFB tira conclusão
 *    errada de um dado certo.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { ASSET_CLASSES } from '../src/domain/types'
import { summarizePerformance } from '../src/domain/returns'
import { netOfTax } from '../src/domain/fixed-income'
import { today } from '../src/lib/dates'
import { loadPortfolio } from '../src/sheets/portfolio'

const server = new McpServer({ name: 'carteira', version: '0.1.0' })

/** O agente lê melhor JSON denso do que prosa; a formatação fica com ele. */
function json(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] }
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return {
    content: [
      {
        type: 'text' as const,
        text:
          `Não foi possível ler a carteira: ${message}\n\n` +
          'Verifique ~/.config/carteira/config.json (id da planilha e caminho da chave) ' +
          'e se a planilha está compartilhada com a service account.',
      },
    ],
    isError: true,
  }
}

const CURRENCY_NOTE =
  'Todo valor vem em duas moedas: `*Native` é o desempenho na moeda do ativo, `*BRL` é o ' +
  'resultado em reais incluindo o efeito do câmbio. Para ativos em dólar os dois costumam ' +
  'contar histórias bem diferentes, e o segundo é o que o investidor brasileiro de fato ganhou.'

// ---------------------------------------------------------------------------

server.registerTool(
  'portfolio_summary',
  {
    title: 'Resumo da carteira',
    description:
      'Patrimônio total em reais e a alocação por classe de ativo, comparada com as metas ' +
      'definidas na planilha. Cada classe traz `share` (fração atual), `target` (meta) e ' +
      '`drift` (share − target, positivo quando a classe está acima da meta). Use como ponto ' +
      'de partida de qualquer análise de carteira ou decisão de rebalanceamento.',
    inputSchema: {},
  },
  async () => {
    try {
      const { summary } = await loadPortfolio()
      return json(summary)
    } catch (error) {
      return failure(error)
    }
  },
)

server.registerTool(
  'portfolio_positions',
  {
    title: 'Posições da carteira',
    description:
      'Posições com quantidade, preço médio, cotação atual, valor de mercado e rendimento. ' +
      'Preço médio segue a regra da RFB: uma venda reduz a posição mas NÃO altera o preço ' +
      'médio, e taxas de corretagem entram no custo de aquisição. ' +
      CURRENCY_NOTE,
    inputSchema: {
      assetClass: z
        .enum(ASSET_CLASSES)
        .optional()
        .describe('Filtra por classe. Sem isto, devolve a carteira inteira.'),
    },
  },
  async ({ assetClass }) => {
    try {
      const { positions, summary } = await loadPortfolio()
      const filtered = assetClass
        ? positions.filter((position) => position.assetClass === assetClass)
        : positions

      return json({
        totalBRL: summary.totalBRL,
        updatedAt: summary.updatedAt,
        positions: filtered,
      })
    } catch (error) {
      return failure(error)
    }
  },
)

server.registerTool(
  'portfolio_asset',
  {
    title: 'Detalhe de um ativo',
    description:
      'Posição consolidada de um ativo mais o histórico completo de operações dele. Use ao ' +
      'discutir uma tese específica, avaliar se vale aumentar ou reduzir, ou entender como o ' +
      'preço médio chegou onde chegou. Para papéis de renda fixa, traz também o contrato ' +
      '(emissor, indexador, taxa, vencimento) e a simulação de resgate hoje com o IR ' +
      'regressivo já descontado.',
    inputSchema: {
      symbol: z.string().describe('Ticker (AAPL) ou id do contrato de renda fixa.'),
    },
  },
  async ({ symbol }) => {
    try {
      const key = symbol.trim().toUpperCase()
      const { positions, data } = await loadPortfolio()

      const position = positions.find((candidate) => candidate.symbol === key)
      if (!position) {
        const known = positions.map((candidate) => candidate.symbol).join(', ')
        return json({ error: `Sem posição para "${key}".`, disponíveis: known })
      }

      const trades = data.trades
        .filter((trade) => trade.symbol === key)
        .sort((a, b) => a.date.localeCompare(b.date))

      const contract = data.contracts.find((candidate) => candidate.symbol === key)
      const redemption =
        contract && position.marketValueBRL > 0
          ? netOfTax(position.totalCostBRL, position.marketValueBRL, contract.issueDate, today())
          : null

      return json({ position, contract: contract ?? null, redemptionToday: redemption, trades })
    } catch (error) {
      return failure(error)
    }
  },
)

server.registerTool(
  'portfolio_trades',
  {
    title: 'Extrato de operações',
    description:
      'Livro-razão da carteira: compras, vendas, dividendos e juros, do mais recente para o ' +
      'mais antigo. Cada operação guarda o câmbio da sua própria data, então dá para ver ' +
      'quanto o dólar pesou em cada aporte. Use para entender o ritmo de aportes ou auditar ' +
      'como uma posição foi formada.',
    inputSchema: {
      since: z.string().optional().describe('Data ISO aaaa-mm-dd. Devolve operações a partir dela.'),
      symbol: z.string().optional().describe('Filtra por ativo.'),
      limit: z.number().int().positive().max(500).optional().describe('Máximo de linhas (padrão 50).'),
    },
  },
  async ({ since, symbol, limit }) => {
    try {
      const { data } = await loadPortfolio()
      const key = symbol?.trim().toUpperCase()

      const trades = data.trades
        .filter((trade) => (since ? trade.date >= since : true))
        .filter((trade) => (key ? trade.symbol === key : true))
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, limit ?? 50)

      return json({ count: trades.length, trades })
    } catch (error) {
      return failure(error)
    }
  },
)

server.registerTool(
  'portfolio_performance',
  {
    title: 'Rentabilidade da carteira',
    description:
      'Quanto foi aportado, quanto vale hoje e quanto rendeu — com DUAS medidas de retorno, ' +
      'de propósito. `simpleReturn` é valor/custo − 1, que subestima o desempenho de quem ' +
      'aporta todo mês porque trata igual o dinheiro de cinco anos atrás e o do mês passado. ' +
      '`annualizedReturn` é a XIRR: a taxa anual que considera QUANDO cada real entrou, e é ' +
      'a que se compara com o CDI. Quanto maior a distância entre as duas, mais o retorno ' +
      'simples estava enganando. `annualizedReturn` pode ser null quando o fluxo não tem ' +
      'solução — nesse caso não invente um número.',
    inputSchema: {},
  },
  async () => {
    try {
      const { data, summary } = await loadPortfolio()
      const performance = summarizePerformance(data.trades, summary.totalBRL, today())
      return json({ performance, allocation: summary.byClass })
    } catch (error) {
      return failure(error)
    }
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)
