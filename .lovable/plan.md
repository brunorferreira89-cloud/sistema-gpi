

## Diagnóstico

O bug está em `calcProjetado` (em `torre-utils.ts`). Quando `anterior = 0` (mês selecionado sem valor), a função determina o sinal do valor projetado a partir de `anterior`:

```typescript
const sign = anterior < 0 ? -1 : 1;
return sign * Math.abs(meta.meta_valor);
```

Como `0` não é negativo, `sign = +1`, e custos/despesas saem com sinal **positivo** em vez de negativo. Isso faz valores como Contabilidade (+1.139), Aluguel de Veículos (+2.800) e Consultoria (+2.500) **anularem** parcialmente o total do subgrupo, resultando em META (2.512) em vez de um valor maior que (9.311).

O mesmo problema afeta `meta_tipo = 'delta'`: `0 + valor_positivo = positivo`, quando deveria ser negativo para custos.

## Plano de Correção

### 1. `src/lib/torre-utils.ts` — `calcProjetado`

Adicionar parâmetro opcional `contaTipo?: string`. Quando `anterior = 0`, determinar o sinal a partir do tipo da conta:

```typescript
export function calcProjetado(
  anterior: number,
  meta: TorreMeta | null,
  contaTipo?: string
): number | null {
  if (!meta || meta.meta_valor === null) return null;
  if (meta.meta_tipo === 'pct') return anterior * (1 + meta.meta_valor / 100);
  if (meta.meta_tipo === 'delta') {
    const result = anterior + meta.meta_valor;
    // When anterior=0, delta>0 for costs should be negative
    if (anterior === 0 && result > 0 && contaTipo && contaTipo !== 'receita') {
      return -result;
    }
    return result;
  }
  // valor absoluto
  const sign = anterior === 0
    ? (contaTipo && contaTipo !== 'receita' ? -1 : 1)
    : (anterior < 0 ? -1 : 1);
  return sign * Math.abs(meta.meta_valor);
}
```

### 2. `src/components/clientes/TorreControleTab.tsx` — Propagar `contaTipo`

Atualizar todas as chamadas a `calcProjetado` e `sumNodeProjetado` para passar o tipo da conta:

- **`sumNodeProjetado`**: Na linha do `nivel === 2`, passar `node.conta.tipo`:
  ```typescript
  const proj = calcProjetado(real, meta, node.conta.tipo);
  ```

- **Cálculo de `projetado`** (~linha 1036): Passar `conta.tipo`:
  ```typescript
  calcProjetado(realSel, meta, conta.tipo)
  ```

- **`calcPctFromChildren`** (~linha 638): Passar `kid.tipo` / `gk.tipo`:
  ```typescript
  const proj = m ? calcProjetado(r, m, kid.tipo) : null;
  ```

- **`calcVariacao`** (~linha 839): Passar `conta.tipo`.

- **`gcProjetado`** (~linha 813): Passar `c.tipo`.

- **`statusCounts`** (~linha 796): Passar tipo da conta.

### Escopo

- Alterações **apenas** em `torre-utils.ts` (assinatura de `calcProjetado`) e `TorreControleTab.tsx` (passar o parâmetro nas chamadas).
- Nenhuma outra função, componente ou modo é alterado.
- O parâmetro é opcional — chamadas existentes em outros arquivos continuam funcionando (sem `contaTipo`, comportamento antigo preservado para `anterior ≠ 0`).

