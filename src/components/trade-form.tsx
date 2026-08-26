'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ASSET_CLASSES,
  ASSET_CLASS_LABELS,
  FIXED_INCOME_INDEXER_LABELS,
  FIXED_INCOME_INDEXERS,
  TRADE_KIND_LABELS,
  type Asset,
  type AssetClass,
  type Currency,
  type FixedIncomeIndexer,
  type TradeKind,
} from '@/domain/types'
import { today } from '@/lib/dates'
import { Button, Field, Input, RadioPills, Select } from './form'

/**
 * Formulário de operação.
 *
 * Duas naturezas na mesma tela, porque para você é o mesmo gesto ("registrei
 * um aporte"), ainda que os campos mudem:
 *
 * - RENDA VARIÁVEL — quantidade × preço, na moeda do ativo.
 * - RENDA FIXA — um valor em reais. Sem cotação, sem quantidade: o que se
 *   informa é quanto entrou. Nos bastidores isso vira `quantidade = reais` e
 *   `preço = 1`, e é por isso que o mesmo cálculo de custo médio serve para as
 *   duas (ver src/domain/positions.ts).
 *
 * A moeda nunca é um campo: vem do ativo. Deixá-la solta só criaria a chance de
 * cadastrar uma compra de AAPL em reais. Pelo mesmo motivo o câmbio some quando
 * a operação já é em BRL.
 */

const NEW_ASSET = '__new_asset__'
const NEW_CONTRACT = '__new_contract__'

/** Classes com cotação de mercado. Renda fixa tem o seu próprio caminho. */
const MARKET_CLASSES = ASSET_CLASSES.filter((assetClass) => assetClass !== 'fixed_income')

const CURRENCY_OF_CLASS: Record<AssetClass, Currency> = {
  us_stock: 'USD',
  us_etf: 'USD',
  br_stock: 'BRL',
  br_fii: 'BRL',
  fixed_income: 'BRL',
}

/** Rótulos que fazem sentido para cada natureza. */
const MARKET_KINDS: TradeKind[] = ['buy', 'sell', 'dividend']
const FIXED_INCOME_KINDS: TradeKind[] = ['buy', 'sell', 'interest']
const FIXED_INCOME_KIND_LABELS: Partial<Record<TradeKind, string>> = {
  buy: 'Aplicação',
  sell: 'Resgate',
  interest: 'Juros',
}

export interface ContractOption {
  symbol: string
  name: string
  issuer: string
}

export interface TradeFormProps {
  assets: Asset[]
  contracts: ContractOption[]
  onSubmitted: () => void
}

interface FormState {
  kind: TradeKind
  symbol: string
  date: string
  quantity: string
  unitPrice: string
  amount: string
  fees: string
  fxRate: string
  note: string
  newSymbol: string
  newName: string
  /**
   * Vazio até o usuário escolher. Nada de classe pré-selecionada: um padrão
   * silencioso vira ativo cadastrado na classe errada, e classe errada
   * desloca a alocação inteira sem ninguém notar.
   */
  newClass: AssetClass | ''
  newBroker: string
  contractSymbol: string
  contractName: string
  contractIssuer: string
  contractIndexer: FixedIncomeIndexer
  /** Em PERCENTUAL, como se fala: 110 (% do CDI) ou 13,5 (% a.a.). */
  contractRate: string
  contractMaturity: string
  contractLiquidity: boolean
  contractFgc: boolean
}

const INITIAL: FormState = {
  kind: 'buy',
  symbol: '',
  date: today(),
  quantity: '',
  unitPrice: '',
  amount: '',
  fees: '0',
  fxRate: '',
  note: '',
  newSymbol: '',
  newName: '',
  newClass: '',
  newBroker: '',
  contractSymbol: '',
  contractName: '',
  contractIssuer: '',
  contractIndexer: 'cdi',
  contractRate: '',
  contractMaturity: '',
  contractLiquidity: false,
  contractFgc: true,
}

/** `CDB Banco XP 2028` → `RF-CDB-BANCO-XP-2028`, sem acento. */
function slugify(name: string): string {
  const ascii = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const slug = ascii
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return slug ? `RF-${slug}`.slice(0, 40) : ''
}

