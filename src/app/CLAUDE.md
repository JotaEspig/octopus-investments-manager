# `src/app/` — interface e rotas de API

## A decisão que define esta pasta

**A interface NÃO tem dashboard, e isso é deliberado.** O painel é a planilha.
Duplicar gráfico e alocação aqui significaria manter dois lugares que calculam a
mesma coisa e divergem no arredondamento. O botão "Abrir planilha" resolve
melhor. Se pedirem um dashboard, questione antes de construir.

A interface é um **livro-caixa**: cadastrar operação, conferir o que entrou,
desfazer erro de digitação, exportar. Mais nada.

## Convenções das rotas

Toda rota que fala com o Sheets precisa de:

```ts
export const runtime = 'nodejs'      // googleapis não roda no edge
export const dynamic = 'force-dynamic'
```

Erro sempre volta por `errorResponse` (`@/lib/api`), que traduz o tipo em status
e mensagem acionável — 503 com `setup: true` quando é configuração, 422 com
`fields` quando é validação. Nunca deixe vazar "Internal Server Error" quando a
causa é um compartilhamento esquecido.

Validação com os schemas de `@/lib/schemas`, os MESMOS que o formulário usa: o
que a interface recusa, a rota também recusa. Uma chamada por curl não pode
gravar o que o form não deixaria.

## Convenções da interface

**Roda em `127.0.0.1`, sem autenticação.** É premissa, não descuido — a chave da
service account não sai do disco. Não adicione login sem antes rever essa
decisão.

**A moeda vem do ativo, nunca é campo solto.** Deixá-la separada só criaria a
chance de cadastrar compra de AAPL em reais. Pelo mesmo motivo o câmbio some
quando a operação já é em BRL.

**Desfazer é para erro de digitação**, não para registrar venda — para isso
existe o tipo `sell`. Por isso o botão só aparece nas operações recentes.

**Falha de peça secundária não derruba a tela.** A lista de abas do seletor de
CSV, por exemplo, falha em silêncio e apenas some — não vira erro de página.

Componentes ficam em `src/components/`. Sem biblioteca de UI: são cinco
controles no total, em `form.tsx`.
