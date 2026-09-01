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

Regra de mudança de schema e migração: `CLAUDE.md` da raiz (é regra de
funcionamento do versionamento, não de negócio).
