

## Plan: Add diagnostic console.logs to DreAnualTab.tsx

Three log points to add, all read-only diagnostics:

1. **After `contasComValor` memo** (after line 312): Log total values count and sample from `valoresAnuais`
2. **After `contasComValor` memo**: Find TRIBUTOS-related accounts in `contas` and log them
3. **For each TRIBUTOS account found**: Log matching values from `valoresAnuais`

All three logs will be placed together in a single `useMemo` or effect-like block right after line 312, using `contas` and `valoresAnuais` as inputs. No other changes.

### Implementation
Add a diagnostic `useMemo` block after line 314 that:
- Logs `valoresAnuais?.length` and a 5-item sample
- Filters `contas` for names containing TRIBUTO, SIMPLES, or ICMS
- Logs each match with its corresponding values from `valoresAnuais`

