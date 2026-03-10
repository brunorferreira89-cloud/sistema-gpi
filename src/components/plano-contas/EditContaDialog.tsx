import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { type ContaRow } from '@/lib/plano-contas-utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface EditContaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conta: ContaRow | null;
  contas: ContaRow[];
  onSaved: () => void;
}

const TIPO_OPTIONS = [
  { value: 'receita', label: 'Receitas operacionais' },
  { value: 'custo_variavel', label: 'Custos operacionais' },
  { value: 'despesa_fixa', label: 'Despesas operacionais e outras receitas' },
  { value: 'investimento', label: 'Atividades de investimento' },
  { value: 'financiamento', label: 'Atividades de financiamento' },
];

export function EditContaDialog({ open, onOpenChange, conta, contas, onSaved }: EditContaDialogProps) {
  const [nome, setNome] = useState('');
  const [direcao, setDirecao] = useState<'entrada' | 'saida'>('saida');
  const [tipo, setTipo] = useState('despesa_fixa');
  const [grupoId, setGrupoId] = useState<string>('');
  const [subgrupoId, setSubgrupoId] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const nivel = conta?.nivel ?? 0;

  const grupos = useMemo(() => contas.filter(c => c.nivel === 0), [contas]);

  const subgrupos = useMemo(() => {
    if (!grupoId) return [];
    return contas.filter(c => c.nivel === 1 && c.conta_pai_id === grupoId);
  }, [contas, grupoId]);

  useEffect(() => {
    if (!conta || !open) return;

    if (conta.nivel === 0) {
      setNome(conta.nome);
      setTipo(conta.tipo);
    } else if (conta.nivel === 1) {
      const raw = conta.nome;
      const hasPlus = raw.startsWith('(+)');
      const hasMinus = raw.startsWith('(-)');
      setDirecao(hasPlus ? 'entrada' : hasMinus ? 'saida' : (conta.tipo === 'receita' ? 'entrada' : 'saida'));
      setNome(raw.replace(/^\([+-]\)\s*/, ''));
      // Find parent grupo
      setGrupoId(conta.conta_pai_id || '');
    } else if (conta.nivel === 2) {
      const raw = conta.nome;
      const hasPlus = raw.startsWith('(+)');
      const hasMinus = raw.startsWith('(-)');
      setDirecao(hasPlus ? 'entrada' : hasMinus ? 'saida' : (conta.tipo === 'receita' ? 'entrada' : 'saida'));
      setNome(raw.replace(/^\([+-]\)\s*/, ''));
      // Find parent subgrupo and grupo
      const parentSub = contas.find(c => c.id === conta.conta_pai_id);
      if (parentSub) {
        setSubgrupoId(parentSub.id);
        setGrupoId(parentSub.conta_pai_id || '');
      } else {
        setSubgrupoId('');
        setGrupoId(conta.conta_pai_id || '');
      }
    }
  }, [conta, open, contas]);

  const handleSave = async () => {
    if (!conta || !nome.trim()) return;
    setSaving(true);

    try {
      const updates: Record<string, unknown> = {};

      if (nivel === 0) {
        updates.nome = nome.trim();
        updates.tipo = tipo;
      } else if (nivel === 1) {
        const prefix = direcao === 'entrada' ? '(+) ' : '(-) ';
        updates.nome = prefix + nome.trim();
        updates.conta_pai_id = grupoId || null;
      } else if (nivel === 2) {
        const prefix = direcao === 'entrada' ? '(+) ' : '(-) ';
        updates.nome = prefix + nome.trim();
        // If subgrupo selected, parent is subgrupo; else parent is grupo
        updates.conta_pai_id = subgrupoId || grupoId || null;
      }

      await supabase.from('plano_de_contas').update(updates).eq('id', conta.id);
      toast.success('Conta atualizada');
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error('Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const titleByNivel = nivel === 0 ? 'Modificar grupo' : nivel === 1 ? 'Modificar subgrupo' : 'Modificar categoria';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]" style={{ background: '#FFFFFF', border: '1px solid #DDE4F0' }}>
        <DialogHeader>
          <DialogTitle style={{ color: '#0D1B35', fontFamily: 'DM Sans, sans-serif' }}>{titleByNivel}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {/* Direction toggle for nivel 1 and 2 */}
          {(nivel === 1 || nivel === 2) && (
            <div className="flex flex-col gap-1.5">
              <Label style={{ color: '#0D1B35', fontSize: 13 }}>Direção</Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setDirecao('entrada')}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-md border text-sm font-medium transition-colors"
                  style={{
                    borderColor: direcao === 'entrada' ? '#16A34A' : '#DDE4F0',
                    background: direcao === 'entrada' ? '#F0FDF4' : '#FFFFFF',
                    color: direcao === 'entrada' ? '#16A34A' : '#6B7280',
                  }}
                >
                  <span style={{ fontWeight: 700 }}>↑</span> Entrada
                </button>
                <button
                  type="button"
                  onClick={() => setDirecao('saida')}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-md border text-sm font-medium transition-colors"
                  style={{
                    borderColor: direcao === 'saida' ? '#DC2626' : '#DDE4F0',
                    background: direcao === 'saida' ? '#FEF2F2' : '#FFFFFF',
                    color: direcao === 'saida' ? '#DC2626' : '#6B7280',
                  }}
                >
                  <span style={{ fontWeight: 700 }}>↓</span> Saída
                </button>
              </div>
            </div>
          )}

          {/* Name field */}
          <div className="flex flex-col gap-1.5">
            <Label style={{ color: '#0D1B35', fontSize: 13 }}>
              {nivel === 0 ? 'Nome do grupo' : nivel === 1 ? 'Nome do subgrupo' : 'Nome da categoria'}
            </Label>
            <Input
              value={nome}
              onChange={e => setNome(e.target.value)}
              className="h-9"
              style={{ borderColor: '#DDE4F0' }}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
            />
          </div>

          {/* Tipo for nivel 0 */}
          {nivel === 0 && (
            <div className="flex flex-col gap-1.5">
              <Label style={{ color: '#0D1B35', fontSize: 13 }}>Tipo</Label>
              <Select value={tipo} onValueChange={setTipo}>
                <SelectTrigger className="h-9" style={{ borderColor: '#DDE4F0' }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPO_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Grupo selector for nivel 1 and 2 */}
          {(nivel === 1 || nivel === 2) && (
            <div className="flex flex-col gap-1.5">
              <Label style={{ color: '#0D1B35', fontSize: 13 }}>Grupo</Label>
              <Select value={grupoId} onValueChange={(v) => { setGrupoId(v); setSubgrupoId(''); }}>
                <SelectTrigger className="h-9" style={{ borderColor: '#DDE4F0' }}>
                  <SelectValue placeholder="Selecione o grupo" />
                </SelectTrigger>
                <SelectContent>
                  {grupos.map(g => (
                    <SelectItem key={g.id} value={g.id}>{g.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Subgrupo selector for nivel 2 */}
          {nivel === 2 && (
            <div className="flex flex-col gap-1.5">
              <Label style={{ color: '#0D1B35', fontSize: 13 }}>Subgrupo (opcional)</Label>
              <Select value={subgrupoId} onValueChange={setSubgrupoId}>
                <SelectTrigger className="h-9" style={{ borderColor: '#DDE4F0' }}>
                  <SelectValue placeholder="Selecione o subgrupo" />
                </SelectTrigger>
                <SelectContent>
                  {subgrupos.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} style={{ borderColor: '#DDE4F0', color: '#0D1B35' }}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving} style={{ background: '#1A3CFF', color: '#FFFFFF' }}>
            {saving ? 'Salvando...' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
