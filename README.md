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

### O motor da planilha (Apps Script)

Um passo manual sobra, e vale saber por quê: um script vinculado à planilha
pertence a **você**, não à service account, então a API do Google não consegue
criá-lo — e a API do Apps Script não cria gatilhos de tempo. São dois cliques,
uma vez:

1. Na planilha: **Extensões → Apps Script**, cole `apps-script/Code.gs` e salve.
2. Recarregue a planilha e clique em **Carteira → Ativar atualização diária**.

A página `/setup` mostra esse passo a passo com botão de copiar. Sem ele, a
renda fixa não é precificada e o gráfico de 12 meses fica vazio.

### O agente consultor

```bash
./install.sh              # instala agente, skills e o servidor MCP em ~/.claude
./install.sh --uninstall  # remove tudo (a planilha não é tocada)
```

Instala o agente `consultor-investimentos`, três skills e o servidor MCP
`carteira`. Depois disso o agente funciona de qualquer diretório: a
configuração de acesso à planilha é copiada para
`~/.config/carteira/config.json`, porque o servidor MCP é lançado de fora deste
projeto e não enxerga o `.env.local`. A chave em si **não** é copiada — o
arquivo guarda o caminho dela.

Se rodar o `install.sh` antes de fazer o setup da planilha, ele avisa e instala
o resto; rode de novo depois para gravar a configuração.

| Tool MCP | O que devolve |
|---|---|
| `portfolio_summary` | Patrimônio total, alocação por classe, real vs. meta |
| `portfolio_positions` | Posição, preço médio, cotação, rendimento |
| `portfolio_asset` | Detalhe de um ativo + histórico + resgate com IR (renda fixa) |
| `portfolio_trades` | Extrato filtrado |
| `portfolio_performance` | Aportado, valor atual, retorno simples e XIRR |

Todas são **somente leitura**, de propósito. O agente analisa, você registra —
uma análise errada você percebe lendo, um lançamento errado contamina preço
médio e imposto em silêncio.

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
src/lib/       zod, dinheiro, câmbio, datas, configuração
src/app/       interface e rotas de API do Next
apps-script/   Code.gs — CDI, marcação de RF e snapshot mensal
mcp/           servidor MCP (somente leitura) para o agente
.claude/       agente e skills que o install.sh publica em ~/.claude
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

## Uma duplicação consciente

O preço médio é calculado em **dois lugares**: nas fórmulas das abas de
apresentação e em `src/domain/`. Não é descuido — é o preço de a planilha
funcionar no celular sem nada rodando. `src/domain/` é a autoridade; a fórmula
é o espelho.

`npm run verify:sheet` é o guarda dessa duplicação: compara as duas contas
ativo a ativo e falha se divergirem mais de um centavo. Também acusa fórmulas
quebradas — o sintoma clássico de locale trocado, em que o Sheets espera `,`
onde escrevemos `;`. Rode depois de todo `sheet:install` e sempre que mexer
numa fórmula.

O mesmo vale para `apps-script/Code.gs`, que reimplementa a marcação na curva
de `src/domain/fixed-income.ts` porque não dá para importar TypeScript lá
dentro. Mexeu num, mexa no outro.

## Aviso

Ferramenta pessoal de registro e acompanhamento. Os números que ela mostra são
uma projeção das operações cadastradas, não um informe oficial da corretora nem
base para declaração de imposto sem conferência.
