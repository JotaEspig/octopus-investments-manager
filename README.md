# Carteira

Gerenciador de investimentos com o **Google Sheets como fonte de verdade**.

Três peças, cada uma com um papel:

| Peça | Papel |
|---|---|
| **A planilha** | O painel. Abre do celular, de qualquer lugar, e se atualiza sozinha. |
| **A interface** (Next.js, local) | A porta de entrada. Cadastra operações com validação. |
| **O servidor MCP** | Dá ao agente `consultor-investimentos` acesso à carteira real. |

A planilha continua viva mesmo com a interface desligada: um Apps Script rodando
na nuvem do Google busca o CDI no Banco Central, marca a renda fixa na curva e
grava o snapshot mensal do patrimônio.

## Custo

R$ 0,00, sem cartão de crédito em nenhum passo. Google Sheets, Apps Script e a
Sheets API são gratuitos; as cotações vêm do `GOOGLEFINANCE` embutido na
planilha e o CDI/câmbio das APIs abertas do Banco Central. Nada roda hospedado.

## Setup

Uma vez só, ~10 minutos.

1. **Google Cloud** — em [console.cloud.google.com](https://console.cloud.google.com):
   criar um projeto → *APIs & Services* → habilitar **Google Sheets API**.
   Não é preciso ativar faturamento; se o console pedir, a API habilitada foi a errada.
2. **Service account** — *IAM & Admin* → *Service Accounts* → criar →
   *Keys* → *Add key* → *JSON* → baixar.
3. Mover o JSON para `./secrets/service-account.json` (a pasta é ignorada pelo git).
4. Criar uma **planilha vazia** no seu Google Drive.
5. **Compartilhar** a planilha com o `client_email` que está no JSON, como *Editor*.
6. `cp .env.example .env.local` e preencher o `CARTEIRA_SPREADSHEET_ID`
   (o trecho da URL entre `/d/` e `/edit`).

Depois disso, o instalador monta a planilha inteira:

```bash
npm install
npm run sheet:install     # cria abas, fórmulas, formatação e gráficos
npm run dev               # http://127.0.0.1:3000
```

O mesmo instalador está na interface, em `/setup`, com diagnóstico do que já
está pronto e do que falta.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Interface em `127.0.0.1:3000` |
| `npm run sheet:install` | Constrói/atualiza a estrutura da planilha (idempotente) |
| `npm run verify:sheet` | Compara as posições calculadas em TS com as fórmulas da planilha |
| `npm test` | Testes do domínio (puros, sem rede) |
| `npm run typecheck` | `tsc --noEmit` |

## Estrutura

```
src/domain/    regras de negócio puras, sem I/O — é o que os testes cobrem
src/sheets/    schema.ts (o contrato da planilha), bootstrap e repositórios
src/lib/       zod, dinheiro, câmbio, configuração
src/app/       interface e rotas de API do Next
apps-script/   Code.gs — CDI, marcação de RF e snapshot mensal
mcp/           servidor MCP (somente leitura) para o agente
```

Duas regras sustentam o desenho:

- **Abas de dados ≠ abas de apresentação.** O código só escreve nas abas de
  dados (`Operações`, `Ativos`, `Contratos RF`, `Cotações`, `CDI`, `Histórico`,
  `Config`). As abas visuais (`Painel`, `Ações EUA`, `ETFs`, `Ações BR`, `FIIs`,
  `Renda Fixa`) são derivadas por fórmula — reformatar, mover gráfico e trocar
  cor não quebra nada.
- **`Operações` é append-only.** É o livro-razão. Posição e preço médio são
  projeções dele, nunca campos guardados: dá auditoria e permite recalcular
  tudo do zero.

## Aviso

Ferramenta pessoal de registro e acompanhamento. Os números que ela mostra são
uma projeção das operações cadastradas, não um informe oficial da corretora nem
base para declaração de imposto sem conferência.
