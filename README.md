# Yvy Guaraní S.A. — tienda y sistema de gestión

Sistema web da Yvy Guaraní S.A. para ligar a produção das cooperativas aos almacenes de barrio (bodegas): uma **loja** para os clientes e um **sistema de gestão** (pedidos, depósito, estoque, abastecimento, preços, clientes e usuários) para a equipe.
Interface em espanhol do Paraguai; funciona no computador e no celular. **Um servidor guarda os dados de todos**: cada pessoa entra do seu aparelho e vê as mudanças dos outros em tempo real.

## Como rodar

Requer apenas **Node.js 24 ou superior** (testado com 26). Sem dependências para instalar, sem build e sem serviços pagos: o banco de dados é o SQLite que já vem no Node.

```bash
npm start
```

Abra http://localhost:4173. Na primeira vez aparece **"Configurá el acceso"**: crie o nome, o usuário e a senha da conta de Administración. Com ela você cria as demais contas em **Usuarios y accesos** e define a senha de cada uma ("Crear acceso").

```bash
npm test
```

Roda os 65 testes automatizados: regras de estoque e pedido, roteiro de aceitação, painel, acessos, catálogo, visão de dados por papel, o servidor (login, permissões, concorrência, persistência, diário, arquivos protegidos e avisos ao vivo) e o modo produção (https, proxy e arranque).

### Onde ficam os dados

- `data/yvy.db`: a base (SQLite). Não é publicada pelo servidor.
- `data/respaldos/`: cópias de segurança automáticas da base, ao iniciar, a cada 24 h e antes de carregar um cenário ou importar um respaldo. Ficam as últimas 14.
- Em **Configuración → Datos y respaldo** a Administración também baixa e importa um respaldo em JSON. Ele inclui as contas (só o hash das senhas): guarde-o em lugar seguro.

### Usar de outros aparelhos

- **Na mesma rede (Wi-Fi do escritório)**, para testar com celulares:

  ```bash
  node server/main.mjs --host=0.0.0.0
  ```

  Os outros aparelhos abrem `http://IP-DO-COMPUTADOR:4173`. O Windows pode pedir para liberar o firewall. **Atenção:** sem https as senhas viajam sem criptografia pela rede; use só numa rede de confiança.
- **Pela internet** (Ecoagro, fornecedores e clientes de qualquer lugar): siga o **[PUBLICAR.md](PUBLICAR.md)**. O kit em `deploy/` instala o sistema num VPS Ubuntu com Caddy (https automático) e serviço do sistema, e traz scripts de instalação e atualização com volta atrás. Também dá para usar https direto com `--tls-cert=` e `--tls-key=`.

Outras opções: `--port=` (ou `PORT`) e `--data=` (ou `DATA_DIR`). Em `.claude/launch.json` há também a configuração **yvy-prueba** (porta 4174, pasta `data-prueba/`): uma instância de testes separada que não toca nos dados reais.

## Segurança

- **Permissões no servidor**: toda ação passa pelas regras do `js/domain.js` executadas no servidor; a tela só pede. Um papel sem permissão não executa nada, mesmo chamando a API diretamente.
- **Cada conta recebe só o seu** (`D.viewFor`): cliente sem custos, margens nem pedidos de outros clientes; cooperativa sem preços nem dados de outras; visitante sem preços nem estoque. Ninguém recebe hashes de senha.
- **Senhas**: verificadas no servidor com PBKDF2-SHA256 (210.000 iterações, com sal). Mensagem genérica em caso de erro e limite de 8 tentativas a cada 15 minutos por usuário e IP. Trocar a senha encerra as outras sessões daquela conta.
- **Sessão**: cookie `HttpOnly`, `SameSite=Lax` (e `Secure` com https), válida por 14 dias. Na base fica só o hash do token. Os POST exigem JSON e um cabeçalho próprio, o que bloqueia envios forjados de outros sites.
- **Cabeçalhos**: política de conteúdo restrita (CSP), proteção contra iframes e `nosniff`.
- **Diário** (`diario` na base): cada ação aceita ou recusada, com usuário, papel, IP e "vista de" quando a Administración usa "Ver como". Fotos incrustadas ficam como `[imagen]`; senhas nunca entram no diário.
- **Transações**: o novo estado e o registro no diário são gravados juntos ou nenhum é gravado. O servidor processa um comando por vez, então duas reservas simultâneas nunca vendem o mesmo estoque (há teste para isso).

## Níveis de acesso

Cada pessoa entra com usuário e senha e vê só as seções do seu papel.

| Papel | O que vê |
| --- | --- |
| Administración | Tudo: painel geral, pedidos, novo pedido, clientes, estoque, recepção, movimentos, oferta e demanda, preços, catálogo, loja, usuários, configuração e histórico. Pode **"Ver como"** qualquer conta: o servidor entrega exatamente a visão daquela conta. |
| Ventas | Painel comercial, pedidos, novo pedido, clientes, oferta e demanda, preços, estoque e loja. |
| Depósito | Painel de depósito, pedidos, recepção, estoque e movimentos. |
| Cooperativa | Sua oferta, o que o depósito recebeu dela e seus produtos. Sem preços internos. |
| Cliente (almacén) | A loja com preços, seu pedido, seus pedidos e avisos de interesse. Sem custos nem pedidos de outros. |
| Visitante (sem login) | A loja sem preços ("Precio para clientes registrados"). |

A matriz completa está em **Usuarios y accesos**.

