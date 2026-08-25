import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // `googleapis` é pesado e depende de APIs do Node — deixá-lo fora do bundle
  // evita que o Next tente empacotá-lo nas rotas de API.
  serverExternalPackages: ['googleapis'],
}

export default nextConfig
