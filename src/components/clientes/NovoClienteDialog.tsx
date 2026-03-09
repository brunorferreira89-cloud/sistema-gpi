import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { ONBOARDING_ITEMS, TREINAMENTO_MODULOS } from '@/lib/onboarding-defaults';
import { toast } from '@/hooks/use-toast';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NovoClienteDialog({ open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    nome_empresa: '',
    segmento: '',
    faturamento_faixa: '',
    status: 'onboarding',
    responsavel_nome: '',
    responsavel_email: '',
    responsavel_whatsapp: '',
  });

  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const handleSave = async () => {
    if (!form.nome_empresa || !form.segmento || !form.faturamento_faixa) {
      toast({ title: 'Preencha os campos obrigatórios', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const { data: cliente, error } = await supabase
        .from('clientes')
        .insert({
          nome_empresa: form.nome_empresa,
          segmento: form.segmento,
          faturamento_faixa: form.faturamento_faixa,
          status: form.status,
          responsavel_nome: form.responsavel_nome || null,
          responsavel_email: form.responsavel_email || null,
          responsavel_whatsapp: form.responsavel_whatsapp || null,
        } as any)
        .select()
        .single();
      if (error) throw error;

      // Populate onboarding checklist
      const onboardingRows = ONBOARDING_ITEMS.map((i) => ({
        cliente_id: cliente.id,
        semana: i.semana,
        item: i.item,
        ordem: i.ordem,
      }));
      await supabase.from('onboarding_checklist' as any).insert(onboardingRows);

      // Populate training modules
      const treinamentoRows = TREINAMENTO_MODULOS.map((m) => ({
        cliente_id: cliente.id,
        modulo: m.modulo,
        titulo: m.titulo,
        ordem: m.ordem,
      }));
      await supabase.from('treinamento_progresso' as any).insert(treinamentoRows);

      toast({ title: 'Cliente cadastrado. Checklist de onboarding criado automaticamente.' });
      onOpenChange(false);
      navigate(`/clientes/${cliente.id}`);
    } catch (err: any) {
      toast({ title: 'Erro ao cadastrar', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo Cliente</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="space-y-1.5">
            <Label>Nome da empresa *</Label>
            <Input value={form.nome_empresa} onChange={(e) => set('nome_empresa', e.target.value)} placeholder="Ex: Padaria Dona Maria" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Segmento *</Label>
              <Select value={form.segmento} onValueChange={(v) => set('segmento', v)}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="alimentacao">Alimentação</SelectItem>
                  <SelectItem value="saude">Saúde</SelectItem>
                  <SelectItem value="estetica">Beleza & Estética</SelectItem>
                  <SelectItem value="varejo">Varejo</SelectItem>
                  <SelectItem value="servicos">Serviços</SelectItem>
                  <SelectItem value="outro">Outro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Faturamento mensal *</Label>
              <Select value={form.faturamento_faixa} onValueChange={(v) => set('faturamento_faixa', v)}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="faixa1">R$ 80k a R$ 150k</SelectItem>
                  <SelectItem value="faixa2">R$ 150k a R$ 300k</SelectItem>
                  <SelectItem value="faixa3">R$ 300k a R$ 500k</SelectItem>
                  <SelectItem value="faixa4">Acima de R$ 500k</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Status inicial</Label>
            <Select value={form.status} onValueChange={(v) => set('status', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="onboarding">Onboarding</SelectItem>
                <SelectItem value="ativo">Ativo</SelectItem>
                <SelectItem value="inativo">Inativo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="border-t border-border pt-3 space-y-3">
            <p className="text-xs font-medium text-txt-sec">Responsável financeiro</p>
            <Input value={form.responsavel_nome} onChange={(e) => set('responsavel_nome', e.target.value)} placeholder="Nome do responsável" />
            <div className="grid grid-cols-2 gap-3">
              <Input type="email" value={form.responsavel_email} onChange={(e) => set('responsavel_email', e.target.value)} placeholder="E-mail" />
              <Input value={form.responsavel_whatsapp} onChange={(e) => set('responsavel_whatsapp', e.target.value)} placeholder="WhatsApp" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? 'Salvando...' : 'Cadastrar cliente'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
