

## Diagnóstico

Encontrei **duas referências residuais** que ainda redirecionam clientes para `/minha-area`:

1. **`src/pages/LoginPage.tsx` (linha 18)**: Após login bem-sucedido, o `useEffect` redireciona clientes para `/minha-area`
   ```tsx
   if (profile.role === 'cliente') {
     navigate('/minha-area', { replace: true });  // ← aqui
   }
   ```

2. **`src/components/ProtectedRoute.tsx` (linha 24)**: Quando um cliente tenta acessar uma rota de admin/consultor, é redirecionado para `/minha-area`
   ```tsx
   if (profile.role === 'cliente') return <Navigate to="/minha-area" replace />;
   ```

O `RootRedirect` já foi corrigido, mas o `LoginPage` executa primeiro (via `useEffect`) e "ganha a corrida".

## Plano

| Arquivo | Linha | Alteração |
|---------|-------|-----------|
| `src/pages/LoginPage.tsx` | 18 | `/minha-area` → `/cliente` |
| `src/components/ProtectedRoute.tsx` | 24 | `/minha-area` → `/cliente` |

Duas linhas. Nada mais.

