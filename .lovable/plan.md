
# Análise: Grupos abaixo de Resultado Operacional não aparecem na DRE

## Diagnóstico

Após investigar o banco de dados e o código de importação, identifiquei a causa raiz:

### Os dados de Investimento e Financeiro nunca foram importados

A tabela `valores_mensais` **não possui nenhum registro** para contas dos tipos `investimento` e `financeiro` deste cliente. Os dois arquivos importados (`painel_realizado_2026-03-20.xlsx`) inseriram **27 contas mapeadas** — todas dos tipos `receita`, `custo_variavel` e `despesa_fixa`.

O plano de contas está completo (tem 8 contas de investimento e 11 de financeiro no nível 2), mas sem valores importados para elas.

### Por que a importação não trouxe esses dados?

A exportação DRE do Nibo (arquivo "painel_realizado") tipicamente contém apenas a parte operacional:
- Receitas Operacionais
- Custos Operacionais
- Despesas Operacionais

As categorias de **Atividades de Investimento** e **Atividades de Financiamento** geralmente estão em um relatório separado no Nibo (DFC — Demonstração do Fluxo de Caixa), não no DRE Gerencial.

### Possibilidade adicional: filtro do parser

O parser (`nibo-dre-parser.ts`) possui uma lista `LINHAS_IGNORADAS` que inclui a string `'resultado'`. A função `deveIgnorar()` usa `startsWith()`, o que poderia filtrar linhas como "Resultado após investimentos" — mas isso são totalizadores, não categorias. O filtro `isCategoriaReal` também rejeita linhas ALL CAPS (tratando-as como totalizadores), mas com `contasDoPlano` fornecido, ele deveria aceitar linhas que correspondam ao plano. Se as linhas de investimento/financeiro existem no XLSX mas com nomes diferentes do plano, a correspondência falha silenciosamente.

## Recomendações (escolha uma abordagem)

### Opção A — Verificar o conteúdo real dos XLSX
Analisar os dois arquivos XLSX enviados para confirmar se contêm ou não as linhas de investimento/financeiro. Se contêm, o problema está no parser e precisa de correção. Se não contêm, o usuário precisa exportar o relatório correto do Nibo.

### Opção B — Melhorar o parser para reportar contas não encontradas
Adicionar um log/alerta na importação mostrando quais contas do plano NÃO foram encontradas no arquivo, para que o usuário saiba que dados estão faltando.

### Opção C — Nenhuma alteração de código
Se os arquivos Nibo realmente não trazem essas categorias, orientar o usuário a exportar o relatório de Fluxo de Caixa (DFC) do Nibo e importá-lo separadamente, ou inserir os valores manualmente.

## Próximo passo sugerido

Posso **analisar o conteúdo dos dois XLSX enviados** para confirmar se as linhas de investimento e financeiro estão presentes. Isso definirá se é um problema de dados (Nibo não exportou) ou de código (parser filtrou incorretamente).
