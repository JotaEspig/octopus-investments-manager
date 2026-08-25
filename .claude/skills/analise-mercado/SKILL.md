---
name: analise-mercado
description: >-
  Base de conhecimento de ANÁLISE de mercado e de ativos — como avaliar um negócio (moat, qualidade,
  gestão), ler fundamentos (receita, margens, lucro, fluxo de caixa livre, dívida, ROE/ROIC),
  entender valuation (P/L, P/FCF, EV/EBITDA, dividend yield, DCF conceitual), avaliar ETFs (índice,
  expense ratio, liquidez, domicílio/tributação), ler o cenário macro (juros, inflação, câmbio,
  ciclo) e pesquisar dados atuais na web de forma crítica. Use ao analisar uma ação, ETF, setor ou
  o cenário macro específico antes de uma decisão.
when_to_use: >-
  Quando o usuário quiser avaliar um ativo específico (ação, ETF, setor), entender se um preço está
  caro ou barato, interpretar indicadores fundamentalistas, comparar empresas, avaliar o cenário
  macroeconômico (Selic, inflação, dólar), ou pesquisar e validar dados de mercado atuais.
  Complementa `estrategia-investimentos` (aquela é sobre a arquitetura da carteira; esta é sobre
  avaliar cada peça).
---

# Análise de Mercado e de Ativos

Método para avaliar **um ativo ou um cenário** com a lente de valor e longo prazo. Para montar a
carteira em si (alocação, diversificação), use `estrategia-investimentos`.

## Princípio central

> Uma ação é um pedaço de um **negócio**, não um bilhete de loteria. Analisar uma ação = analisar a
> empresa (qualidade + preço), não o gráfico. Preço é o que você paga; valor é o que você recebe.

## Buscar dados atuais (obrigatório para decisões)

Preços, múltiplos, resultados trimestrais, taxas (Selic/CDI), inflação e regras tributárias **mudam
constantemente**. Antes de afirmar que algo está caro/barato ou citar uma taxa:
1. Use **WebSearch/WebFetch** para obter o dado mais recente (cotação, último resultado, guidance).
2. **Cite a data e a fonte** do número.
3. Nunca apresente um preço/múltiplo de memória como se fosse atual.
4. Cruze mais de uma fonte para números importantes; desconfie de dados isolados.

## As quatro perguntas de qualidade de um negócio (Buffett)

1. **Entendo como ganha dinheiro?** (círculo de competência)
2. **Tem fosso competitivo durável (moat)?** Tipos: marca, efeito de rede, escala/custo, custo de
   troca, ativos regulatórios/patentes.
3. **A gestão é competente e alinhada?** Track record, honestidade nos relatórios, executivos donos
   de ações, alocação de capital racional (reinveste bem, recompra a preço bom, dívida sob controle).
4. **O preço é razoável?** Margem de segurança frente ao valor estimado.

## Fundamentos — o que olhar (e por quê)

| Métrica | O que diz | Sinal saudável |
|---------|-----------|----------------|
| **Receita** | Tamanho e crescimento do negócio | Crescimento consistente ao longo de anos |
| **Margem bruta/operacional/líquida** | Eficiência e poder de precificação | Estável ou em expansão |
| **Lucro líquido (EPS)** | Resultado ao acionista | Crescente e de qualidade (não só contábil) |
| **Fluxo de Caixa Livre (FCF)** | Caixa real após investir no negócio | Positivo, crescente, próximo do lucro |
| **ROE / ROIC** | Retorno sobre capital | Alto e consistente (ROIC > custo de capital) |
| **Dívida líquida / EBITDA** | Alavancagem | Baixa/gerenciável vs. geração de caixa |
| **Cobertura de juros** | Capacidade de pagar a dívida | Confortável |
| **Payout / dividend yield** | Quanto distribui | Sustentável, não maior que o FCF |

> Regra prática: **lucro sem caixa é suspeito.** Prefira empresas cujo lucro vira fluxo de caixa
> livre de verdade.

## Valuation — está caro ou barato?

Nenhum múltiplo isolado decide; compare com **o histórico da própria empresa**, com **os pares** e
com a **qualidade/crescimento** do negócio.

