

## Diagnóstico

O visual está errado porque o cliente está caindo na rota `/minha-area` (layout mobile de 430px) ao invés de `/cliente` (portal full-width).

**Causa raiz** encontrada em duas camadas:

1. **Edge function `criar-usuario`** (linha 145): ao criar usuário cliente, define explicitamente `portal_ativo: false`
   ```ts
   portal_ativo: finalRole === "cliente" ? false : true,
   ```

2. **PortalRoute.tsx** (linha 19): verifica `profile?.portal_ativo` — como é `false`, redireciona para `/minha-area`
   ```ts
   if (!profile?.portal_ativo) return <Navigate to="/minha-area" replace />;
   ```

**Fluxo atual**: Login → `/cliente` → PortalRoute vê `portal_ativo=false` → redireciona → `/minha-area` → ClienteLayout (430px) → MinhaAreaPage

**Fluxo desejado**: Login → `/cliente` → PortalRoute permite → PortalLayout (full-width) → ClientePortalPage

## Plano de correção

### 1. PortalRoute.tsx — Verificar acesso real via `portal_usuario_clientes`

Substituir a checagem simples de `profile?.portal_ativo` por uma query à tabela `portal_usuario_clientes`, que é a fonte de verdade do acesso ao portal (é onde o fluxo de criação de usuário insere os registros com `ativo: true`).

Alternativamente, a abordagem mais simples: remover a checagem de `portal_ativo` do PortalRoute e deixar o `ClientePortalPage` tratar internamente o estado de "sem acesso" (ele já faz isso — mostra tela de "nenhuma empresa vinculada").

**Abordagem recomendada**: Remover a linha `if (!profile?.portal_ativo)` do PortalRoute. O ClientePortalPage já verifica acesso real via `portal_usuario_clientes` e exibe estados adequados.

### 2. Edge function `criar-usuario` — Corrigir `portal_ativo`

Alterar linha 145 para definir `portal_ativo: true` quando o role é `cliente`, alinhando com o fato de que o acesso real já é controlado por `portal_usuario_clientes`.

### 3. AuthContext — Atualizar campo `portal_ativo` (opcional)

Se removermos a checagem no PortalRoute, não é estritamente necessário mudar o AuthContext. Mas para consistência, poderíamos fazer o `fetchProfile` também checar `portal_usuario_clientes`. Porém isso adiciona complexidade desnecessária — o ClientePortalPage já faz essa verificação.

## Arquivos alterados

| Arquivo | Alteração |
|---------|-----------|
| `src/components/PortalRoute.tsx` | Remover checagem de `portal_ativo` (linha 19) |
| `supabase/functions/criar-usuario/index.ts` | Mudar `portal_ativo: false` para `true` na linha 145 |

## Resultado esperado

Cliente faz login → vai para `/cliente` → PortalRoute permite (role=cliente + sessão) → ClientePortalPage full-width com dados financeiros.

