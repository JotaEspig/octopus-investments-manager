'use client'

import { useCallback, useEffect, useState } from 'react'
import { ExportPanel } from '@/components/export-panel'
import { Card, Shell } from '@/components/shell'
import { TradeForm, type ContractOption } from '@/components/trade-form'
import { TRADE_KIND_LABELS, type Asset, type Trade } from '@/domain/types'

/**
 * Livro-caixa: cadastrar e conferir.
 *
 * Não há dashboard aqui de propósito — o painel é a planilha. Duplicar os
 * gráficos significaria manter dois lugares que calculam a mesma coisa e
 * divergem no arredondamento; o botão "Abrir planilha" resolve melhor.
 */

interface AssetsResponse {
  assets: Asset[]
  contracts: ContractOption[]
  spreadsheetUrl: string
}

export default function HomePage() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [contracts, setContracts] = useState<ContractOption[]>([])
  const [trades, setTrades] = useState<Trade[]>([])
  const [spreadsheetUrl, setSpreadsheetUrl] = useState<string | null>(null)
  const [exportableSheets, setExportableSheets] = useState<string[]>([])
  const [setupNeeded, setSetupNeeded] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const [assetsResponse, tradesResponse] = await Promise.all([
        fetch('/api/assets'),
        fetch('/api/trades'),
      ])

      const assetsBody = await assetsResponse.json()
      if (!assetsResponse.ok) {
        setSetupNeeded(assetsBody.error ?? 'Falha ao ler a planilha')
        return
      }

      const body = assetsBody as AssetsResponse
      setAssets(body.assets)
      setContracts(body.contracts)
      setSpreadsheetUrl(body.spreadsheetUrl)
      setSetupNeeded(null)

      if (tradesResponse.ok) {
        const body = (await tradesResponse.json()) as { trades: Trade[] }
        setTrades(body.trades)
      }

      // A lista de abas vem da planilha, não do schema — e falhar aqui não
      // pode derrubar a tela: sem ela, só some o seletor de CSV.
      try {
        const response = await fetch('/api/export?format=list')
        if (response.ok) {
          const body = (await response.json()) as { sheets: string[] }
          setExportableSheets(body.sheets)
        }
      } catch {
        setExportableSheets([])
      }
    } catch (error) {
      setSetupNeeded(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function undo(id: string) {
    if (!confirm('Apagar esta operação da planilha?')) return
    await fetch(`/api/trades/${encodeURIComponent(id)}`, { method: 'DELETE' })
    await refresh()
  }

  if (setupNeeded) {
    return (
      <Shell title="Carteira">
        <Card title="Setup incompleto">
          <p className="text-sm text-negative">{setupNeeded}</p>
          <p className="mt-3 text-sm text-ink-muted">
            Abra <strong>Setup</strong> para ver o diagnóstico passo a passo.
          </p>
        </Card>
      </Shell>
    )
  }

  return (
    <Shell title="Carteira" spreadsheetUrl={spreadsheetUrl}>
      <Card title="Nova operação">
        {loading ? (
          <p className="text-sm text-ink-muted">Carregando…</p>
        ) : (
          <TradeForm assets={assets} contracts={contracts} onSubmitted={() => void refresh()} />
        )}
      </Card>

      <Card
        title="Últimas operações"
        description="Confira o que acabou de entrar. Desfazer apaga a linha da planilha — é para erro de digitação, não para registrar venda."
      >
        {trades.length === 0 ? (
          <p className="text-sm text-ink-muted">Nenhuma operação cadastrada ainda.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {trades.map((trade) => (
              <li key={trade.id} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5">
                  <span className="tabular text-ink-muted">
                    {trade.date.slice(8, 10)}/{trade.date.slice(5, 7)}
                  </span>
                  <span>{TRADE_KIND_LABELS[trade.kind]}</span>
                  <strong>{trade.symbol}</strong>
                  <span className="tabular text-ink-muted">
                    {trade.quantity} × {formatMoney(trade.unitPrice, trade.currency)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void undo(trade.id)}
                  className="shrink-0 text-xs text-ink-muted transition-colors hover:text-negative"
                >
                  desfazer
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="Exportar"
        description="Um arquivo com o que a planilha tem hoje — cabeçalho real, nada inventado. Serve de backup fora do Google e de porta de saída para outra ferramenta."
      >
        <ExportPanel sheets={exportableSheets} />
      </Card>
    </Shell>
  )
}

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(value)
}
