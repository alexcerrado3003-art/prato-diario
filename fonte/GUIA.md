# Prato Diário no seu celular (iPhone e Android)

O app que você usa dentro do Claude agora roda sozinho no celular:

- **ícone na tela inicial** e tela cheia, sem a barra do navegador;
- **seus dados no seu próprio banco** (Supabase), protegidos por login com código por e-mail;
- **IA pela sua chave da API do Claude**, que fica guardada só no servidor e nunca no celular.

É o mesmo app, com as mesmas telas, tabelas TACO e IBGE e funções. Funciona igual no iPhone e no Android, e os dois celulares veem os mesmos dados.

São 5 passos, umas 40 minutos no total, feitos uma única vez. As contas, as chaves e o cartão ficam todos com você. Eu não crio nem vejo nenhum deles.

---

## Quanto custa

| item | custo |
| --- | --- |
| Supabase (banco + login + função da IA) | grátis no plano Free. Um projeto Free sem nenhum acesso por 7 dias é pausado; com uso diário, isso não acontece. |
| Netlify (endereço do app) | grátis |
| API do Claude | pré-pago, por uso. Cada foto de prato custa cerca de **US$ 0,03** com o modelo padrão (Sonnet 5.5). Com 5 fotos por dia, dá uns **US$ 4,50 por mês**. Dicas rápidas usam o Haiku e saem mais baratas. |
| App na loja | não precisa: o app é instalado direto pelo navegador |

A função conta quantas análises você faz por dia e para em 60 (você pode mudar esse número). No console da API, também dá para pôr um limite de gasto mensal.

---

## Passo 1: criar o banco (Supabase)

1. Crie uma conta em **supabase.com** e clique em **New project**.
   - Nome: `prato-diario`.
   - Região: **South America (São Paulo)**.
   - Crie uma senha forte para o banco e guarde-a no seu gerenciador de senhas. O app não usa essa senha.
2. Quando o projeto estiver pronto, abra **SQL Editor**, clique em **New query**, cole o arquivo `supabase/migrations/0001_init.sql` inteiro e clique em **Run**. Deve aparecer "Success".
3. Abra **Project Settings → API** (em alguns painéis, **API Keys**) e anote dois valores, que são públicos e feitos para ficar no app:
   - **Project URL**, que tem a forma `https://xxxx.supabase.co`;
   - a chave **anon** ou **publishable**.

   **Não use** a chave `service_role` ou `secret`. O app recusa essas chaves, se você colar por engano.

## Passo 2: login por código no e-mail

1. Abra **Authentication → Sign In / Providers** e deixe **Email** ligado.
2. Abra **Authentication → Emails** (ou **Email Templates**) e edite o modelo **Magic Link**. Troque o texto por:

   ```
   <h2>Seu código do Prato Diário</h2>
   <p>Digite este código no app: <b>{{ .Token }}</b></p>
   <p>Ele vale por 1 hora. Se não foi você, ignore este e-mail.</p>
   ```

   O app pede um código de 6 dígitos e não um link, porque no iPhone o link abriria o Safari e não o app instalado.
3. **Faça isso só depois do Passo 5**, quando já tiver entrado uma vez: em **Authentication → Sign In / Providers**, desligue **Allow new users to sign up**. Assim, ninguém mais consegue criar conta no seu banco.

## Passo 3: chave da API do Claude

1. Entre em **platform.claude.com**, adicione créditos em **Billing** (pode começar com US$ 5) e, se quiser, ponha um limite mensal em **Limits**.
2. Em **API Keys**, crie uma chave chamada `prato-diario`. Ela começa com `sk-ant-`. Copie a chave e **não cole em nenhum outro lugar além do passo seguinte**.

## Passo 4: a função da IA (no Supabase)

1. No Supabase, abra **Edge Functions**, clique em **Deploy a new function** e escolha **Via Editor**.
2. Dê à função o nome **`ai`**, exatamente assim. Apague o exemplo, cole o arquivo `supabase/functions/ai/index.ts` inteiro e clique em **Deploy**.
3. Em **Edge Functions → Secrets**, adicione:
   - `ANTHROPIC_API_KEY`: a chave do Passo 3;
   - `ALLOWED_EMAILS`: o seu e-mail. Se for usar outro e-mail no segundo celular, coloque os dois separados por vírgula;
   - opcionais: `AI_DAILY_LIMIT` (padrão 60), `CLAUDE_MODEL` (padrão `claude-sonnet-5-5`) e `CLAUDE_MODEL_QUICK` (padrão `claude-haiku-5-5`).
