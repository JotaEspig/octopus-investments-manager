import { describe, expect, it } from 'vitest'
import { appsScriptHealth } from './diagnose'

/**
 * O Apps Script parar é a falha mais silenciosa do projeto: a planilha continua
 * ali, bonita, com números que parecem certos — só velhos. O Google desativa
 * gatilhos após falhas repetidas e avisa por um e-mail fácil de não ver.
 *
 * Este é o único lugar onde essa falha vira visível.
 */

const AGORA = new Date('2026-08-25T21:00:00Z')
const dias = (n: number) => new Date(AGORA.getTime() - n * 86_400_000).toISOString()

describe('appsScriptHealth', () => {
  it('distingue "nunca rodou" de "parou" — a ação é diferente', () => {
    // Nunca rodou = setup incompleto, a saída é colar o Code.gs.
    const nunca = appsScriptHealth(null, AGORA)
    expect(nunca.status).toBe('warn')
    expect(nunca.detail).toContain('Code.gs')
    expect(nunca.daysAgo).toBeNull()

    // Parou = gatilho quebrado, a saída é reativar pelo menu.
    const parou = appsScriptHealth(dias(10), AGORA)
    expect(parou.status).toBe('warn')
    expect(parou.detail).toContain('10 dias')
    expect(parou.detail).toContain('reative')
  })

  it('trata vazio como nunca rodou', () => {
    // É o que a planilha traz na chave recém-criada pelo instalador.
    expect(appsScriptHealth('', AGORA).daysAgo).toBeNull()
    expect(appsScriptHealth('   ', AGORA).status).toBe('warn')
  })

  it('aceita folga de dois dias antes de reclamar', () => {
    // Uma falha isolada do BCB não pode virar alarme: o gatilho se recupera
    // sozinho na próxima execução, porque o fetch do CDI é incremental.
    expect(appsScriptHealth(dias(0), AGORA).status).toBe('ok')
    expect(appsScriptHealth(dias(1), AGORA).status).toBe('ok')
    expect(appsScriptHealth(dias(2), AGORA).status).toBe('ok')
    expect(appsScriptHealth(dias(3), AGORA).status).toBe('warn')
  })

  it('diz "hoje" quando rodou hoje', () => {
    expect(appsScriptHealth(dias(0), AGORA).detail).toContain('hoje')
  })

  it('não quebra com carimbo ilegível', () => {
    // A célula é editável à mão; alguém pode digitar qualquer coisa ali.
    const lixo = appsScriptHealth('ontem de tarde', AGORA)
    expect(lixo.status).toBe('warn')
    expect(lixo.detail).toContain('ilegível')
    expect(lixo.daysAgo).toBeNull()
  })

  it('carimbo no futuro não vira número negativo de dias', () => {
    // Acontece se o relógio da máquina estiver adiantado em relação ao Google.
    const futuro = appsScriptHealth(dias(-1), AGORA)
    expect(futuro.status).toBe('ok')
    expect(futuro.daysAgo).toBeLessThanOrEqual(0)
  })
})
