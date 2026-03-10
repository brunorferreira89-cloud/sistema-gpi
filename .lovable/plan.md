

## Plano: Centralizar funcionalidades financeiras dentro da ficha do cliente

### Resumo
Mover Torre/DRE, KPIs, Alertas, Importação Nibo e Plano de Contas para dentro de `ClienteFichaPage` como novas abas. Remover os links correspondentes da sidebar. Diagnósticos permanece como página independente (é baseado em leads, não em clientes existentes).

### Novas abas no ClienteFichaPage
As abas passarão de:
`Visão Geral | Onboarding | Treinamento | Contato`

Para:
`Visão Geral | Financeiro | KPIs | Alertas | Onboarding | Treinamento | Contato`

Onde:
- **Financeiro** = Torre/DRE + Importação Nibo + Plano de Contas (agrupados com sub-seções colapsáveis ou sub-tabs internas)
- **KPIs** = conteúdo da página KPIsPage, sem o seletor de cliente
- **Alertas** = conteúdo da AlertasPage, sem o seletor de cliente

### Arquivos a criar (componentes de aba por cliente)

| Componente | Base | Diferença |
|---|---|---|
| `src/components/clientes/FinanceiroTab.tsx` | TorrePage + ImportacaoNiboPage + PlanoDeContasClientePage | Recebe `clienteId` via prop, sem seletor de cliente. Contém 3 seções: DRE, Importação, Plano de Contas |
| `src/components/clientes/KPIsTab.tsx` | KPIsPage | Recebe `clienteId` via prop, sem seletor de cliente |
| `src/components/clientes/AlertasTab.tsx` | AlertasPage | Recebe `clienteId` via prop, sem seletor de cliente |

### Arquivos a editar

| Arquivo | Mudança |
|---|---|
| `src/pages/ClienteFichaPage.tsx` | Adicionar 3 novas TabsTrigger + TabsContent importando os novos componentes |
| `src/components/AppSidebar.tsx` | Remover itens: Torre/DRE, Importação Nibo, KPIs, Alertas, Plano de Contas |
| `src/App.tsx` | Remover rotas standalone: `/torre-de-controle`, `/importacao-nibo`, `/kpis`, `/alertas`, `/plano-de-contas`, `/plano-de-contas/:clienteId` |

### Abordagem para a aba Financeiro
Agrupar DRE, Importação e Plano de Contas em seções colapsáveis dentro de uma única aba, usando `Collapsible` do Radix:

```text
┌─ Financeiro (tab) ──────────────────────┐
│                                         │
│  ▼ Torre de Controle / DRE              │
│    [seletor competência] [importar]     │
│    [tabela DRE com realizado vs meta]   │
│                                         │
│  ▼ Importação Nibo                      │
│    [seletor competência] [importar]     │
│    [histórico de importações]           │
│                                         │
│  ▼ Plano de Contas                      │
│    [importar xlsx] [copiar de outro]    │
│    [árvore de contas]                   │
└─────────────────────────────────────────┘
```

### O que NÃO muda
- Diagnósticos (página de leads independente)
- Dashboard, Kanban, Reuniões, Reunião Coletiva, Onboarding (sidebar)
- Banco de dados (nenhuma migração necessária)
- Lógica de cálculo (kpi-utils, plano-contas-utils, nibo-import-utils)
- Área do Cliente (ClienteLayout/MinhaAreaPage)

