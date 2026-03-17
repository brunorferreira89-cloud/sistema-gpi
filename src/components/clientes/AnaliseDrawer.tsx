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
  composicao: { nome: string; valor: number; grupo?: string; nivel?: string; pct_faturamento?: number; valor_anterior?: number; variacao_pct?: number; variacao_abs?: number; pct?: number | null; filhas?: { nome: string; valor: number; pct_faturamento: number }[] }[];
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

/** Derive competencia date (YYYY-MM-01) from mes_referencia like "Fevereiro 2026" or "Fevereiro de 2026" */
function mesRefToCompetencia(mesRef: string): string | null {
  const meses: Record<string, string> = {
    janeiro: '01', fevereiro: '02', março: '03', marco: '03', abril: '04',
    maio: '05', junho: '06', julho: '07', agosto: '08', setembro: '09',
    outubro: '10', novembro: '11', dezembro: '12',
  };
  const parts = mesRef.trim().toLowerCase().split(/\s+/).filter(p => p !== 'de');
  if (parts.length < 2) return null;
  const mm = meses[parts[0]];
  const yyyy = parts[parts.length - 1];
  if (!mm || !yyyy || !/^\d{4}$/.test(yyyy)) return null;
  return `${yyyy}-${mm}-01`;
}

function formatGeradoEm(d: string): string {
  const dt = new Date(d);
  return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function AnaliseDrawer({ isOpen, onClose, titulo, dados }: Props) {
  const { clienteId } = useParams<{ clienteId: string }>();
  const [analysis, setAnalysis] = useState<{ titulo: string; contexto?: string; analise: string; alerta?: string | null; acao: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [geradoEm, setGeradoEm] = useState<string | null>(null);

  const competencia = dados ? mesRefToCompetencia(dados.mes_referencia) : null;

  const gerarNovaAnalise = useCallback(async () => {
    if (!dados) return;
    setLoading(true);
    setAnalysis(null);
    setGeradoEm(null);
    try {
      const { data: result, error } = await supabase.functions.invoke('analisar-indicador', {
        body: dados,
      });
      if (error) throw error;
      const now = new Date().toISOString();
      setAnalysis(result);
      setGeradoEm(now);

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
            gerado_em: now,
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

  useEffect(() => {
    if (!isOpen || !dados) return;

    const carregarAnalise = async () => {
      if (!clienteId || !competencia) {
        await gerarNovaAnalise();
        return;
      }

      setLoading(true);
      setAnalysis(null);
      setGeradoEm(null);

      try {
        const { data: cached } = await supabase
          .from('analises_ia' as any)
          .select('*')
          .eq('cliente_id', clienteId)
          .eq('indicador', dados.indicador)
          .eq('competencia', competencia)
          .maybeSingle();

        if (cached && (cached as any).analise) {
          setAnalysis({
            titulo: (cached as any).titulo || '',
            contexto: (cached as any).contexto || undefined,
            analise: (cached as any).analise || '',
            alerta: (cached as any).alerta || null,
            acao: (cached as any).acao || '',
          });
          setGeradoEm((cached as any).gerado_em || null);
          setLoading(false);
          return; // Cache found — do NOT call Edge Function
        }
      } catch (e) {
        console.error('Erro ao buscar cache:', e);
      }

      // No cache found — generate new analysis
      setLoading(false);
      await gerarNovaAnalise();
    };

    carregarAnalise();
  }, [isOpen, dados, clienteId, competencia, gerarNovaAnalise]);

  const handleRefresh = useCallback(async () => {
    await gerarNovaAnalise();
  }, [gerarNovaAnalise]);

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
          background: 'rgba(13,27,53,0.45)',
        }}
      />

      {/* Modal container */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 50,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24, pointerEvents: 'none',
      }}>
      {/* Modal box */}
      <div style={{
        background: '#FFFFFF', borderRadius: 16,
        width: '100%', maxWidth: 600, maxHeight: '82vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 80px rgba(13,27,53,0.18), 0 0 0 1px rgba(196,207,234,0.5)',
        overflow: 'hidden',
        pointerEvents: 'auto',
        animation: 'modalEnter 0.22s cubic-bezier(0.16, 1, 0.3, 1) forwards',
      }}>
        {/* Header (fixed) */}
        <div style={{
          padding: '20px 24px',
          background: 'linear-gradient(135deg, #FFFFFF 0%, #EEF4FF 100%)',
          borderBottom: '1px solid #DDE4F0',
          position: 'relative', flexShrink: 0,
        }}>
          <button onClick={onClose} style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', cursor: 'pointer', color: '#8A9BBC', padding: 4 }}>
            <X size={18} />
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <span style={{ fontSize: 13 }}>◎</span>
            <span style={{ fontSize: 9, fontWeight: 700, color: '#1A3CFF', letterSpacing: '0.18em' }}>ANÁLISE · IA</span>
          </div>
          <div style={{ fontWeight: 700, fontSize: 18, color: '#0D1B35', marginBottom: 4 }}>{titulo}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              display: 'inline-block', padding: '2px 10px', borderRadius: 12,
              fontSize: 11, fontWeight: 600, color: '#FFFFFF', background: statusColor,
            }}>
              {dados.status === 'verde' ? 'Saudável' : dados.status === 'ambar' ? 'Atenção' : 'Crítico'}
            </span>
            <span style={{ fontSize: 11, color: '#8A9BBC' }}>
              {dados.mes_referencia}
            </span>
          </div>
          {geradoEm && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
                color: '#00A86B',
                background: 'rgba(0,168,107,0.08)',
                border: '1px solid rgba(0,168,107,0.2)',
                padding: '2px 7px', borderRadius: 4,
              }}>
                ✓ CACHE
              </span>
              <span style={{ fontSize: 10, color: '#8A9BBC' }}>
                Gerado em {formatGeradoEm(geradoEm)}
              </span>
              <button
                onClick={handleRefresh}
                disabled={loading}
                style={{
                  marginLeft: 'auto',
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '4px 10px', borderRadius: 5,
                  border: '1px solid #C4CFEA',
                  background: 'transparent',
                  color: '#4A5E80', fontSize: 10, fontWeight: 600,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.5 : 1,
                  fontFamily: "'DM Sans', system-ui",
                  transition: 'all 0.15s',
                }}
                title="Regenerar análise"
              >
                <RefreshCw size={10} className={loading ? 'animate-spin' : ''} />
                Regenerar
              </button>
            </div>
          )}
        </div>

        {/* Content (scrolls) */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
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
                    <div style={{ fontWeight: 600, fontSize: 14, color: '#0D1B35', marginBottom: 4 }}>
                      {analysis.titulo}
                    </div>
                  )}
                  {analysis.contexto && (
                    <div style={{ fontSize: 12, color: '#8A9BBC', fontStyle: 'italic', marginBottom: 8 }}>
                      {analysis.contexto}
                    </div>
                  )}
                  {analysis.analise && (
                    <div style={{ fontSize: 13, color: '#4A5E80', lineHeight: 1.7, marginBottom: 10 }}>
                      {analysis.analise}
                    </div>
                  )}
                  {analysis.alerta && (
                    <div style={{
                      background: '#DC26260A', borderLeft: '3px solid #DC2626',
                      padding: '8px 12px', fontSize: 12, color: '#DC2626', marginBottom: 10,
                    }}>
                      ⚠ Risco: {analysis.alerta}
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
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      </div>

      <style>{`
        @keyframes modalEnter {
          from { opacity: 0; transform: scale(0.96) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </>
  );
}
