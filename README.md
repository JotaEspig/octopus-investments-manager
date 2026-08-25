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
| `npm run sheet:style` | Repinta a planilha. Só aparência — não lê nem escreve valor nenhum |
| `npm run sheet:migrate` | Sobe a planilha de versão. `--dry-run` só mostra o plano |
| `npm run sheet:reset` | **Apaga tudo.** Pede confirmação digitando o nome da planilha |
| `npm run verify:sheet` | Compara as posições calculadas em TS com as fórmulas da planilha |
| `npm test` | Testes do domínio (puros, sem rede) |
| `npm run typecheck` | `tsc --noEmit` |

### `sheet:style`

Cor de aba por classe, cabeçalhos coloridos, alinhamento por natureza do dado
(número à direita para as casas decimais alinharem na vertical, data ao centro,
texto à esquerda), listras alternadas, grade escondida e ganho/perda em verde e
vermelho.

É **substitutivo**: listras e regras condicionais antigas são removidas antes
das novas, então rodar dez vezes dá o mesmo resultado de rodar uma. Como não
toca em valor de célula, é seguro rodar com a carteira cheia — e é o jeito de
voltar ao padrão se você mexeu no visual à mão.

O `sheet:install` já chama a estilização no fim; este comando existe para
repintar sem reinstalar.

## Exportar

Botão **Exportar** na interface, ou direto na API:

```
GET /api/export                       # JSON completo
GET /api/export?format=csv&sheet=X    # uma aba em CSV
GET /api/export?format=list           # nomes das abas
```

O JSON traz todas as abas, a carteira calculada, a deriva estrutural e um
checksum. O CSV é por aba, porque um CSV não comporta várias tabelas sem virar
um formato inventado.

**Fidelidade acima de conveniência.** O dump usa o cabeçalho **real** de cada
aba e a largura **real** da grade, lidos da planilha — não a expectativa do
`schema.ts`. Coluna que você acrescentou à mão aparece; coluna que o schema
espera e a planilha não tem, não é inventada. Cabeçalho vazio vira `Coluna C`
(a letra real) e cabeçalho repetido ganha sufixo, em vez de sobrescrever.

**Falha parcial não derruba o todo.** Cada aba é lida em isolamento; uma aba
ilegível vira uma entrada com `error` e o resto sai completo. Se o cálculo da
carteira falhar, `portfolio` vem `null` e os dados brutos continuam lá — um
backup que só funciona quando está tudo bem não é backup.

**Segurança.** O CSV neutraliza injeção de fórmula: um campo de texto começando
com `=`, `+`, `-` ou `@` viraria fórmula ativa ao abrir no Excel, então recebe
um apóstrofo. Número negativo não é afetado — a defesa só vale para texto. O
arquivo também leva BOM, sem o qual o Excel abre UTF-8 como Latin-1 e
"Observação" vira "ObservaÃ§Ã£o".

Nada de credencial vai no arquivo: nem caminho de chave, nem e-mail da service
account. Só o que está dentro da planilha.

**O checksum é verificável por qualquer um.** É `sha256` da serialização
canônica do bloco `sheets` (chaves em ordem alfabética, sem espaços), e a
receita vai gravada em `integrity.algorithm`. Não é assinatura — quem editar o
arquivo de propósito recalcula. Detecta acidente: download truncado, edição
sem querer.

Fórmulas não são exportadas, só os valores que produziram. Elas são
reproduzíveis com `sheet:install`; os dados é que são insubstituíveis.

### Versões do schema

A planilha guarda a versão em `Config!schema_version` e o código declara a que
espera em `SCHEMA_VERSION`. Quando divergem, há dois caminhos — e **nenhum
deles é resetar**. O reset existe para recomeçar do zero por vontade própria,
não para contornar uma atualização.

**Mudança aditiva** — coluna nova numa aba de apresentação, aba nova, chave
nova em `Config`. O `sheet:install` absorve sozinho: ele reescreve as abas de
apresentação inteiras e nunca encosta em linha de dados. Foi assim que a v2
entrou.

```bash
npm run sheet:install
```

