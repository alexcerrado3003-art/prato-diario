# Prato Diário

Diário alimentar com foto, para uso pessoal. As tabelas de alimentos são a TACO (NEPA/Unicamp) e a IBGE POF 2008–2009.

- **App:** https://alexcerrado3003-art.github.io/prato-diario/. No iPhone, abra no Safari e toque em Compartilhar → Adicionar à Tela de Início. No Android, abra no Chrome e toque em ⋮ → Instalar app.
- **Dados:** cada conta tem os seus, guardados no Supabase e protegidos por login e por RLS.
- **IA:** a função `ai`, no Supabase, chama a API do Claude. A chave fica guardada só como segredo no Supabase.
- **Código-fonte e guia:** a pasta `fonte/`.

Este repositório não tem nenhuma chave secreta. A chave em `config.js` é a publishable do Supabase, que foi feita para ficar no navegador.
