import { useState, useRef, useEffect, useMemo } from 'react';

const EMOJI_MAP: Record<string, string> = {
  // Alimentação
  'restaurante': '🍽️', 'pizza': '🍕', 'pizzaria': '🍕',
  'sushi': '🍣', 'japones': '🍱', 'churrasco': '🥩',
  'hamburger': '🍔', 'lanchonete': '🍔', 'sanduiche': '🥪',
  'padaria': '🥖', 'confeitaria': '🎂', 'doceria': '🍰',
  'sorvete': '🍦', 'acai': '🫐', 'cafe': '☕',
  'cafeteria': '☕', 'bar': '🍺', 'boteco': '🍻',
  'peixe': '🐟', 'frutos do mar': '🦞', 'carnes': '🥩',
  'acougue': '🥩', 'hortifruti': '🥦', 'mercado': '🛒',
  'supermercado': '🛒', 'marmita': '🍱', 'fit': '🥗',
  'vegano': '🌱', 'vegetariano': '🥦', 'tapioca': '🫓',
  'crepe': '🥞', 'massa': '🍝', 'italiano': '🍝',
  'chines': '🥡', 'tailandes': '🍜', 'indiano': '🍛',
  'mexicano': '🌮', 'americano': '🍔', 'baiano': '🦐',
  'nordestino': '🌵', 'self service': '🍽️',
  // Saúde
  'clinica': '🏥', 'hospital': '🏥', 'medico': '👨‍⚕️',
  'dentista': '🦷', 'odonto': '🦷', 'farmacia': '💊',
  'laboratorio': '🔬', 'fisioterapia': '🦴',
  'nutricao': '🥗', 'nutricionista': '🥗',
  'psicologia': '🧠', 'psiquiatria': '🧠',
  'veterinario': '🐾', 'pet': '🐶', 'oftalmologia': '👁️',
  'dermatologia': '🫁', 'cardiologia': '❤️',
  'ortopedia': '🦴', 'pediatria': '👶',
  'ginecologia': '👩‍⚕️', 'urologia': '💉',
  'endocrinologia': '🔬', 'neurologia': '🧠',
  'terapia': '🧘', 'quiropraxia': '💆',
  // Beleza e Estética
  'salao': '💇', 'barbearia': '💈', 'cabeleireiro': '✂️',
  'estetica': '💅', 'unhas': '💅', 'manicure': '💅',
  'spa': '🧖', 'massagem': '💆', 'depilacao': '🪒',
  'maquiagem': '💄', 'micropigmentacao': '🖊️',
  'sobrancelha': '👁️', 'cilios': '👁️', 'botox': '💉',
  'emagrecimento': '⚖️', 'laser': '✨',
  // Fitness e Academia
  'academia': '🏋️', 'crossfit': '🏋️', 'pilates': '🧘',
  'yoga': '🧘', 'natacao': '🏊', 'futebol': '⚽',
  'musculacao': '💪', 'personal': '🏃', 'danca': '💃',
  'artes marciais': '🥋', 'boxe': '🥊', 'muay thai': '🥊',
  'funcional': '🏃', 'spinning': '🚴', 'ginastica': '🤸',
  // Educação
  'escola': '🏫', 'colegio': '🎒', 'universidade': '🎓',
  'curso': '📚', 'ingles': '🇺🇸', 'idiomas': '🌍',
  'informatica': '💻', 'cursinhos': '📝', 'reforco': '📖',
  'creche': '👶', 'jardim': '🌸',
  // Moda e Varejo
  'loja': '🏪', 'boutique': '👗', 'moda': '👗',
  'calcados': '👟', 'acessorios': '💍', 'joias': '💎',
  'relogio': '⌚', 'otica': '👓', 'cama mesa banho': '🛏️',
  'eletronicos': '📱', 'informatica loja': '💻',
  // Serviços
  'contabilidade': '📊', 'advocacia': '⚖️',
  'imobiliaria': '🏠', 'construcao': '🏗️',
  'arquitetura': '📐', 'engenharia': '⚙️',
  'marketing': '📣', 'publicidade': '🎨',
  'fotografia': '📷', 'video': '🎬',
  'musica': '🎵', 'evento': '🎉', 'buffet': '🎊',
  'seguranca': '🔒', 'limpeza': '🧹',
  'logistica': '🚚', 'transporte': '🚗',
  'oficina': '🔧', 'eletrica': '⚡',
  'hidraulica': '🔧', 'ar condicionado': '❄️',
  'tecnologia': '💻', 'software': '💻',
  'financeiro': '💰', 'investimento': '📈',
  'consultoria': '🤝', 'rh': '👥',
  // Default
  'empresa': '🏢', 'comercio': '🏪', 'industria': '🏭',
  // Extra - Automotivo
  'automovel': '🚗', 'mecanica': '🔧', 'funilaria': '🚙',
  'lava jato': '🚿', 'estacionamento': '🅿️', 'autoescola': '🚦',
  'pneu': '🛞', 'motocicleta': '🏍️', 'bicicleta': '🚲',
  // Extra - Entretenimento
  'cinema': '🎬', 'teatro': '🎭', 'parque': '🎢',
  'boliche': '🎳', 'karaoke': '🎤', 'escape room': '🔐',
  'fliperamas': '🕹️', 'brinquedo': '🧸',
  // Extra - Turismo e Hotelaria
  'hotel': '🏨', 'pousada': '🏡', 'hostel': '🛏️',
  'viagem': '✈️', 'turismo': '🗺️', 'agencia viagem': '✈️',
  'camping': '⛺', 'resort': '🏖️',
  // Extra - Alimentação 2
  'cervejaria': '🍺', 'vinhos': '🍷', 'destilados': '🥃',
  'chocolateria': '🍫', 'pastelaria': '🥟', 'salgados': '🥧',
  'food truck': '🚚', 'delivery': '📦', 'quentinha': '🍱',
  'sucos': '🧃', 'smoothie': '🥤', 'cha': '🍵',
  // Extra - Agro
  'agronegocio': '🌾', 'fazenda': '🚜', 'pecuaria': '🐄',
  'avicultura': '🐔', 'piscicultura': '🐟', 'horta': '🌿',
  'floricultura': '💐', 'jardinagem': '🌳', 'paisagismo': '🌴',
  // Extra - Pet
  'petshop': '🐕', 'banho e tosa': '🐩', 'racao': '🦴',
  'adestramento': '🐾', 'hotel pet': '🐈',
  // Extra - Saúde 2
  'acupuntura': '📍', 'fonoaudiologia': '🗣️', 'protese': '🦷',
  'implante': '🦷', 'anestesia': '💉', 'radiologia': '📡',
  'biomedicina': '🧬', 'enfermagem': '🩺', 'home care': '🏠',
  // Extra - Varejo 2
  'papelaria': '📝', 'livraria': '📚', 'brinquedos': '🧩',
  'artesanato': '🧶', 'costura': '🧵', 'tecidos': '🧵',
  'moveis': '🪑', 'decoracao': '🖼️', 'colchao': '🛏️',
  'utilidades': '🏪', 'ferramentas': '🔨', 'tintas': '🎨',
  // Extra - Tecnologia
  'startup': '🚀', 'app': '📱', 'ecommerce': '🛒',
  'marketplace': '🏪', 'saas': '☁️', 'ia': '🤖',
  'jogos': '🎮', 'web': '🌐', 'dados': '📊',
  'ciberseguranca': '🛡️', 'cloud': '☁️', 'blockchain': '⛓️',
  // Extra - Serviços 2
  'coworking': '🏢', 'grafica': '🖨️', 'lavanderia': '👔',
  'alfaiataria': '🪡', 'relojoaria': '⏰', 'chaveiro': '🔑',
  'dedetizacao': '🐜', 'mudanca': '📦', 'cartorio': '📜',
  'despachante': '📋', 'traducao': '🌐', 'design': '🎨',
  'coaching': '🎯', 'mentoria': '🧭', 'treinamento': '📈',
};

