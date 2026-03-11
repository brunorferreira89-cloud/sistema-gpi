import { useEffect, useRef } from 'react';

const C = {
  primary: '#1A3CFF', cyan: '#0099E6', green: '#00A86B', amber: '#D97706', red: '#DC2626',
  bg: '#F0F4FA', bgAlt: '#E8EEF8', surface: '#FFFFFF', border: '#DDE4F0', borderStr: '#C4CFEA',
  txt: '#0D1B35', txtSec: '#4A5E80', txtMuted: '#8A9BBC',
  mono: "'Courier New', monospace",
};

type IndicadorTipo = 'altimetro' | 'ganho_rapido' | 'projecao_rota' | 'fat' | 'custo' | 'mc' | 'desp' | 'ro' | 'invest' | 'financ' | 'gc';

interface IndicadorDados {
  faturamento: number;
  custos: number;
  mc: number;
  despesas: number;
  ro: number;
  investimentos: number;
  financeiro: number;
  gc: number;
  fatMeta: number;
  custosMeta: number;
  mcMeta: number;
  despesasMeta: number;
  roMeta: number;
  investMeta: number;
  financMeta: number;
  gcMeta: number;
  gcPct: number;
  gcMetaPct: number;
  ganhoRapidoNome: string;
  ganhoRapidoPct: number;
  ganhoRapidoValor: number;
  projecaoValor: number;
  projecaoTendencia: 'queda' | 'melhora';
  mesBase: string;
  mesProximo: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  tipo: IndicadorTipo;
  dados: IndicadorDados;
}

const fmtR = (v: number) => {
  const abs = Math.abs(v);
  const s = abs.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  return v < 0 ? `(${s.replace('-', '')})` : s;
};

const TITULOS: Record<IndicadorTipo, { eyebrow: string; titulo: string; subtitulo: string }> = {
  altimetro: { eyebrow: '◈ ALTÍMETRO FINANCEIRO', titulo: 'Geração de Caixa', subtitulo: 'Análise da altitude financeira atual vs. benchmark GPI' },
  ganho_rapido: { eyebrow: '⚡ GANHO RÁPIDO', titulo: 'Oportunidade de Redução', subtitulo: 'Conta com maior impacto na Geração de Caixa' },
  projecao_rota: { eyebrow: '🔮 PROJEÇÃO DE ROTA', titulo: 'Tendência Projetada', subtitulo: 'Cenário projetado sem ajuste de metas' },
  fat: { eyebrow: '📊 FATURAMENTO', titulo: 'Receita Bruta', subtitulo: 'Soma de todas as contas de receita' },
  custo: { eyebrow: '📊 CUSTOS OPERACIONAIS', titulo: 'Custos Variáveis', subtitulo: 'Custos diretamente ligados à operação' },
  mc: { eyebrow: '📊 MARGEM DE CONTRIBUIÇÃO', titulo: 'Margem de Contribuição', subtitulo: 'Faturamento menos custos operacionais' },
  desp: { eyebrow: '📊 DESPESAS FIXAS', titulo: 'Despesas Fixas', subtitulo: 'Despesas recorrentes da operação' },
  ro: { eyebrow: '📊 RESULTADO OPERACIONAL', titulo: 'Resultado Operacional', subtitulo: 'Margem de contribuição menos despesas fixas' },
  invest: { eyebrow: '📊 ATIV. INVESTIMENTO', titulo: 'Atividades de Investimento', subtitulo: 'Investimentos e aplicações' },
  financ: { eyebrow: '📊 ATIV. FINANCIAMENTO', titulo: 'Atividades de Financiamento', subtitulo: 'Operações financeiras e empréstimos' },
  gc: { eyebrow: '📊 GERAÇÃO DE CAIXA', titulo: 'Geração de Caixa', subtitulo: 'Resultado final da operação financeira' },
};

