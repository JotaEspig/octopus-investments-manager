# Comportamento — `mcp/`

## Invariante: SOMENTE LEITURA

**Nunca adicione uma tool que escreva.** O agente analisa, o usuário registra.

A assimetria é o argumento: uma análise errada se percebe lendo; um lançamento
errado contamina preço médio e imposto em silêncio, e só aparece meses depois na
apuração. Se pedirem uma tool de escrita, explique isso antes de construir.

## Duas decisões de arquitetura

**Não passa pela API HTTP.** Importa `loadPortfolio` direto, então responde com
o `next dev` desligado — que é o estado normal da máquina. O agente continua sem
ver célula nenhuma: enxerga tools tipadas, e o cálculo mora no mesmo
`src/domain/` que a interface usa. É o que garante que os dois nunca respondam
números diferentes para a mesma pergunta.

**A configuração vem de `~/.config/carteira/config.json`**, não do `.env.local`.
O servidor é lançado pelo Claude Code de qualquer diretório e não enxerga o
projeto. O `install.sh` grava esse arquivo.

## As descrições das tools são parte do produto

Elas contam o que o número **significa**, não só o que ele é. Um agente que não
sabe que o preço médio segue a regra da RFB tira conclusão errada de um dado
certo.

Ao adicionar ou mudar uma tool, a descrição precisa dizer:

- se o valor é em moeda nativa ou em reais, e por que os dois existem
- qualquer regra contraintuitiva por trás (venda não altera PM, XIRR vs. retorno
  simples, IR regressivo valendo para o ganho inteiro)
- quando o campo pode vir `null`, e que `null` não deve virar número inventado

## Erro

Falha de leitura devolve `isError: true` com uma mensagem que aponta o setup —
os suspeitos são sempre planilha não compartilhada, ID errado ou config
ausente. Não deixe o agente concluir "carteira vazia" quando o problema é acesso.

## Testar sem cliente MCP

```bash
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
 | npx tsx mcp/server.ts
```
