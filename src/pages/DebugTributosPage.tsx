import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

const CLIENTE_REGALO_ID = '9911afed-7508-42db-92ab-86397f4a95ad';
const ANO = '2026';
const NOMES_ALVO = ['Simples Nacional', 'ICMS', 'Parcelamento de Tributos'];

export default function DebugTributosPage() {
  const [contasTributos, setContasTributos] = useState<any[]>([]);
  const [valoresPorConta, setValoresPorConta] = useState<Record<string, any[]>>({});
  const [valoresSemFiltro, setValoresSemFiltro] = useState<Record<string, any[]>>({});
  const [totalValores, setTotalValores] = useState<number | null>(null);
  const [ultimaImportacao, setUltimaImportacao] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function run() {
      setLoading(true);

      // 1. Buscar todas as contas do cliente
      const { data: todasContas } = await supabase
        .from('plano_de_contas')
        .select('id, nome, nivel, conta_pai_id, ordem, tipo')
        .eq('cliente_id', CLIENTE_REGALO_ID)
        .order('ordem');

      // Filtrar tributos
      const tributos = (todasContas || []).filter(c =>
        c.nome.toUpperCase().includes('TRIBUT') ||
        c.nome.toUpperCase().includes('SIMPLES') ||
        c.nome.toUpperCase().includes('ICMS')
      );
      setContasTributos(tributos);

      // 2. Buscar valores (com filtro not null) para cada conta encontrada
      const map: Record<string, any[]> = {};
      for (const c of tributos) {
        const { data } = await supabase
          .from('valores_mensais')
          .select('conta_id, competencia, valor_realizado')
          .eq('conta_id', c.id)
          .gte('competencia', `${ANO}-01-01`)
          .lte('competencia', `${ANO}-12-31`)
          .order('competencia');
        map[c.id] = data || [];
      }
      setValoresPorConta(map);

      // 2b. Buscar valores SEM filtro de null para as 3 contas-alvo
      const contasAlvo = tributos.filter(c =>
        NOMES_ALVO.some(n => c.nome.toLowerCase().includes(n.toLowerCase()))
      );
      const mapSemFiltro: Record<string, any[]> = {};
      for (const c of contasAlvo) {
        const { data } = await supabase
          .from('valores_mensais')
          .select('conta_id, competencia, valor_realizado')
          .eq('conta_id', c.id)
          .gte('competencia', `${ANO}-01-01`)
          .lte('competencia', `${ANO}-12-31`)
          .order('competencia');
        mapSemFiltro[c.id] = data || [];
      }
      setValoresSemFiltro(mapSemFiltro);

      // 3. Total de registros em valores_mensais para o cliente em 2026
      const contaIds = (todasContas || []).map(c => c.id);
      if (contaIds.length > 0) {
        const { data: allVals } = await supabase
          .from('valores_mensais')
          .select('id')
          .in('conta_id', contaIds)
          .gte('competencia', `${ANO}-01-01`)
          .lte('competencia', `${ANO}-12-31`);
        setTotalValores(allVals?.length ?? 0);
      }

      // 4. Última importação do cliente
      const { data: impData } = await supabase
        .from('importacoes_nibo')
        .select('*')
        .eq('cliente_id', CLIENTE_REGALO_ID)
        .order('created_at', { ascending: false })
        .limit(1);
      setUltimaImportacao(impData?.[0] ?? null);

      setLoading(false);
    }
    run();
  }, []);

  if (loading) return <div style={{ padding: 32 }}>Carregando diagnóstico...</div>;

  const contasAlvo = contasTributos.filter(c =>
    NOMES_ALVO.some(n => c.nome.toLowerCase().includes(n.toLowerCase()))
  );

  return (
    <div style={{ padding: 32, fontFamily: 'monospace', fontSize: 13, whiteSpace: 'pre-wrap' }}>
      <h2>DEBUG TRIBUTOS — Cliente Regalo ({CLIENTE_REGALO_ID})</h2>
      <hr />

      <h3>1. Contas com nome TRIBUT/SIMPLES/ICMS ({contasTributos.length} encontradas)</h3>
      {contasTributos.map(c => (
        <div key={c.id}>
          id: {c.id} | nome: {c.nome} | nivel: {c.nivel} | conta_pai_id: {c.conta_pai_id} | tipo: {c.tipo} | ordem: {c.ordem}
        </div>
      ))}

      <hr />
      <h3>2. Valores mensais para cada conta acima (ano {ANO}) — filtro padrão</h3>
      {contasTributos.map(c => (
        <div key={c.id} style={{ marginBottom: 16 }}>
          <strong>{c.nome} ({c.id}):</strong>
          {valoresPorConta[c.id]?.length === 0 && ' NENHUM VALOR ENCONTRADO'}
          {valoresPorConta[c.id]?.map((v, i) => (
            <div key={i}>  competencia: {v.competencia} | valor_realizado: {v.valor_realizado}</div>
          ))}
        </div>
      ))}

      <hr />
      <h3>2b. Valores SEM filtro de null — contas-alvo ({contasAlvo.length} contas)</h3>
      {contasAlvo.map(c => (
        <div key={c.id} style={{ marginBottom: 16 }}>
          <strong>{c.nome} ({c.id}):</strong>
          {(valoresSemFiltro[c.id]?.length ?? 0) === 0 && ' NENHUM REGISTRO'}
          {valoresSemFiltro[c.id]?.map((v, i) => (
            <div key={i}>  competencia: {v.competencia} | valor_realizado: {v.valor_realizado === null ? 'NULL' : v.valor_realizado}</div>
          ))}
        </div>
      ))}

      <hr />
      <h3>3. Total de registros em valores_mensais do cliente em {ANO}: {totalValores}</h3>

      <hr />
      <h3>4. Última importação Nibo do cliente</h3>
      {ultimaImportacao ? (
        <div>
          id: {ultimaImportacao.id}{'\n'}
          created_at: {ultimaImportacao.created_at}{'\n'}
          competencia: {ultimaImportacao.competencia}{'\n'}
          arquivo_nome: {ultimaImportacao.arquivo_nome}{'\n'}
          status: {ultimaImportacao.status}{'\n'}
          total_contas_importadas: {ultimaImportacao.total_contas_importadas}{'\n'}
          total_contas_nao_mapeadas: {ultimaImportacao.total_contas_nao_mapeadas}{'\n'}
          observacao: {ultimaImportacao.observacao}
        </div>
      ) : (
        <div>NENHUMA IMPORTAÇÃO ENCONTRADA</div>
      )}
    </div>
  );
}
