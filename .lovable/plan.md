

## P69 — META GPI real + totalizadores dinâmicos

### AJUSTE 1 — Altímetro: META GPI → META PROPOSTA (dinâmica)

**File:** `TorreIndicadoresCriacao.tsx`

**Current state:** Line 280 has `gcBenchmark10 = totais.fat * 0.1` and the gauge uses a fixed 10% marker. The middle column in the 3-column grid shows "META GPI" with hardcoded `10.0%`.

**Changes:**
1. **Remove** `gcBenchmark10` (line 280) — it's no longer needed.
2. **Gauge SVG (lines 494-501):** Replace the fixed 10% amber marker with the `gcMetaPct` blue/primary marker. Actually, the dashed arc already represents META PROPOSTA. The amber dot at 10% should be removed entirely since the benchmark belongs in KPIs module, not here.
3. **Grid below gauge (lines 518-522):** The middle column currently shows "META GPI" with `10.0%` and `fmtR(gcBenchmark10)`. Replace with:
   - Label: "META PROPOSTA" 
   - Percentage: `gcMetaPct.toFixed(1)%` (already computed at line 201)
   - Value: `fmtR(totaisMeta.gc)`
   - Color: `C.primary` (blue, matching the dashed arc)
4. Since both the middle and right columns would now show META PROPOSTA, **restructure** to 2 columns: REALIZADO and META PROPOSTA. This avoids duplication.

Wait — re-reading the spec: "renomear label para META PROPOSTA" and "Remover completamente a referência ao benchmark fixo de 10%". The 3-column grid becomes 2 columns (REALIZADO + META PROPOSTA), and the amber marker on the gauge is removed.

### AJUSTE 2 — Totalizadores META com AV% na tabela

**File:** `TorreControleTab.tsx`

**Current state:** The totalizador rows in `renderTotalizador` already call `calcTotaisProjetado()` which uses `metaMap` — this is reactive via `useCallback` dependencies. The values already recalculate when metas change.

**What's missing:** The AV% is not shown next to the META value. The spec asks for format `"100.291 (104,5%)"`.

**Changes in `renderTotalizador`:**
1. In the **CRIAÇÃO DE METAS** mode (modoMeta, lines 1050-1069): After `fmtTorre(projVal)` in the META column (line 1065), append AV% calculated as `Math.abs(projVal) / projTotais.fat * 100`.
2. In the **ANÁLISE META** mode (modoAnaliseMeta, lines 1039-1049): Same — append AV% to the META column value.
3. In the **TODOS** mode (lines 1071-1098): Same — append AV% to the META column value.

The AV% format: `(XX.X%)` in 10px muted color next to the value.

### Summary of file changes

| File | Change |
|------|--------|
| `TorreIndicadoresCriacao.tsx` | Remove `gcBenchmark10`, remove amber 10% marker from gauge, convert 3-col grid to 2-col (REALIZADO + META PROPOSTA), use `gcMetaPct` and `totaisMeta.gc` |
| `TorreControleTab.tsx` | In `renderTotalizador`, append AV% `(XX.X%)` next to META values in all 3 modes |

No database changes. No Edge Function changes.

