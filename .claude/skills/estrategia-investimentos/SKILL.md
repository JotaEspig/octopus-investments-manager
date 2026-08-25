---
name: estrategia-investimentos
description: >-
  Base de conhecimento de ESTRATÉGIA de investimentos de longo prazo — alocação de ativos, modelo
  core-satélite, diversificação (classe, geografia, setor, fator, tempo), perfis de risco,
  rebalanceamento, renda fixa brasileira (CDB/Tesouro/FGC/tributação regressiva), ETFs, stock
  picking com checklist, reserva de emergência vs. oportunidade, tributação de investimentos no
  exterior e vieses comportamentais. Use ao discutir como montar/ajustar uma carteira, dividir
  aportes entre classes, avaliar uma estratégia ou tomar decisões de compra/venda/rebalanceamento.
when_to_use: >-
  Quando o usuário quiser desenhar ou revisar a alocação da carteira, decidir a divisão entre renda
  fixa/ETFs/ações, definir perfil de risco, planejar aportes, estruturar reserva de emergência e de
  oportunidade, criar regras de stock picking, entender tributação de renda fixa e do exterior, ou
  montar um plano de rebalanceamento. Complementa a skill `analise-mercado` (esta é sobre a
  arquitetura da carteira; a outra, sobre avaliar cada ativo).
---

# Estratégia de Investimentos — Arquitetura de Carteira

Método para transformar objetivos em uma carteira **executável e disciplinada**, na filosofia de
valor e longo prazo. Esta skill é a "arquitetura"; para avaliar um ativo específico, use
`analise-mercado`.

## A hierarquia das decisões (o que importa mais)

1. **Alocação de ativos** (RF × RV × geografia) — responde pela maior parte da variação de retorno.
2. **Comportamento e disciplina** — aportar sempre, não vender no pânico, rebalancear.
3. **Custos e impostos** — corroem retorno silenciosamente; sempre pensar no líquido.
4. **Seleção de ativos individuais** — importa, mas menos do que as três acima.

> Investidor iniciante gasta 90% da energia no item 4 (qual ação?) e 10% nos itens 1–3. O consultor
> inverte isso.

## Sequência-mãe (nunca fora de ordem)

```
0. Reserva de emergência (6–12 meses) em RF líquida  ← ANTES de qualquer risco
1. Quitar dívidas caras (juros > retorno esperado)   ← dívida cara vence qualquer investimento
2. Definir perfil e alocação-alvo (%)
3. Montar o núcleo (RF + ETFs amplos)
4. Adicionar satélite (stock picking) com tese e teto
5. Rebalancear periodicamente; aportar sempre
```

## Modelo Core-Satélite

```
NÚCLEO (70–85%): estável, barato, automático
  ├── Renda Fixa (CDB/Tesouro) — preserva capital, gera liquidez
  └── ETFs amplos (EUA/global) — captura o crescimento do mercado
SATÉLITE (15–30%): ativo, autoral, maior risco/retorno
  ├── Stock picking (teses de convicção, com regras)
  └── Reserva de oportunidade (caixa remunerado para quedas)
```

## Perfis de alocação (ponto de partida)

| Classe | Conservador | Moderado | Arrojado |
|--------|-------------|----------|----------|
| Renda Fixa | 60% | 40% | 25% |
| ETFs amplos | 30% | 40% | 45% |
| Stock picking | 7% | 15% | 25% |
| Reserva de oportunidade | 3% | 5% | 5% |

**Regra do estômago:** o % em renda variável não deve exceder a queda que a pessoa aguenta ver sem
vender. Se cairia 35% e venderia, a alocação em bolsa está alta demais *para ela*.

## Os cinco eixos de diversificação

1. **Classe de ativo** — RF × RV (o mais importante).
2. **Geografia/moeda** — Brasil (real) × EUA (dólar) × mundo.
3. **Setor** — tech, consumo, saúde, energia, financeiro...
4. **Fator** — crescimento × valor, grandes × pequenas.
5. **Tempo** — aportes mensais (dollar-cost averaging) diluem o risco de "comprar no topo".

**Armadilha da falsa diversificação:** comprar um ETF de tech por cima de ações de tech não
diversifica — empilha risco. Diversificar = puxar para eixos descorrelacionados.

## Renda fixa brasileira (essencial)

- **Reserva de emergência ≠ reserva de oportunidade.** Emergência: 6–12 meses, líquida, intocável,
  vem antes de tudo. Oportunidade: ~5–10%, munição remunerada para quedas.
- **CDB:** pós-fixado (% do CDI, surfa Selic alta), prefixado (trava taxa, aposta em queda de juros),
  híbrido (IPCA+, protege poder de compra).
