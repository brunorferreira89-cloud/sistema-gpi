

## Diagnóstico

O problema tem duas causas:

1. **Dados reais existem em Fevereiro no banco de dados.** Os registros de Fevereiro foram criados em `2026-03-09T23:43:12` (importação anterior), e os de Janeiro em `2026-03-10T00:27:25` (importação recente). A importação de Janeiro não apaga dados de outros meses -- ela apenas insere/atualiza na competência selecionada.

2. **Bug na query de valores da DRE.** A query `valores-mensais-torre` usa `contas` do escopo externo mas não o inclui como dependência no `enabled` nem no `queryKey`. Quando `contas` ainda não carregou, o resultado fica vazio e pode ser cacheado incorretamente.

## Plano de correção

### 1. Corrigir dependência da query de valores (`FinanceiroTab.tsx`)

Adicionar `contas` como dependência na query de valores:
- `enabled: !!clienteId && !!competencia && !!contas?.length`
- Incluir `contas?.length` no queryKey para forçar re-fetch quando contas carregar

### 2. Limpar dados antigos de Fevereiro (ação manual ou automática)

A abordagem mais segura: ao importar uma planilha Nibo, o sistema não deve interferir em outros meses. Os dados de Fevereiro vieram de uma importação anterior legítima.

**Solução:** O usuário pode excluir a importação de Fevereiro usando o botão de exclusão. Porém, atualmente a exclusão não remove os `valores_mensais` associados. Vou corrigir `handleDeleteConfirm` no `ImportActionDialog.tsx` para também limpar os `valor_realizado` da competência excluída.

### Arquivos a editar

| Arquivo | Mudança |
|---|---|
| `src/components/clientes/FinanceiroTab.tsx` | Corrigir dependência da query de valores (enabled + queryKey) |
| `src/components/importacao/ImportActionDialog.tsx` | Ao excluir importação, também limpar `valor_realizado` dos `valores_mensais` da competência correspondente |

