# `mcp/` — o servidor que o agente consulta

Comportamento está em [`docs/mcp.md`](../docs/mcp.md), não aqui. Este arquivo
só mapeia.

## O que tem aqui

Um arquivo só: `server.ts`. Registra as tools `portfolio_summary`,
`portfolio_positions`, `portfolio_asset`, `portfolio_trades`,
`portfolio_performance`.

## Pedidos comuns

**Nova tool de consulta**: ver `docs/mcp.md` para a regra de somente-leitura e
o que a descrição da tool precisa dizer.

**Novo campo em `src/domain/types.ts`**: conferir se as tools existentes
precisam expor o campo novo.
