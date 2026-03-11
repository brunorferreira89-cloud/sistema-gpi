import { useState, useRef, useEffect, useCallback, useMemo, Fragment } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { type ContaRow, formatCurrency } from '@/lib/plano-contas-utils';
import { TorreMeta, calcProjetado, fmtCompetencia } from '@/lib/torre-utils';
import { toast } from 'sonner';
import { MessageSquare, Send, X, Loader2 } from 'lucide-react';

// ── Types ───────────────────────────────────────────────
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCall?: ToolCallData | null;
  toolStatus?: 'pending' | 'confirmed' | 'cancelled';
}

interface ToolCallData {
  name: string;
  input: any;
  textBefore?: string;
  impacto?: { label: string; atual: number; projetado: number; delta: number }[];
}

interface DreNode { conta: ContaRow; children: DreNode[] }

interface Props {
  open: boolean;
  onClose: () => void;
  clienteId: string;
  clienteNome: string;
  clienteSegmento: string;
  contas: ContaRow[];
  realizadoMap: Record<string, number | null>;
  metaMap: Record<string, TorreMeta>;
  mesBase: string;        // mesEfetivo (selected month)
  mesProximo: string;     // mesSeg (next month)
  onMetaAtualizada: () => void;
}

// ── Colors ──────────────────────────────────────────────
const C = {
  primary: '#1A3CFF', green: '#00A86B', red: '#DC2626',
  bg: '#F0F4FA', surface: '#FFFFFF', border: '#DDE4F0', borderStr: '#C4CFEA',
  txt: '#0D1B35', txtSec: '#4A5E80', txtMuted: '#8A9BBC',
  mono: "'Courier New', monospace",
};