## Catálogo inicial

51 produtos tirados da loja on-line da Ecoagro (ecoagro.org.py), em 8 categorias: pastas, especiarias, méis, grãos, farinhas, yuyos, almacén e doces.

- **Fotos**: baixadas dessa loja e reduzidas (`assets/productos/`, ~2 MB). **Confirmar com a Ecoagro a autorização de uso antes de publicar a loja.**
- **Nomes e apresentações**: da loja da Ecoagro. Marcas comercializadas por ela aparecem como "Marca: …"; a linha própria aparece como "Línea Eco Agro Naturalmente".
- **Selos** (orgânico, sem glúten etc.): mostrados como "según declara el proveedor", até serem validados com documentos.
- **Descrições, histórias (17) e receitas (12)**: textos próprios da Yvy Guaraní, sem alegações de saúde. Editáveis em Catálogo → Editar.
- **Sem preços**: aparecem como "Precio a confirmar" e só podem ser pedidos depois de ter preço em **Precios**.
- **Vídeos**: nenhum ainda. Aceita link do YouTube, link https de vídeo ou arquivo em `assets/videos/`.
- Frescos e perecíveis ficam fora da operação inicial.

## Nome comercial

O nome provisório é **Mercado Yvy**, configurável em **Configuración → Tienda**. Opções para a equipe: Mercado Yvy, Yvy Kokue ("kokue" = roça, chácara), Yvy Rapo ("rapo" = raiz) ou Del Kokue. Confirmar os significados em guarani com falantes antes de escolher.

## Cenários para apresentar e testar

Em **Configuración → Datos y respaldo → Escenarios** (só Administración; vale para todos os usuários do servidor; a conta em uso é mantida e uma cópia de segurança é feita antes):

- **Demostración**: 13 semanas de atividade **fictícia** sobre o catálogo real, com clientes de exemplo, preços inventados em 12 produtos, recepções, pedidos, faltantes, cancelamentos e entregas. O cabeçalho mostra o selo "Demostración".
- **Escenario de prueba**: os dados fictícios do roteiro de aceitação (o produto PAS-REM-300 começa sem estoque).
- **Volver al catálogo inicial**: catálogo real, sem preços, sem pedidos e sem clientes.

## Estrutura

| Arquivo | Papel |
| --- | --- |
| `server/app.mjs` | Servidor: base SQLite, sessões, API, diário, cópias de segurança, avisos ao vivo e arquivos estáticos. |
| `server/main.mjs` | Inicia o servidor (porta, host, pasta de dados, https). |
| `js/domain.js` | Regras, sem dependências. Toda alteração passa por `execute(state, actor, cmd, now)`; `viewFor` define o que cada conta recebe. |
| `js/catalogo.js` | Catálogo inicial (produtos, categorias, histórias, receitas, selos declarados). |
| `js/seed.js` | Dados de arranque: catálogo inicial, demonstração e cenário de prueba. |
| `js/app.js` | Interface: loja, ingresso e sistema de gestão. Conversa só com a API. |
| `css/app.css` | Estilos. Fonte Poppins embutida (`assets/fonts/`, licença OFL). |
| `tests/` | 65 testes automatizados (`tests/fixtures/` tem um certificado só para os testes de https). |
| `deploy/`, `PUBLICAR.md` | Kit e guia para publicar na internet com https. |

### API

`GET /api/estado`, `GET /api/eventos` (avisos ao vivo), `POST /api/ingresar`, `POST /api/salir`, `POST /api/configurar` (só no primeiro acesso), `POST /api/contrasena`, `POST /api/comando` (`{ type, payload }`, os mesmos comandos de `domain.js`), `POST /api/escenario`, `GET/POST /api/respaldo`, `GET /api/salud`.

## Verificação desta versão

- **65 testes automatizados passando**, incluindo os 12 do servidor e os 3 do modo produção (https com cookie Secure e HSTS, IP real atrás do proxy, aviso de porta ocupada).
- **Na interface, numa instância de testes separada** (porta 4174, já apagada junto com as senhas de teste):
  - ingresso pelo servidor, com o cookie de sessão inacessível para scripts da página;
  - painel com a demonstração;
  - novo pedido confirmado;
  - "Ver como" um cliente, recebendo só os pedidos e os preços dele;
  - pedido feito por um segundo aparelho (script) aparecendo na tela da Administración sem recarregar;
  - texto digitado num formulário preservado, com o aviso "Actualizar";
  - visitante sem preços nem estoque;
  - telas a 390 px sem rolagem horizontal.
- O servidor real (`data/`) ficou na tela de primeiro acesso, sem senha criada.
- **Não verificado**: acesso por outro aparelho físico na rede, hospedagem com https, celular físico, leitor de tela, reprodução de vídeo real.

## O que ainda falta para operar com lojas reais

1. **Contratar o VPS e o domínio e seguir o [PUBLICAR.md](PUBLICAR.md).** Os scripts de instalação foram validados só na sintaxe: ainda não rodaram num servidor real.
2. **Preços e condições** do piloto (pedido mínimo, entrega, pagamento e prazos).
3. **Procedimento de qualidade e liberação** por categoria, com a cooperativa.
4. **Autorização da Ecoagro** para as fotos e validação dos selos declarados.
5. Fotos e vídeos próprios dos produtos e histórias contadas pelas cooperativas.
6. Recuperação de senha por e-mail ou WhatsApp. Hoje é a Administración que restabelece.
