

## Sobre a lógica das tags de tipo

As tags (Receita, Custo Variável, Despesa Fixa, Investimento, Financeiro) vêm de **classificação automática por nome** na função `classifyTipo()` em `src/lib/plano-contas-utils.ts`. Ela usa regex no nome da conta:
- Nomes com "receita", "faturamento", "venda" → **Receita**
- Nomes com "cmv", "insumo", "imposto", "taxa" → **Custo Variável**
- Nomes com "aluguel", "folha", "energia" → **Despesa Fixa**
- Nomes com "marketing", "capex" → **Investimento**
- Nomes com "empréstimo", "retirada" → **Financeiro**
- Fallback → **Despesa Fixa**

Essa classificação é aplicada **apenas no momento da importação** (XLSX ou cópia de outro cliente). Depois, o valor é salvo na coluna `tipo` da tabela `plano_de_contas` e nunca mais recalculado. Porém, **não existe UI para editar o tipo** depois de salvo — como mostra a imagem, contas como "Gas" e "Bebidas - Refrigerantes" ficaram com classificação errada (Despesa Fixa em vez de Custo Variável).

## Plano de implementação

### Edição inline do tipo na ContasTree

Tornar a badge de tipo clicável. Ao clicar, exibir um `<select>` dropdown inline (mesmo padrão visual do rename inline já existente) com as 5 opções de tipo. Ao selecionar, salvar imediatamente no banco via `supabase.from('plano_de_contas').update({ tipo }).eq('id', contaId)` e fazer refresh.

**Arquivo editado:** `src/components/plano-contas/ContasTree.tsx`

Alterações no componente `SortableRow`:
1. Adicionar estado `editingTipo` (boolean) e `tipoValue` (string)
2. Tornar a badge de tipo clicável (`onClick → setEditingTipo(true)`)
3. Quando `editingTipo === true`, renderizar um `<select>` com as opções de `tipoLabels` no lugar da badge
4. No `onChange` do select: salvar via `onChangeTipo(contaId, newTipo)` e fechar
5. Adicionar prop `onChangeTipo` ao `SortableRow`, implementar no componente pai com update no Supabase + `onRefresh()`

Nenhuma migração de banco necessária — a coluna `tipo` já existe e aceita qualquer texto.

