

## Diagnóstico do problema

O Nibo importa valores para **todos os níveis** da hierarquia de contas — tanto para sub-grupos (nível 2, como "(-) INSUMOS" = -41.324) quanto para suas contas-filhas (nível 3, como "(-) Insumos" = -20.183 + "(-) Gás" = -958). O `calcIndicador` ignora apenas contas `is_total=true` (nível 1), mas soma as de nível 2 e 3 juntas, causando **dupla contagem**.

Exemplo concreto para Janeiro 2026:
- "(+) RECEITAS" (nível 2) = R$ 81.293,22 ← soma dos filhos
- Filhos nível 3: PIX 12.301 + Ifood 26.594 + Crédito 20.554 + Débito 17.481 + Site 4.370 - Troco 10 = R$ 81.293,22
- **`calcIndicador` soma ambos** → R$ 162.586 (errado, deveria ser R$ 81.293)

O mesmo bug afeta **todos os locais** que somam contas por tipo: DRE Financeira, Torre de Controle (tab e página), KPIs e Indicadores.

## Solução

Criar uma função utilitária `getLeafContas(contas)` que identifica contas "folha" (sem filhos). Uma conta é folha se a próxima conta na ordem tem nível ≤ ao dela, ou se é a última. Usar essa função em todos os cálculos.

### Arquivos a alterar

**1. `src/lib/dre-indicadores.ts`**
- Adicionar `isLeafConta(contas, index)` — retorna `true` se a próxima conta tem `nivel ≤ atual` ou não existe
- Adicionar `getLeafContas(contas)` — filtra apenas folhas
- Atualizar `calcIndicador` para usar apenas contas folha (skip de `is_total` E de contas com filhos)

**2. `src/components/clientes/DreAnualTab.tsx`**
- Importar `getLeafContas` 
- Corrigir `faturamentoPorMes` para somar apenas folhas de receita

**3. `src/components/clientes/TorreControleTab.tsx`**
- Corrigir cálculo de `faturamento` (linhas 112-122) para usar apenas folhas

**4. `src/pages/TorrePage.tsx`**
- Corrigir `faturamento`, `custos`, `despesas` (linhas 114-134) para usar apenas folhas

**5. `src/lib/kpi-utils.ts`**
- Refatorar para usar `calcIndicador` com contas folha em vez de busca por keywords
- Faturamento = soma das folhas de `receita`
- MC = `calcIndicador` com `['receita', 'custo_variavel']`
- CMV = soma das folhas de `custo_variavel`
- CMO = buscar conta de pessoal (folhas de `despesa_fixa` com keyword "pessoal/salário")
- Despesas fixas = soma das folhas de `despesa_fixa`
- GC = calcIndicador com todos os 5 tipos (= Resultado de Caixa)

**6. `src/components/clientes/IndicadorDetalhe.tsx`**
- Já usa `calcIndicador` internamente, será corrigido automaticamente

### Lógica da função isLeaf

```text
function isLeafConta(contas: ContaRow[], index: number): boolean {
  const conta = contas[index];
  if (conta.is_total) return false;
  const next = contas[index + 1];
  // É folha se não há próxima ou próxima tem nivel ≤ atual
  return !next || next.nivel <= conta.nivel;
}
```

Isso garante que sub-grupos como "(-) INSUMOS" (nível 2, seguido por "(-) Insumos" nível 3) sejam corretamente excluídos do cálculo.