4. Deixe a opção **Verify JWT** ligada, que é o padrão. Ela garante que só quem está logado chama a IA.

## Passo 5: publicar o app e instalar

1. Entre em **app.netlify.com/drop**, crie a conta grátis e **arraste a pasta `pwa` inteira** para a página. Arraste a pasta, não só o `index.html`.
   - Em segundos, aparece um endereço como `https://nome-aleatorio.netlify.app`. Em **Site configuration → Change site name**, você pode trocar para algo como `prato-diario-alex`.
2. **No iPhone:** abra o endereço no **Safari**, toque em **Compartilhar** e depois em **Adicionar à Tela de Início**.
3. **No Android:** abra o endereço no **Chrome**, toque no menu **⋮** e depois em **Instalar app** (ou **Adicionar à tela inicial**).
4. Abra pelo ícone. Na primeira vez:
   1. cole o **Project URL** e a **chave pública** do Passo 1;
   2. digite seu e-mail;
   3. digite o código que chegar.

   Depois disso, o app lembra de tudo.
5. Volte ao Passo 2, item 3, e desligue novos cadastros.

**Opcional:** para não precisar colar o endereço e a chave em cada celular, abra `pwa/config.js`, preencha `url` e `anonKey` e arraste a pasta de novo no Netlify. Use só a chave **pública**.

---

## Atualizar o app depois

Quando eu fizer melhorias, mando uma pasta `pwa` nova. É só arrastá-la de novo no Netlify, em **Deploys**, na área de arrastar. Na próxima vez que você abrir, o celular baixa a versão nova sozinho. Seus dados não mudam, porque ficam no Supabase.

## Seus dados de dentro do Claude

O que você registrou na versão dentro do Claude fica lá. A versão do celular começa vazia. Se quiser levar o histórico, me peça e eu preparo a importação.

## Se algo der errado

| o que aparece | o que fazer |
| --- | --- |
| "A IA não está configurada" | confira o segredo `ANTHROPIC_API_KEY` e se há créditos em platform.claude.com |
| "Esta conta não está autorizada a usar a IA" | seu e-mail não está em `ALLOWED_EMAILS` |
| "Limite de uso atingido" | você passou de `AI_DAILY_LIMIT` análises hoje; o limite volta à meia-noite |
| o código não chega | olhe o spam. O e-mail grátis do Supabase manda poucos por hora; espere alguns minutos |
| "Este e-mail não tem acesso" | os cadastros estão desligados e esse e-mail não tem conta; religue os cadastros por um momento |
| "Não consegui salvar agora" | sem internet ou projeto pausado; abra o painel do Supabase e clique em **Restore** |
| quer trocar de banco | na tela de entrar, toque em "Trocar o banco conectado" |

## Versão nativa (opcional, só se quiser loja ou APK)

A pasta `native/` tem uma casca em Expo que abre o mesmo app dentro de um aplicativo nativo. Ela **não é necessária**: a versão instalada pelo navegador já faz tudo.

- **Android (APK grátis):** num computador com Node, troque `appUrl` em `native/app.json` pelo seu endereço do Netlify e `SEUNOME` pelo seu nome. Depois, rode `npm install`, `npx eas-cli login` (crie uma conta grátis em expo.dev) e `npx eas-cli build -p android --profile apk`. No fim, aparece um link para baixar o APK no celular.
- **iPhone nativo:** precisa do Apple Developer Program (US$ 99 por ano) para instalar fora da loja. Para uso próprio, a versão pela Tela de Início dá o mesmo resultado sem custo.
- Na casca nativa, "Exportar CSV" não baixa arquivo. Para exportar, use a versão instalada pelo navegador.

## O que fica onde

| onde | o quê |
| --- | --- |
| seu celular | o app, o endereço do banco, a chave pública e a sessão de login |
| Supabase (São Paulo) | perfil, metas, refeições, pesos, bioimpedância e o contador de uso da IA, separados por login |
| API do Claude | recebe a foto e o pedido na hora da análise. Pelos termos comerciais da API, o conteúdo não é usado para treinar modelos |
| Netlify | só os arquivos do app, sem nenhum dado seu |
