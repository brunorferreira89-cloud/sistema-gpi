import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { X, RefreshCw } from 'lucide-react';
import { formatCurrency } from '@/lib/plano-contas-utils';
import { supabase } from '@/integrations/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';

export interface AnaliseDrawerDados {
  indicador: string;
  valor_atual: number;
  valor_absoluto: number;
  faturamento: number;
  mes_referencia: string;
  status: 'verde' | 'ambar' | 'vermelho';
  limite_verde: number;
  limite_ambar: number;
  direcao: string;
  historico: { mes: string; valor: number }[];
  formula: string;
  composicao: { nome: string; valor: number; grupo?: string; nivel?: string; pct_faturamento?: number; valor_anterior?: number; variacao_pct?: number; variacao_abs?: number; pct?: number | null }[];
  instrucao_especifica?: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  titulo: string;
  dados: AnaliseDrawerDados | null;
}

const STATUS_COLORS: Record<string, string> = {
  verde: '#00A86B',
  ambar: '#D97706',
  vermelho: '#DC2626',
};

function fmtCur(v: number): string {
  return formatCurrency(Math.abs(v)).replace('R$\u00a0', 'R$ ').replace('R$  ', 'R$ ');
}

function SparkLineFull({ data, color, w = 320, h = 48 }: { data: number[]; color: string; w?: number; h?: number }) {
  if (data.length < 2) return <div style={{ width: w, height: h }} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = 6;
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x},${y}`;
  }).join(' ');
  const lastX = pad + ((data.length - 1) / (data.length - 1)) * (w - pad * 2);
  const lastY = h - pad - ((data[data.length - 1] - min) / range) * (h - pad * 2);
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="block">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" opacity={0.7} />
      <circle cx={lastX} cy={lastY} r={4} fill={color} />
    </svg>
  );
}

/** Derive competencia date (YYYY-MM-01) from mes_referencia like "Fevereiro 2026" */
function mesRefToCompetencia(mesRef: string): string | null {
  const meses: Record<string, string> = {
    janeiro: '01', fevereiro: '02', março: '03', marco: '03', abril: '04',
    maio: '05', junho: '06', julho: '07', agosto: '08', setembro: '09',
    outubro: '10', novembro: '11', dezembro: '12',
  };
  const parts = mesRef.trim().toLowerCase().split(/\s+/);
  if (parts.length < 2) return null;
  const mm = meses[parts[0]];
  const yyyy = parts[1];
  if (!mm || !yyyy) return null;
  return `${yyyy}-${mm}-01`;
}

function formatGeradoEm(d: string): string {
  const dt = new Date(d);
  return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function AnaliseDrawer({ isOpen, onClose, titulo, dados }: Props) {
  const { id: clienteId } = useParams<{ id: string }>();
  const [analysis, setAnalysis] = useState<{ titulo: string; contexto?: string; analise: string; alerta?: string | null; acao: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [geradoEm, setGeradoEm] = useState<string | null>(null);

  const competencia = dados ? mesRefToCompetencia(dados.mes_referencia) : null;

  const fetchFromCache = useCallback(async (): Promise<boolean> => {
    if (!clienteId || !dados || !competencia) return false;
    try {
      const { data: cached } = await supabase
        .from('analises_ia' as any)
        .select('*')
        .eq('cliente_id', clienteId)
        .eq('indicador', dados.indicador)
        .eq('competencia', competencia)
        .limit(1)
        .maybeSingle();
      if (cached && (cached as any).titulo) {
        setAnalysis({
          titulo: (cached as any).titulo || '',
          analise: (cached as any).analise || '',
          acao: (cached as any).acao || '',
        });
        setGeradoEm((cached as any).gerado_em || null);
        return true;
      }
    } catch (e) {
      console.error('Erro ao buscar cache:', e);
    }
    return false;
  }, [clienteId, dados, competencia]);

  const callEdgeFunction = useCallback(async () => {
    if (!dados) return;
    setLoading(true);
    try {
      const { data: result, error } = await supabase.functions.invoke('analisar-indicador', {
        body: dados,
      });
      if (error) throw error;
      setAnalysis(result);
      setGeradoEm(new Date().toISOString());

      // Save to cache
      if (clienteId && competencia) {
        await supabase.from('analises_ia' as any).upsert(
          {
            cliente_id: clienteId,
            indicador: dados.indicador,
            competencia,
            titulo: result?.titulo || '',
            analise: result?.analise || '',
            acao: result?.acao || '',
            gerado_em: new Date().toISOString(),
          } as any,
          { onConflict: 'cliente_id,indicador,competencia' }
        );
      }
    } catch (e) {
      console.error('Erro ao analisar:', e);
      setAnalysis({ titulo: 'Análise indisponível', analise: '', acao: '' });
    } finally {
      setLoading(false);
    }
  }, [dados, clienteId, competencia]);

  const handleOpen = useCallback(async () => {
    setAnalysis(null);
    setGeradoEm(null);
    const found = await fetchFromCache();
    if (!found) {
      await callEdgeFunction();
    }
  }, [fetchFromCache, callEdgeFunction]);

  const handleRefresh = useCallback(async () => {
    setAnalysis(null);
    setGeradoEm(null);
    await callEdgeFunction();
  }, [callEdgeFunction]);

  useEffect(() => {
    if (isOpen && dados) handleOpen();
  }, [isOpen, dados]);

  if (!isOpen || !dados) return null;

  const statusColor = STATUS_COLORS[dados.status] || '#8A9BBC';
  const composicaoTotal = dados.composicao.reduce((s, c) => s + c.valor, 0);

  return (
    <>
      {/* Overlay */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 50,
          background: '#0D1B3540',
          animation: 'fadeIn 200ms ease',
        }}
      />
      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 440, zIndex: 51,
        background: '#FFFFFF', borderLeft: '1px solid #DDE4F0',
        overflowY: 'auto', padding: 28,
        animation: 'slideInRight 250ms cubic-bezier(0.16,1,0.3,1)',
      }}>
        {/* Top line */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: statusColor }} />

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18, color: '#0D1B35', marginBottom: 6 }}>{titulo}</div>
            <span style={{
              display: 'inline-block', padding: '2px 10px', borderRadius: 12,
              fontSize: 11, fontWeight: 600, color: '#FFFFFF', background: statusColor,
            }}>
              {dados.status === 'verde' ? 'Saudável' : dados.status === 'ambar' ? 'Atenção' : 'Crítico'}
            </span>
          </div>
          <button onClick={onClose} style={{ padding: 4, cursor: 'pointer', background: 'none', border: 'none', color: '#8A9BBC' }}>
            <X size={20} />
          </button>
        </div>

        {/* Value */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 40, fontWeight: 800, fontFamily: "'Courier New', monospace", color: statusColor }}>
            {dados.valor_atual.toFixed(1).replace('.', ',')}%
          </div>
          <div style={{ fontSize: 13, color: '#8A9BBC' }}>
            {fmtCur(dados.valor_absoluto)} · {dados.mes_referencia}
          </div>
        </div>

        {/* Formula */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.08em', color: '#8A9BBC', fontWeight: 600, marginBottom: 6 }}>
            Como é calculado
          </div>
          <div style={{
            background: '#F0F4FA', borderRadius: 8, padding: 12,
            fontFamily: "'Courier New', monospace", fontSize: 12, color: '#0D1B35', lineHeight: 1.6,
          }}>
            {dados.formula}
          </div>
        </div>

        {/* Composition */}
        {dados.composicao.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.08em', color: '#8A9BBC', fontWeight: 600, marginBottom: 6 }}>
              Composição
            </div>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #DDE4F0' }}>
                  <th style={{ textAlign: 'left', padding: '4px 0', color: '#8A9BBC', fontWeight: 500, fontSize: 11 }}>Conta</th>
                  <th style={{ textAlign: 'right', padding: '4px 0', color: '#8A9BBC', fontWeight: 500, fontSize: 11 }}>Valor</th>
                  {dados.faturamento > 0 && (
                    <th style={{ textAlign: 'right', padding: '4px 0', color: '#8A9BBC', fontWeight: 500, fontSize: 11 }}>% fat.</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {dados.composicao.map((c, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #F8F9FB' }}>
                    <td style={{ padding: '5px 0', color: '#4A5E80' }}>{c.nome}</td>
                    <td style={{ textAlign: 'right', padding: '5px 0', fontFamily: 'monospace', color: '#0D1B35' }}>
                      {fmtCur(c.valor)}
                    </td>
                    {dados.faturamento > 0 && (
                      <td style={{ textAlign: 'right', padding: '5px 0', fontFamily: 'monospace', color: '#8A9BBC', fontSize: 11 }}>
                        {((Math.abs(c.valor) / Math.abs(dados.faturamento)) * 100).toFixed(1)}%
                      </td>
                    )}
                  </tr>
                ))}
                <tr style={{ borderTop: '2px solid #DDE4F0' }}>
                  <td style={{ padding: '5px 0', fontWeight: 700, color: '#0D1B35' }}>Total</td>
                  <td style={{ textAlign: 'right', padding: '5px 0', fontFamily: 'monospace', fontWeight: 700, color: '#0D1B35' }}>
                    {fmtCur(composicaoTotal)}
                  </td>
                  {dados.faturamento > 0 && (
                    <td style={{ textAlign: 'right', padding: '5px 0', fontFamily: 'monospace', fontWeight: 700, color: '#0D1B35', fontSize: 11 }}>
                      {((Math.abs(composicaoTotal) / Math.abs(dados.faturamento)) * 100).toFixed(1)}%
                    </td>
                  )}
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* History */}
        {dados.historico.length > 1 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.08em', color: '#8A9BBC', fontWeight: 600, marginBottom: 6 }}>
              Histórico {dados.historico.length} meses
            </div>
            <SparkLineFull data={dados.historico.map(h => h.valor)} color={statusColor} />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              {dados.historico.map((h, i) => (
                <span key={i} style={{ fontSize: 9, color: '#8A9BBC' }}>{h.mes}</span>
              ))}
            </div>
          </div>
        )}

        {/* AI Analysis */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.08em', color: '#8A9BBC', fontWeight: 600, marginBottom: 6 }}>
            Análise GPI
          </div>
          <div style={{
            background: 'linear-gradient(135deg, #1A3CFF08, #0099E608)',
            border: '1px solid #1A3CFF1A', borderRadius: 12, padding: 16,
          }}>
            {loading ? (
              <div>
                <Skeleton className="h-4 w-3/4 mb-2" />
                <Skeleton className="h-3 w-full mb-1" />
                <Skeleton className="h-3 w-5/6 mb-1" />
                <Skeleton className="h-3 w-2/3" />
                <div style={{ fontSize: 12, color: '#8A9BBC', marginTop: 8 }}>Analisando indicadores...</div>
              </div>
            ) : analysis ? (
              <div>
                {analysis.titulo && (
                  <div style={{ fontWeight: 600, fontSize: 14, color: '#0D1B35', marginBottom: 8 }}>
                    {analysis.titulo}
                  </div>
                )}
                {analysis.analise && (
                  <div style={{ fontSize: 13, color: '#4A5E80', lineHeight: 1.6, marginBottom: 10 }}>
                    {analysis.analise}
                  </div>
                )}
                {analysis.acao && (
                  <div style={{
                    background: '#1A3CFF0F', borderLeft: '3px solid #1A3CFF',
                    padding: '10px 14px', fontSize: 12, color: '#1A3CFF', fontWeight: 500,
                  }}>
                    → Ação recomendada: {analysis.acao}
                  </div>
                )}
                {geradoEm && (
                  <div style={{ fontSize: 11, color: '#8A9BBC', marginTop: 10 }}>
                    Análise gerada em {formatGeradoEm(geradoEm)}
                  </div>
                )}
              </div>
            ) : null}
          </div>
          <button
            onClick={handleRefresh}
            disabled={loading}
            style={{
              marginTop: 8, fontSize: 11, color: '#8A9BBC', background: 'none',
              border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Atualizar análise
          </button>
        </div>

        <style>{`
          @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
          @keyframes slideInRight { from { transform: translateX(100%) } to { transform: translateX(0) } }
        `}</style>
      </div>
    </>
  );
}