const FORMULAS: Record<IndicadorTipo, string> = {
  altimetro: 'GC = Resultado Operacional − Investimentos + Financiamentos',
  ganho_rapido: 'Score = |Valor Realizado| × (Meta% / 100)\nMaior score entre custos e despesas = Ganho Rápido',
  projecao_rota: 'Projeção = Média(GC mês-1, GC mês-2)\nTendência calculada sem ajuste de metas',
  fat: 'Faturamento = Σ contas tipo "receita"',
  custo: 'Custos Operacionais = Σ contas tipo "custo_variavel"',
  mc: 'MC = Faturamento + Custos Operacionais',
  desp: 'Despesas Fixas = Σ contas tipo "despesa_fixa"',
  ro: 'RO = MC + Despesas Fixas',
  invest: 'Investimentos = Σ contas tipo "investimento"',
  financ: 'Financiamentos = Σ contas tipo "financeiro"',
  gc: 'GC = RO + Investimentos + Financiamentos',
};

function getExplicacao(tipo: IndicadorTipo, dados: IndicadorDados): string {
  switch (tipo) {
    case 'altimetro':
      return `O benchmark GPI recomenda uma Geração de Caixa de pelo menos 10% sobre o faturamento. Atualmente a GC está em ${dados.gcPct.toFixed(1)}%, ${dados.gcPct >= 10 ? 'acima' : 'abaixo'} do benchmark. A meta proposta projeta ${dados.gcMetaPct.toFixed(1)}% de GC.`;
    case 'ganho_rapido':
      return `A conta "${dados.ganhoRapidoNome}" foi identificada como a maior oportunidade de ganho. Uma redução de ${dados.ganhoRapidoPct.toFixed(0)}% nesta conta liberaria ${fmtR(dados.ganhoRapidoValor)} para a Geração de Caixa.`;
    case 'projecao_rota':
      return `Sem nenhum ajuste de meta, a tendência projetada para o próximo mês é de ${fmtR(dados.projecaoValor)}. ${dados.projecaoTendencia === 'queda' ? 'Há indicação de queda, reforçando a necessidade de ajustes nas metas.' : 'A tendência é de melhora, mas ajustes podem potencializar o resultado.'}`;
    case 'fat': return `O faturamento realizado em ${dados.mesBase} foi de ${fmtR(dados.faturamento)}. A meta proposta para ${dados.mesProximo} é de ${fmtR(dados.fatMeta)}.`;
    case 'custo': return `Os custos operacionais em ${dados.mesBase} totalizaram ${fmtR(dados.custos)}. A meta para ${dados.mesProximo} é ${fmtR(dados.custosMeta)}.`;
    case 'mc': return `A Margem de Contribuição resulta da diferença entre receitas e custos diretos. Em ${dados.mesBase} foi ${fmtR(dados.mc)} (${dados.faturamento ? ((dados.mc / dados.faturamento) * 100).toFixed(1) : 0}% do faturamento).`;
    case 'desp': return `As despesas fixas em ${dados.mesBase} totalizaram ${fmtR(dados.despesas)}. A meta para ${dados.mesProximo} é ${fmtR(dados.despesasMeta)}.`;
    case 'ro': return `O Resultado Operacional é a margem após dedução das despesas fixas. Em ${dados.mesBase} foi ${fmtR(dados.ro)}.`;
    case 'invest': return `Os investimentos em ${dados.mesBase} totalizaram ${fmtR(dados.investimentos)}. A meta para ${dados.mesProximo} é ${fmtR(dados.investMeta)}.`;
    case 'financ': return `As atividades de financiamento em ${dados.mesBase} totalizaram ${fmtR(dados.financeiro)}. A meta para ${dados.mesProximo} é ${fmtR(dados.financMeta)}.`;
    case 'gc': return `A Geração de Caixa é o resultado final após todas as operações. Em ${dados.mesBase} foi ${fmtR(dados.gc)} (${dados.gcPct.toFixed(1)}% do faturamento). A meta proposta projeta ${fmtR(dados.gcMeta)} (${dados.gcMetaPct.toFixed(1)}%).`;
    default: return '';
  }
}

