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

  useEffect(() => {
    async function run() {
      setLoading(true);

      // Get all contas for this client
      const { data: contas } = await supabase
        .from('plano_de_contas')
        .select('id, nome, nivel')
        .eq('cliente_id', CLIENTE_ID);

      if (!contas?.length) { setLoading(false); return; }

      const contaMap = new Map(contas.map(c => [c.id, c]));
      const contaIds = contas.map(c => c.id);

      // Get all valores_mensais with non-null valor
      const { data: valores } = await supabase
        .from('valores_mensais')
        .select('conta_id, competencia, valor_realizado')
        .in('conta_id', contaIds)
        .not('valor_realizado', 'is', null)
        .order('competencia');

      const joined: Row[] = (valores || []).map(v => {
        const c = contaMap.get(v.conta_id);
        return {
          conta_id: v.conta_id,
          competencia: v.competencia,
          valor_realizado: v.valor_realizado,
          nome: c?.nome ?? '???',
          nivel: c?.nivel ?? -1,
        };
      }).sort((a, b) => a.nivel - b.nivel || a.nome.localeCompare(b.nome) || a.competencia.localeCompare(b.competencia));

      setRows(joined);
      setLoading(false);
    }
    run();
  }, []);

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