// ── Helpers ─────────────────────────────────────────────
function buildTree(contas: ContaRow[]): DreNode[] {
  const map = new Map<string, DreNode>();
  const roots: DreNode[] = [];
  for (const c of contas) map.set(c.id, { conta: c, children: [] });
  for (const c of contas) {
    const node = map.get(c.id)!;
    if (c.conta_pai_id && map.has(c.conta_pai_id)) map.get(c.conta_pai_id)!.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function sumNodeLeafs(node: DreNode, valMap: Record<string, number | null>): number {
  if (node.conta.nivel === 2) return valMap[node.conta.id] ?? 0;
  let total = 0;
  for (const child of node.children) total += sumNodeLeafs(child, valMap);
  return total;
}

function sumByTipo(tree: DreNode[], tipo: string, valMap: Record<string, number | null>): number {
  let total = 0;
  for (const n of tree) { if (n.conta.tipo === tipo) total += sumNodeLeafs(n, valMap); }
  return total;
}

function calcTotais(tree: DreNode[], valMap: Record<string, number | null>) {
  const fat = sumByTipo(tree, 'receita', valMap);
  const custos = sumByTipo(tree, 'custo_variavel', valMap);
  const mc = fat + custos;
  const despesas = sumByTipo(tree, 'despesa_fixa', valMap);
  const ro = mc + despesas;
  const invest = sumByTipo(tree, 'investimento', valMap);
  const rai = ro + invest;
  const financ = sumByTipo(tree, 'financeiro', valMap);
  const gc = rai + financ;
  return { fat, MC: mc, RO: ro, RAI: rai, GC: gc };
}

function genId() { return Math.random().toString(36).slice(2, 10); }

// ── Component ───────────────────────────────────────────
export function ChatAnalistaDrawer({
  open, onClose, clienteId, clienteNome, clienteSegmento,
  contas, realizadoMap, metaMap, mesBase, mesProximo, onMetaAtualizada,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const tree = useMemo(() => buildTree(contas), [contas]);

  // Build projetado map using current metas
  const buildProjetadoMap = useCallback((overrideMap?: Record<string, TorreMeta>) => {
    const mMap = overrideMap || metaMap;
    const projMap: Record<string, number | null> = {};
    for (const c of contas) {
      if (c.nivel === 2) {
        const real = realizadoMap[c.id] ?? null;
        if (real == null) { projMap[c.id] = null; continue; }
        const meta = mMap[c.id] || null;
        projMap[c.id] = meta ? calcProjetado(real, meta) : real;
      }
    }
    return projMap;
  }, [contas, realizadoMap, metaMap]);

  // Calculate impact of a tool call
  const calcImpacto = useCallback((toolName: string, toolInput: any): ToolCallData['impacto'] => {
    const currentTotais = calcTotais(tree, buildProjetadoMap());

    // Simulate new meta
    const simulatedMetaMap = { ...metaMap };
    if (toolName === 'atualizar_meta_conta') {
      simulatedMetaMap[toolInput.conta_id] = {
        conta_id: toolInput.conta_id,
        meta_tipo: toolInput.meta_tipo,
        meta_valor: toolInput.meta_valor,
      };
    } else if (toolName === 'aplicar_meta_grupo') {
      for (const cid of toolInput.contas_ids) {
        simulatedMetaMap[cid] = {
          conta_id: cid,
          meta_tipo: toolInput.meta_tipo,
          meta_valor: toolInput.meta_valor,
        };
      }
    } else if (toolName === 'limpar_metas_mes') {
      // All metas cleared → projMap = realizadoMap
      const clearedTotais = calcTotais(tree, realizadoMap);
      return [
        { label: 'MC', atual: currentTotais.MC, projetado: clearedTotais.MC, delta: clearedTotais.MC - currentTotais.MC },
        { label: 'RO', atual: currentTotais.RO, projetado: clearedTotais.RO, delta: clearedTotais.RO - currentTotais.RO },
        { label: 'RAI', atual: currentTotais.RAI, projetado: clearedTotais.RAI, delta: clearedTotais.RAI - currentTotais.RAI },
        { label: 'GC', atual: currentTotais.GC, projetado: clearedTotais.GC, delta: clearedTotais.GC - currentTotais.GC },
      ];
    }

    const newProjMap = buildProjetadoMap(simulatedMetaMap);
    const newTotais = calcTotais(tree, newProjMap);
    return [
      { label: 'MC', atual: currentTotais.MC, projetado: newTotais.MC, delta: newTotais.MC - currentTotais.MC },
      { label: 'RO', atual: currentTotais.RO, projetado: newTotais.RO, delta: newTotais.RO - currentTotais.RO },
      { label: 'RAI', atual: currentTotais.RAI, projetado: newTotais.RAI, delta: newTotais.RAI - currentTotais.RAI },
      { label: 'GC', atual: currentTotais.GC, projetado: newTotais.GC, delta: newTotais.GC - currentTotais.GC },
    ];
  }, [tree, metaMap, realizadoMap, buildProjetadoMap]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  // Focus input when opened
  useEffect(() => {
    if (open && inputRef.current) setTimeout(() => inputRef.current?.focus(), 200);
  }, [open]);

  // Build system prompt
  const systemPrompt = useMemo(() => {
    const totais = calcTotais(tree, realizadoMap);
    const fmt = (v: number) => formatCurrency(v);
    const pct = (v: number, base: number) => base !== 0 ? ((v / base) * 100).toFixed(1) : '0.0';

    const contasList = contas.map(c => {
      const real = realizadoMap[c.id];
      const realStr = real != null ? fmt(real) : 'sem valor';
      return `- "${c.nome}" (tipo: ${c.tipo}, nivel: ${c.nivel}, id: ${c.id}, realizado: ${realStr})`;
    }).join('\n');

    return `Você é o Comandante GPI — consultor financeiro de elite especializado
em inteligência financeira para pequenas e médias empresas brasileiras.
Você combina análise técnica precisa com linguagem acessível e, quando
pertinente, metáforas de aviação (empresa = aeronave, finanças =
instrumentos de voo, GPI = comandante responsável pelo voo).

METODOLOGIA GPI — BENCHMARKS OBRIGATÓRIOS:
- Geração de Caixa (GC): indicador mais importante. Benchmark: > 10% fat.
  Se GC negativa: prioridade absoluta — foque nisso antes de qualquer outro ponto.
- Margem de Contribuição (MC): receita menos custos variáveis. Benchmark: > 40%.
- Resultado Operacional (RO): MC menos despesas fixas. Deve ser positivo.
- CMV (custo de mercadoria/insumos): benchmark < 38% do faturamento.
- CMO (custo com mão de obra): benchmark < 25% do faturamento.
- Retiradas dos sócios: ≤ 5% do faturamento E ≤ 50% da GC.
- Endividamento anual: < 30% fat. = seguro | 30–50% = atenção | > 50% = risco.

REGRAS DE ANÁLISE:
- Sempre contextualize valores em % sobre o faturamento, não apenas R$.
- Aponte a causa antes de sugerir a solução.
- Máximo 3 parágrafos por resposta — seja denso, não longo.
- Sugira no máximo 2–3 ações concretas por resposta.
- Cite o nome exato da conta quando relevante.
- Não invente dados. Se não souber, pergunte.
- Compare com benchmarks GPI sempre que disponível.

TOM DE VOZ:
- Direto. Técnico quando necessário, acessível sempre.
- Use metáforas de aviação com moderação.
- Quando crítico: diga claramente, sem suavizar.
- Quando positivo: reconheça, mas aponte o próximo patamar.

CONTEXTO DO CLIENTE — SESSÃO ATUAL:
Cliente: ${clienteNome}
Segmento: ${clienteSegmento}
Mês base (realizado): ${fmtCompetencia(mesBase)}
Mês alvo (metas): ${fmtCompetencia(mesProximo)}

TOTALIZADORES (realizado do mês base):
Faturamento: ${fmt(totais.fat)}
MC: ${fmt(totais.MC)} (${pct(totais.MC, totais.fat)}%)
RO: ${fmt(totais.RO)} (${pct(totais.RO, totais.fat)}%)
RAI: ${fmt(totais.RAI)} (${pct(totais.RAI, totais.fat)}%)
GC: ${fmt(totais.GC)} (${pct(totais.GC, totais.fat)}%)

CONTAS DISPONÍVEIS NO PLANO DE CONTAS:
${contasList}`;
  }, [tree, contas, realizadoMap, clienteNome, clienteSegmento, mesBase, mesProximo]);

  // Send message
  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');

    const userMsg: ChatMessage = { id: genId(), role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      // Build messages for API (only role + content, no toolCall)
      const apiMessages = [...messages, userMsg]
        .filter(m => m.role === 'user' || (m.role === 'assistant' && m.content))
        .map(m => ({ role: m.role, content: m.content }));

      const { data, error } = await supabase.functions.invoke('chat-analista', {
        body: { messages: apiMessages, system_prompt: systemPrompt },
      });

      if (error) throw error;

      // Process response
      const contentBlocks = data?.content || [];
      const textBlock = contentBlocks.find((b: any) => b.type === 'text');
      const toolUseBlock = contentBlocks.find((b: any) => b.type === 'tool_use');

      if (toolUseBlock) {
        const impacto = calcImpacto(toolUseBlock.name, toolUseBlock.input);
        const assistantMsg: ChatMessage = {
          id: genId(),
          role: 'assistant',
          content: textBlock?.text || '',
          toolCall: {
            name: toolUseBlock.name,
            input: toolUseBlock.input,
            textBefore: textBlock?.text || undefined,
            impacto,
          },
          toolStatus: 'pending',
        };
        setMessages(prev => [...prev, assistantMsg]);
      } else {
        const assistantMsg: ChatMessage = {
          id: genId(),
          role: 'assistant',
          content: textBlock?.text || data?.content?.[0]?.text || 'Sem resposta.',
        };
        setMessages(prev => [...prev, assistantMsg]);
      }
    } catch (err) {
      console.error('Chat error:', err);
      toast.error('Erro ao enviar mensagem');
      setMessages(prev => [...prev, { id: genId(), role: 'assistant', content: 'Erro ao processar. Tente novamente.' }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, systemPrompt, calcImpacto]);

  // Execute tool call
  const executeToolCall = useCallback(async (msgId: string) => {
    const msg = messages.find(m => m.id === msgId);
    if (!msg?.toolCall) return;

    const { name, input: toolInput } = msg.toolCall;
    let resumo = '';

    try {
      if (name === 'atualizar_meta_conta') {
        await supabase.from('torre_metas').upsert({
          cliente_id: clienteId,
          conta_id: toolInput.conta_id,
          competencia: mesProximo,
          meta_tipo: toolInput.meta_tipo,
          meta_valor: toolInput.meta_valor,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'cliente_id,conta_id,competencia' });
        resumo = `Meta de "${toolInput.conta_nome}" atualizada para ${toolInput.meta_tipo === 'pct' ? `${toolInput.meta_valor}%` : `R$ ${formatCurrency(toolInput.meta_valor)}`}.`;
      } else if (name === 'aplicar_meta_grupo') {
        const upserts = toolInput.contas_ids.map((cid: string) => ({
          cliente_id: clienteId,
          conta_id: cid,
          competencia: mesProximo,
          meta_tipo: toolInput.meta_tipo,
          meta_valor: toolInput.meta_valor,
          updated_at: new Date().toISOString(),
        }));
        await supabase.from('torre_metas').upsert(upserts, { onConflict: 'cliente_id,conta_id,competencia' });
        resumo = `Meta de ${toolInput.meta_tipo === 'pct' ? `${toolInput.meta_valor}%` : `R$ ${formatCurrency(toolInput.meta_valor)}`} aplicada a ${toolInput.contas_ids.length} contas do grupo "${toolInput.grupo_nome}".`;
      } else if (name === 'limpar_metas_mes') {
        await supabase.from('torre_metas').delete().eq('cliente_id', clienteId).eq('competencia', mesProximo);
        resumo = `Todas as metas de ${fmtCompetencia(mesProximo)} foram removidas.`;
      }

      // Update message status
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, toolStatus: 'confirmed' as const } : m));

      // Add confirmation message
      setMessages(prev => [...prev, { id: genId(), role: 'assistant', content: `✅ Feito, Comandante. ${resumo}` }]);

      // Trigger refresh
      onMetaAtualizada();
    } catch (err) {
      console.error('Tool execution error:', err);
      toast.error('Erro ao executar ação');
    }
  }, [messages, clienteId, mesProximo, onMetaAtualizada]);

  // Cancel tool call
  const cancelToolCall = useCallback((msgId: string) => {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, toolStatus: 'cancelled' as const } : m));
    setMessages(prev => [...prev, { id: genId(), role: 'assistant', content: 'Ação cancelada. Os instrumentos permanecem inalterados.' }]);
  }, []);

  if (!open) return null;

  const toolNameLabels: Record<string, string> = {
    atualizar_meta_conta: 'ATUALIZAR META',
    aplicar_meta_grupo: 'META EM GRUPO',
    limpar_metas_mes: 'LIMPAR METAS',
  };

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: 440, zIndex: 50,
      background: C.surface, borderLeft: `1px solid ${C.border}`,
      display: 'flex', flexDirection: 'column',
      boxShadow: '-8px 0 30px rgba(13,27,53,0.12)',
      animation: 'slideInRight 0.25s ease',
    }}>
      <style>{`
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      {/* Header */}
      <div style={{
        padding: '14px 16px', borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: C.bg,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 20 }}>👨🏻‍✈️</span>
          <div>
            <p style={{ fontSize: 13, fontWeight: 700, color: C.txt, margin: 0 }}>Comandante GPI</p>
            <p style={{ fontSize: 10, color: C.txtMuted, margin: 0, letterSpacing: '0.06em' }}>CHAT ANALISTA</p>
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: C.txtMuted }}>
          <X style={{ width: 18, height: 18 }} />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: C.txtMuted }}>
            <span style={{ fontSize: 32 }}>👨🏻‍✈️</span>
            <p style={{ fontSize: 13, marginTop: 8 }}>Comandante à disposição.</p>
            <p style={{ fontSize: 11, marginTop: 4 }}>Pergunte sobre os indicadores, peça análises ou ajuste metas por linguagem natural.</p>
          </div>
        )}

        {messages.map(msg => {
          if (msg.role === 'user') {
            return (
              <div key={msg.id} style={{ alignSelf: 'flex-end', maxWidth: '85%', animation: 'fadeIn 0.2s ease' }}>
                <div style={{
                  background: C.primary, color: '#FFFFFF', borderRadius: '12px 12px 2px 12px',
                  padding: '8px 12px', fontSize: 13, lineHeight: 1.5,
                }}>
                  {msg.content}
                </div>
              </div>
            );
          }

          // Assistant message
          return (
            <div key={msg.id} style={{ alignSelf: 'flex-start', maxWidth: '90%', animation: 'fadeIn 0.2s ease' }}>
              {/* Text content (before tool call or standalone) */}
              {msg.content && (!msg.toolCall || msg.toolCall.textBefore) && (
                <div style={{
                  background: C.bg, color: C.txt, borderRadius: '12px 12px 12px 2px',
                  padding: '8px 12px', fontSize: 13, lineHeight: 1.6,
                  marginBottom: msg.toolCall ? 8 : 0,
                  whiteSpace: 'pre-wrap',
                }}>
                  {msg.content}
                </div>
              )}

              {/* Tool call card */}
              {msg.toolCall && msg.toolStatus === 'pending' && (
                <ConfirmationCard
                  toolCall={msg.toolCall}
                  mesProximo={mesProximo}
                  onConfirm={() => executeToolCall(msg.id)}
                  onCancel={() => cancelToolCall(msg.id)}
                />
              )}

              {/* Tool confirmed/cancelled — no card, just the follow-up message */}
              {msg.toolCall && msg.toolStatus !== 'pending' && !msg.content && null}
            </div>
          );
        })}

        {loading && (
          <div style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', background: C.bg, borderRadius: 12, animation: 'fadeIn 0.2s ease' }}>
            <Loader2 style={{ width: 14, height: 14, color: C.primary, animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 12, color: C.txtMuted }}>Analisando...</span>
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{ padding: '10px 16px', borderTop: `1px solid ${C.border}`, background: C.bg }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Pergunte ao Comandante..."
            style={{
              flex: 1, padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderStr}`,
              fontSize: 13, outline: 'none', background: C.surface, color: C.txt,
            }}
          />
          <button
            onClick={send}
            disabled={loading || !input.trim()}
            style={{
              padding: '8px 12px', borderRadius: 8, background: C.primary, color: '#FFFFFF',
              border: 'none', cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
              opacity: loading || !input.trim() ? 0.5 : 1, display: 'flex', alignItems: 'center',
            }}
          >
            <Send style={{ width: 16, height: 16 }} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Confirmation Card ───────────────────────────────────
