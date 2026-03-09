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
import { Search, Loader2, CheckCircle2 } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatCnpj(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 14);
  return digits
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

function cleanCnpj(value: string): string {
  return value.replace(/\D/g, '');
}

export function NovoClienteDialog({ open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [cnpjLoading, setCnpjLoading] = useState(false);
  const [cnpjFetched, setCnpjFetched] = useState(false);
  const [form, setForm] = useState({
    cnpj: '',
    nome_empresa: '',
    razao_social: '',
    endereco_completo: '',
    cep: '',
    administrador_nome: '',
    administrador_cpf: '',
    segmento: '',
    faturamento_faixa: '',
    status: 'onboarding',
    responsavel_nome: '',
    responsavel_email: '',
    responsavel_whatsapp: '',
  });

  const set = (key: string, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (key === 'cnpj') setCnpjFetched(false);
  };

  const handleCnpjChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatCnpj(e.target.value);
    set('cnpj', formatted);
  };

  const fetchCnpjData = async () => {
    const digits = cleanCnpj(form.cnpj);
    if (digits.length !== 14) {
      toast({ title: 'CNPJ deve ter 14 dígitos', variant: 'destructive' });
      return;
    }

    setCnpjLoading(true);
    try {
      const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`);
      if (!res.ok) throw new Error('CNPJ não encontrado');
      const data = await res.json();

      const endereco = [
        data.descricao_tipo_de_logradouro,
        data.logradouro,
        data.numero,
        data.complemento,
        data.bairro,
        data.municipio ? `${data.municipio}/${data.uf}` : '',
      ]
        .filter(Boolean)
        .join(', ');

      const socios = data.qsa || [];
      const admin = socios.find(
        (s: any) =>
          s.qualificacao_socio?.toLowerCase().includes('administrador') ||
          s.qualificacao_socio?.toLowerCase().includes('sócio-administrador')
      ) || socios[0];

      setForm((f) => ({
        ...f,
        razao_social: data.razao_social || '',
        nome_empresa: f.nome_empresa || data.nome_fantasia || data.razao_social || '',
        endereco_completo: endereco,
        cep: data.cep ? data.cep.replace(/^(\d{5})(\d{3})$/, '$1-$2') : '',
        administrador_nome: admin?.nome_socio || '',
        administrador_cpf: admin?.cnpj_cpf_do_socio || '',
        responsavel_nome: f.responsavel_nome || admin?.nome_socio || '',
      }));

      setCnpjFetched(true);
      toast({ title: 'Dados do CNPJ carregados com sucesso' });
    } catch {
      toast({ title: 'Não foi possível consultar o CNPJ', description: 'Verifique o número e tente novamente.', variant: 'destructive' });
    } finally {
      setCnpjLoading(false);
    }
  };

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
          cnpj: cleanCnpj(form.cnpj) || null,
          razao_social: form.razao_social || null,
          endereco_completo: form.endereco_completo || null,
          cep: form.cep || null,
          administrador_nome: form.administrador_nome || null,
          administrador_cpf: form.administrador_cpf || null,
        } as any)
        .select()
        .single();
      if (error) throw error;

      const onboardingRows = ONBOARDING_ITEMS.map((i) => ({
        cliente_id: cliente.id,
        semana: i.semana,
        item: i.item,
        ordem: i.ordem,
      }));
      await supabase.from('onboarding_checklist' as any).insert(onboardingRows);

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
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo Cliente</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          {/* CNPJ com busca automática */}
          <div className="space-y-1.5">
            <Label>CNPJ</Label>
            <div className="flex gap-2">
              <Input
                value={form.cnpj}
                onChange={handleCnpjChange}
                placeholder="00.000.000/0000-00"
                maxLength={18}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={fetchCnpjData}
                disabled={cnpjLoading || cleanCnpj(form.cnpj).length !== 14}
                title="Buscar dados do CNPJ"
              >
                {cnpjLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : cnpjFetched ? (
                  <CheckCircle2 className="h-4 w-4 text-green" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Dados preenchidos pela Receita Federal */}
          {cnpjFetched && (
            <div className="rounded-lg border border-border bg-surface-hi p-3 space-y-2">
              <p className="text-xs font-semibold text-txt-sec uppercase tracking-wide">Dados da Receita Federal</p>
              <div className="grid gap-2 text-sm">
                <div>
                  <span className="text-txt-muted text-xs">Razão Social:</span>
                  <p className="text-txt font-medium">{form.razao_social || '—'}</p>
                </div>
                <div>
                  <span className="text-txt-muted text-xs">Endereço:</span>
                  <p className="text-txt">{form.endereco_completo || '—'}</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-txt-muted text-xs">CEP:</span>
                    <p className="text-txt">{form.cep || '—'}</p>
                  </div>
                  <div>
                    <span className="text-txt-muted text-xs">Administrador:</span>
                    <p className="text-txt">{form.administrador_nome || '—'}</p>
                  </div>
                </div>
                {form.administrador_cpf && (
                  <div>
                    <span className="text-txt-muted text-xs">CPF do administrador:</span>
                    <p className="text-txt font-mono-data text-xs">{form.administrador_cpf}</p>
                  </div>
                )}
              </div>
            </div>
          )}

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
