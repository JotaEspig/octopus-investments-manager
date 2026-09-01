@AGENTS.md

# Octopus — mapa do projeto

Gerenciador de investimentos com o Google Sheets como fonte de verdade.

| Pasta | Papel |
|---|---|
| `src/domain/` | Regras financeiras — autoridade sobre os números |
| `src/sheets/` | Tudo que fala com o Google Sheets: contrato, migrações, escrita |
| `src/app/` | Interface e rotas de API |
| `src/lib/` | Utilitários compartilhados (dinheiro, datas, câmbio, validação) |
| `apps-script/` | Roda dentro da planilha, fora do build |
| `mcp/` | Servidor MCP consultado pelo agente |
| `scripts/` | Os `npm run sheet:*` |
| `.claude/` | Agente e skills |
| `docs/` | Regras de negócio e comportamento detalhado, por assunto |

Cada pasta de código tem seu próprio `CLAUDE.md` mapeando o que tem dentro.
Comportamento e regras — o que o código faz e por quê — está em `docs/`, não
nos `CLAUDE.md`: o código e os testes são a fonte da verdade sobre como as
coisas funcionam.

## `docs/`

| Arquivo | Assunto |
|---|---|
| `docs/domain.md` | Regras de cálculo: preço médio, renda fixa, IR, XIRR, duas moedas |
| `docs/sheets.md` | Contrato da planilha: dialeto de fórmula, formato, idempotência |
| `docs/apps-script.md` | Duplicação com `src/domain/`, ordem do `dailyUpdate`, histórico |
| `docs/app.md` | Por que não há dashboard, convenções de rota e interface |
| `docs/lib.md` | Detalhes de `money.ts`, `dates.ts`, `fx.ts`, `env.ts` |
| `docs/scripts.md` | Convenções dos scripts de linha de comando |
| `docs/mcp.md` | Por que o servidor MCP é somente leitura, arquitetura |

Leia o arquivo de `docs/` correspondente só quando precisar entender a regra de
negócio por trás de uma mudança — não é preciso carregar tudo de antemão.

# Regra: mudanças no schema da planilha

Esta não é regra de negócio — é regra de funcionamento do versionamento do
projeto, e vale sempre, não só quando o assunto vier à tona.

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

## Pedidos comuns

Cada pedido abaixo toca vários arquivos em pastas diferentes.

| Pedido | Pastas que mudam |
|---|---|
| Novo tipo de ativo (ex.: cripto, previdência) | `src/domain/types.ts` → `src/lib/schemas.ts` → `src/sheets/schema.ts` + `styling.ts` → `apps-script/Code.gs` → `mcp/server.ts` |
| Nova coluna ou mudança de formato numa aba de DADOS | `src/sheets/schema.ts` + `src/sheets/migrations.ts` — ver a regra de schema acima |
| Novo indicador ou gráfico no Painel | `src/sheets/bootstrap.ts` + `src/sheets/styling.ts` |
| Nova regra de cálculo | `src/domain/` → espelhar em `src/sheets/` e, se for renda fixa, em `apps-script/Code.gs` |
| Novo campo no formulário de operação | `src/lib/schemas.ts` → `src/components/trade-form.tsx` → `src/app/api/trades/` → `src/sheets/repositories.ts` |
| Nova tool de consulta para o agente | `mcp/server.ts` |
| Novo `npm run sheet:*` | `scripts/` |
| Mudança no agente ou nas skills de investimento | `.claude/` |

## Convenção de commit

Formato: `tipo(escopo opcional): mensagem`.

- **tipo**: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`.
- **escopo**: a pasta ou o conceito afetado (`painel`, `sheets`, `mcp`,
  `domain`...). Omita quando o commit atravessa várias áreas.
- **mensagem**: em português, minúscula, sem ponto final.

```
feat(painel): snapshot semanal e tabela de ativos com objetivo
fix(sheets): CONFIG_PRIVACY_ROW entrava antes de privacy_mode
refactor(domain): separa cálculo de posição de average-cost.ts
```
