import Link from 'next/link'
import type { ReactNode } from 'react'

/**
 * Casca compartilhada das duas páginas. A interface é deliberadamente pequena —
 * o painel é a planilha, aqui só se cadastra e se confere.
 */

export function Shell({
  title,
  spreadsheetUrl,
  action,
  children,
}: {
  title: string
  spreadsheetUrl?: string | null
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 px-5 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <nav className="flex items-center gap-2 text-sm">
          {action}
          {spreadsheetUrl ? (
            <a
              className="rounded-md border border-border px-3 py-1.5 text-ink-muted transition-colors hover:text-ink"
              href={spreadsheetUrl}
              target="_blank"
              rel="noreferrer"
            >
              Abrir planilha ↗
            </a>
          ) : null}
          <Link
            className="rounded-md border border-border px-3 py-1.5 text-ink-muted transition-colors hover:text-ink"
            href="/setup"
          >
            Setup
          </Link>
        </nav>
      </header>
      <main className="flex flex-col gap-6">{children}</main>
    </div>
  )
}

export function Card({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface-raised p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      {description ? <p className="mt-1 text-sm text-ink-muted">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  )
}
