

## Diagnóstico

O botão "Salvar" está desabilitado porque a condição é `disabled={Object.keys(editedFields).length === 0}`. O estado `editedFields` só é preenchido quando o usuário **edita manualmente** um bloco de texto. Quando a IA gera os 4 blocos, os dados são salvos diretamente no banco pela função `handleGenerate`, mas `editedFields` permanece vazio — logo o botão fica cinza/desabilitado.

Na prática, após a IA gerar, os dados **já estão salvos** no banco. Mas isso não é claro para o usuário, que espera poder clicar "Salvar".

## Solução

No `PrepararApresentacao.tsx`, linha ~352, alterar a lógica do botão Salvar:

1. **Remover o `disabled`** do botão Salvar — ele deve estar sempre habilitado quando há conteúdo (prep não nulo).
2. Ajustar a condição para: `disabled={!prep}` (desabilita apenas se não houver nenhum dado carregado).
3. Quando não há campos editados, o `handleSaveAll` pode simplesmente mostrar um toast informativo "Nenhuma alteração pendente" ou salvar normalmente sem alterações.

Alternativa mais elegante: mudar para `disabled={!prep || saving}` onde `saving` é o estado de loading do save.

### Arquivo alterado
- `src/components/apresentacao/PrepararApresentacao.tsx` — apenas a linha do `disabled` do botão Salvar.

