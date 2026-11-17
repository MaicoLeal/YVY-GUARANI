# Publicar na internet com https

Guia para colocar a loja e o sistema de gestão da Yvy Guaraní no ar, acessíveis pelas cooperativas, pela equipe e pelos almacenes de qualquer lugar, com cadeado (https).

Este guia é para um **servidor próprio (VPS)**. Para publicar na **Vercel**, use o [VERCEL.md](VERCEL.md).

O código fica no GitHub: **https://github.com/MaicoLeal/YVY-GUARANI**. O servidor baixa o projeto de lá e, a cada versão nova, só puxa as mudanças.

O que já está pronto no projeto:

| Arquivo | Para quê |
| --- | --- |
| `deploy/instalar.sh` | Instala tudo no servidor: usuário próprio, pastas, serviço, https. Roda os testes antes e não instala nada se algum falhar. |
| `deploy/actualizar.sh` | Atualiza o código sem tocar nos dados, guarda a versão anterior e uma cópia da base. `--volver` desfaz a atualização. |
| `deploy/yvy.service` | Serviço do sistema (inicia sozinho, reinicia se cair, isolado: só escreve na pasta de dados). |
| `deploy/Caddyfile` | Caddy publica o site com certificado https automático (Let's Encrypt) e renovação sozinha. |
| `deploy/yvy.env.ejemplo` | Configuração de produção (cookie seguro, IP real atrás do proxy). |

## 1. O que você precisa decidir e contratar

- **Domínio**, por exemplo `tienda.seudominio.com.py`, de preferência registrado em nome da Yvy Guaraní S.A.
- **Servidor (VPS)** com **Ubuntu 24.04 LTS**. Para o piloto basta 1 vCPU, 1–2 GB de RAM e 20 GB de disco. Qualquer provedor serve. Se vocês já usam Hostinger, um VPS deles funciona. Hospedagem compartilhada **não** serve: o sistema precisa de um processo sempre ligado e de um arquivo de banco próprio.
- Acesso **SSH** ao servidor com um usuário que tenha `sudo`.

## 2. Apontar o domínio

No painel do domínio, crie um registro **A** com o nome escolhido (ex.: `tienda`) apontando para o **IP do VPS**. Pode levar de minutos a algumas horas para valer. O https só funciona depois disso.

## 3. Preparar o servidor (uma vez)

Conecte por SSH e instale o necessário. Confira os comandos nas páginas oficiais, porque podem mudar:

1. **Atualizar e liberar só o necessário no firewall**

   ```bash
   sudo apt update && sudo apt upgrade -y
   ```

   ```bash
   sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable
   ```

2. **Node.js 24 ou superior**: siga https://nodejs.org/en/download (opção "Linux" com gerenciador de pacotes) ou o repositório da NodeSource. Depois confira:

   ```bash
   node -v
   ```

3. **Caddy**: siga https://caddyserver.com/docs/install (seção "Debian, Ubuntu, Raspbian"). Depois confira:

   ```bash
   caddy version
   ```

4. **Git** (no Ubuntu costuma vir instalado):

   ```bash
   sudo apt install -y git
   ```

## 4. Baixar o projeto no servidor

No servidor, na pasta do seu usuário:

```bash
cd ~ && git clone https://github.com/MaicoLeal/YVY-GUARANI.git yvy && cd yvy
```

Essa pasta `~/yvy` é só a cópia de onde o sistema é instalado. O sistema em uso fica em `/opt/yvy` e os dados em `/var/lib/yvy`; nenhum dado vai nem volta do GitHub.

> **Repositório privado:** hoje o repositório é público, por isso o `git clone` funciona sem senha. Se ele passar a ser privado, o servidor precisa de uma chave de acesso só de leitura (no GitHub: Settings → Deploy keys) para clonar e atualizar.

## 5. Instalar

Ainda dentro de `~/yvy`:

```bash
sudo bash deploy/instalar.sh tienda.seudominio.com.py
```

O script confere o Node e o Caddy, roda os testes, cria o usuário `yvy`, instala o código em `/opt/yvy`, os dados em `/var/lib/yvy`, a configuração em `/etc/yvy/yvy.env`, configura o Caddy para o seu domínio e liga tudo. Se o Caddy já publicar outros sites nesse servidor, o script para e pede para você juntar a configuração à mão (ele não apaga nada).

## 6. Primeiro acesso

Abra `https://tienda.seudominio.com.py`. Aparece **"Configurá el acceso"**: crie a conta de Administración com uma senha forte. **Faça isso logo após instalar**, porque até lá qualquer pessoa que abrir o site pode criar essa conta.

Depois, na ordem:

1. **Configuración → Tienda**: nome comercial definitivo.
2. **Configuración → Cooperativas y proveedores**: confira Ecoagro e Agronorte e cadastre o fornecedor de ervas.
3. **Precios**: preços dos produtos que vão ser vendidos.
4. **Clientes**: cadastre os almacenes e crie a conta de cada um (**Usuarios y accesos → Crear acceso**).
5. **Usuarios y accesos**: contas de Ventas, Depósito e Cooperativas.

## Atualizar para uma versão nova

1. **No seu computador**, na pasta do projeto: rode os testes, faça o commit e envie para o GitHub.

   ```bash
   npm test
   ```

   ```bash
   git add -A && git commit -m "Descreva a mudança" && git push
   ```

2. **No servidor**: puxe a versão nova e atualize. O script roda os testes de novo e, se algum falhar, não troca nada.

   ```bash
   cd ~/yvy && git pull && sudo bash deploy/actualizar.sh
   ```

Se algo der errado depois de atualizar, volte o sistema para a versão anterior (os dados não são tocados):

```bash
cd ~/yvy && sudo bash deploy/actualizar.sh --volver
```

A pasta `~/yvy` continua com a versão nova. Corrija o problema, envie uma versão corrigida para o GitHub e só então rode o `git pull` e o `actualizar.sh` de novo.

## Cópias de segurança

- O servidor faz cópias automáticas em `/var/lib/yvy/respaldos` (ao iniciar, a cada 24 h e antes de trocar dados; ficam as 14 últimas), e a atualização guarda mais uma.
- **Guarde também uma cópia fora do servidor** (se o VPS se perder, as cópias se perdem junto). Do seu computador, por exemplo uma vez por semana:

  ```powershell
  ssh usuario@IP-DO-SERVIDOR "sudo tar -C /var/lib/yvy -czf - respaldos" > respaldos-yvy.tgz
  ```

- Em **Configuración → Datos y respaldo** também dá para baixar um respaldo em JSON.

## Se algo não funcionar

| Sintoma | Onde olhar |
| --- | --- |
| O site não abre | `sudo systemctl status yvy caddy` |
| Erro da aplicação | `sudo journalctl -u yvy -n 100` |
| Sem cadeado / erro de certificado | O domínio ainda não aponta para o IP (passo 2), ou as portas 80 e 443 estão fechadas: `sudo journalctl -u caddy -n 100` |
| Esqueci a senha de Administración | Outra conta de Administración pode restabelecer. Se não houver nenhuma, peça ajuda: dá para criar uma nova conta direto na base, com o serviço parado. |

## Antes de abrir para lojas reais

- [ ] Domínio próprio com https funcionando (cadeado no navegador).
- [ ] Conta de Administración criada com senha forte, e uma segunda conta de Administración de reserva.
- [ ] Nome comercial, preços e condições (pedido mínimo, entrega, pagamento) definidos.
- [ ] Autorização da Ecoagro para usar as fotos, e selos validados.
- [ ] Cópia de segurança fora do servidor testada (baixar e abrir).
- [ ] Teste completo num celular real: cliente faz o pedido, depósito prepara e despacha, cliente vê o pedido entregue.
- [ ] A demonstração **não** carregada (Configuración → Escenarios → "Volver al catálogo inicial", se tiver sido usada).
