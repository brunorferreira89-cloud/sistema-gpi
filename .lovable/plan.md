

## Diagnóstico: Conta "Aplicação" não importada

### Causa raiz

No arquivo exportado do Nibo, a conta "Aplicação" aparece **sem prefixo** `(+)` ou `(-)`:

```
(-) DIVERSOS                    | -30000
Aplicação                       | -30000    ← sem prefixo!
```

No parser `src/lib/nibo-dre-parser.ts`, **linha 167**, existe um filtro rígido:

```typescript
if (!nomeOriginal.startsWith('(')) continue; // Only lines with prefix (+) or (-)
```

Isso descarta qualquer linha que não comece com `(`. Como "Aplicação" não tem prefixo, é silenciosamente ignorada na importação.

### Plano de correção

**Arquivo**: `src/lib/nibo-dre-parser.ts` — apenas a lógica de filtragem de linhas.

1. **Relaxar o filtro da linha 167**: Em vez de exigir que toda linha comece com `(`, permitir também linhas que correspondam a uma conta do plano de contas (`nomesNormalizados`). Quando `contasDoPlano` é fornecido, a verificação `isCategoriaReal` na linha 168 já valida contra o plano — basta deixar essas linhas passarem pelo filtro de prefixo.

   Lógica proposta:
   ```typescript
   // Skip lines without prefix UNLESS they match the chart of accounts
   if (!nomeOriginal.startsWith('(')) {
     if (!nomesNormalizados || !isCategoriaReal(nomeOriginal, nomesNormalizados, nomesComPrefixo)) {
       continue;
     }
   }
   ```

2. **Sem contasDoPlano (fallback heurístico)**: Manter o filtro original — sem prefixo e sem plano de contas, a linha é ignorada (comportamento seguro existente).

3. **Nenhuma outra alteração**: Não mexer em Edge Functions, tabelas, outros parsers ou componentes.

### Impacto

- Contas como "Aplicação" que existem no plano de contas do cliente mas aparecem sem prefixo no Nibo passarão a ser importadas corretamente.
- Contas COM prefixo continuam funcionando exatamente como antes.
- Após a correção, o cliente precisará reimportar o mês de Janeiro 2026 para que o valor de R$ 30.000 apareça na DRE.

