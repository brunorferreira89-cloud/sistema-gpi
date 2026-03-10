

## Diagnóstico

O problema é que existem dados de `valores_mensais` para Fevereiro 2026 no banco, mas **não existe registro correspondente na tabela `importacoes_nibo`** para essa competência. Isso provavelmente ocorreu porque uma importação anterior foi deletada sem limpar os valores, ou os dados foram inseridos de outra forma.

O histórico de importações só mostra registros da tabela `importacoes_nibo`. Como Fevereiro não tem registro lá, o usuário não consegue excluir esses dados "órfãos".

## Solução

Adicionar uma seção de **"Competências com dados"** na aba Importação que detecta automaticamente todas as competências que possuem `valores_mensais` com `valor_realizado` preenchido, **inclusive aquelas sem registro em `importacoes_nibo`**. Para competências órfãs (dados sem registro de importação), exibir um botão de exclusão que permite limpar os dados diretamente.

### Implementação

**Arquivo: `src/components/clientes/ImportacaoTab.tsx`**

1. Adicionar uma query que busca competências distintas com dados em `valores_mensais` para as contas do cliente
2. Comparar com o histórico de `importacoes_nibo` para identificar competências "órfãs"
3. Se houver competências órfãs, exibir um alerta com lista dessas competências e botão para excluir os dados de cada uma (deletando permanentemente os registros de `valores_mensais` daquela competência)

A exclusão usará `supabase.from('valores_mensais').delete().in('conta_id', contaIds).eq('competencia', comp)` — remoção permanente conforme já definido.

