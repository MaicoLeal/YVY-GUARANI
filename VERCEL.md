# Publicar na Vercel

Na Vercel o sistema roda assim:

- **A página** (loja e gestão) é publicada como arquivos estáticos. O build copia para `publico/` só `index.html`, `css/`, `js/` e `assets/`; o código do servidor e os testes não vão para o site.
- **A API** (`/api/…`) roda como uma função da Vercel: `api/index.mjs`. Ela usa as mesmas regras e permissões do servidor próprio (`server/nucleo.mjs`).
- **Os dados** ficam numa base **Postgres da Neon**, conectada ao projeto pelo painel da Vercel. A Vercel não tem disco permanente, então sem essa base o sistema não funciona e a tela mostra "Falta conectar la base de datos".

A configuração está em `vercel.json` e é aplicada sozinha a cada publicação.

## 1. Conectar a base de dados (uma vez)

No painel da Vercel, dentro do projeto:

1. Abra **Storage → Create Database → Neon** e escolha o plano gratuito (Free).
2. **Região:** a função e a base precisam ficar na mesma região, senão cada consulta atravessa o continente. A base atual do projeto (`neon-aero-fence`, criada em 17/11/2026) está em **Washington, D.C. (iad1)**, e por isso a função também roda lá (`"regions": ["iad1"]` no `vercel.json`). Se um dia a base for recriada em outra região, troque `regions` para a mesma (veja "Se algo não funcionar").
3. **Connect:** conecte a base a este projeto. A Vercel cria sozinha a variável `DATABASE_URL`; você não precisa copiar senha nenhuma.
   - Marque pelo menos **Production**.
   - Se a Neon oferecer criar uma base separada para **Preview**, aceite. Assim os testes de branches não mexem nos dados reais.

As tabelas são criadas sozinhas no primeiro acesso.

## 2. Proteger o primeiro acesso (recomendado)

Enquanto ninguém configurou a conta de Administración, quem abrir o site primeiro poderia criá-la. Para evitar isso:

1. Em **Settings → Environment Variables**, crie `CODIGO_CONFIGURACION` com um código que só você saiba, por exemplo uma frase longa.
2. Marque o ambiente **Production** e salve.

Com isso, a tela "Configurá el acceso" pede também o **Código de configuración**. Depois que a conta de Administración existe, o código não é mais usado.

## 3. Publicar

Qualquer `git push` para a branch `main` publica de novo. Para publicar agora, sem mudar código: **Deployments → (última publicação) → ⋯ → Redeploy**.

Depois abra o site:

1. Aparece **"Configurá el acceso"**: crie a conta de Administración **logo em seguida**.
2. Continue pela ordem do [PUBLICAR.md](PUBLICAR.md), seção "Primeiro acesso": nome comercial, cooperativas, preços, clientes e contas.

## Diferenças em relação ao servidor próprio

| | Servidor próprio (VPS) | Vercel |
| --- | --- | --- |
| Mudanças feitas por outra pessoa | aparecem na hora | aparecem em até 10 segundos (a tela consulta se houve mudança) |
| Base de dados | SQLite no servidor | Postgres na Neon |
| Cópias de segurança automáticas | arquivos `.db` em `respaldos/` | 14 cópias dentro da própria base (tabela `respaldos`): uma por dia e antes de trocar dados. A Neon também guarda um histórico próprio para restaurar a base |
| Respaldo em JSON (Configuración → Datos y respaldo) | sim | sim. Importar só aceita arquivos de até 4 MB, limite da Vercel |
| Dois pedidos ao mesmo tempo para o mesmo estoque | um por vez | cada mudança só é gravada se ninguém mudou a base no meio; senão é recalculada. Há teste com duas cópias da função |

**Tamanho dos dados:** a Vercel limita cada resposta a 4,5 MB, e o sistema manda os dados de cada tela de uma vez. A demonstração de 13 semanas ocupa cerca de 0,7 MB, então há folga para o piloto. Com muitos meses de operação será preciso paginar o histórico.

**Planos:** confira nos termos da Vercel e da Neon se os planos gratuitos servem para o uso comercial da Yvy Guaraní e quais são os limites atuais (horas de processamento, espaço da base).

## Testar no computador como se fosse a Vercel

Sem conta e sem base real (usa um Postgres em memória):

```bash
npm install
```

```bash
node tools/simular-vercel.mjs --codigo=prueba-local
```

Abra http://localhost:4175. Os dados se perdem ao fechar. Em `.claude/launch.json` essa configuração se chama **yvy-vercel**.

## Se algo não funcionar

| Sintoma | O que fazer |
| --- | --- |
| "Falta conectar la base de datos" | Passo 1. Depois, **Redeploy**: a variável só vale para publicações feitas depois de criada. |
| "Error interno del servidor" | No painel da Vercel, **Logs** (ou **Deployments → Functions**) mostra a mensagem completa. |
| Tudo funciona, mas lento | A base e a função estão em regiões diferentes. Veja a região da base na Neon e troque `regions` no `vercel.json`: São Paulo = `gru1`, Washington (us-east-1) = `iad1`, Ohio (us-east-2) = `cle1`, Frankfurt = `fra1`. |
| "El código de configuración no es correcto" | Confira `CODIGO_CONFIGURACION` em Settings → Environment Variables. Depois de mudar, faça **Redeploy**. Depois de 8 tentativas erradas, espere 15 minutos. |
| Esqueci a senha de Administración | Outra conta de Administración pode restabelecer. Se não houver nenhuma, peça ajuda: dá para ajustar direto na base, pelo editor SQL da Neon. |
