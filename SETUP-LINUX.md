# Instalação num Linux, rodando o tempo todo

Guia pra instalar o Octopus no seu Linux como um serviço `systemd` — sobe
sozinho no boot, reinicia se cair, sem precisar deixar um terminal aberto.

Não é hospedagem remota nem acesso pela internet. É o mesmo modelo do
`README.md` (`127.0.0.1`, sem login — ver `src/app/CLAUDE.md`), só que
embrulhado como serviço em vez de rodar com `npm run dev` numa janela aberta.

## O que você vai fazer, resumido

| Passo | O quê |
|---|---|
| 1 | Instalar o Node.js |
| 2 | Copiar o projeto pra máquina |
| 3 | Google Cloud + planilha (igual ao README) |
| 4 | Configurar `.env.local` |
| 5 | Instalar dependências e rodar o instalador da planilha |
| 6 | Colar o Apps Script (`Code.gs`) e ativar o gatilho diário |
| 7 | Buildar a versão de produção |
| 8 | Registrar como serviço `systemd` (sobe sozinho, reinicia se cair) |
| 9 | Mapear um hostname bonito no `/etc/hosts` (opcional) |
| 10 | Criar um atalho/lançador (opcional) |

Tudo isso é feito **uma vez**.

---

## 1. Node.js

Use a versão LTS. Se a distro tiver um pacote recente o bastante, é a via mais
simples:

```bash
# Arch
sudo pacman -S nodejs npm

# Debian/Ubuntu — o repositório da distro costuma ficar desatualizado;
# prefira o NodeSource ou nvm abaixo se `apt` trouxer uma versão antiga
sudo apt install nodejs npm
```

Alternativa portátil, independente da distro — [nvm](https://github.com/nvm-sh/nvm):

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install --lts
```

Confirme:

```bash
node -v
npm -v
```

## 2. Copiar o projeto

```bash
git clone <url-do-repositório> ~/apps/octopus
cd ~/apps/octopus
```

(ou baixar e extrair o `.zip`, se preferir não usar git)

## 3. Google Cloud e a planilha

Os mesmos seis passos do `README.md`:

1. [console.cloud.google.com](https://console.cloud.google.com) → criar
   projeto → *APIs & Services* → habilitar **Google Sheets API**
2. *IAM & Admin* → *Service Accounts* → criar → *Keys* → *Add key* → *JSON* →
   baixar
3. Mover o JSON pra `~/apps/octopus/secrets/service-account.json`
4. Criar uma **planilha vazia** no seu Google Drive
5. Compartilhar a planilha com o `client_email` do JSON, como **Editor**
6. Copiar o ID da planilha da URL (o trecho entre `/d/` e `/edit`)

> [!TIP]
> Não exige cartão de crédito. Se o console pedir faturamento, a API
> habilitada foi a errada — confirme que é "Google Sheets API".

## 4. `.env.local`

```bash
cp .env.example .env.local
$EDITOR .env.local
```

Preencha:

```
CARTEIRA_SPREADSHEET_ID=<o ID copiado no passo 3.6>
CARTEIRA_SERVICE_ACCOUNT_PATH=./secrets/service-account.json
```

## 5. Instalar e montar a planilha

```bash
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

```bash
npm run build
```

O comando que vai rodar como serviço é `npm run start`, que já usa
`next start --hostname 127.0.0.1` (só a própria máquina acessa, porta `3000`
por padrão).

## 8. Registrar como serviço `systemd`

Crie a unit em `~/.config/systemd/user/octopus.service` (serviço de usuário —
não exige `sudo` nem `root`, sobe junto com a sua sessão):

```ini
[Unit]
Description=Octopus — gerenciador de investimentos
After=network.target

[Service]
Type=simple
WorkingDirectory=%h/apps/octopus
ExecStart=/usr/bin/npm run start
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
```

> [!NOTE]
> Ajuste `WorkingDirectory` se copiou o projeto em outro lugar, e confirme o
> caminho do `npm` com `which npm` — se usou `nvm`, o caminho não é
> `/usr/bin/npm`, é algo dentro de `~/.nvm/versions/node/...`.

Ative:

```bash
systemctl --user daemon-reload
systemctl --user enable --now octopus.service
systemctl --user status octopus.service    # confere se está "active (running)"
```

Pra isso sobreviver sem você estar logado (não só enquanto a sessão gráfica
está aberta), habilite o *linger* do usuário:

```bash
sudo loginctl enable-linger $USER
```

Logs em tempo real:

```bash
journalctl --user -u octopus.service -f
```

Pra parar, reiniciar ou remover:

```bash
systemctl --user stop octopus.service
systemctl --user restart octopus.service
systemctl --user disable --now octopus.service
```

<details>
<summary>Alternativa: um serviço de sistema (root) em vez de usuário</summary>

<br/>

Se preferir que rode independente de qualquer login, crie a mesma unit em
`/etc/systemd/system/octopus.service`, troque `WorkingDirectory`/`ExecStart`
pra caminhos absolutos (sem `%h`), adicione `User=<seu-usuário>` na seção
`[Service]`, e use os comandos sem `--user` (`sudo systemctl enable --now
octopus.service`). Não precisa de `linger` nesse caso.

</details>

## 9. Hostname bonito (opcional)

Pra abrir `http://investimentos.local` em vez de `http://127.0.0.1:3000` —
puramente cosmético, não muda segurança nem alcance de rede (continua só a
própria máquina).

```bash
sudo $EDITOR /etc/hosts
```

Adicione a última linha:

```
127.0.0.1    investimentos.local
```

> [!NOTE]
> Evite terminar o nome em `.com`, `.net` etc. — prefira `.local` ou um
> domínio inventado sem TLD real, pra nunca colidir com um site de verdade se
> o `/etc/hosts` for esquecido ou copiado pra outra máquina.

A porta continua sendo preciso informar na URL:
`http://investimentos.local:3000`.

## 10. Atalho/lançador (opcional)

Pra abrir com um clique num ambiente gráfico (GNOME, KDE, etc.), crie
`~/.local/share/applications/octopus.desktop`:

```ini
[Desktop Entry]
Type=Application
Name=Octopus
Exec=xdg-open http://investimentos.local:3000
Icon=/home/SEU_USUARIO/apps/octopus/src/app/icon.svg
Terminal=false
Categories=Finance;
```

Ajuste `SEU_USUARIO` e o caminho. Ele aparece no menu de aplicativos como
qualquer outro programa instalado.

---

## Manutenção

**Atualizar o código** depois de uma mudança no projeto:

```bash
cd ~/apps/octopus
git pull
npm install
npm run build
systemctl --user restart octopus.service
```

**Mudança de schema da planilha** (nova versão do projeto que exige migração):
rode `npm run sheet:migrate` antes do `restart` — mesma regra do projeto
principal, nunca `sheet:reset`.

**Ver se está rodando:** `systemctl --user status octopus.service`, ou
`journalctl --user -u octopus.service -f` pra ver o log ao vivo.

## O que NÃO fazer

- **Não** abra a porta `3000` no roteador/firewall pra fora da rede local —
  o app não tem autenticação, é seguro só porque hoje é inalcançável de fora
  da própria máquina.
- **Não** rode `npm run sheet:reset` como forma de "resetar" — apaga o
  histórico de aportes pra sempre.
