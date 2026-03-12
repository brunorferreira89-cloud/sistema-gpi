import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { cliente_id, competencia, competencia_anterior, force, diretriz } = await req.json();
    if (!cliente_id || !competencia || !competencia_anterior) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check cache first (unless force=true or diretriz provided)
    const hasDiretriz = typeof diretriz === 'string' && diretriz.trim().length > 0;
    if (!force && !hasDiretriz) {
      const { data: cached } = await supabase
        .from("sugestoes_metas_ia")
        .select("sugestoes, narrativa, gerado_em, diretriz")
        .eq("cliente_id", cliente_id)
        .eq("competencia", competencia)
        .maybeSingle();

      if (cached) {
        const sugestoes = cached.sugestoes as any[];
        return new Response(JSON.stringify({ sugestoes, narrativa: cached.narrativa, competencia, total: sugestoes.length, cached: true, gerado_em: cached.gerado_em, diretriz: cached.diretriz }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Fetch client
    const { data: cliente } = await supabase.from("clientes").select("razao_social, nome_empresa, segmento, faturamento_faixa").eq("id", cliente_id).single();
    if (!cliente) return new Response(JSON.stringify({ error: "Cliente não encontrado" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Fetch plano de contas
    const { data: contas } = await supabase.from("plano_de_contas").select("*").eq("cliente_id", cliente_id).order("ordem");
    if (!contas?.length) return new Response(JSON.stringify({ error: "Plano de contas vazio" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const contaIds = contas.map((c: any) => c.id);

    // Fetch valores for both months
    const { data: valoresAtual } = await supabase.from("valores_mensais").select("conta_id, valor_realizado").in("conta_id", contaIds).eq("competencia", competencia);
    const { data: valoresAnterior } = await supabase.from("valores_mensais").select("conta_id, valor_realizado").in("conta_id", contaIds).eq("competencia", competencia_anterior);

    const realizadoMap: Record<string, number | null> = {};
    const anteriorMap: Record<string, number | null> = {};
    (valoresAtual || []).forEach((v: any) => { realizadoMap[v.conta_id] = v.valor_realizado; });
    (valoresAnterior || []).forEach((v: any) => { anteriorMap[v.conta_id] = v.valor_realizado; });

    // Sum leafs helper
    function sumLeafs(parentId: string, valMap: Record<string, number | null>): number {
      let total = 0;
      for (const c of contas!) {
        if (c.conta_pai_id === parentId) {
          if (c.nivel === 2) {
            const v = valMap[c.id];
            if (v != null) total += v;
          } else {
            total += sumLeafs(c.id, valMap);
          }
        }
      }
      return total;
    }

    function sumByTipo(tipo: string, valMap: Record<string, number | null>): number {
      let total = 0;
      for (const c of contas!) {
        if (c.tipo === tipo && c.nivel === 0) total += sumLeafs(c.id, valMap);
      }
      return total;
    }

    // Calculate totals
    const fatReal = sumByTipo("receita", realizadoMap);
    const fatAnt = sumByTipo("receita", anteriorMap);
    const custosReal = sumByTipo("custo_variavel", realizadoMap);
    const despesasReal = sumByTipo("despesa_fixa", realizadoMap);
    const investReal = sumByTipo("investimento", realizadoMap);
    const financReal = sumByTipo("financeiro", realizadoMap);
    const custosAnt = sumByTipo("custo_variavel", anteriorMap);
    const despesasAnt = sumByTipo("despesa_fixa", anteriorMap);
    const investAnt = sumByTipo("investimento", anteriorMap);
    const financAnt = sumByTipo("financeiro", anteriorMap);

    const mcReal = fatReal + custosReal;
    const roReal = mcReal + despesasReal;
    const raiReal = roReal + investReal;
    const gcReal = raiReal + financReal;
    const mcAnt = fatAnt + custosAnt;
    const roAnt = mcAnt + despesasAnt;
    const gcAnt = roAnt + investAnt + financAnt;

    const pct = (v: number, base: number) => base !== 0 ? ((v / base) * 100).toFixed(1) : "0.0";
    const fmt = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });

    // Format competencia
    const fmtComp = (comp: string) => {
      const d = new Date(comp + "T12:00:00Z");
      const meses = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
      return `${meses[d.getUTCMonth()]}/${d.getUTCFullYear()}`;
    };

    // Build conta lines
    const contaLines = contas.map((c: any) => {
      const real = realizadoMap[c.id] ?? 0;
      const ant = anteriorMap[c.id] ?? 0;
      const av = fatReal !== 0 ? ((Math.abs(real) / fatReal) * 100).toFixed(1) : "0.0";
      return `conta_id: ${c.id} | nome: ${c.nome} | nivel: ${c.nivel} | tipo: ${c.tipo} | is_total: ${!!c.is_total} | anterior: ${fmt(ant)} | realizado: ${fmt(real)} | AV%: ${av}%`;
    }).join("\n");

    const nomeCliente = cliente.razao_social || cliente.nome_empresa;

    const hasDiretriz = typeof diretriz === 'string' && diretriz.trim().length > 0;

    // Conditional system prompt
    const systemPrompt = hasDiretriz
      ? `Você é um consultor financeiro especialista analisando os números de ${nomeCliente} em ${fmtComp(competencia)}.

OBJETIVO DO CONSULTOR:
"${diretriz.trim()}"

Sua tarefa é analisar os dados financeiros abaixo e sugerir ajustes específicos nas categorias do plano de contas que, somados, permitam atingir o objetivo declarado acima.

REGRAS:
1. Priorize as categorias com maior impacto no indicador-alvo
2. Seja cirúrgico — sugira poucos ajustes de alto impacto, não pulverize em muitas categorias pequenas
3. Os ajustes devem ser realistas — variações acima de 40% de um mês para o outro exigem justificativa sólida
4. Calcule se os ajustes somados realmente atingem o objetivo declarado. Se não for possível atingir 100%, declare isso e mostre até onde é possível chegar
5. Para cada sugestão, explique no campo "motivo" a conexão direta com o objetivo do consultor
6. Retorne no mesmo formato JSON já especificado

Formato de cada item do array JSON:
{ "conta_id": "uuid", "conta_nome": "string", "nivel": number, "meta_tipo": "pct" | "valor", "meta_valor": number, "confianca": "alta" | "media" | "baixa", "parametros": string[], "motivo": string, "objetivo": string, "impacto_gc": string }

Responda APENAS com um array JSON válido, sem texto antes ou depois, sem markdown.`
      : `Você é um consultor financeiro sênior da GPI Inteligência Financeira.
Analise os dados financeiros do cliente e sugira metas para o próximo mês.

Benchmarks GPI obrigatórios:
- CMV (Custos Variáveis / Receita): < 38%
- CMO (Pessoal / Receita): < 25%
- Margem de Contribuição: > 40% da Receita
- Geração de Caixa: > 10% da Receita
- Endividamento: < 30% do faturamento anual = seguro

Regras para sugestão:
- Sugira metas apenas para contas com valor realizado diferente de zero
- Não sugira metas para linhas is_total
- Para contas de receita (tipo 'receita'): metas devem ser crescimento (positivo)
- Para contas de custo/despesa/investimento: metas devem ser redução (negativo em %) ou manutenção
- Prefira meta em % (meta_tipo: 'pct') quando a variação fizer sentido relativa ao histórico
- Use meta em valor absoluto (meta_tipo: 'valor') apenas quando o valor for mais claro que o percentual
- Seja realista: variações acima de 30% num único mês raramente são atingíveis
- Confiança alta: quando há tendência clara nos 2 meses + benchmark disponível
- Confiança média: quando há apenas 1 mês de histórico ou tendência instável
- Confiança baixa: quando o valor é muito volátil ou não há referência de benchmark

Responda APENAS com um array JSON válido, sem texto antes ou depois, sem markdown.`;

    const userPrompt = `Cliente: ${nomeCliente}
Segmento: ${cliente.segmento}
Faixa de faturamento: ${cliente.faturamento_faixa}

Mês analisado: ${fmtComp(competencia)}
Mês anterior: ${fmtComp(competencia_anterior)}

DADOS FINANCEIROS:
${contaLines}

TOTALIZADORES:
Faturamento: R$ ${fmt(fatReal)} | Mês ant: R$ ${fmt(fatAnt)}
MC: R$ ${fmt(mcReal)} (${pct(mcReal, fatReal)}%) | Mês ant: R$ ${fmt(mcAnt)} (${pct(mcAnt, fatAnt)}%)
RO: R$ ${fmt(roReal)} (${pct(roReal, fatReal)}%) | Mês ant: R$ ${fmt(roAnt)} (${pct(roAnt, fatAnt)}%)
GC: R$ ${fmt(gcReal)} (${pct(gcReal, fatReal)}%) | Mês ant: R$ ${fmt(gcAnt)} (${pct(gcAnt, fatAnt)}%)

Sugira metas para TODOS os níveis (grupos, subgrupos e categorias) que tiverem valor realizado ≠ 0.`;

    // Call Anthropic for suggestions
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const aiResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        messages: [{ role: "user", content: userPrompt }],
        system: systemPrompt,
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("Anthropic error:", aiResponse.status, errText);
      return new Response(JSON.stringify({ error: "Erro na API de IA", status: aiResponse.status }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const aiData = await aiResponse.json();
    const rawText = aiData.content?.[0]?.text || "";
    const cleanedText = rawText.replace(/```json|```/g, "").trim();

    let parsed: any[];
    try {
      parsed = JSON.parse(cleanedText);
    } catch {
      const lastBrace = cleanedText.lastIndexOf("}");
      if (lastBrace > 0) {
        const repairedJson = cleanedText.substring(0, lastBrace + 1) + "]";
        try {
          parsed = JSON.parse(repairedJson);
          console.warn(`Recovered ${parsed.length} items from truncated LLM response`);
        } catch {
          return new Response(JSON.stringify({ error: "Erro ao processar resposta da IA", raw: cleanedText }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      } else {
        return new Response(JSON.stringify({ error: "Erro ao processar resposta da IA", raw: cleanedText }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ── Generate narrativa (Comandante GPI) ──────────────────────
    const nomeEmpresa = nomeCliente;
    const competenciaFormatada = fmtComp(competencia);
    const sugestoesPadraoTexto = parsed.map((s: any) => {
      const contaInfo = contas.find((c: any) => c.id === s.conta_id);
      const nome = contaInfo?.nome || s.conta_nome || s.conta_id;
      const metaLabel = s.meta_tipo === 'pct' ? `${s.meta_valor}%` : `R$ ${fmt(s.meta_valor)}`;
      return `- ${nome}: meta ${metaLabel} (confiança: ${s.confianca})`;
    }).join("\n");

    const missaoRecebidaSection = hasDiretriz ? `
SEÇÃO EXTRA OBRIGATÓRIA — antes das 5 seções padrão, adicione:

**Missão recebida**
Referencie o objetivo do consultor em linguagem de cockpit/aviação.
Objetivo recebido: "${diretriz.trim()}"
Confirme se os ajustes propostos atingem o objetivo e qual o resultado projetado.
Use o estilo: "Recebi as coordenadas do comandante em terra: [parafrasear objetivo]. 
Após análise dos instrumentos, os ajustes propostos projetam [resultado] — [confirmação ou distância do objetivo]."

` : '';

    const narrativaPrompt = `
Você é o Comandante GPI — um comandante de aviação experiente que também
é consultor financeiro de elite. Você fala com o dono do negócio como se
ele fosse o DONO DO AVIÃO: a empresa é a aeronave, as finanças são os
instrumentos de voo, e você é o comandante responsável por manter o voo
seguro, estável e no rumo certo.

Sua linguagem mistura terminologia real de aviação com consultoria financeira,
de forma natural, criativa e muito fácil de entender. O dono do avião não
precisa ser piloto — você explica tudo com clareza e confiança.

EMPRESA (Aeronave): ${nomeEmpresa}
MÊS ANALISADO (Última rota): ${competenciaFormatada}

LEITURAS DOS INSTRUMENTOS (sugestões geradas):
${sugestoesPadraoTexto}
${missaoRecebidaSection}
Escreva o RELATÓRIO DE VOO com estas seções OBRIGATÓRIAS,
usando exatamente estes títulos em negrito:

**Leitura dos Instrumentos**
Descreva o diagnóstico do mês como se fosse a leitura dos painéis da cabine.
O que os instrumentos estão indicando? Há alertas acesos? A aeronave está
voando dentro da faixa segura? Seja direto, como um comandante passando
o briefing antes da decolagem.

**Destino e Altitude Alvo**
Descreva o que queremos alcançar com as metas como se fosse o plano de voo:
altitude ideal, rota mais eficiente, destino final. Conecte os resultados
esperados à saúde financeira da empresa (geração de caixa, lucro, equilíbrio).

**Por que estes ajustes nos controles**
Explique a lógica dos percentuais sugeridos como ajustes nos controles da
aeronave. Por que reduzir empuxo aqui? Por que aumentar altitude ali?
Use benchmarks do setor como referência de altitude segura para aviões
deste modelo (segmento).

**Turbulências no caminho**
Aponte os principais desafios como turbulências previstas na rota.
Seja honesto, como um bom comandante que não esconde condições climáticas
adversas, mas também não entra em pânico — turbulência faz parte do voo.

**Checklist antes da decolagem**
2 a 3 ações concretas e práticas que o dono do avião deve executar
esta semana, no estilo checklist de cabine: direto, numerado, sem enrolação.

REGRAS DE ESCRITA:
- Use termos de aviação de forma natural e criativa (instrumentos, altitude,
  rota, cabine, checklist, decolagem, pouso, turbulência, radar, vento
  contrário, combustível, carga, centro de gravidade, velocidade de cruzeiro,
  ponto de estol, etc.)
- Linguagem acessível — o dono do avião entende mesmo sem saber pilotar
- Parágrafos curtos (máximo 4 linhas)
- Tom: comandante experiente, confiante, direto, com leveza e bom humor sutil
- NÃO use bullet points dentro das seções — apenas parágrafos corridos
- NÃO mencione nomes de sistemas, planilhas ou ferramentas
- NÃO quebre o personagem em nenhum momento
- Máximo 480 palavras no total
`;

    let narrativa: string | null = null;
    try {
      const narrativaResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2000,
          messages: [{ role: "user", content: narrativaPrompt }],
        }),
      });

      if (narrativaResponse.ok) {
        const narrativaData = await narrativaResponse.json();
        narrativa = narrativaData.content?.[0]?.text || null;
      } else {
        console.error("Narrativa generation failed:", narrativaResponse.status);
      }
    } catch (e) {
      console.error("Narrativa generation error:", e);
    }

    // Save to cache (including diretriz)
    const diretrizValue = hasDiretriz ? diretriz.trim() : null;
    await supabase.from("sugestoes_metas_ia").upsert(
      { cliente_id, competencia, sugestoes: parsed, narrativa, diretriz: diretrizValue, gerado_em: new Date().toISOString() },
      { onConflict: "cliente_id,competencia" }
    );

    return new Response(JSON.stringify({ sugestoes: parsed, narrativa, competencia, total: parsed.length, cached: false, diretriz: diretrizValue }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("sugerir-metas error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
