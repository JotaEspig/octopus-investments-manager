'use client'

import { useState } from 'react'
import { Button, Field, Select } from './form'

/**
 * Exportação.
 *
 * O download é feito por navegação normal (`window.location`), e não por
 * `fetch` + Blob: assim o navegador cuida do arquivo, o nome vem do
 * `Content-Disposition` do servidor, e um export grande não precisa caber na
 * memória da aba antes de virar arquivo.
 *
 * A consequência é que o resultado não passa por aqui — por isso o aviso do
 * que fazer se o download não começar, em vez de um spinner que nunca acaba.
 */

export interface ExportPanelProps {
  /** Abas disponíveis para CSV. Vazio enquanto o setup não terminou. */
  sheets: string[]
}

export function ExportPanel({ sheets }: ExportPanelProps) {
  const [sheet, setSheet] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  function download(url: string, what: string) {
    setMessage(`Baixando ${what}…`)
    window.location.href = url
    // O navegador não avisa quando o download começa. Em vez de fingir que
    // sabe, a mensagem some sozinha e diz onde olhar se nada aconteceu.
    setTimeout(() => setMessage(null), 6000)
  }

  const selected = sheet || sheets[0] || ''

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={() => download('/api/export', 'a planilha inteira')}>
          Exportar tudo (.json)
        </Button>
        <span className="text-sm text-ink-muted">
          Todas as abas, a carteira calculada e um checksum para conferir a integridade.
        </span>
      </div>

      {sheets.length > 0 ? (
        <div className="grid items-end gap-3 border-t border-border pt-4 sm:grid-cols-[1fr_auto]">
          <Field label="Uma aba em CSV" hint="Para abrir no Excel ou importar em outra ferramenta">
            <Select value={selected} onChange={(event) => setSheet(event.target.value)}>
              {sheets.map((title) => (
                <option key={title} value={title}>
                  {title}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              download(`/api/export?format=csv&sheet=${encodeURIComponent(selected)}`, selected)
            }
          >
            Baixar .csv
          </Button>
        </div>
      ) : null}

      {message ? <p className="text-sm text-ink-muted">{message}</p> : null}
    </div>
  )
}
