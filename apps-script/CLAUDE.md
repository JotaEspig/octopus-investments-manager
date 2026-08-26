# `apps-script/` — o motor que roda dentro da planilha

Este código **não faz parte do build**. Ele roda no runtime do Google, dentro da
planilha, por um gatilho diário. É o que mantém a planilha viva com a interface
desligada — que é o estado normal, já que ela só roda na máquina do usuário.

## Duplicação deliberada

`Code.gs` reimplementa a marcação na curva de `src/domain/fixed-income.ts`.
**Não dá para importar TypeScript aqui** — é o preço de a planilha precificar
renda fixa sozinha.

> **Mexeu num, mexa no outro.** As fórmulas precisam continuar espelhadas:
> pós-fixado aplica o percentual sobre a TAXA diária, prefixado e IPCA+ usam
> base 252, e o dia da aplicação não rende.

## A ordem de `dailyUpdate()` importa

```
refreshQuotes → fetchCdi → repriceFixedIncome → snapshotMonthly → recordLastRun
```

**`refreshQuotes` vem primeiro** porque o snapshot depende das cotações. O
`GOOGLEFINANCE` só recalcula com a planilha ABERTA, e o gatilho roda com ela
fechada — sem forçar, o histórico seria construído sobre preço congelado do
último dia em que alguém abriu, e sem nenhum sinal disso. Forçar é apagar a
fórmula e reescrevê-la; não existe API de "recalcule agora".

Isso abre uma janela de milissegundos com a coluna vazia. Por isso as fórmulas
são lidas para a memória ANTES, a restauração está em `finally`, e existe
`repairQuotes()` no menu para reconstruí-las a partir de `Ativos`. Ao mexer
nessa função, **preserve as três proteções**.

**`recordLastRun` vem por último**, e só se tudo passou: carimbo gravado após
falha diria que está tudo bem quando não está. É ele que faz `/setup` conseguir
dizer "não roda há 12 dias" — sem isso, gatilho quebrado é invisível.

## Restrições do ambiente

- Sem `import`/`export` e sem npm. Só as globais do Apps Script
  (`SpreadsheetApp`, `UrlFetchApp`, `Utilities`, `ScriptApp`).
- Os nomes de aba em `SHEETS` e os intervalos em `CLASS_TOTAL_RANGES` precisam
  bater **exatamente** com `src/sheets/schema.ts`. Renomeou lá, renomeie aqui.
- `SpreadsheetApp.flush()` antes de ler valor de fórmula, senão o snapshot lê o
  estado anterior.

## Por que é colado à mão

Um script vinculado à planilha pertence ao USUÁRIO, não à service account, então
a API do Google não consegue criá-lo. E a API do Apps Script não cria gatilhos
de tempo — só código rodando dentro do próprio script cria. Daí os dois cliques
manuais do setup. Não tente automatizar: já foi verificado que não dá.

## Limitações declaradas — repasse, não esconda

- **IPCA+ sai subestimado**: só o cupom real, sem correção monetária. O VNA
  oficial usa IPCA defasado com projeção pro-rata da ANBIMA, que não é API
  aberta.
- **Resgate parcial** é subtraído pelo valor de face, o que subestima o saldo.
  Aplicar e resgatar no vencimento — o caso normal — é exato.

## Testar

Não há teste automatizado aqui. A verificação é manual, pelo editor do Apps
Script: rodar `fetchCdi()` e conferir contra o site do BCB, e rodar
`snapshotMonthly()` duas vezes para confirmar que não duplica a linha do mês.
