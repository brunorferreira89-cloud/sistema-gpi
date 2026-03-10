

## Diagnosis

The bug is in **two calculation functions** that don't apply the category prefix sign:

1. **`calcIndicadorValue`** (line 75-86): For `receita` type, it does `total += v` without checking if the category name starts with `(-)`. So "(-) Troco" (value=10) is added as +10 instead of -10, causing +20 error.

2. **`faturamentoPorMes`** (line 195-208): Same issue — sums all receita leaf values as positive without prefix check.

The `sumLeafsOfNode` function (used for group/subgroup rows) already correctly applies the sign via `hasPrefixMinus()`. The indicator and faturamento calculations bypass this.

## Fix

### Change 1: `calcIndicadorValue` (line 75-86)
Add sign logic based on category name prefix:
- If category name starts with `(-)` → subtract `Math.abs(v)`
- If category name starts with `(+)` or no prefix → add `Math.abs(v)`
- Keep the existing `receita` vs non-receita sign logic (receita adds, others subtract from total)
- Within each type, respect the individual category prefix

### Change 2: `faturamentoPorMes` (line 195-208)
Apply the same prefix-based sign when summing receita values for faturamento calculation.

### Temporary diagnostic
Add `console.log` inside the receita leaf loop to confirm values and signs before removing it.

### Expected result
- Receitas: 81.293 (not 81.313)
- MC: 40.711 (50.1%)

