# Comportamento — `src/lib/`

Sem regra de negócio aqui (essa mora em `domain/`) e sem chamada ao Sheets
(essa mora em `sheets/`). Só as ferramentas que os dois usam.

## `money.ts`

Usamos `number` com arredondamento explícito nas fronteiras, não biblioteca
decimal — decisão consciente para esta escala. A consequência tem que ser
respeitada:

**Nunca compare dinheiro com `===`.** Use `equals()`. E `round()` arredonda
meio-para-cima em valor absoluto, corrigindo o caso clássico em que `1.005` é
representado como `1.00499999999999989`.

`parseNumber` aceita `"1.234,56"` e `"1,234.56"` — o que vem da planilha varia
conforme o modo de leitura, e adivinhar errado troca a casa decimal.

## `dates.ts`

**ISO `yyyy-mm-dd` no código, `dd/mm/yyyy` na planilha.** Não misture: é nesse
formato que o Sheets em pt_BR reconhece o texto como data em vez de guardar
string. `fromSheetDate` também aceita o número serial (dias desde 30/12/1899,
epoch herdada do Lotus 1-2-3).

## `fx.ts`

PTAX de venda do Banco Central, API aberta. Duas ressalvas que devem aparecer
para o usuário, não serem escondidas: a PTAX do dia só sai à tarde (cadastro de
manhã traz a do dia anterior), e para IR de ativo no exterior a RFB tem regras
próprias sobre qual PTAX usar. O campo no formulário é editável por isso.

## `env.ts`

Configuração vem do `.env.local` **ou** de `~/.config/carteira/config.json` — o
segundo existe porque o servidor MCP é lançado de fora do projeto e não enxerga
o primeiro. Ao mexer aqui, lembre que os dois caminhos precisam continuar
funcionando.

## `schemas.ts`

Zod compartilhado entre formulário e API. O ticker tem lista de permitidos
porque tem forma conhecida e vira critério de busca nas fórmulas da planilha.
Texto livre (nome, emissor, observação) **não** se bloqueia — a defesa ali é
neutralizar na escrita, em `sheets/repositories.ts`.