| Múltiplo | Uso | Cuidado |
|----------|-----|---------|
| **P/L (preço/lucro)** | Rápido, popular | Distorce com lucro volátil ou cíclico |
| **P/FCF (preço/fluxo de caixa livre)** | Mais robusto que P/L | Capex pode variar |
| **EV/EBITDA** | Neutraliza estrutura de capital | Ignora capex e impostos |
| **PEG (P/L ÷ crescimento)** | Ajusta P/L ao crescimento | Depende de projeção incerta |
| **Dividend yield** | Renda | Yield alto pode sinalizar problema/queda futura |
| **P/VP (preço/valor patrimonial)** | Bancos, seguradoras | Pouco útil para negócios "leves" de ativos |

**DCF (fluxo de caixa descontado), conceitualmente:** o valor de um negócio é a soma dos fluxos de
caixa futuros trazidos a valor presente. Você não precisa de uma planilha perfeita — precisa da
**intuição**: quanto de caixa esse negócio gera, quão previsível é, e a que taxa descontá-lo.
Empresa de qualidade e previsível justifica múltiplo maior; empresa cíclica/incerta exige margem de
segurança maior.

**Empresa boa ≠ ação boa.** A melhor empresa do mundo a um preço absurdo pode ser um péssimo
investimento; um negócio mediano muito descontado pode ser ótimo. Qualidade **e** preço.

## Avaliação de ETFs

| Critério | O que verificar |
|----------|-----------------|
| **Índice/estratégia** | O que replica (S&P 500, mundo, setor)? Faz o que você quer? |
| **Expense ratio** | Taxa anual — no núcleo, prefira < 0,10% |
| **Liquidez / patrimônio** | Volume e AUM altos → spreads menores, menos risco de fechamento |
| **Domicílio** | EUA (distribui dividendos, retenção de 30% p/ brasileiro) vs. Irlanda (acumulação) |
| **Método de replicação** | Física (detém os ativos) vs. sintética (derivativos) |
| **Sobreposição** | Já contém ativos que você tem? Evitar empilhar o mesmo risco |
| **Tracking error** | Quão fielmente segue o índice |

## Cenário macro — as alavancas que movem tudo

| Variável | Efeito principal |
|----------|------------------|
| **Juros (Selic/Fed)** | Sobe → RF fica atraente, desconta ações (sobretudo crescimento) e imóveis |
| **Inflação** | Corrói poder de compra; empresas com pricing power se protegem melhor |
| **Câmbio (dólar/real)** | Afeta exportadoras, importadoras e o valor em reais de ativos no exterior |
| **Ciclo econômico** | Expansão favorece cíclicas; recessão favorece defensivas |
| **Crédito/liquidez** | Dinheiro barato infla ativos; aperto os desvaloriza |

> Não se investe **por** previsão macro (ninguém acerta consistentemente), mas se **entende** o
> pano de fundo para dimensionar risco e não pagar caro em euforia.

## Sinais de alerta (red flags)

- Crescimento de receita sem geração de caixa; lucro que nunca vira FCF.
- Dívida crescendo mais rápido que o resultado.
- Diluição constante de acionistas (emissão de ações).
- Governança fraca, trocas frequentes de auditor/CFO, contabilidade agressiva.
- Yield de dividendo "bom demais" (mercado pode estar precificando corte).
- Tese que depende de um único produto/cliente/regulação.
- Hype narrativo sem fundamento financeiro ("é o futuro", sem números).

## Como entregar uma análise de ativo (formato sugerido)

```
ATIVO: ____  (data da análise e das cotações usadas)
1. O negócio em 3 linhas — o que faz, como ganha dinheiro
2. Moat — existe? qual? é durável?
3. Fundamentos — receita, margens, FCF, dívida, ROE/ROIC (com números atuais)
4. Valuation — múltiplos vs. histórico e pares; caro/justo/barato e por quê
5. Riscos — os 2–3 principais e o que invalidaria a tese
6. Papel na carteira — núcleo ou satélite? que % faz sentido?
7. Veredito — posição clara + condições que a mudariam
+ Aviso educacional (não é recomendação regulada pela CVM)
```

Sempre citar **data e fonte** dos números e separar **fato** (dado) de **opinião** (interpretação).
