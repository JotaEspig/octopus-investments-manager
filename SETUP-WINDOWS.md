# Instalação num PC Windows, rodando o tempo todo

Guia pra instalar o Octopus no seu Windows como um serviço que sobe sozinho —
sem precisar deixar um terminal aberto, sem precisar lembrar de religar depois
que reiniciar o PC.

Não é hospedagem remota nem acesso pela internet. É o mesmo modelo do
`README.md` (`127.0.0.1`, sem login — ver `src/app/CLAUDE.md`), só que embrulhado
como serviço em vez de rodar com `npm run dev` numa janela aberta.

## O que você vai fazer, resumido

| Passo | O quê |
|---|---|
| 1 | Instalar o Node.js no Windows |
| 2 | Copiar o projeto pra máquina |
| 3 | Google Cloud + planilha (igual ao README) |
| 4 | Configurar `.env.local` |
| 5 | Instalar dependências e rodar o instalador da planilha |
| 6 | Colar o Apps Script (`Code.gs`) e ativar o gatilho diário |
| 7 | Buildar a versão de produção |
| 8 | Registrar como serviço do Windows (sobe sozinho, reinicia se cair) |
| 9 | Mapear um hostname bonito no `hosts` (opcional) |
| 10 | Criar um atalho na área de trabalho |

Tudo isso é feito **uma vez**. Depois, é só um ícone na área de trabalho.

---

## 1. Node.js

