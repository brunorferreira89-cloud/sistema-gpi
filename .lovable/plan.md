

# Fix: Botões %, R$, =R$ não funcionam na Torre de Controle

## Problema
Quando o usuário clica num botão de tipo (%, R$, =R$) enquanto o input está focado, a sequência de eventos é:
1. Input perde foco → `onBlur` dispara → `commit()` salva com o tipo antigo e fecha a edição (`setEditing(false)`)
2. Botões são desmontados antes do `onClick` disparar
3. Resultado: o tipo nunca muda

## Solução
Adicionar `onMouseDown={(e) => e.preventDefault()}` nos botões de tipo. Isso impede que o input perca o foco quando o botão é clicado, permitindo que o `onClick` do botão execute normalmente.

## Arquivo
`src/components/clientes/TorreControleTab.tsx`

## Alteração
Linha ~226: nos botões dentro de `renderTipoToggle`, adicionar `onMouseDown`:
```tsx
<button
  key={b.tipo}
  onMouseDown={(e) => e.preventDefault()}   // ← ADICIONAR
  onClick={(e) => { e.stopPropagation(); switchTipo(b.tipo); }}
  style={...}
>
```

Uma única linha adicionada. Nenhuma outra alteração.