- **FGC:** cobre R$ 250 mil por CPF por instituição (teto global R$ 1 mi / 4 anos). Não concentre
  além disso num banco. Tesouro Direto não tem FGC, mas tem garantia soberana.
- **IR regressivo:** 22,5% (até 180d) → 20% (até 360d) → 17,5% (até 720d) → **15% (>720d)**. IOF
  morde resgates com < 30 dias.
- **Isentos de IR:** LCI, LCA, CRI, CRA, debêntures incentivadas — comparar sempre no **líquido**.
- Com Selic alta (contexto de 2026: 14%), prefixados/IPCA+ longos permitem travar juros altos —
  mas só com dinheiro que não será resgatado antes do vencimento (marcação a mercado).

## ETFs (núcleo do exterior)

- Diversificação instantânea, custo baixo (expense ratio idealmente < 0,10% no núcleo), sem risco
  de escolher a ação errada.
- Montagem por níveis: **(1)** um único ETF mundial; **(2) recomendado:** ~70% S&P 500 + ~30%
  mundo ex-EUA; **(3)** mercado total EUA + desenvolvidos + emergentes + RF em dólar.
- **Atenção tributária:** dividendos de ativos americanos sofrem 30% de retenção na fonte para
  brasileiro (sem tratado). ETFs domiciliados nos EUA são distribuidores → priorizar **crescimento**
  sobre **alto dividendo** por eficiência tributária.

## Stock picking — disciplina do satélite

**Checklist antes de comprar:** entende o negócio? tem moat durável? finanças saudáveis (receita,
margem, FCF, dívida, ROE/ROIC)? gestão competente e alinhada? preço razoável? conhece os riscos e o
que invalidaria a tese?

**Regras de disciplina:**
- Teto de ~5% da carteira por posição (ou ~25–30% do satélite).
- 5–10 ações no satélite (não 30).
- Só compra com **tese escrita**; só vende por critério (tese quebrou, ficou caro demais, ou surgiu
  oportunidade claramente melhor).
- Zero alavancagem, opções especulativas ou day trade.

## Reserva de oportunidade

- ~5% em RF líquida remunerada. Não virar market timer com 30% em caixa esperando o crash perfeito.
- Definir **gatilhos escritos** (ex.: aporta metade a −15% do topo, o resto a −25%).
- Reabastecer com aportes seguintes após usar.

## Rebalanceamento

- A cada 6–12 meses, ou quando uma classe desviar ~5–10 pontos do alvo.
- **Preferir rebalancear com aportes novos** (direciona o dinheiro à classe defasada) — evita
  imposto e custo. Só vender para rebalancear quando o aporte não bastar.

## Custos e tributação do exterior (Brasil, contexto 2026)

- **IOF câmbio** (remessa para investimento): 1,1% → mitigar remetendo em **blocos** (2–3 meses).
- **Retenção de dividendos EUA:** 30% na fonte (sem tratado; compensável no BR até o limite).
- **IR ganho de capital exterior:** 15% (alíquota única, Lei 14.754/2023), apurado anualmente na
  DIRPF, sem isenção mensal. Declarar em "Bens e Direitos" pelo custo de aquisição em reais.
- Guardar comprovantes de toda remessa, compra, venda e dividendo. Tributação muda de ano para ano —
  **sempre confirmar as regras vigentes**.

## Vieses comportamentais a combater

| Viés | Sintoma | Antídoto |
|------|---------|----------|
| Pânico | Vender na queda | Regras escritas; aportar nas quedas |
| Euforia/FOMO | Comprar o ativo da moda no topo | Alocação-alvo; ceticismo com hype |
| Ancoragem | Fixar-se no preço que pagou | Reavaliar pela tese, não pelo preço de entrada |
| Recência | Achar que a tendência recente continua | Pensar em ciclos e história de mercado |
| Excesso de atividade | Coceira de "fazer algo" | Menos é mais; olhar a carteira menos vezes |
| Aversão à perda | Segurar perdedor, vender vencedor cedo | Decidir por tese; cortar tese quebrada |

## Erros clássicos (o "não faça")

Investir no exterior sem reserva de emergência · confundir emergência com oportunidade · remeter
pouco e toda hora (IOF/câmbio) · perseguir moda · empilhar risco correlacionado · vender no pânico ·
alavancagem para "acelerar" · ignorar imposto na venda · não declarar ativos no exterior · parar de
aportar quando cai.

## Como aplicar esta skill numa conversa

1. Identifique **em que etapa** da sequência-mãe o usuário está.
2. Confirme reserva de emergência e perfil antes de falar de alocação de risco.
3. Proponha **alocação-alvo em %** e traduza em **valores** do aporte real dele.
4. Aponte custos/tributos que mudam a decisão.
5. Termine com **regras escritas** (alvos, teto, cadência, gatilhos) e um próximo passo concreto.
