'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ASSET_CLASSES,
  ASSET_CLASS_LABELS,
  TRADE_KIND_LABELS,
  type Asset,
  type AssetClass,
  type Currency,
  type TradeKind,
} from '@/domain/types'
import { today } from '@/lib/dates'
import { Button, Field, Input, RadioPills, Select } from './form'

/**
 * Formulário de operação.
 *
 * A moeda não é um campo: ela vem do ativo. Deixar o usuário escolher moeda
 * separado do ativo só cria a chance de cadastrar uma compra de AAPL em reais.
 * Pela mesma razão o câmbio some quando a operação é em BRL.
 *
 * Renda fixa ainda não aparece aqui — chega na Fase 3, com os campos próprios
 * (emissor, indexador, vencimento).
 */

const KINDS: TradeKind[] = ['buy', 'sell', 'dividend']

const NEW_ASSET = '__new__'

export interface TradeFormProps {
  assets: Asset[]
  onSubmitted: () => void
}

interface FormState {
  kind: TradeKind
  symbol: string
  date: string
  quantity: string
  unitPrice: string
  fees: string
  fxRate: string
  note: string
  newSymbol: string
  newName: string
  newClass: AssetClass
  newBroker: string
}

const INITIAL: FormState = {
  kind: 'buy',
  symbol: '',
  date: today(),
  quantity: '',
  unitPrice: '',
  fees: '0',
  fxRate: '',
  note: '',
  newSymbol: '',
  newName: '',
  newClass: 'us_etf',
  newBroker: 'Avenue',
}

/** Classes com cotação de mercado; renda fixa entra na Fase 3. */
const SELECTABLE_CLASSES = ASSET_CLASSES.filter((assetClass) => assetClass !== 'fixed_income')

const CURRENCY_OF_CLASS: Record<AssetClass, Currency> = {
  us_stock: 'USD',
  us_etf: 'USD',
  br_stock: 'BRL',
  br_fii: 'BRL',
  fixed_income: 'BRL',
}

export function TradeForm({ assets, onSubmitted }: TradeFormProps) {
  const [form, setForm] = useState<FormState>(INITIAL)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [fxBusy, setFxBusy] = useState(false)

  const creatingAsset = form.symbol === NEW_ASSET
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }))

  const currency: Currency = useMemo(() => {
    if (creatingAsset) return CURRENCY_OF_CLASS[form.newClass]
    return assets.find((asset) => asset.symbol === form.symbol)?.currency ?? 'BRL'
  }, [assets, creatingAsset, form.newClass, form.symbol])

  const needsFx = currency !== 'BRL'

  // A PTAX é buscada quando a data ou a moeda muda; o campo continua editável
  // porque a do próprio dia só sai à tarde e o câmbio da corretora não é a PTAX.
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

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setErrors({})
    setMessage(null)

    const symbol = creatingAsset ? form.newSymbol.toUpperCase() : form.symbol

    const payload = {
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

      // Preserva data e ativo: cadastrar várias operações seguidas é o caso comum.
      setForm((current) => ({
        ...INITIAL,
        date: current.date,
        symbol: creatingAsset ? symbol : current.symbol,
        fxRate: current.fxRate,
      }))
      setMessage(`${TRADE_KIND_LABELS[form.kind]} de ${symbol} registrada`)
      onSubmitted()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const priceLabel = form.kind === 'dividend' ? 'Valor por cota' : 'Preço unitário'
  const quantityLabel = form.kind === 'dividend' ? 'Cotas' : 'Quantidade'

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <RadioPills
        value={form.kind}
        onChange={(kind) => set('kind', kind)}
        options={KINDS.map((kind) => ({ value: kind, label: TRADE_KIND_LABELS[kind] }))}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Ativo" error={errors['trade.symbol']}>
          <Select value={form.symbol} onChange={(event) => set('symbol', event.target.value)} required>
            <option value="" disabled>
              Selecione…
            </option>
            {assets.map((asset) => (
              <option key={asset.symbol} value={asset.symbol}>
                {asset.symbol} — {asset.name}
              </option>
            ))}
            <option value={NEW_ASSET}>+ Cadastrar novo ativo</option>
          </Select>
        </Field>

        <Field label="Data" error={errors['trade.date']}>
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
          <Field label="Classe" hint={`Moeda: ${currency}`}>
            <Select
              value={form.newClass}
              onChange={(event) => set('newClass', event.target.value as AssetClass)}
            >
              {SELECTABLE_CLASSES.map((assetClass) => (
                <option key={assetClass} value={assetClass}>
                  {ASSET_CLASS_LABELS[assetClass]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Corretora">
            <Input value={form.newBroker} onChange={(event) => set('newBroker', event.target.value)} />
          </Field>
        </fieldset>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={quantityLabel} error={errors['trade.quantity']}>
          <Input
            type="number"
            step="any"
            min="0"
            value={form.quantity}
            onChange={(event) => set('quantity', event.target.value)}
            required
          />
        </Field>
        <Field label={`${priceLabel} (${currency})`} error={errors['trade.unitPrice']}>
          <Input
            type="number"
            step="any"
            min="0"
            value={form.unitPrice}
            onChange={(event) => set('unitPrice', event.target.value)}
            required
          />
        </Field>
        <Field label={`Taxas (${currency})`} hint="Corretagem e emolumentos">
          <Input
            type="number"
            step="any"
            min="0"
            value={form.fees}
            onChange={(event) => set('fees', event.target.value)}
          />
        </Field>
      </div>

      {needsFx ? (
        <div className="grid gap-4 sm:grid-cols-2">
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
          <Field label="Observação">
            <Input value={form.note} onChange={(event) => set('note', event.target.value)} />
          </Field>
        </div>
      ) : (
        <Field label="Observação">
          <Input value={form.note} onChange={(event) => set('note', event.target.value)} />
        </Field>
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
