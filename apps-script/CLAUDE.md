# `apps-script/` — o motor que roda dentro da planilha

Comportamento está em [`docs/apps-script.md`](../docs/apps-script.md), não
aqui. Este arquivo só mapeia.

## O que tem aqui

Um arquivo só: `Code.gs`. Contém `dailyUpdate()` e suas etapas
(`refreshQuotes`, `fetchCdi`, `repriceFixedIncome`, `formatEtfCurrency`,
`snapshotWeekly`, `recordLastRun`), o backfill de histórico,
`onOpenSafetyNet` e os menus manuais (`repairQuotes()` etc.).

## Pedidos comuns

**Novo tipo de ativo**: atualizar `CLASS_ORDER` na mesma posição de
`ASSET_CLASSES` em `src/domain/types.ts`.

**Renomeou aba/coluna em `src/sheets/schema.ts`**: repetir em `SHEETS` /
`CLASS_TOTAL_RANGES` aqui.

**Nova regra de cálculo de renda fixa**: espelhar de
`src/domain/fixed-income.ts` para cá.
