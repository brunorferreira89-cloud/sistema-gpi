import { useState } from 'react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { formatCurrency, type ContaRow } from '@/lib/plano-contas-utils';
import { type IndicadorDRE, calcIndicador } from '@/lib/dre-indicadores';
import { ChevronRight, Equal, Minus } from 'lucide-react';

const tipoLabels: Record<string, string> = {
  receita: 'Receitas Operacionais',
  custo_variavel: 'Custos Operacionais',
  despesa_fixa: 'Despesas Operacionais',
  investimento: 'Atividade de Investimento',
  financeiro: 'Atividade de Financiamento',
};

const tipoColors: Record<string, string> = {
  receita: 'text-primary',
  custo_variavel: 'text-red',
  despesa_fixa: 'text-amber',
  investimento: 'text-[#9333EA]',
  financeiro: 'text-txt-muted',
};

/** The formulas in subtraction form */
const formulaMap: Record<string, { label: string; parts: { label: string; tipos: string[]; op: '+' | '−' }[] }> = {
  margem_contribuicao: {
    label: 'Margem de Contribuição',
    parts: [
      { label: 'Receitas Operacionais', tipos: ['receita'], op: '+' },
      { label: 'Custos Operacionais', tipos: ['custo_variavel'], op: '−' },
    ],
  },
  resultado_operacional: {
    label: 'Resultado Operacional',
    parts: [
      { label: 'Margem de Contribuição', tipos: ['receita', 'custo_variavel'], op: '+' },
      { label: 'Despesas Operacionais', tipos: ['despesa_fixa'], op: '−' },
    ],
  },
  resultado_apos_investimentos: {
    label: 'Resultado Após Investimentos',
    parts: [
      { label: 'Resultado Operacional', tipos: ['receita', 'custo_variavel', 'despesa_fixa'], op: '+' },
      { label: 'Atividade de Investimento', tipos: ['investimento'], op: '−' },
    ],
  },
  resultado_caixa: {
    label: 'Resultado de Caixa',
    parts: [
      { label: 'Resultado Após Investimentos', tipos: ['receita', 'custo_variavel', 'despesa_fixa', 'investimento'], op: '+' },
      { label: 'Atividade de Financiamento', tipos: ['financeiro'], op: '−' },
    ],
  },
};

interface Props {
  indicador: IndicadorDRE;
  contas: ContaRow[];
  valoresMap: Record<string, number | null>;
  children: React.ReactNode;
}

export function IndicadorDetalhe({ indicador, contas, valoresMap, children }: Props) {
  const [open, setOpen] = useState(false);

  const formula = formulaMap[indicador.key];
  if (!formula) return <>{children}</>;

  const resultado = calcIndicador(contas, valoresMap, indicador.acumula);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="cursor-pointer text-left hover:underline decoration-dotted underline-offset-2 transition-colors">
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-80 p-0">
        <div className="px-4 py-3 border-b border-border bg-surface-hi rounded-t-lg">
          <h4 className="text-xs font-bold text-txt tracking-wide uppercase">{formula.label}</h4>
          <p className="text-[11px] text-txt-muted mt-0.5">Fórmula de cálculo</p>
        </div>

        <div className="px-4 py-3 space-y-2.5">
          {formula.parts.map((part, idx) => {
            const val = calcIndicador(contas, valoresMap, part.tipos);
            const isFirst = idx === 0;
            return (
              <div key={idx} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {!isFirst && (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-txt-muted shrink-0">
                      {part.op === '−' ? <Minus className="h-3 w-3" /> : '+'}
                    </span>
                  )}
                  {isFirst && (
                    <span className="flex h-5 w-5 items-center justify-center shrink-0" />
                  )}
                  <span className="text-xs text-txt truncate">{part.label}</span>
                </div>
                <span className={`text-xs font-mono font-semibold tabular-nums ${val >= 0 ? 'text-green' : 'text-destructive'}`}>
                  {formatCurrency(Math.abs(val))}
                </span>
              </div>
            );
          })}
        </div>

        <div className="mx-4 border-t border-dashed border-border" />

        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 shrink-0">
              <Equal className="h-3 w-3 text-primary" />
            </span>
            <span className="text-xs font-bold text-txt">{formula.label}</span>
          </div>
          <span className={`text-sm font-mono font-bold tabular-nums ${resultado >= 0 ? 'text-green' : 'text-destructive'}`}>
            {formatCurrency(resultado)}
          </span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
