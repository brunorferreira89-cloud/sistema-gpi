import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

const CLIENTE_ID = '9911afed-7508-42db-92ab-86397f4a95ad';

interface Row {
  conta_id: string;
  competencia: string;
  valor_realizado: number | null;
  nome: string;
  nivel: number;
}

export default function DebugTributosPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteResult, setDeleteResult] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadData = async () => {
    setLoading(true);
    const { data: contas } = await supabase
      .from('plano_de_contas')
      .select('id, nome, nivel')
      .eq('cliente_id', CLIENTE_ID);
    if (!contas?.length) { setLoading(false); return; }
    const contaMap = new Map(contas.map(c => [c.id, c]));
    const contaIds = contas.map(c => c.id);
    const { data: valores } = await supabase
      .from('valores_mensais')
      .select('conta_id, competencia, valor_realizado')
      .in('conta_id', contaIds)
      .not('valor_realizado', 'is', null)
      .order('competencia');
    const joined: Row[] = (valores || []).map(v => {
      const c = contaMap.get(v.conta_id);
      return { conta_id: v.conta_id, competencia: v.competencia, valor_realizado: v.valor_realizado, nome: c?.nome ?? '???', nivel: c?.nivel ?? -1 };
    }).sort((a, b) => a.nivel - b.nivel || a.nome.localeCompare(b.nome) || a.competencia.localeCompare(b.competencia));
    setRows(joined);
    setLoading(false);
  };

  const handleDeleteAll = async () => {
    if (!window.confirm('⚠️ ATENÇÃO: Isso vai apagar TODOS os valores_mensais do cliente Regalo. Tem certeza?')) return;
    if (!window.confirm('ÚLTIMA CONFIRMAÇÃO: Esta ação é irreversível. Continuar?')) return;
    setDeleting(true);
    const { data: contas } = await supabase.from('plano_de_contas').select('id').eq('cliente_id', CLIENTE_ID);
    const contaIds = contas?.map(c => c.id) || [];
    if (contaIds.length === 0) { setDeleteResult('Nenhuma conta encontrada.'); setDeleting(false); return; }
    const { data: deleted, error } = await supabase.from('valores_mensais').delete().in('conta_id', contaIds).select('id');
    if (error) { setDeleteResult(`ERRO: ${error.message}`); } else { setDeleteResult(`✅ ${deleted?.length ?? 0} registros removidos.`); }
    setDeleting(false);
    await loadData();
  };

  useEffect(() => { loadData(); }, []);

  if (loading) return <div style={{ padding: 32 }}>Carregando...</div>;

  // Contagem por nivel
  const countByNivel: Record<number, number> = {};
  rows.forEach(r => { countByNivel[r.nivel] = (countByNivel[r.nivel] || 0) + 1; });

  // Insumos
  const insumos = rows.filter(r => r.nome.toLowerCase().includes('insumo'));

  return (
    <div style={{ padding: 32, fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap' }}>
      <h2>DEBUG — valores_mensais com JOIN plano_de_contas</h2>
      <p>Cliente: {CLIENTE_ID}</p>

      <div style={{ margin: '16px 0' }}>
        <button
          onClick={handleDeleteAll}
          disabled={deleting}
          style={{ background: '#DC2626', color: 'white', padding: '8px 16px', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: 14 }}
        >
          {deleting ? 'Apagando...' : '⚠️ Apagar TODOS os valores_mensais do cliente Regalo'}
        </button>
        {deleteResult && <div style={{ marginTop: 8, fontWeight: 'bold' }}>{deleteResult}</div>}
      </div>
      <hr />

      <h3>1. Contagem por nivel (total: {rows.length} registros não-null)</h3>
      {Object.entries(countByNivel).sort(([a],[b]) => Number(a)-Number(b)).map(([n, count]) => (
        <div key={n}>nivel={n}: {count} registros</div>
      ))}

      <hr />
      <h3>2. Contas INSUMOS ({insumos.length} registros)</h3>
      {insumos.length === 0 && <div>Nenhum registro encontrado</div>}
      {insumos.map((r, i) => (
        <div key={i}>
          nivel={r.nivel} | {r.nome} | {r.competencia} | valor={r.valor_realizado}
        </div>
      ))}

      <hr />
      <h3>3. Todos os registros ({rows.length})</h3>
      {rows.map((r, i) => (
        <div key={i}>
          nivel={r.nivel} | {r.nome} | {r.competencia} | valor={r.valor_realizado}
        </div>
      ))}
    </div>
  );
}
