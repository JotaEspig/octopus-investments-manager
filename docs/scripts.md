# Comportamento — `scripts/`

Cada arquivo é um `npm run sheet:*`. São a casca fina; a lógica mora em
`src/sheets/`, para que a página `/setup` possa executar exatamente o mesmo
código.

## Convenções

**Carregue o `.env.local` explicitamente.** O Next faz sozinho, script avulso
não:

```ts
import { config as loadDotenv } from 'dotenv'
loadDotenv({ path: '.env.local', quiet: true })
```

**Embrulhe em `async function main()`** e chame no fim com `.catch`. Top-level
await falha quando o arquivo é resolvido como CJS.

**Saia com código 1 em falha.** É o que permite virar passo de CI — o
`verify:sheet` depende disso.

**Símbolos de status consistentes:** `✓` feito, `!` aviso, `✗` erro. Mensagem de
erro sempre acionável: quem lê precisa saber o que fazer, não só que quebrou.

## Operação destrutiva

`sheet:reset` e `sheet:migrate` (quando toca dados) pedem confirmação
interativa por `node:readline/promises`.

> **Não adicione `--force` a nenhum dos dois.** Uma porta dos fundos anularia o
> único mecanismo que protege anos de histórico de aportes. O reset exige
> digitar o NOME da planilha justamente porque digitar "s" é reflexo e digitar o
> nome obriga a ler a tela.

Antes de confirmar, mostre o que será perdido em números concretos — quantas
operações, quantos ativos, quantos contratos.

## Escapes ANSI

Use `\u001b[31m` e não o caractere literal. Caractere de controle no fonte é
invisível no editor e some em qualquer round-trip de ferramenta.

## Script temporário de diagnóstico

Precisou sondar a planilha? Crie o arquivo **dentro desta pasta** (o alias `@/`
e o `tsconfig` só valem aqui dentro) e apague depois. Prefixe com ponto —
`.tmp-*.ts` — para não confundir com comando de verdade.