**Mudança que transforma dados** — coluna inserida no meio de `Operações`, aba
renomeada, valor que muda de formato. Aí o `sheet:install` **se recusa a
rodar**, porque escrever o cabeçalho novo por cima das linhas antigas as
desalinharia em silêncio. O caminho é:

```bash
npm run sheet:migrate --dry-run   # o que viria pela frente
npm run sheet:migrate             # aplica, com backup e confirmação
npm run sheet:install             # reconstrói as abas de apresentação
npm run verify:sheet              # confere que planilha e código batem
```

Antes de transformar qualquer coisa, as sete abas de dados são **duplicadas e
ocultadas** dentro da própria planilha (`_bkp_v2_Operações` e companhia). Se
algo sair errado, a recuperação é apagar a aba quebrada e renomear a cópia de
volta. Confira o resultado antes de apagar os backups — o `sheet:migrate` os
lista quando não há nada pendente.

**Três defesas, em camadas**, porque cada uma cobre um jeito diferente de errar:

| Erro | O que pega |
|---|---|
| Subiu `SCHEMA_VERSION` e não registrou a migração | Um teste falha no CI |
| Registrou uma migração destrutiva e tentou reinstalar direto | `sheet:install` recusa e manda usar `sheet:migrate` |
| **Mexeu numa coluna e esqueceu de versionar** | `sheet:install` lê o cabeçalho da planilha, compara com o schema e recusa |

A terceira é a que importa mais, porque é a mais provável e a única que não
depende da disciplina de quem escreve o código. Ela distingue o que é seguro do
que não é: coluna nova **no fim** passa (as linhas antigas só ficam com a célula
vazia); renomear, remover, reordenar ou inserir no meio desloca dados e trava,
apontando qual aba e qual coluna divergiu.

Cada versão tem uma entrada em `src/sheets/migrations.ts`, mesmo as aditivas:
sem isso não daria para dizer, olhando só o registro, o que aconteceu entre
duas versões.

**Pular versões não existe.** Sair da v2 para a v4 é `v2 → v3 → v4`, uma etapa
por vez, e a versão gravada sobe depois de **cada** etapa. É isso que torna a
operação retomável: se a corrente quebrar no v4, a planilha fica registrada
como v3 e rodar de novo aplica só o que falta — em vez de reaplicar o v3 sobre
dados que ele já transformou.

Cada migração só sabe transformar da versão imediatamente anterior. Nenhuma
precisa perguntar "de onde este usuário veio?", porque o encadeamento garante
que ela receba a estrutura que espera.

O módulo já traz as primitivas para as mudanças destrutivas típicas —
`insertColumn`, `deleteColumn`, `moveColumn`, `renameSheet`, `transformColumn`
— para que a primeira delas seja escrita em três linhas, e não improvisada com
a planilha de alguém no meio.

### `sheet:reset`

Apaga **todas** as abas e devolve a planilha ao estado de recém-criada.
Destrutivo e irreversível — o Sheets tem histórico de versões, mas contar com
isso não é plano.

Antes de agir ele mostra o que será perdido (quantas operações, ativos e
contratos) e exige que você **digite o nome da planilha** para confirmar, no
estilo do GitHub para apagar repositório. Digitar "s" é reflexo; digitar o nome
obriga a ler a tela.

Não existe `--force`, de propósito: uma porta dos fundos aqui anularia o único
mecanismo que protege anos de histórico de aportes. O Apps Script colado na
planilha sobrevive ao reset — ele vive fora das abas.

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
- **Estrutura ≠ aparência.** `bootstrap.ts` cria abas, fórmulas e gráficos;
  `styling.ts` cuida de como aquilo se parece. É o que permite repintar sem
  risco de quebrar um cálculo.

## As duas porcentagens

Elas respondem perguntas diferentes e por isso convivem:

- **`% da classe`**, nas abas por tipo e na tabela de ativos do Painel — o peso
  do ativo dentro da própria classe. "BBAS3 é 20%" quer dizer 20% das suas
  ações brasileiras.
- **`% atual`**, na tabela de alocação do Painel — o peso da classe na carteira
  inteira, que é o que se compara com a meta para decidir rebalanceamento.
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
