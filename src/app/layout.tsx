import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Carteira',
  description: 'Cadastro de operações da carteira, com o Google Sheets como fonte de verdade.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  )
}
