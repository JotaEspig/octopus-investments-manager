# `src/sheets/` — tudo que fala com o Google Sheets

Contrato e comportamento estão em [`docs/sheets.md`](../../docs/sheets.md), não
aqui. A regra de migração de schema é regra de funcionamento, não de negócio —
está no `CLAUDE.md` da raiz. Este arquivo só mapeia.

## O que tem aqui

| Arquivo | Responsabilidade |
|---|---|
| `schema.ts` | O contrato: abas, colunas, fórmulas, formatos, intervalos nomeados |
| `bootstrap.ts` | Estrutura: cria abas, escreve fórmulas, gráficos |
| `styling.ts` | Só aparência: cores, alinhamento, listras, formatação condicional |
| `migrations.ts` | Versões do schema, backup, deriva estrutural |
| `repositories.ts` | Leitura e escrita das abas de dados |
| `export.ts` | Snapshot fiel em JSON/CSV |
| `portfolio.ts` | Ponto único onde planilha vira carteira |
| `diagnose.ts` | Diagnóstico usado por `/setup` |
| `client.ts` | Cliente da API do Sheets |
| `reset.ts` | Lógica de `sheet:reset` |

## Pedidos comuns

**Novo tipo de ativo**: `schema.ts` e `styling.ts` — ver `docs/domain.md` para
o restante da cadeia.

**Nova coluna ou mudança de formato numa aba de DADOS**: `schema.ts` +
`migrations.ts` — ver a regra no `CLAUDE.md` da raiz.

**Novo indicador ou gráfico do Painel**: `bootstrap.ts` (fórmula) +
`styling.ts` (aparência). Nunca em `src/app/`.

**Mexeu numa fórmula de apresentação**: rode `npm run verify:sheet`.
