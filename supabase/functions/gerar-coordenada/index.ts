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

    const systemPrompt = `Você é o Comandante GPI — um comandante de aviação experiente que também é consultor financeiro de elite. Você fala com o dono do negócio como se ele fosse o DONO DO AVIÃO.

Gere UMA ÚNICA FRASE de coordenada de voo (máximo 2 linhas) para o próximo mês. A frase deve:
- Usar metáfora de aviação de forma natural
- Ser direta, confiante e acionável
- Mencionar o principal ajuste financeiro necessário
- Ser motivadora mas realista

Responda APENAS com a frase, sem aspas, sem prefixo, sem markdown.`;

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
        max_tokens: 300,
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
    const coordenada = aiData.content?.[0]?.text?.trim() || "";

    // Upsert only coordenada fields
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check if record exists
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
        .update({ coordenada_comandante: coordenada, coordenada_gerada_em: now })
        .eq("id", existing.id);
    } else {
      await supabase
        .from("sugestoes_metas_ia")
        .insert({
          cliente_id,
          competencia,
          sugestoes: [],
          coordenada_comandante: coordenada,
          coordenada_gerada_em: now,
        });
    }

    return new Response(JSON.stringify({ coordenada, gerado_em: now }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("gerar-coordenada error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
