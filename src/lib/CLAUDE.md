# `src/lib/` — utilitários compartilhados

Comportamento está em [`docs/lib.md`](../../docs/lib.md), não aqui. Este
arquivo só mapeia.

## O que tem aqui

| Arquivo | O que é |
|---|---|
| `money.ts` | Arredondamento e comparação de dinheiro, `parseNumber` |
| `dates.ts` | Conversão ISO ↔ formato da planilha |
| `fx.ts` | PTAX do Banco Central |
| `env.ts` | Config de `.env.local` ou `~/.config/carteira/config.json` |
| `schemas.ts` | Zod compartilhado entre formulário e API |
| `api.ts` | `errorResponse` — tradução de erro em status HTTP |

## Pedidos comuns

**Novo tipo de ativo com ticker de forma diferente** (ex.: cripto): lista de
permitidos em `schemas.ts`.

**Novo campo em qualquer formulário**: passa por `schemas.ts` antes de chegar
em `src/components/` ou nas rotas.
