

## Diagnóstico

O cache **nunca funcionou** porque o `AnaliseDrawer.tsx` usa `useParams<{ id: string }>()` (destructuring `id`), mas a rota é `/clientes/:clienteId`. Resultado: `clienteId` é sempre `undefined`, o SELECT no cache é pulado, e o upsert nunca salva.

Além disso, a tabela `analises_ia` não tem coluna `valor_atual` para comparação futura — mas como a regra é "fixar por competência", basta corrigir o param e o cache funcionará.

## Plano — Modificar apenas `AnaliseDrawer.tsx`

### 1. Corrigir useParams
Mudar de `useParams<{ id: string }>()` para `useParams<{ clienteId: string }>()` e usar diretamente `clienteId`.

### 2. Garantir que o cache funcione
A lógica atual já está correta (SELECT → se achou retorna → senão chama Edge Function → upsert). O problema era apenas o `clienteId` undefined. Com a correção do param, o fluxo funciona:
- Primeira abertura: não encontra cache → chama Claude → salva em `analises_ia`
- Aberturas subsequentes: encontra cache → exibe imediatamente → não chama Claude
- Botão "Atualizar análise": força nova chamada e sobrescreve cache

### Escopo estrito
- Modificar: `AnaliseDrawer.tsx` — apenas a linha do `useParams`
- Não alterar: Edge Function, DreIndicadoresHeader, tabelas, outros componentes

