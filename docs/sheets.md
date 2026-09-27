# Contrato e comportamento — `src/sheets/`

A área com mais armadilhas do projeto.

## Regras

**Nenhum intervalo solto.** Um `"A2:J"` fora de `schema.ts` é bug. Colunas se
localizam pelo `key` ou pelo `header`, nunca por índice fixo — foi assim que a
coluna `% da classe` entrou sem quebrar o `totalColumn`.

**Estrutura ≠ aparência.** Formatação vai em `styling.ts`, e só lá. É o que
permite `sheet:style` repintar sem risco de quebrar cálculo.

**Abas de dados ≠ abas de apresentação.** O código só escreve nas de dados. As
visuais são derivadas por fórmula e reconstruídas inteiras pelo instalador.

**Idempotência é requisito.** `bootstrap` e `styling` rodam de novo sem
duplicar. Listra e formatação condicional são REMOVIDAS antes de reaplicadas,
senão empilham a cada execução.

**`Operações` é append-only.** Posição e preço médio são *projeções* dele,
nunca campos guardados.

## Armadilhas medidas na planilha

**Dialeto de fórmula.** Escreva com `;`. Os dois pontos ambíguos — separador de
coluna e de linha em literal de matriz — usam `FORMULA_TOKEN`, porque `;`
significa coisas diferentes dentro e fora de `{}`. O `bootstrap` detecta o
dialeto com uma sonda antes de escrever; não presuma.

**`USER_ENTERED` interpreta tudo.** É necessário para o Sheets reconhecer data,
mas faz texto do usuário virar fórmula. Toda escrita passa por
`escapeSheetsFormula`; fórmula intencional se marca com `formula()`.

**Formato numérico.** `#` depois da vírgula faz o Sheets imprimir o separador
mesmo em inteiro — `69` virava `69,`. Quantidade usa `General`.

**Locale e fuso são propriedades INDEPENDENTES.** Já estiveram na mesma
condição e o fuso nunca era aplicado numa planilha que já nascia `pt_BR`.

**`values.append` não serve** em `Operações`: as colunas ARRAYFORMULA se
estendem até o fim da grade e o append escreveria lá embaixo. Use `nextRow`.

**A grade não cresce sozinha.** Cada aba nasce com 1000 linhas, e tanto o
`values.update` quanto o `getRange` do Apps Script recusam escrever além dela.
Quem acrescenta linha amplia antes, em lote de 500: `ensureRowCapacity` no
`writeRow`, `ensureRows` no `Code.gs`. É seguro porque toda fórmula que lê aba
de dados usa intervalo aberto (`$A$2:$A`, `$D:$D`) — nunca feche um intervalo
em `$A$1000`, ou as linhas novas ficam de fora da conta em silêncio.

## O rendimento % da planilha é na MOEDA DO ATIVO

A planilha mostra rendimento em porcentagem em quatro lugares: na linha de cada
ativo nas abas de classe, na linha 1 de cada aba (a classe inteira), e no Painel
por classe, por objetivo e por ativo. **Os quatro são a mesma conta**, e é de
propósito: agregado é sempre `Σ ganho ÷ Σ custo`, nunca média de porcentagens —
média daria o mesmo peso a uma posição de mil reais e a uma de cem.

Somar ETF americano com CDB exige uma moeda comum, e a conversão usa o câmbio de
**hoje**. Como ele multiplica numerador e denominador, se cancela: o percentual
que a planilha mostra é o do ATIVO, na moeda dele — para VOO, o retorno em
dólar. Foi a escolha deliberada, porque é o que mantém o número do Painel
idêntico ao da aba de classe.

O rendimento do INVESTIDOR em reais, que usa o câmbio de cada compra, é outro
número (costuma ser bem diferente em posição dolarizada) e não sai de fórmula:
precisaria de uma coluna de custo em reais nas abas de classe. Ele vive em
`src/domain/` (`returnBRL`) e é o que o app e o MCP devolvem — ver `docs/domain.md`.

Uma exceção conhecida: a aba `Renda Fixa` chama de "Rendimento (R$)" a diferença
entre valor bruto e aplicado, **sem somar proventos** de `interest` — ela não tem
coluna de proventos. Enquanto nenhum contrato pagar juros em dinheiro os números
batem; quando pagar, `verify:sheet` acusa, e o certo será dar à aba a coluna que
falta.

Regra de mudança de schema e migração: `CLAUDE.md` da raiz (é regra de
funcionamento do versionamento, não de negócio).
