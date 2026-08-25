import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Só o domínio é testado automaticamente: ele é puro, sem I/O e sem rede.
    // O que fala com o Google Sheets é verificado por `npm run verify:sheet`.
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
