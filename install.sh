#!/usr/bin/env bash
#
# install.sh — instala o consultor de investimentos globalmente no Claude Code:
# o agente `consultor-investimentos`, três skills (estratégia, análise de mercado e a nova
# `carteira-mcp`) e o servidor MCP `carteira`, que dá ao agente acesso somente-leitura aos
# números reais da carteira.
#
# Depois disto, o agente funciona de QUALQUER diretório — a configuração de acesso à planilha
# fica em ~/.config/carteira/config.json, não no .env.local do projeto, justamente porque o
# servidor MCP é lançado de fora daqui.
#
# Uso:
#   ./install.sh              # instala/atualiza
#   ./install.sh --uninstall  # remove agente, skills, servidor MCP e configuração
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

CLAUDE_DIR="${HOME}/.claude"
AGENTS_DIR="${CLAUDE_DIR}/agents"
SKILLS_DIR="${CLAUDE_DIR}/skills"
CONFIG_DIR="${XDG_CONFIG_HOME:-${HOME}/.config}/carteira"
CONFIG_FILE="${CONFIG_DIR}/config.json"

SKILLS=(estrategia-investimentos analise-mercado carteira-mcp)
AGENTS=(consultor-investimentos)
MCP_NAME=carteira

TSX="${REPO_DIR}/node_modules/.bin/tsx"
MCP_ENTRY="${REPO_DIR}/mcp/server.ts"

# ---- uninstall -------------------------------------------------------------
if [[ "${1:-}" == "--uninstall" ]]; then
  for a in "${AGENTS[@]}"; do
    rm -f "${AGENTS_DIR}/${a}.md" && echo "✓ Removido: ${AGENTS_DIR}/${a}.md"
  done
  for s in "${SKILLS[@]}"; do
    rm -rf "${SKILLS_DIR}/${s}" && echo "✓ Removido: ${SKILLS_DIR}/${s}"
  done
  if command -v claude >/dev/null 2>&1; then
    claude mcp remove "${MCP_NAME}" -s user >/dev/null 2>&1 && echo "✓ Servidor MCP removido: ${MCP_NAME}" || true
  fi
  rm -rf "${CONFIG_DIR}" && echo "✓ Removido: ${CONFIG_DIR}"
  echo
  echo "Desinstalado. A PLANILHA NÃO FOI TOCADA — seus dados continuam lá."
  echo "Reinicie o Claude Code para atualizar a lista de skills e agentes."
  exit 0
fi

# ---- pré-checagens ---------------------------------------------------------
for a in "${AGENTS[@]}"; do
  [[ -f "${REPO_DIR}/.claude/agents/${a}.md" ]] \
    || { echo "ERRO: agente não encontrado: ${a}.md" >&2; exit 1; }
done
for s in "${SKILLS[@]}"; do
  [[ -f "${REPO_DIR}/.claude/skills/${s}/SKILL.md" ]] \
    || { echo "ERRO: skill inválida — SKILL.md não encontrado em ${s}" >&2; exit 1; }
done
[[ -f "${MCP_ENTRY}" ]] || { echo "ERRO: servidor MCP não encontrado em ${MCP_ENTRY}" >&2; exit 1; }
[[ -x "${TSX}" ]] || { echo "ERRO: dependências não instaladas. Rode 'npm install' antes." >&2; exit 1; }

mkdir -p "${AGENTS_DIR}" "${SKILLS_DIR}" "${CONFIG_DIR}"

# ===========================================================================
# 1. Skills
# ===========================================================================
for s in "${SKILLS[@]}"; do
  rm -rf "${SKILLS_DIR:?}/${s}"
  cp -R "${REPO_DIR}/.claude/skills/${s}" "${SKILLS_DIR}/${s}"
  echo "✓ Skill instalada em ${SKILLS_DIR}/${s}"
done

# ===========================================================================
# 2. Agente
# ===========================================================================
for a in "${AGENTS[@]}"; do
  cp "${REPO_DIR}/.claude/agents/${a}.md" "${AGENTS_DIR}/${a}.md"
  echo "✓ Agente instalado em ${AGENTS_DIR}/${a}.md"
done

# ===========================================================================
# 3. Configuração de acesso à planilha
#
# O servidor MCP é lançado pelo Claude Code de qualquer diretório e não enxerga
# o .env.local do projeto — por isso a configuração é copiada para um caminho
# absoluto e estável. A CHAVE em si não é copiada: o arquivo guarda o caminho
# dela, e ela continua onde está.
# ===========================================================================
ENV_FILE="${REPO_DIR}/.env.local"

if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  SPREADSHEET_ID="$(grep -E '^CARTEIRA_SPREADSHEET_ID=' "${ENV_FILE}" | tail -1 | cut -d= -f2- | tr -d '"'"'"' ')"
  KEY_PATH="$(grep -E '^CARTEIRA_SERVICE_ACCOUNT_PATH=' "${ENV_FILE}" | tail -1 | cut -d= -f2- | tr -d '"'"'"' ')"
  KEY_PATH="${KEY_PATH:-./secrets/service-account.json}"

  # Relativo ao repositório vira absoluto: o MCP roda de outro diretório.
  if [[ "${KEY_PATH}" != /* ]]; then
    KEY_PATH="${REPO_DIR}/${KEY_PATH#./}"
  fi

  if [[ -n "${SPREADSHEET_ID}" ]]; then
    cat > "${CONFIG_FILE}" <<JSON
{
  "spreadsheetId": "${SPREADSHEET_ID}",
  "serviceAccountPath": "${KEY_PATH}"
}
JSON
    chmod 600 "${CONFIG_FILE}"
    echo "✓ Configuração gravada em ${CONFIG_FILE}"
    [[ -f "${KEY_PATH}" ]] || echo "  ! Chave não encontrada em ${KEY_PATH} — o MCP vai falhar até ela existir"
  else
    echo "  ! CARTEIRA_SPREADSHEET_ID vazio no .env.local — configure e rode este script de novo"
  fi
else
  echo "  ! .env.local não existe ainda. Faça o setup (README) e rode este script de novo"
  echo "    para que o agente consiga ler a carteira."
fi

# ===========================================================================
# 4. Servidor MCP (somente leitura)
# ===========================================================================
if command -v claude >/dev/null 2>&1; then
  claude mcp remove "${MCP_NAME}" -s user >/dev/null 2>&1 || true
  claude mcp add "${MCP_NAME}" -s user -- "${TSX}" "${MCP_ENTRY}" >/dev/null
  echo "✓ Servidor MCP registrado: ${MCP_NAME} (escopo user)"
else
  echo "  ! CLI 'claude' não encontrado no PATH. Registre o MCP à mão:"
  echo "      claude mcp add ${MCP_NAME} -s user -- ${TSX} ${MCP_ENTRY}"
fi

echo
echo "Pronto. Reinicie o Claude Code para carregar as skills, o agente e o servidor MCP."
echo
echo "  Skills:  ${SKILLS[*]}"
echo "  Agente:  ${AGENTS[*]}"
echo "  MCP:     ${MCP_NAME} — portfolio_summary · positions · asset · trades · performance"
echo "  Config:  ${CONFIG_FILE}"
echo
echo "  Interface (cadastro de operações):  cd ${REPO_DIR} && npm run dev"
