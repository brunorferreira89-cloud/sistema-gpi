

## Plano: Melhorar banner da Torre de Controle

### Mudanças em `src/components/clientes/TorreControleTab.tsx`

**1. Título "TORRE DE CONTROLE" maior e mais impactante**
- Aumentar `fontSize` de 28 para **40px**
- Adicionar `textShadow` com glow azul para efeito neon
- Manter `fontWeight: 800` e `letterSpacing: '-0.02em'`

**2. Ícone de torre de controle redesenhado (canto direito)**
- Substituir o SVG simplista atual (retângulos + círculos) por uma torre de controle aeroportuária mais detalhada e lúdica:
  - Base trapezóidal, corpo cilíndrico, cabine de vidro panorâmica com painéis iluminados, antena no topo com ondas de sinal animadas
  - Aumentar o tamanho de 160x100 para **200x130**
  - Aumentar opacidade de 0.12 para **0.25** para dar mais destaque
  - Adicionar efeito de glow pulsante nos "vidros" da cabine e na antena

**3. Efeitos visuais do banner aprimorados**
- Aumentar altura do banner de 150 para **170px** para acomodar o título maior
- Adicionar uma segunda camada de scanning beam mais sutil (velocidade diferente) para efeito de profundidade
- Adicionar keyframe `glowPulse` para animar os painéis luminosos da torre

### Arquivos alterados
- Apenas `src/components/clientes/TorreControleTab.tsx`

