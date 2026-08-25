import { Card, Shell } from '@/components/shell'

// Substituída na Fase 2 pelo livro-caixa (formulário de operação + extrato).
export default function HomePage() {
  return (
    <Shell title="Carteira">
      <Card title="Em construção" description="O cadastro de operações chega na próxima fase.">
        <p className="text-sm text-ink-muted">
          Por enquanto, use <strong>Setup</strong> para instalar a estrutura da planilha.
        </p>
      </Card>
    </Shell>
  )
}
