# `.claude/` — o agente e as skills

Estes arquivos são a **fonte**. O `install.sh` os copia para `~/.claude/`, onde
o Claude Code de fato os carrega.

> **Edite aqui, nunca em `~/.claude/`.** A cópia instalada é sobrescrita na
> próxima execução do `install.sh`, e a alteração se perde sem aviso.

Depois de mexer, reinstale e reinicie o Claude Code:

```bash
./install.sh
```

## O que vive aqui

| Arquivo | Papel |
|---|---|
| `agents/consultor-investimentos.md` | O agente. Filosofia de valor e longo prazo |
| `skills/estrategia-investimentos/` | Arquitetura da carteira: alocação, core-satélite, rebalanceamento |
| `skills/analise-mercado/` | Avaliar um ativo: fundamentos, valuation, macro |
| `skills/carteira-mcp/` | **Como interpretar** os números que as tools MCP devolvem |

As duas primeiras skills são conhecimento geral de investimentos e não dependem
deste projeto. A terceira é a ponte: ela existe porque um agente que recebe
`avgPriceNative` sem saber que a venda não altera o preço médio tira conclusão
errada de um dado certo.

## Ao escrever para o agente

**Sem dado pessoal.** O repositório é público. A skill `carteira-mcp` já nomeou
as posições concretas do usuário uma vez e teve que ser corrigida — em vez de
listar ativos, mande consultar `portfolio_positions`, que é mais correto e não
envelhece.

**Explique o significado, não só o campo.** O valor da `carteira-mcp` está em
dizer por que retorno nativo e em reais contam histórias diferentes, por que
XIRR diverge do retorno simples com aporte mensal, e que cotação zero é fórmula
quebrada e não ativo que virou pó.

**Repasse as limitações declaradas.** IPCA+ sai subestimado e resgate parcial é
aproximado — o agente precisa saber para avisar quando for relevante, em vez de
apresentar o número como exato.

Se adicionar ou remover uma skill, atualize a lista `SKILLS` no `install.sh` —
ele tem pré-checagem e falha se o arquivo não existir, mas não descobre skill
nova sozinho.