function getValoresGrid(tipo: IndicadorTipo, dados: IndicadorDados): { label: string; valor: number }[] {
  const d = dados;
  switch (tipo) {
    case 'altimetro': return [{ label: 'GC Realizado', valor: d.gc }, { label: 'GC Meta', valor: d.gcMeta }, { label: 'Faturamento', valor: d.faturamento }, { label: 'GC %', valor: d.gcPct }];
    case 'ganho_rapido': return [{ label: 'Valor Atual', valor: d.ganhoRapidoValor }, { label: 'Redução %', valor: d.ganhoRapidoPct }];
    case 'projecao_rota': return [{ label: 'GC Atual', valor: d.gc }, { label: 'Projeção', valor: d.projecaoValor }];
    case 'fat': return [{ label: 'Realizado', valor: d.faturamento }, { label: 'Meta', valor: d.fatMeta }];
    case 'custo': return [{ label: 'Realizado', valor: d.custos }, { label: 'Meta', valor: d.custosMeta }];
    case 'mc': return [{ label: 'Realizado', valor: d.mc }, { label: 'Meta', valor: d.mcMeta }];
    case 'desp': return [{ label: 'Realizado', valor: d.despesas }, { label: 'Meta', valor: d.despesasMeta }];
    case 'ro': return [{ label: 'Realizado', valor: d.ro }, { label: 'Meta', valor: d.roMeta }];
    case 'invest': return [{ label: 'Realizado', valor: d.investimentos }, { label: 'Meta', valor: d.investMeta }];
    case 'financ': return [{ label: 'Realizado', valor: d.financeiro }, { label: 'Meta', valor: d.financMeta }];
    case 'gc': return [{ label: 'Realizado', valor: d.gc }, { label: 'Meta', valor: d.gcMeta }, { label: 'GC %', valor: d.gcPct }, { label: 'Meta %', valor: d.gcMetaPct }];
    default: return [];
  }
}

export function TorreIndicadorModal({ open, onClose, tipo, dados }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const info = TITULOS[tipo];
  const formula = FORMULAS[tipo];
  const explicacao = getExplicacao(tipo, dados);
  const valores = getValoresGrid(tipo, dados);

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(13,27,53,0.45)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={ref}
        style={{
          background: C.surface, borderRadius: 16, maxWidth: 560, width: '95%', maxHeight: '88vh',
          overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
          animation: 'modalEnter 0.22s cubic-bezier(0.16,1,0.3,1)',
        }}
      >
        <style>{`@keyframes modalEnter { from { opacity: 0; transform: scale(0.96) translateY(8px); } to { opacity: 1; transform: scale(1) translateY(0); } }`}</style>

        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <p style={{ fontSize: 9, fontWeight: 700, color: C.cyan, letterSpacing: '0.18em', margin: 0 }}>{info.eyebrow}</p>
              <h3 style={{ fontSize: 20, fontWeight: 700, color: C.txt, margin: '6px 0 4px' }}>{info.titulo}</h3>
              <p style={{ fontSize: 12, color: C.txtSec, margin: 0 }}>{info.subtitulo}</p>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: C.txtMuted, padding: 4 }}>✕</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: 24, overflowY: 'auto', maxHeight: 'calc(88vh - 100px)' }}>
          {/* Formula */}
          <div style={{ background: C.bgAlt, border: `1px solid ${C.border}`, borderRadius: 8, padding: '12px 16px', marginBottom: 20 }}>
            <p style={{ fontSize: 9, fontWeight: 700, color: C.txtMuted, letterSpacing: '0.12em', marginBottom: 6, textTransform: 'uppercase' }}>Fórmula</p>
            <pre style={{ fontFamily: C.mono, fontSize: 12, color: C.txt, margin: 0, whiteSpace: 'pre-wrap' }}>{formula}</pre>
          </div>

          {/* Values grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
            {valores.map((v, i) => (
              <div key={i} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px' }}>
                <p style={{ fontSize: 9, fontWeight: 600, color: C.txtMuted, letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 4px' }}>{v.label}</p>
                <p style={{ fontFamily: C.mono, fontSize: 16, fontWeight: 700, color: v.valor < 0 ? C.red : C.txt, margin: 0 }}>
                  {v.label.includes('%') ? `${v.valor.toFixed(1)}%` : fmtR(v.valor)}
                </p>
              </div>
            ))}
          </div>

          {/* Explanation */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '14px 16px' }}>
            <p style={{ fontSize: 9, fontWeight: 700, color: C.txtMuted, letterSpacing: '0.12em', marginBottom: 8, textTransform: 'uppercase' }}>Explicação</p>
            <p style={{ fontSize: 13, color: C.txtSec, lineHeight: 1.6, margin: 0 }}>{explicacao}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
