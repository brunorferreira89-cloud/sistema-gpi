

## Diagnóstico: Claude recebe zeros no Painel de Análise

### Causa raiz

No `AnaliseCompletaModal.tsx`, linha 195-197, ao chamar a Edge Function `analisar-indicador`, **todos os dados financeiros são enviados como zero**:

```typescript
valor_atual: 0, valor_absoluto: 0, faturamento: 0,
status: 'verde', limite_verde: 0, limite_ambar: 0,
direcao: 'maior_melhor', historico: [], formula: '', composicao: [],
```

O Claude recebe "Valor atual: 0.0% (0 sobre faturamento 0)" e não tem dados para analisar. Por isso as análises dizem "custos zerados", "sem dados detalhados da composição" etc.

Em contraste, o `DreIndicadoresHeader` (que funciona corretamente nos cards individuais) busca `plano_de_contas` e `valores_mensais`, calcula faturamento, custos, composição detalhada com subgrupos, e envia tudo isso para a Edge Function.

### Plano de correção

**Arquivo**: `src/components/clientes/AnaliseCompletaModal.tsx`

1. **Buscar dados financeiros ao abrir o modal**: Adicionar queries para `plano_de_contas` e `valores_mensais` do cliente/competência (mesmo padrão do `DreIndicadoresHeader`).

2. **Computar valores reais por indicador**: Para cada um dos 10 indicadores, calcular:
   - `faturamento` (soma receitas)
   - `valor_absoluto` e `valor_atual` (% do faturamento)
   - `composicao` (subgrupos com valores, % fat, variação vs anterior)
   - `formula` (texto descritivo do cálculo)
   - `status` (verde/âmbar/vermelho conforme thresholds)
   - `historico` (últimos 6 meses, buscando `valores_mensais` adicionais)

3. **Buscar mês anterior para variações**: Query adicional para competência anterior, permitindo calcular `variacao_pct` na composição.

4. **Reutilizar helpers existentes**: Importar `getLeafContas` de `dre-indicadores.ts` e replicar a lógica de `getSubgroups` / `calcIndicatorValue` do `DreIndicadoresHeader` para montar o payload.

5. **Passar dados reais na chamada**: Substituir os zeros por valores calculados na função `gerarAnalise`.

### Impacto

- O Claude passará a receber dados financeiros reais (faturamento, custos, composição detalhada com nomes de contas)
- Análises geradas serão específicas e contextualizadas
- Nenhuma alteração em Edge Functions, tabelas ou outros componentes