export function TradeForm({ assets, contracts, onSubmitted }: TradeFormProps) {
  const [form, setForm] = useState<FormState>(INITIAL)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [fxBusy, setFxBusy] = useState(false)

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }))

  const creatingAsset = form.symbol === NEW_ASSET
  const creatingContract = form.symbol === NEW_CONTRACT
  const knownContract = contracts.some((contract) => contract.symbol === form.symbol)
  const isFixedIncome = creatingContract || knownContract

  /**
   * `null` enquanto não dá para saber — ativo não escolhido, ou classe do
   * ativo novo ainda em branco. Chutar BRL aqui rotularia os campos com uma
   * moeda que o usuário não escolheu, que é o tipo de palpite que faz alguém
   * cadastrar compra em dólar como se fosse em real.
   */
  const currency: Currency | null = useMemo(() => {
    if (isFixedIncome) return 'BRL'
    if (creatingAsset) return form.newClass ? CURRENCY_OF_CLASS[form.newClass] : null
    return assets.find((asset) => asset.symbol === form.symbol)?.currency ?? null
  }, [assets, creatingAsset, form.newClass, form.symbol, isFixedIncome])

  const needsFx = currency === 'USD'

  /** Sufixo de moeda nos rótulos. Some enquanto a moeda é desconhecida. */
  const currencyLabel = currency ? ` (${currency})` : ''
  const kinds = isFixedIncome ? FIXED_INCOME_KINDS : MARKET_KINDS
  const kindLabel = (kind: TradeKind) =>
    (isFixedIncome ? FIXED_INCOME_KIND_LABELS[kind] : undefined) ?? TRADE_KIND_LABELS[kind]

  // Trocar de natureza pode deixar um tipo inválido selecionado.
  useEffect(() => {
    if (!kinds.includes(form.kind)) set('kind', 'buy')
  }, [form.kind, kinds])

  // PTAX buscada ao mudar data ou moeda; o campo segue editável porque a do
  // próprio dia só sai à tarde e o câmbio da corretora não é a PTAX.
  useEffect(() => {
    if (!needsFx) {
      set('fxRate', '1')
      return
    }
    let cancelled = false
    setFxBusy(true)
    fetch(`/api/fx?date=${form.date}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { rate?: number } | null) => {
        if (!cancelled && body?.rate) set('fxRate', String(body.rate))
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setFxBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [form.date, needsFx])

  function buildPayload() {
    if (isFixedIncome) {
      const symbol = creatingContract
        ? form.contractSymbol || slugify(form.contractName)
        : form.symbol
      return {
        trade: {
          date: form.date,
          kind: form.kind,
          symbol,
          // Renda fixa: o valor em reais VIRA a quantidade, com preço 1.
          quantity: Number(form.amount),
          unitPrice: 1,
          currency: 'BRL' as Currency,
          fees: Number(form.fees || 0),
          fxRate: 1,
          note: form.note,
        },
        ...(creatingContract
          ? {
              newContract: {
                symbol,
                name: form.contractName,
                issuer: form.contractIssuer,
                indexer: form.contractIndexer,
                // O campo é preenchido em percentual; guardamos fração.
                rate: Number(form.contractRate) / 100,
                issueDate: form.date,
                maturity: form.contractMaturity,
                dailyLiquidity: form.contractLiquidity,
                fgc: form.contractFgc,
              },
            }
          : {}),
      }
    }

    const symbol = creatingAsset ? form.newSymbol.toUpperCase() : form.symbol
    return {
      trade: {
        date: form.date,
        kind: form.kind,
        symbol,
        quantity: Number(form.quantity),
        unitPrice: Number(form.unitPrice),
        currency,
        fees: Number(form.fees || 0),
        fxRate: needsFx ? Number(form.fxRate) : 1,
        note: form.note,
      },
      ...(creatingAsset
        ? {
            newAsset: {
              symbol,
              name: form.newName,
              assetClass: form.newClass,
              currency,
              broker: form.newBroker,
            },
          }
        : {}),
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setErrors({})
    setMessage(null)

    const payload = buildPayload()

    try {
      const response = await fetch('/api/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await response.json()

      if (!response.ok) {
        setErrors(body.fields ?? {})
        setMessage(body.error ?? 'Não foi possível registrar')
        return
      }

      // Preserva data e ativo: cadastrar várias operações seguidas é o comum.
      setForm((current) => ({
        ...INITIAL,
        date: current.date,
        symbol: payload.trade.symbol,
        fxRate: current.fxRate,
      }))
      setMessage(`${kindLabel(form.kind)} de ${payload.trade.symbol} registrada`)
      onSubmitted()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const rateHint =
    form.contractIndexer === 'cdi'
      ? 'Em % do CDI: 110 para 110% do CDI'
      : form.contractIndexer === 'prefixed'
        ? 'Taxa anual: 13,5 para 13,5% a.a.'
        : 'Cupom real anual: 6 para IPCA + 6% a.a.'

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <RadioPills
        value={form.kind}
        onChange={(kind) => set('kind', kind)}
        options={kinds.map((kind) => ({ value: kind, label: kindLabel(kind) }))}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Ativo" error={errors['trade.symbol']}>
          <Select value={form.symbol} onChange={(event) => set('symbol', event.target.value)} required>
            <option value="" disabled>
              Selecione…
            </option>
            {assets.length > 0 ? (
              <optgroup label="Renda variável">
                {assets.map((asset) => (
                  <option key={asset.symbol} value={asset.symbol}>
                    {asset.symbol} — {asset.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {contracts.length > 0 ? (
              <optgroup label="Renda fixa">
                {contracts.map((contract) => (
                  <option key={contract.symbol} value={contract.symbol}>
                    {contract.name} — {contract.issuer}
                  </option>
                ))}
              </optgroup>
            ) : null}
            <optgroup label="Cadastrar">
              <option value={NEW_ASSET}>+ Novo ativo (ação, ETF, FII)</option>
              <option value={NEW_CONTRACT}>+ Novo papel de renda fixa</option>
            </optgroup>
          </Select>
        </Field>

        <Field label={isFixedIncome && form.kind === 'buy' ? 'Data da aplicação' : 'Data'} error={errors['trade.date']}>
          <Input
            type="date"
            value={form.date}
            onChange={(event) => set('date', event.target.value)}
            required
          />
        </Field>
      </div>

      {creatingAsset ? (
        <fieldset className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-2">
          <legend className="px-1.5 text-xs font-medium text-ink-muted">Novo ativo</legend>
          <Field label="Ticker" hint="Como aparece na bolsa: AAPL, VOO, PETR4" error={errors['newAsset.symbol']}>
            <Input
              value={form.newSymbol}
              onChange={(event) => set('newSymbol', event.target.value.toUpperCase())}
              placeholder="VOO"
              required
            />
          </Field>
          <Field label="Nome" error={errors['newAsset.name']}>
            <Input
              value={form.newName}
              onChange={(event) => set('newName', event.target.value)}
              placeholder="Vanguard S&P 500 ETF"
              required
            />
          </Field>
          <Field
            label="Classe"
            hint={currency ? `Moeda: ${currency}` : 'Define a moeda do ativo'}
            error={errors['newAsset.assetClass']}
          >
            <Select
              value={form.newClass}
              onChange={(event) => set('newClass', event.target.value as AssetClass | '')}
              required
            >
              <option value="" disabled>
                Selecione…
              </option>
              {MARKET_CLASSES.map((assetClass) => (
                <option key={assetClass} value={assetClass}>
                  {ASSET_CLASS_LABELS[assetClass]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Corretora" error={errors['newAsset.broker']}>
            <Input
              value={form.newBroker}
              onChange={(event) => set('newBroker', event.target.value)}
              placeholder="Onde o ativo está custodiado"
              required
            />
          </Field>
        </fieldset>
      ) : null}

      {creatingContract ? (
        <fieldset className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-2">
          <legend className="px-1.5 text-xs font-medium text-ink-muted">Novo papel de renda fixa</legend>
          <Field label="Nome" error={errors['newContract.name']}>
            <Input
              value={form.contractName}
              onChange={(event) => {
                set('contractName', event.target.value)
                if (!form.contractSymbol) set('contractSymbol', slugify(event.target.value))
              }}
              placeholder="CDB Banco XP 2028"
              required
            />
          </Field>
          <Field label="Emissor" error={errors['newContract.issuer']}>
            <Input
              value={form.contractIssuer}
              onChange={(event) => set('contractIssuer', event.target.value)}
              placeholder="Banco XP"
              required
            />
          </Field>
          <Field label="Indexador">
            <Select
              value={form.contractIndexer}
              onChange={(event) => set('contractIndexer', event.target.value as FixedIncomeIndexer)}
            >
              {FIXED_INCOME_INDEXERS.map((indexer) => (
                <option key={indexer} value={indexer}>
                  {FIXED_INCOME_INDEXER_LABELS[indexer]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Taxa" hint={rateHint} error={errors['newContract.rate']}>
            <Input
              type="number"
              step="any"
              min="0"
              value={form.contractRate}
              onChange={(event) => set('contractRate', event.target.value)}
              placeholder={form.contractIndexer === 'cdi' ? '110' : '13,5'}
              required
            />
          </Field>
          <Field label="Vencimento" error={errors['newContract.maturity']}>
            <Input
              type="date"
              value={form.contractMaturity}
              onChange={(event) => set('contractMaturity', event.target.value)}
              required
            />
          </Field>
          <Field label="Identificador" hint="Chave na planilha. Gerado a partir do nome.">
            <Input
              value={form.contractSymbol}
              onChange={(event) => set('contractSymbol', event.target.value.toUpperCase())}
            />
          </Field>
          <div className="flex items-center gap-5 sm:col-span-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.contractLiquidity}
                onChange={(event) => set('contractLiquidity', event.target.checked)}
              />
              Liquidez diária
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.contractFgc}
                onChange={(event) => set('contractFgc', event.target.checked)}
              />
              Coberto pelo FGC
            </label>
          </div>
        </fieldset>
      ) : null}

      {isFixedIncome ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label={form.kind === 'sell' ? 'Valor resgatado (R$)' : 'Valor (R$)'}
            error={errors['trade.quantity']}
          >
            <Input
              type="number"
              step="any"
              min="0"
              value={form.amount}
              onChange={(event) => set('amount', event.target.value)}
              placeholder="1000,00"
              required
            />
          </Field>
          <Field label="Taxas (R$)" hint="Custódia, se houver">
            <Input
              type="number"
              step="any"
              min="0"
              value={form.fees}
              onChange={(event) => set('fees', event.target.value)}
            />
          </Field>
          <Field label="Observação">
            <Input value={form.note} onChange={(event) => set('note', event.target.value)} />
          </Field>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label={form.kind === 'dividend' ? 'Cotas' : 'Quantidade'}
              error={errors['trade.quantity']}
            >
              <Input
                type="number"
                step="any"
                min="0"
                value={form.quantity}
                onChange={(event) => set('quantity', event.target.value)}
                required
              />
            </Field>
            <Field
              label={`${form.kind === 'dividend' ? 'Valor por cota' : 'Preço unitário'}${currencyLabel}`}
              error={errors['trade.unitPrice']}
            >
              <Input
                type="number"
                step="any"
                min="0"
                value={form.unitPrice}
                onChange={(event) => set('unitPrice', event.target.value)}
                required
              />
            </Field>
            <Field label={`Taxas${currencyLabel}`} hint="Corretagem e emolumentos">
              <Input
                type="number"
                step="any"
                min="0"
                value={form.fees}
                onChange={(event) => set('fees', event.target.value)}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {needsFx ? (
              <Field
                label="Câmbio USD/BRL"
                hint={fxBusy ? 'Buscando PTAX…' : 'PTAX de venda do dia. Ajuste se usou outro câmbio.'}
                error={errors['trade.fxRate']}
              >
                <Input
                  type="number"
                  step="any"
                  min="0"
                  value={form.fxRate}
                  onChange={(event) => set('fxRate', event.target.value)}
                  required
                />
              </Field>
            ) : null}
            <Field label="Observação">
              <Input value={form.note} onChange={(event) => set('note', event.target.value)} />
            </Field>
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? 'Registrando…' : 'Registrar'}
        </Button>
        {message ? <span className="text-sm text-ink-muted">{message}</span> : null}
      </div>
    </form>
  )
}
