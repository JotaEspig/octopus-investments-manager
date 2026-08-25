---
name: carteira-mcp
description: >-
  Como consultar a carteira real do usuário pelas tools MCP do servidor `carteira`
  (portfolio_summary, portfolio_positions, portfolio_asset, portfolio_trades,
  portfolio_performance) e como interpretar os números que elas devolvem — preço médio pela
  regra da RFB, a diferença entre retorno na moeda nativa e em reais, XIRR versus retorno
  simples, e marcação na curva de renda fixa. Use SEMPRE que a conversa envolver a carteira
  concreta do usuário (posições, alocação, rentabilidade, rebalanceamento, o que aportar)
  em vez de um caso hipotético.
---

# Carteira — consultar os números reais

O usuário mantém a carteira numa planilha do Google Sheets alimentada pelo app
`carteira`. O servidor MCP de mesmo nome expõe esses dados. **Consulte antes de
opinar**: analisar a carteira de memória, ou perguntar ao usuário quanto ele tem
de cada coisa, é retrabalho quando o número está a uma chamada de distância.

## As tools

| Tool | Quando usar |
|---|---|
| `portfolio_summary` | Ponto de partida de qualquer análise. Patrimônio total e alocação por classe vs. meta. |
| `portfolio_positions` | Ativo a ativo: posição, preço médio, cotação, rendimento. Aceita filtro por classe. |
| `portfolio_asset` | Uma tese específica: histórico completo de operações do papel, e para RF a simulação de resgate com IR. |
| `portfolio_trades` | Ritmo de aportes, auditoria de como uma posição se formou. |
| `portfolio_performance` | "Quanto rendeu?" — traz retorno simples e XIRR. |

Todas são **somente leitura**. Não existe tool de escrita, e isso é
intencional: o usuário registra as operações na interface. Se ele pedir para
você lançar uma compra, explique que o cadastro é na interface (`npm run dev`,
`127.0.0.1:3000`) e siga com a análise.

## Como ler os números

### Preço médio segue a regra da RFB
Uma **venda não altera o preço médio** — só reduz a posição. Compras a preços
diferentes fazem média ponderada; vender no meio não "reseta" nada. Taxas de
corretagem já estão embutidas no custo de aquisição.

Consequência prática: um preço médio muito abaixo da cotação não significa que
o usuário "acertou o timing" recentemente — pode ser uma compra antiga
carregando a média.

### Todo valor vem em duas moedas, e as duas importam
- `*Native` — desempenho na moeda do ativo. Diz se **o ativo** foi bem.
- `*BRL` — resultado em reais, câmbio incluído. Diz se **o investidor** ganhou.

Para a carteira dele (AAPL, MSFT, GOOGL, PG e ETFs, tudo via Avenue) a
diferença costuma ser grande. Ao comentar desempenho, **diga qual das duas você
está usando**. Um ativo pode estar 5% negativo em dólar e positivo em reais
porque o câmbio subiu — e o contrário também acontece.

O custo em reais usa o câmbio de **cada compra**, não o de hoje. É o que foi
efetivamente desembolsado.

### XIRR ≠ retorno simples
`simpleReturn` é `valor/custo − 1`. Com aportes mensais ele **subestima** o
desempenho, porque trata igual o dinheiro que ficou anos investido e o que
entrou mês passado.

`annualizedReturn` (XIRR) é a taxa anual que considera quando cada real entrou —
é ela que se compara com o CDI. Quanto maior a distância entre as duas, mais o
retorno simples estava enganando.

Se `annualizedReturn` vier `null`, o fluxo não tem solução matemática. **Não
invente um número**: diga que não é determinável e use o retorno simples,
declarando a limitação.

### Renda fixa é marcada na curva
Não há cotação: o valor vem do principal corrigido pelo indexador desde a
aplicação, em base 252 dias úteis.

`portfolio_asset` num papel de RF traz `redemptionToday` com o **IR regressivo**
já aplicado (22,5% até 180 dias · 20% até 360 · 17,5% até 720 · 15% depois).
Olhe o campo `daysToNextBracket`: se faltam poucos dias para a alíquota cair,
isso muda a recomendação de resgate — a alíquota nova vale para o ganho inteiro,
não só para a parte posterior.

Duas limitações declaradas, que você deve repassar quando forem relevantes:
- **IPCA+** aparece **subestimado**: sai só com o cupom real, sem a correção
  monetária (o VNA oficial usa projeção pro-rata da ANBIMA, que não é pública).
- **Resgate parcial** é subtraído pelo valor de face, o que subestima o saldo.

### Cotações têm atraso e podem falhar
Vêm do `GOOGLEFINANCE`, com ~20 minutos de delay — irrelevante para
buy-and-hold. Mas se uma cotação vier **zero**, provavelmente a fórmula falhou
(acontece com FII e ETF brasileiro), e não que o ativo virou pó. Nesse caso
avise em vez de concluir que houve perda total.

## Erro de leitura

Se uma tool falhar, é setup, não carteira vazia. Os suspeitos, em ordem:
planilha não compartilhada com a service account, `CARTEIRA_SPREADSHEET_ID`
errado, ou `~/.config/carteira/config.json` ausente. Aponte o `/setup` da
interface, que faz o diagnóstico passo a passo.

## Relação com as outras skills

- `estrategia-investimentos` — a arquitetura da carteira (alocação,
  core-satélite, rebalanceamento). Use junto ao interpretar o `drift` do
  `portfolio_summary`.
- `analise-mercado` — avaliar um ativo específico. Use junto com
  `portfolio_asset` ao discutir aumentar, reduzir ou sair de uma posição.