const entries = Object.entries(EMOJI_MAP);

function normalize(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

interface EmojiSegmentoPickerProps {
  value: string;
  onChange: (emoji: string) => void;
}

export function EmojiSegmentoPicker({ value, onChange }: EmojiSegmentoPickerProps) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const results = useMemo(() => {
    if (!search.trim()) return entries.slice(0, 8);
    const q = normalize(search.trim());
    return entries.filter(([key]) => normalize(key).includes(q)).slice(0, 8);
  }, [search]);

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center gap-2">
        <span className="text-2xl leading-none select-none">{value || '🏢'}</span>
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Buscar subsegmento..."
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
      </div>

      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-1 w-full overflow-hidden"
          style={{
            background: '#fff',
            border: '1px solid #DDE4F0',
            borderRadius: 10,
            boxShadow: '0 4px 16px rgba(13,27,53,0.1)',
          }}
        >
          {results.length === 0 ? (
            <button
              type="button"
              className="flex w-full items-center gap-2.5 px-3 py-2 text-sm hover:bg-accent transition-colors"
              onClick={() => { onChange('🏢'); setSearch(''); setOpen(false); }}
            >
              <span className="text-lg">🏢</span>
              <span className="text-foreground">Empresa</span>
            </button>
          ) : (
            results.map(([key, emoji]) => (
              <button
                key={key}
                type="button"
                className="flex w-full items-center gap-2.5 px-3 py-2 text-sm hover:bg-accent transition-colors"
                onClick={() => { onChange(emoji); setSearch(''); setOpen(false); }}
              >
                <span className="text-lg">{emoji}</span>
                <span className="capitalize text-foreground">{key}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
