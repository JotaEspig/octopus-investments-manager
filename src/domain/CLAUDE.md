# `src/domain/` — as regras de negócio

Regras e comportamento estão em [`docs/domain.md`](../../docs/domain.md), não
aqui. Este arquivo só mapeia.

## O que tem aqui

| Arquivo | Responsabilidade |
|---|---|
| `types.ts` | `ASSET_CLASSES`, `ASSET_CLASS_LABELS`, moedas, objetivo do ativo |
| `average-cost.ts` | Preço médio e posição a partir das operações |
| `positions.ts` | Agrega posições por classe |
| `fixed-income.ts` | Marcação na curva |
| `returns.ts` | XIRR, retorno simples, nativo vs. BRL |
| `history.ts` | `missingHistoryMonths` |

Cada um tem seu `.test.ts` ao lado.

## Pedidos comuns

**Novo tipo de ativo**: começa em `types.ts` (`ASSET_CLASSES`,
`ASSET_CLASS_LABELS`). Depois `src/lib/schemas.ts`, `src/sheets/schema.ts` +
`styling.ts`, `apps-script/Code.gs` (`CLASS_ORDER`), `mcp/server.ts` — ver
tabela de pedidos comuns no `CLAUDE.md` da raiz.

**Nova regra de cálculo**: com teste. Se espelhada em fórmula da planilha ou em
`apps-script/Code.gs`, atualize os dois e rode `npm run verify:sheet`.
