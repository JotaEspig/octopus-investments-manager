# `scripts/` — os comandos de linha

Convenções estão em [`docs/scripts.md`](../docs/scripts.md), não aqui. Este
arquivo só mapeia.

## O que tem aqui

| Arquivo | Comando |
|---|---|
| `sheet-install.ts` | `sheet:install` |
| `sheet-migrate.ts` | `sheet:migrate` |
| `sheet-reset.ts` | `sheet:reset` |
| `sheet-style.ts` | `sheet:style` |
| `verify-sheet.ts` | `verify:sheet` |

## Pedidos comuns

**Novo `npm run sheet:*`**: criar arquivo aqui seguindo `docs/scripts.md`,
registrar em `package.json`, chamar a lógica de `src/sheets/`.
