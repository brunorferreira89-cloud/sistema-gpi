import { useState, useEffect } from 'react';
import { Eye, Lock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import ClientePortalPage from '@/pages/ClientePortalPage';

interface Props {
  clienteId: string;
  onSwitchTab?: (tab: string) => void;
}

export function ClientePortalEspelho({ clienteId, onSwitchTab }: Props) {
  const [portalAtivo, setPortalAtivo] = useState<boolean | null>(null);
  const [clienteNome, setClienteNome] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const check = async () => {
      setLoading(true);
      // Check if any active link exists in portal_usuario_clientes for this client
      const { data: links } = await supabase
        .from('portal_usuario_clientes')
        .select('id')
        .eq('cliente_id', clienteId)
        .eq('ativo', true)
        .limit(1);

      // Also check legacy profiles.portal_ativo as fallback
      const { data: profiles } = await supabase
        .from('profiles')
        .select('portal_ativo')
        .eq('cliente_id', clienteId)
        .eq('role', 'cliente');

      const ativo = (links && links.length > 0) || (profiles?.some((p: any) => p.portal_ativo === true) ?? false);
      setPortalAtivo(ativo);

      const { data: cli } = await supabase
        .from('clientes')
        .select('nome_empresa, razao_social')
        .eq('id', clienteId)
        .single();
      setClienteNome(cli?.razao_social || cli?.nome_empresa || '');
      setLoading(false);
    };
    check();
  }, [clienteId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!portalAtivo) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="max-w-md rounded-xl border border-border bg-surface p-8 text-center space-y-4">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <Lock className="h-8 w-8 text-txt-muted" />
          </div>
          <h3 className="text-lg font-bold text-txt">Portal não ativo para este cliente</h3>
          <p className="text-sm text-txt-muted leading-relaxed">
            Configure o acesso na aba Portal e ative o portal para
            visualizar como o cliente verá as informações.
          </p>
          {onSwitchTab && (
            <Button variant="outline" onClick={() => onSwitchTab('contato')}>
              Ir para aba Contato
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Banner de contexto */}
      <div
        className="mb-4 flex items-center justify-between rounded-lg px-4 py-2.5"
        style={{
          background: 'rgba(217,119,6,0.08)',
          borderBottom: '1px solid rgba(217,119,6,0.20)',
        }}
      >
        <div className="flex items-center gap-2 text-sm">
          <Eye className="h-4 w-4" style={{ color: '#D97706' }} />
          <span style={{ color: '#92400E' }}>
            Você está vendo o portal como o cliente vê · <strong>{clienteNome}</strong>
          </span>
        </div>
        <span
          className="rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase"
          style={{ background: 'rgba(217,119,6,0.12)', color: '#92400E' }}
        >
          Modo Consultor — somente leitura
        </span>
      </div>

      {/* Portal content */}
      <ClientePortalPage clienteId={clienteId} espelho />
    </div>
  );
}
