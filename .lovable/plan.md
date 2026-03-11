

## Problem

The SummaryCards (NO PLANO, ATENÇÃO, DESVIO CRÍTICO, GC PROJETADO) appear in **ANÁLISE META** mode but always show zeros/empty because the underlying calculations (`statusCounts` and `gcProjetado`) are gated by `modoMeta` (CRIAÇÃO DE METAS mode).

**Root cause** in `TorreControleTab.tsx`:
- Line 423: `if (!contas || !modoMeta) return counts;` — statusCounts only computes when CRIAÇÃO DE METAS is active
- Line 439: `if (!contas || !modoMeta) return null;` — gcProjetado only computes when CRIAÇÃO DE METAS is active
- Line 1169: `{modoAnaliseMeta && <SummaryCards .../>}` — but cards render in ANÁLISE META mode

## Fix

In `TorreControleTab.tsx`, change both guards to accept either mode:

1. **Line 423**: Change `!modoMeta` → `!(modoMeta || modoAnaliseMeta)`
2. **Line 439**: Change `!modoMeta` → `!(modoMeta || modoAnaliseMeta)` 
3. **Line 435**: Add `modoAnaliseMeta` to the `useMemo` dependency array
4. **Line 450**: Add `modoAnaliseMeta` to the `useMemo` dependency array

This ensures the status counts and GC projection are calculated whenever either mode is active, making the SummaryCards display real data in ANÁLISE META mode.

