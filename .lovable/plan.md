

## Diagnóstico

**"Metas definidas na Torre" não marca**: A query do checklist busca `torre_metas WHERE competencia = '2026-02-01'` (o mês da DRE selecionada). Porém, a Torre de Controle salva metas para o **mês seguinte** (`2026-03-01`). Resultado: 0 registros encontrados, checklist fica desmarcado.

**"Reunião agendada" não é clicável**: Atualmente apenas o item "Slides revisados" (índice 3) aceita clique manual. "Reunião agendada" (índice 4) tem `disabled={i !== 3}`.

## Plano de Implementação

### 1. Corrigir query de metas no checklist

Na linha 123-124 de `PrepararApresentacao.tsx`, alterar a query para buscar metas do **mês seguinte** à competência selecionada:

```typescript
// Calcular mês seguinte
const compDate = new Date(competencia + 'T00:00:00');
const mesSeg = new Date(compDate.getFullYear(), compDate.getMonth() + 1, 1)
  .toISOString().split('T')[0];

const { count: metasCount } = await supabase
  .from('torre_metas')
  .select('id', { count: 'exact', head: true })
  .eq('cliente_id', clienteId)
  .eq('competencia', mesSeg);
```

### 2. Tornar "Reunião agendada" clicável

Na renderização do checklist (linhas 530-538):
- Permitir clique no índice 4 (além do 3)
- Ao marcar manualmente, abrir o `ReuniaoDialog` para agendar uma reunião
- Ao desmarcar, apenas atualizar o estado local (não cancelar reunião)
- Se já detectada automaticamente como marcada, continuar mostrando marcada

Mudanças:
- `disabled` passa de `i !== 3` para `i !== 3 && i !== 4`
- No `onCheckedChange` do índice 4: se marcando (true), abrir dialog de agendamento com `preselectedClienteId`
- Importar `ReuniaoDialog` e adicionar estado `reuniaoDialogOpen`
- Após salvar reunião no dialog, re-checar `reuniaoAgendada` no estado

### Arquivos alterados

Apenas `src/components/apresentacao/PrepararApresentacao.tsx`:
- Import de `ReuniaoDialog`
- Estado `reuniaoDialogOpen`
- Query de metas corrigida (mês seguinte)
- Checklist: índice 4 clicável, abre dialog de reunião

