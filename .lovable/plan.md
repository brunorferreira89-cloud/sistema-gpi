

## Problem Analysis

The spreadsheet contains negative values (e.g., "(-) Troco" = `-10`), but the parser strips all signs with `Math.abs()` and stores everything as positive in the database. 

The DRE display component tries to reconstruct the sign from the account name prefix, but the stored account names in `plano_de_contas` don't have the `(+)`/`(-)` prefix (e.g., "Troco" not "(-) Troco"). So the sign reconstruction fails.

**Root cause chain:**
1. `nibo-dre-parser.ts` line 147: `val = Math.abs(valCell.v)` — discards negative sign
2. Import saves positive `10` to `valores_mensais` for Troco
3. DRE checks `hasPrefixMinus("Troco")` → `false` → treats as positive
4. Troco adds +10 instead of -10 → Receitas = 81,313 instead of 81,293

## Fix Plan (3 changes)

### 1. Parser: Preserve original sign (`nibo-dre-parser.ts`)
Remove `Math.abs()` from value parsing. Store the raw value as-is from the spreadsheet.

Lines 146-151: Change from `Math.abs(valCell.v)` to just `valCell.v` (preserve sign).

### 2. Import save: Allow negative values to flow through
Both `ImportNiboDialog.tsx` (line 121) and `ImportacaoNiboPage.tsx` (line 168) already just pass the parsed value directly — no `Math.abs` there. So no change needed in save logic.

### 3. DRE display: Use actual value sign, not name prefix (`DreAnualTab.tsx`)
Stop relying on `hasPrefixMinus(nome)` for sign detection. Instead, use the actual sign of the stored value:
- `sumLeafsOfNode`: Return `raw` as-is (it's already signed correctly from DB)
- `calcIndicadorValue`: Use value sign directly — positive receita adds, negative receita subtracts naturally
- `faturamentoPorMes`: Same — just sum raw values for receita type
- Display: Negative values already show red with parentheses via `fmtVal`

### Scope
- `src/lib/nibo-dre-parser.ts` — remove `Math.abs()` from value parsing
- `src/components/clientes/DreAnualTab.tsx` — simplify sign logic to use raw DB values
- No changes to: layout, plano_de_contas, ContasTree, routes, sidebar

### Expected results after re-import
- Troco stored as `-10` in DB
- Receitas Operacionais: 81,293
- MC: 40,711 (50.1%)

**Note:** After deploying these changes, the user must re-import the DRE spreadsheet for the client Regalo to get the corrected values stored in the database.

