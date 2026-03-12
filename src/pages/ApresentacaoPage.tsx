import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import PrepararApresentacao from '@/components/apresentacao/PrepararApresentacao';
import ApresentacaoSlides from '@/components/apresentacao/ApresentacaoSlides';

export default function ApresentacaoPage() {
  const { clienteId } = useParams<{ clienteId: string }>();
  const [competencia, setCompetencia] = useState<string | null>(null);
  const [mesesDisponiveis, setMesesDisponiveis] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'prep' | 'slides'>('prep');

  useEffect(() => {
    if (!clienteId) return;
    async function loadMeses() {
      setLoading(true);
      const { data: contas } = await supabase.from('plano_de_contas').select('id').eq('cliente_id', clienteId);
      const ids = (contas || []).map(c => c.id);
      if (ids.length === 0) { setLoading(false); return; }

      const { data: valores } = await supabase.from('valores_mensais').select('competencia').in('conta_id', ids);
      const uniqueMeses = [...new Set((valores || []).map((v: any) => v.competencia))].sort().reverse();
      setMesesDisponiveis(uniqueMeses);
      if (uniqueMeses.length > 0) setCompetencia(uniqueMeses[0]);
      setLoading(false);
    }
    loadMeses();
  }, [clienteId]);

  if (!clienteId) return null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!competencia) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Nenhum dado financeiro encontrado para este cliente.
      </div>
    );
  }

  if (mode === 'slides') {
    return (
      <ApresentacaoSlides
        clienteId={clienteId}
        competencia={competencia}
        onExit={() => setMode('prep')}
      />
    );
  }

  const fmtMes = (comp: string) => {
    const d = new Date(comp + 'T00:00:00');
    return d.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).toUpperCase().replace('.', '');
  };

  return (
    <div className="p-6 bg-[#F0F4FA] min-h-screen">
      {/* Competência selector */}
      <div className="flex items-center gap-3 mb-6">
        <span className="text-sm font-medium text-[#4A5E80]">Competência:</span>
        <Select value={competencia} onValueChange={(v) => { setCompetencia(v); setMode('prep'); }}>
          <SelectTrigger className="w-[180px] bg-white border-[#DDE4F0]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {mesesDisponiveis.map(m => (
              <SelectItem key={m} value={m}>{fmtMes(m)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <PrepararApresentacao
        clienteId={clienteId}
        competencia={competencia}
        onStartPresentation={() => setMode('slides')}
        onPreview={() => setMode('slides')}
      />
    </div>
  );
}
