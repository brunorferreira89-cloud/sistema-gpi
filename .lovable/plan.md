

## Plano: Atualizar perfil do Bruno para admin

### Problema identificado
O perfil com `id = 545dddba-f7c2-4c18-90cb-7fc9a084866f` tem:
- `nome`: "bruno@nexxuscontabilidade.com" (o e-mail foi salvo como nome por engano)
- `email`: null
- `role`: "consultor"

### Ações necessárias (via SQL UPDATE)
1. Corrigir o campo `email` para `bruno@nexxuscontabilidade.com`
2. Corrigir o campo `nome` para um nome real (ex: "Bruno") — ou manter como está se preferir
3. Alterar `role` de `consultor` para `admin`

Isso será feito com um único UPDATE na tabela `profiles` usando a ferramenta de dados (não migração).

### Impacto
- O usuário passará a ver o item "Equipe GPI" na sidebar
- Terá acesso à rota `/usuarios-internos`
- Todas as permissões de admin estarão ativas

