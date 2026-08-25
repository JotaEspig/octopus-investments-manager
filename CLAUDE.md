@AGENTS.md

# Regra: mudanças no schema da planilha

A planilha guarda anos de histórico de aportes e **não pode ser recriada**.
`npm run sheet:reset` existe para recomeçar por vontade própria — nunca como
solução para diferença de versão. Não sugira reset para resolver schema.

## A pergunta a fazer antes de mexer em `src/sheets/schema.ts`

**Isto muda a posição ou o significado de uma coluna nas abas de DADOS?**
(`Operações`, `Ativos`, `Contratos RF`, `Cotações`, `CDI`, `Histórico`, `Config`)

| Resposta | O que fazer |
|---|---|
| Não — mexe só em aba de apresentação, no Painel ou em fórmula | Nada. O instalador reconstrói essas abas inteiras. |
| Sim, mas é coluna nova **no fim** | Suba `SCHEMA_VERSION`, registre a migração com `touchesData: false`. |
| Sim: renomear, remover, reordenar, inserir no meio, mudar formato do valor | Suba `SCHEMA_VERSION` **e** registre migração com `touchesData: true`. |

Coluna nova no fim é segura porque as linhas antigas apenas ficam com a célula
vazia. Qualquer outra mudança desloca dados já gravados.

## Registrar a migração

Toda versão ganha uma entrada em `src/sheets/migrations.ts`, **inclusive as
aditivas** — sem isso não dá para dizer, olhando o registro, o que aconteceu
entre duas versões. Um teste falha se `SCHEMA_VERSION` subir sem entrada
correspondente.

```ts
{
  to: 3,
  title: 'Frase curta',
  description: 'O que muda. Vai para a tela antes da confirmação do usuário.',
  touchesData: true,
  apply: async (ctx) => {
    await insertColumn(ctx, SHEET.trades, 4)
    return ['coluna Corretora inserida']
  },
}
```

Use as primitivas que já existem: `insertColumn`, `deleteColumn`, `moveColumn`,
`renameSheet`, `transformColumn`.

**Cada migração transforma apenas da versão imediatamente anterior.** Sair da
v2 para a v4 é `v2→v3→v4`, uma etapa por vez, e o encadeamento garante que a v4
receba uma planilha v3. Nunca escreva uma migração que tente adivinhar de onde
o usuário veio — isso multiplicaria os caminhos a cada versão nova.

Nunca pule um número de versão: um buraco no registro faria a etapa seguinte
rodar sobre a estrutura errada.

## Três defesas já existem — não as contorne

1. Teste falha se `SCHEMA_VERSION` subir sem entrada no registro.
2. `sheet:install` recusa quando há migração pendente com `touchesData`.
3. `sheet:install` lê o cabeçalho real das abas de dados e recusa qualquer
   divergência que não seja coluna nova no fim (`checkDataSheetDrift`).

Se uma delas travar, a saída é registrar a migração — não afrouxar a trava.

## Depois de mexer

```bash
npm test                 # registro, encadeamento e deriva
npm run sheet:migrate    # backup + confirmação quando toca dados
npm run sheet:install    # reconstrói as abas de apresentação
npm run verify:sheet     # confirma que planilha e código concordam
```

`verify:sheet` é o guarda da duplicação consciente entre as fórmulas da
planilha e `src/domain/`. Mexeu numa fórmula de apresentação, rode.

O mesmo vale para `apps-script/Code.gs`, que reimplementa a marcação na curva de
`src/domain/fixed-income.ts` porque não dá para importar TypeScript lá dentro.
Mexeu num, mexa no outro.
