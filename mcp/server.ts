#!/usr/bin/env node
/**
 * Servidor MCP da carteira — SOMENTE LEITURA.
 *
 * Dá ao agente `consultor-investimentos` acesso aos números reais da carteira,
 * para ele analisar em vez de perguntar quanto você tem de cada coisa.
 *
 * Duas decisões que valem explicação:
 *
 * 1. NÃO passa pela API HTTP. Importa `loadPortfolio` direto, então responde
 *    mesmo com o `next dev` desligado — que é o estado normal da máquina.
 *    O agente continua sem ver célula nenhuma: enxerga tools tipadas, e o
 *    cálculo mora no mesmo `src/domain` que a interface usa.
 *
 * 2. Nenhuma tool escreve. O agente analisa, você registra. Deixar um modelo
 *    gravar operações na planilha é assumir um risco que nada aqui compensa.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { ASSET_CLASSES } from '../src/domain/types'
import { loadPortfolio } from '../src/sheets/portfolio'

const server = new McpServer({ name: 'carteira', version: '0.1.0' })

/** O agente lê melhor JSON denso do que prosa; a formatação fica com ele. */
function json(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] }
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return {
    content: [{ type: 'text' as const, text: `Erro ao ler a carteira: ${message}` }],
    isError: true,
  }
}

server.registerTool(
  'portfolio_positions',
  {
    title: 'Posições da carteira',
    description:
      'Lista as posições da carteira com quantidade, preço médio, cotação atual, valor de ' +
      'mercado e rendimento. Cada posição vem em duas moedas: `*Native` é o desempenho do ' +
      'ativo na moeda dele, `*BRL` é o resultado em reais incluindo o efeito do câmbio — ' +
      'para ativos em dólar os dois números costumam contar histórias bem diferentes. ' +
      'Preço médio segue a regra da RFB: venda reduz a posição mas não altera o preço médio. ' +
      'Opcionalmente filtra por classe de ativo.',
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
        fxRateUSDBRL: filtered[0]?.currentFxRate ?? null,
        updatedAt: summary.updatedAt,
        positions: filtered,
      })
    } catch (error) {
      return failure(error)
    }
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)
