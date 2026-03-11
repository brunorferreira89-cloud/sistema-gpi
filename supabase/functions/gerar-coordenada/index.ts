import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { cliente_id, competencia, dados } = await req.json();
    if (!cliente_id || !competencia || !dados) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { nomeEmpresa, mesProximo, mesBase, gcReal, gcMeta, gcPct, gcMetaPct, ganhoNome, ganhoPct, ganhoValor, fatReal, fatMeta } = dados;

    const systemPrompt = `Você é o Comandante GPI — consultor financeiro de elite. Retorne APENAS um JSON válido, sem markdown, sem explicações, exatamente neste formato:
{
  "frase": "frase lúdica com linguagem de aviação, máximo 2 frases",
  "tecnico": "análise técnica direta: cite a meta de maior impacto, o valor exato da variação na GC em R$, e o resultado final projetado. Máximo 2 frases. Sem metáforas."
}`;

    const userPrompt = `Empresa: ${nomeEmpresa}
Mês base: ${mesBase} → Meta para: ${mesProximo}
Faturamento: R$ ${fatReal} → Meta: R$ ${fatMeta}
Geração de Caixa atual: R$ ${gcReal} (${gcPct}%)
Geração de Caixa meta: R$ ${gcMeta} (${gcMetaPct}%)
${ganhoNome ? `Principal ajuste: reduzir ${ganhoNome} em ${ganhoPct}% (economia de R$ ${ganhoValor})` : 'Ajustes gerais nas metas definidas'}

Gere a coordenada de voo para ${mesProximo}.`;

    const aiResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 400,
        messages: [{ role: "user", content: userPrompt }],
        system: systemPrompt,
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("Anthropic error:", aiResponse.status, errText);
      return new Response(JSON.stringify({ error: "Erro na API de IA" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const aiData = await aiResponse.json();
    const rawText = (aiData.content?.[0]?.text || "").trim();

    let frase = "";
    let tecnico = "";
    try {
      const cleanedText = rawText.replace(/```json|```/g, "").trim();
      const resultado = JSON.parse(cleanedText);
      frase = resultado.frase || "";
      tecnico = resultado.tecnico || "";
    } catch {
      // Fallback: use raw text as frase if JSON parse fails
      frase = rawText;
      console.warn("Failed to parse JSON from Claude, using raw text as frase");
    }

    // Upsert coordenada fields
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: existing } = await supabase
      .from("sugestoes_metas_ia")
      .select("id")
      .eq("cliente_id", cliente_id)
      .eq("competencia", competencia)
      .maybeSingle();

    const now = new Date().toISOString();

    if (existing) {
      await supabase
        .from("sugestoes_metas_ia")
        .update({ coordenada_comandante: frase, coordenada_tecnico: tecnico, coordenada_gerada_em: now })
        .eq("id", existing.id);
    } else {
      await supabase
        .from("sugestoes_metas_ia")
        .insert({
          cliente_id,
          competencia,
          sugestoes: [],
          coordenada_comandante: frase,
          coordenada_tecnico: tecnico,
          coordenada_gerada_em: now,
        });
    }

    return new Response(JSON.stringify({ coordenada: frase, tecnico, gerado_em: now }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("gerar-coordenada error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
