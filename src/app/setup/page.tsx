'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, Shell } from '@/components/shell'
import type { BootstrapReport } from '@/sheets/bootstrap'
import type { Check, Diagnosis } from '@/sheets/diagnose'

const STATUS_MARK: Record<Check['status'], { icon: string; className: string }> = {
  ok: { icon: '✓', className: 'text-positive' },
  warn: { icon: '!', className: 'text-ink-muted' },
  error: { icon: '✗', className: 'text-negative' },
}

export default function SetupPage() {
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null)
  const [report, setReport] = useState<BootstrapReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const response = await fetch('/api/sheet')
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Falha ao consultar o setup')
      setDiagnosis(body as Diagnosis)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function install() {
    setBusy(true)
    setError(null)
    setReport(null)
    try {
      const response = await fetch('/api/sheet', { method: 'POST' })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Falha ao instalar')
      setReport(body as BootstrapReport)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const blocked = diagnosis?.checks.some((check) => check.status === 'error') ?? true

  return (
    <Shell title="Setup" spreadsheetUrl={diagnosis?.spreadsheetUrl}>
      <Card
        title="Diagnóstico"
        description="Os quatro passos do setup manual, na ordem em que costumam quebrar."
      >
        {diagnosis ? (
          <ul className="flex flex-col gap-2.5">
            {diagnosis.checks.map((check) => {
              const mark = STATUS_MARK[check.status]
              return (
                <li key={check.label} className="flex gap-3 text-sm">
                  <span className={`w-4 shrink-0 font-semibold ${mark.className}`}>{mark.icon}</span>
                  <span className="w-44 shrink-0 font-medium">{check.label}</span>
                  <span className="break-all text-ink-muted">{check.detail}</span>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">Consultando…</p>
        )}

        {diagnosis?.serviceAccountEmail ? (
          <p className="mt-4 border-t border-border pt-4 text-sm text-ink-muted">
            A planilha precisa estar compartilhada como <strong>Editor</strong> com{' '}
            <code className="break-all rounded bg-surface px-1.5 py-0.5">
              {diagnosis.serviceAccountEmail}
            </code>
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={install}
            disabled={busy || blocked}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity disabled:opacity-40"
          >
            {busy ? 'Instalando…' : diagnosis?.ready ? 'Reinstalar' : 'Instalar planilha'}
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-md border border-border px-4 py-2 text-sm transition-colors hover:text-ink"
          >
            Reverificar
          </button>
          <span className="text-sm text-ink-muted">
            Idempotente: não duplica abas nem apaga operações já cadastradas.
          </span>
        </div>
      </Card>

      {error ? (
        <Card title="Erro">
          <p className="text-sm text-negative">{error}</p>
        </Card>
      ) : null}

      {report ? (
        <Card title="O que foi feito">
          <ul className="flex flex-col gap-1.5 text-sm">
            {report.actions.map((action) => (
              <li key={action} className="flex gap-2">
                <span className="text-positive">✓</span>
                <span className="text-ink-muted">{action}</span>
              </li>
            ))}
            {report.warnings.map((warning) => (
              <li key={warning} className="flex gap-2">
                <span className="text-ink-muted">!</span>
                <span className="text-ink-muted">{warning}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </Shell>
  )
}
