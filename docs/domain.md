# Regras de negócio — `src/domain/`

**Puro, sem I/O.** Nada aqui importa de `sheets/`, `app/` ou faz rede. É o que
permite testar tudo sem planilha, e é por isso que este diretório é a
**autoridade** sobre os números: a planilha calcula o mesmo por fórmula para
funcionar no celular, mas se divergir, o certo é aqui.

Toda função nova de cálculo nasce com teste. Sem exceção — é dinheiro.

## Regras que se erra com facilidade

**Preço médio (`average-cost.ts`).** Uma venda **não** altera o preço médio, só
reduz a posição. Quem "recalcula a média" depois de vender apura ganho de
capital errado. As taxas entram no custo na compra e reduzem o recebido na
venda.

```
compra 10 @ 100  →  PM 100 · posição 10
vende   5        →  PM 100 · posição  5      ← PM intocado
compra 10 @ 200  →  PM 150 · posição 15      ← média das COMPRAS
```

**Base 252, não 365 (`fixed-income.ts`).** Renda fixa usa dias ÚTEIS, convenção
da B3. Trocar por 365 subestima o rendimento em ~30%. O calendário de dias úteis
sai da própria série do CDI — o BCB publica uma observação por dia útil, então
não há tabela de feriados para manter.

**IR regressivo conta dias CORRIDOS**, ao contrário da marcação. E a alíquota
vale para o resgate inteiro: cruzar de 360 para 361 dias derruba de 20% para
17,5% sobre TODO o ganho.

**XIRR devolve `null` quando não há raiz** (`returns.ts`). Não invente número —
quem consome trata o `null`.

## Duas modelagens não óbvias

**Renda fixa** não tem cotação nem quantidade natural, então a operação guarda
`quantity` = reais aplicados e `unitPrice` = 1. Aplicar R$ 1.000 num CDB é
`quantity: 1000, unitPrice: 1`; resgate parcial de R$ 300 é uma venda de 300.
Assim o mesmo cálculo de custo médio serve para as duas naturezas.

**Tudo vem em duas moedas.** `*Native` diz se o ATIVO foi bem; `*BRL` diz se o
INVESTIDOR ganhou. O custo em reais usa o câmbio de **cada compra**, não o de
hoje. Para posição em dólar a diferença costuma superar o próprio desempenho do
ativo.

Moeda é propriedade do ATIVO, nunca da classe. ETF é o exemplo: a mesma classe
tem ativo americano (USD) e ativo listado na B3 (BRL) lado a lado — nada no
domínio presume que uma classe inteira está numa moeda só.

## Evolução contra o CDI (`performance.ts`)

O gráfico de patrimônio do Painel e o quadro de rendimento no topo respondem duas
perguntas diferentes, com duas contas diferentes:

**"E se o mesmo dinheiro tivesse ido todo pro CDI?"** — a linha cinza. Parte do
patrimônio do primeiro ponto da janela e soma cada aporte (subtrai cada
resgate e provento) na data em que ele aconteceu, cada um rendendo CDI dali em
diante. Comparável em reais com a linha da carteira.

**"Quanto a carteira rendeu?"** — o quadro. Com aporte mensal, `final ÷ inicial`
mede quanto você depositou, não quanto rendeu. Por isso é rentabilidade
ponderada pelo tempo (TWR): cada fatia entre dois snapshots rende
`atual ÷ (anterior + aporte da fatia)`, e as fatias se multiplicam. É a conta
que fundos e o próprio CDI divulgam — o que torna os dois percentuais
comparáveis lado a lado. Não é a XIRR de `returns.ts`, que pondera pelo
dinheiro e responde outra pergunta.

- Provento **subtrai** do aporte: sai do patrimônio que o histórico mede.
- A janela é de 12 meses contados do **último snapshot**, não de hoje. Com
  menos de 12 meses, a primeira linha do quadro é o histórico inteiro e dá o
  mesmo número da segunda.
- O histórico total começa no **primeiro aporte**: a primeira fatia vai dele ao
  primeiro snapshot, com patrimônio anterior zero.
- **CAGR só com um ano ou mais** (`MIN_DAYS_FOR_CAGR`): anualizar três meses
  bons projeta um número que a carteira nunca entregou.
- Aproximação declarada: o aporte é tratado como se entrasse no começo da
  fatia. Com snapshot semanal, erra por poucos dias; nos meses antigos de
  snapshot mensal, por mais.