function ConfirmationCard({
  toolCall, mesProximo, onConfirm, onCancel,
}: {
  toolCall: ToolCallData; mesProximo: string; onConfirm: () => void; onCancel: () => void;
}) {
  const { name, input: toolInput, impacto } = toolCall;

  const toolNameLabels: Record<string, string> = {
    atualizar_meta_conta: 'ATUALIZAR META',
    aplicar_meta_grupo: 'META EM GRUPO',
    limpar_metas_mes: 'LIMPAR METAS',
  };

  const renderResumo = () => {
    if (name === 'atualizar_meta_conta') {
      return (
        <>
          <Row label="Conta" value={toolInput.conta_nome} />
          <Row label="Ajuste" value={`${toolInput.meta_tipo === 'pct' ? '%' : 'R$'} ${toolInput.meta_valor}`} />
        </>
      );
    }
    if (name === 'aplicar_meta_grupo') {
      return (
        <>
          <Row label="Grupo" value={toolInput.grupo_nome} />
          <Row label="Contas" value={`${toolInput.contas_ids.length} contas`} />
          <Row label="Ajuste" value={`${toolInput.meta_tipo === 'pct' ? '%' : 'R$'} ${toolInput.meta_valor}`} />
        </>
      );
    }
    if (name === 'limpar_metas_mes') {
      return <Row label="Competência" value={fmtCompetencia(toolInput.competencia || mesProximo)} />;
    }
    return null;
  };

  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12,
      overflow: 'hidden', animation: 'fadeIn 0.3s ease',
    }}>
      {/* Header */}
      <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 13 }}>⚡</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: C.txt, letterSpacing: '0.08em' }}>AÇÃO IDENTIFICADA</span>
        </div>
        <span style={{
          fontSize: 9, fontWeight: 700, color: C.primary, background: 'rgba(26,60,255,0.08)',
          border: '1px solid rgba(26,60,255,0.2)', borderRadius: 4, padding: '2px 6px', letterSpacing: '0.06em',
        }}>
          {toolNameLabels[name] || name}
        </span>
      </div>

      {/* Resumo */}
      <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}` }}>
        <p style={{ fontSize: 9, fontWeight: 600, color: C.txtMuted, letterSpacing: '0.1em', marginBottom: 6 }}>RESUMO DA AÇÃO</p>
        {renderResumo()}
      </div>

      {/* Impacto */}
      {impacto && impacto.length > 0 && (
        <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}` }}>
          <p style={{ fontSize: 9, fontWeight: 600, color: C.txtMuted, letterSpacing: '0.1em', marginBottom: 6 }}>IMPACTO NOS INDICADORES</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {impacto.map(ind => (
              <div key={ind.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
                <span style={{ fontWeight: 600, color: C.txtSec, width: 30 }}>{ind.label}</span>
                <span style={{ fontFamily: C.mono, color: C.txt, fontSize: 11 }}>
                  {formatCurrency(ind.atual)}
                </span>
                <span style={{ color: C.txtMuted, fontSize: 10 }}>→</span>
                <span style={{ fontFamily: C.mono, color: C.txt, fontSize: 11 }}>
                  {formatCurrency(ind.projetado)}
                </span>
                <span style={{
                  fontFamily: C.mono, fontSize: 11, fontWeight: 600,
                  color: ind.delta >= 0 ? C.green : C.red,
                  minWidth: 70, textAlign: 'right',
                }}>
                  {ind.delta >= 0 ? '+' : ''}{formatCurrency(ind.delta)}
                </span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 9, color: C.txtMuted, marginTop: 6 }}>
            Valores positivos em <span style={{ color: C.green }}>verde</span> · negativos em <span style={{ color: C.red }}>vermelho</span>
          </p>
        </div>
      )}

      {/* Actions */}
      <div style={{ padding: '10px 14px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button
          onClick={onCancel}
          style={{
            padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 600,
            background: 'transparent', border: `1px solid ${C.border}`, color: C.txtSec,
            cursor: 'pointer',
          }}
        >
          ✗ Cancelar
        </button>
        <button
          onClick={onConfirm}
          style={{
            padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 700,
            background: C.primary, border: 'none', color: '#FFFFFF',
            cursor: 'pointer',
          }}
        >
          ✓ Confirmar e aplicar
        </button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 12, marginBottom: 2 }}>
      <span style={{ color: C.txtMuted, minWidth: 80 }}>{label}:</span>
      <span style={{ color: C.txt, fontWeight: 500 }}>{value}</span>
    </div>
  );
}
