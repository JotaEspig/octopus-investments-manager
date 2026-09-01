# `src/app/` — interface e rotas de API

Comportamento e convenções estão em [`docs/app.md`](../../docs/app.md), não
aqui. Este arquivo só mapeia.

## O que tem aqui

| Caminho | O que é |
|---|---|
| `page.tsx`, `layout.tsx`, `globals.css` | A tela única do livro-caixa |
| `setup/` | Página de instalação e diagnóstico da planilha |
| `api/trades/`, `api/trades/[id]/` | CRUD de operações |
| `api/assets/` | Metadados de ativo (objetivo, corretora) |
| `api/fx/` | Cotação de câmbio (PTAX) |
| `api/portfolio/`, `api/portfolio/performance/` | Leitura da carteira para a interface |
| `api/export/` | Snapshot JSON/CSV |
| `api/sheet/`, `api/sheet/apps-script/` | Instalação, migração e cola do Apps Script |

Componentes ficam em `src/components/` (`form.tsx`, `trade-form.tsx`,
`export-panel.tsx`, `shell.tsx`), não aqui dentro.

## Pedidos comuns

**Novo campo no formulário de operação**: `src/lib/schemas.ts` →
`src/components/trade-form.tsx` → rota em `api/trades/`.

**Nova rota de API**: seguir convenções em `docs/app.md`.

**Pediram um dashboard ou gráfico aqui**: ver `docs/app.md` antes de construir.
