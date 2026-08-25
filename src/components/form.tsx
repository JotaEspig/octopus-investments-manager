import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'

/** Primitivos de formulário. Sem biblioteca: são cinco controles no total. */

const CONTROL =
  'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink outline-none ' +
  'transition-colors focus:border-accent disabled:opacity-50'

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: ReactNode
  error?: string
  children: ReactNode
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-ink-muted">{label}</span>
      {children}
      {error ? (
        <span className="text-xs text-negative">{error}</span>
      ) : hint ? (
        <span className="text-xs text-ink-muted">{hint}</span>
      ) : null}
    </label>
  )
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props
  return <input {...rest} className={`${CONTROL} ${props.type === 'number' ? 'tabular' : ''} ${className ?? ''}`} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const { className, ...rest } = props
  return <select {...rest} className={`${CONTROL} ${className ?? ''}`} />
}

/** Grupo de rádios em pílulas — usado para o tipo da operação. */
export function RadioPills<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (next: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={
              'rounded-md border px-3.5 py-1.5 text-sm transition-colors ' +
              (active
                ? 'border-accent bg-accent text-accent-ink'
                : 'border-border text-ink-muted hover:text-ink')
            }
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export function Button({
  children,
  variant = 'primary',
  ...rest
}: InputHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost'; children: ReactNode }) {
  const styles =
    variant === 'primary'
      ? 'bg-accent text-accent-ink'
      : 'border border-border text-ink-muted hover:text-ink'
  return (
    <button
      {...(rest as object)}
      className={`rounded-md px-4 py-2 text-sm font-medium transition-opacity disabled:opacity-40 ${styles}`}
    >
      {children}
    </button>
  )
}
