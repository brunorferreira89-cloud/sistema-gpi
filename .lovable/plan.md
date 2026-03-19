

## Diagnóstico

O e-mail `bruno.rferreira89@gmail.com` está correto na tabela `profiles`, mas no sistema de autenticação (auth.users) está registrado como `bruno.reisf@hotmail.como` (com erro de digitação). O login valida contra auth.users, por isso rejeita o Gmail.

## Plano de Correção

### 1. Adicionar action `update_email` na Edge Function `criar-usuario`

Inserir um novo bloco entre `update_password` e `CREATE`, que:
- Recebe `{ action: "update_email", user_id, novo_email }`
- Chama `adminClient.auth.admin.updateUserById(user_id, { email: novo_email, email_confirm: true })`
- Atualiza `profiles.email` com o novo e-mail
- Retorna sucesso

### 2. Adicionar botão "Corrigir e-mail" na página de Usuários do Portal

Em `UsuariosPortalPage.tsx`, no modal de edição (`EditarUsuarioModal`):
- Quando o consultor altera o campo de e-mail e salva, além de atualizar `profiles`, chamar a Edge Function com `action: "update_email"` para sincronizar o auth.

Alternativamente, posso apenas corrigir o e-mail deste usuário específico via chamada direta à Edge Function (sem alterar UI), se preferir uma correção pontual.

### Escopo
- `supabase/functions/criar-usuario/index.ts` — novo bloco `update_email`
- Deploy da edge function
- Opcionalmente: `UsuariosPortalPage.tsx` — sincronizar e-mail no auth ao editar

### Técnico
```typescript
// Novo bloco na edge function
if (action === "update_email") {
  const { user_id, novo_email } = body;
  await adminClient.auth.admin.updateUserById(user_id, { 
    email: novo_email, email_confirm: true 
  });
  await adminClient.from("profiles").update({ email: novo_email }).eq("id", user_id);
  return Response({ success: true });
}
```

