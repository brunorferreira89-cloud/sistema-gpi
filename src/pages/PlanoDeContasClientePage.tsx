import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { BookOpen, Upload, Copy, ArrowLeft } from 'lucide-react';
import { PlanoDeContasDetail } from '@/pages/PlanoDeContasPage';
import { ImportXlsxDialog } from '@/components/plano-contas/ImportXlsxDialog';
import { CopyFromClienteDialog } from '@/components/plano-contas/CopyFromClienteDialog';
import { type ContaRow } from '@/lib/plano-contas-utils';

export default function PlanoDeContasClientePage() {
  const { clienteId } = useParams<{ clienteId: string }>();
  const navigate = useNavigate();
  const [importOpen, setImportOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: cliente } = useQuery({
    queryKey: ['cliente', clienteId],
    queryFn: async () => {
      const { data, error } = await supabase.from('clientes').select('*').eq('id', clienteId!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!clienteId,
  });

  const { data: contas, refetch: refetchContas } = useQuery({
    queryKey: ['plano-contas', clienteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('plano_de_contas')
        .select('*')
        .eq('cliente_id', clienteId!)
        .order('ordem');
      if (error) throw error;
      return data as ContaRow[];
    },
    enabled: !!clienteId,
  });

  const handleRefresh = () => {
    refetchContas();
  };

  const hasContas = contas && contas.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/plano-de-contas')} className="rounded-lg p-2 text-txt-muted hover:bg-surface-hi">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <h2 className="text-2xl font-bold text-txt">{cliente?.razao_social || cliente?.nome_empresa || 'Carregando...'}</h2>
          <p className="text-sm text-txt-muted">Plano de Contas — Estrutura DRE</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)} className="gap-2">
            <Upload className="h-4 w-4" />
            Importar .xlsx do Nibo
          </Button>
          <Button variant="outline" onClick={() => setCopyOpen(true)} className="gap-2">
            <Copy className="h-4 w-4" />
            Copiar de outro cliente
          </Button>
        </div>
      </div>

      {hasContas ? (
        <PlanoDeContasDetail
          contas={contas}
          clienteId={clienteId!}
          onRefresh={handleRefresh}
        />
      ) : (
        <div className="flex flex-col items-center justify-center gap-4 py-20 rounded-xl border border-dashed border-border bg-surface">
          <BookOpen className="h-16 w-16 text-txt-muted opacity-30" />
          <h3 className="text-lg font-semibold text-txt">Nenhuma conta cadastrada</h3>
          <p className="text-sm text-txt-muted max-w-md text-center">
            Importe a DRE do Nibo ou copie de um cliente do mesmo segmento
          </p>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setImportOpen(true)} className="gap-2">
              <Upload className="h-4 w-4" />
              Importar .xlsx do Nibo
            </Button>
            <Button variant="outline" onClick={() => setCopyOpen(true)} className="gap-2">
              <Copy className="h-4 w-4" />
              Copiar de outro cliente
            </Button>
          </div>
        </div>
      )}

      {cliente && (
        <>
          <ImportXlsxDialog
            open={importOpen}
            onOpenChange={setImportOpen}
            clienteId={clienteId!}
            clienteFaixa={cliente.faturamento_faixa}
          />
          <CopyFromClienteDialog
            open={copyOpen}
            onOpenChange={setCopyOpen}
            clienteId={clienteId!}
            clienteSegmento={cliente.segmento}
            clienteFaixa={cliente.faturamento_faixa}
          />
        </>
      )}
    </div>
  );
}
