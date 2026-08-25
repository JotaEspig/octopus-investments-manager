import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // O vitest não lê os `paths` do tsconfig — o alias precisa ser repetido aqui.
  resolve: {
    alias: { '@': resolve(import.meta.dirname, 'src') },
  },
  test: {
    // Só o domínio é testado automaticamente: ele é puro, sem I/O e sem rede.
    // O que fala com o Google Sheets é verificado por `npm run verify:sheet`.
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