Baixe o instalador **LTS** em [nodejs.org](https://nodejs.org) e rode o `.msi`
com as opções padrão. Confirme no PowerShell:

```powershell
node -v
npm -v
```

## 2. Copiar o projeto

Duas formas, sem precisar de conta no GitHub:

- Baixar o `.zip` do repositório e extrair, por exemplo em
  `C:\Apps\octopus`
- Ou, se tiver o Git instalado, `git clone` no mesmo lugar

## 3. Google Cloud e a planilha

Os mesmos seis passos do `README.md`:

1. [console.cloud.google.com](https://console.cloud.google.com) → criar
   projeto → *APIs & Services* → habilitar **Google Sheets API**
2. *IAM & Admin* → *Service Accounts* → criar → *Keys* → *Add key* → *JSON* →
   baixar
3. Mover o JSON pra `C:\Apps\octopus\secrets\service-account.json`
4. Criar uma **planilha vazia** no seu Google Drive
5. Compartilhar a planilha com o `client_email` do JSON, como **Editor**
6. Copiar o ID da planilha da URL (o trecho entre `/d/` e `/edit`)

> [!TIP]
> Não exige cartão de crédito. Se o console pedir faturamento, a API
> habilitada foi a errada — confirme que é "Google Sheets API".

## 4. `.env.local`

No PowerShell, dentro da pasta do projeto:

```powershell
Copy-Item .env.example .env.local
notepad .env.local
```

Preencha:

```
CARTEIRA_SPREADSHEET_ID=<o ID copiado no passo 3.6>
CARTEIRA_SERVICE_ACCOUNT_PATH=./secrets/service-account.json
```

## 5. Instalar e montar a planilha

```powershell
cd C:\Apps\octopus
npm install
npm run sheet:install
```

Isso cria as abas, fórmulas, formatação e gráficos na planilha nova.

## 6. Apps Script (passo manual, único que não dá pra automatizar)

Motivo: um script vinculado à planilha pertence a quem é dono dela, não à
service account — a API do Google não consegue criar isso à distância.

1. Na planilha: **Extensões → Apps Script**
2. Apague o conteúdo do editor e cole o arquivo `apps-script/Code.gs` inteiro
3. Salve, recarregue a planilha
4. No menu **Carteira → Ativar atualização diária**, autorize o acesso

> [!IMPORTANT]
> Sem isso, a renda fixa não é precificada e o gráfico de patrimônio fica
> vazio — a `Code.gs` é quem busca o CDI, marca a renda fixa na curva e grava
> o snapshot mensal.

## 7. Build de produção

`npm run dev` recompila a cada mudança e é mais lento — bom pra desenvolver,
ruim pra deixar rodando o tempo todo. Pra instalar de vez, gere o build:

```powershell
npm run build
```

O comando que vai rodar como serviço é `npm run start`, que já usa
`next start --hostname 127.0.0.1` (só a própria máquina acessa, porta `3000`
por padrão).

## 8. Registrar como serviço do Windows

Sem isso, o app só roda enquanto você deixa um terminal aberto. Use o
[NSSM](https://nssm.cc/download) (gratuito, um `.exe` só, sem instalador):

1. Baixe o NSSM e extraia `nssm.exe` (pegue a versão `win64`) em algum lugar
   fixo, por exemplo `C:\Apps\nssm\nssm.exe`
2. No PowerShell, **como Administrador**:

```powershell
C:\Apps\nssm\nssm.exe install Octopus
```

Isso abre uma janela. Preencha:

| Campo | Valor |
|---|---|
| Path | `C:\Program Files\nodejs\npm.cmd` |
| Startup directory | `C:\Apps\octopus` |
| Arguments | `run start` |

Na aba **I/O**, opcionalmente aponte `stdout` e `stderr` pra arquivos de log
(ex.: `C:\Apps\octopus\logs\out.log`), útil se algo parar de funcionar.

Clique **Install service**. Depois:

```powershell
Start-Service Octopus
Get-Service Octopus          # confere se está "Running"
```

O serviço passa a subir sozinho com o Windows e reiniciar se travar. Pra
parar, atualizar ou remover:

```powershell
Stop-Service Octopus
C:\Apps\nssm\nssm.exe remove Octopus confirm
```

<details>
<summary>Alternativa: PM2 em vez de NSSM</summary>

<br/>

Se preferir uma ferramenta do próprio ecossistema Node:

```powershell
npm install -g pm2 pm2-windows-service
pm2-service-install
pm2 start npm --name octopus -- run start
pm2 save
```

Funciona igual — é gosto, não recomendação técnica de um sobre o outro.

</details>

## 9. Hostname bonito (opcional)

Pra abrir `http://investimentos.local` em vez de `http://127.0.0.1:3000` —
puramente cosmético, não muda segurança nem alcance de rede (continua só a
própria máquina).

Abra o Bloco de Notas **como Administrador**, edite:

```
C:\Windows\System32\drivers\etc\hosts
```

Adicione a última linha:

```
127.0.0.1    investimentos.local
```

> [!NOTE]
> Evite terminar o nome em `.com`, `.net` etc. — prefira `.local` ou um
> domínio inventado sem TLD real, pra nunca colidir com um site de verdade se
> o `hosts` for esquecido ou copiado pra outra máquina.

A porta continua sendo preciso informar na URL:
`http://investimentos.local:3000`.

## 10. Atalho na área de trabalho

Clique direito na área de trabalho → **Novo → Atalho** → cole:

```
http://investimentos.local:3000
```

(ou `http://127.0.0.1:3000` se pulou o passo 9). Renomeie o atalho e, se
quiser, troque o ícone pelo `src/app/icon.svg` do projeto (converta pra `.ico`
antes — o Windows não aceita `.svg` direto em atalhos).

---

## Manutenção

**Atualizar o código** depois de uma mudança no projeto:

```powershell
cd C:\Apps\octopus
git pull            # ou baixar o zip de novo, se não usa git
npm install
npm run build
Restart-Service Octopus
```

**Mudança de schema da planilha** (nova versão do projeto que exige migração):
rode `npm run sheet:migrate` antes do `Restart-Service` — mesma regra do
projeto principal, nunca `sheet:reset`.

**Ver se está rodando:** `Get-Service Octopus`, ou abra o atalho — se a página
não carregar, confira os logs configurados no passo 8.

## O que NÃO fazer

- **Não** abra a porta `3000` no roteador/firewall pra fora da rede local —
  o app não tem autenticação, é seguro só porque hoje é inalcançável de fora
  da própria máquina.
- **Não** rode `npm run sheet:reset` como forma de "resetar" — apaga o
  histórico de aportes pra sempre.
