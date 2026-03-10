import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const {
      indicador, valor_atual, valor_absoluto, faturamento,
      mes_referencia, status, limite_verde, limite_ambar,
      direcao, historico, formula, composicao,
    } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const historicoText = (historico || []).map((h: any) => `${h.mes}: ${h.valor.toFixed(1)}%`).join(", ");
    const composicaoText = (composicao || []).map((c: any) => `${c.nome}: R$ ${Math.abs(c.valor).toLocaleString("pt-BR")}`).join("; ");

    const systemPrompt = `Você é um consultor financeiro da GPI Inteligência Financeira.
Analise os indicadores financeiros do cliente de forma técnica, objetiva e acionável. Sempre em português brasileiro.
Responda APENAS com JSON no formato:
{
  "titulo": "string curta de status (máx 8 palavras)",
  "analise": "string de 2-3 frases técnicas e diretas",
  "acao": "string com 1 ação concreta recomendada (máx 15 palavras)"
}
Nunca use markdown. Nunca saia do JSON.`;

    const userPrompt = `Indicador: ${indicador} — ${mes_referencia}
Valor atual: ${valor_atual.toFixed(1)}% (${valor_absoluto.toLocaleString("pt-BR")} sobre faturamento ${faturamento.toLocaleString("pt-BR")})
Status: ${status} (verde>${limite_verde}% · âmbar>${limite_ambar}%)
Direção: ${direcao === "maior_melhor" ? "quanto maior, melhor" : "quanto menor, melhor"}
Histórico 6 meses: ${historicoText || "não disponível"}
Fórmula: ${formula}
Composição: ${composicaoText || "não disponível"}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 400,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);

      if (response.status === 429) {
        return new Response(JSON.stringify({ titulo: "Análise temporariamente indisponível", analise: "Limite de requisições atingido. Tente novamente em alguns segundos.", acao: "" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ titulo: "Análise indisponível", analise: "", acao: "" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
      return new Response(JSON.stringify(parsed), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch {
      return new Response(JSON.stringify({ titulo: "Análise indisponível", analise: content, acao: "" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (e) {
    console.error("analisar-indicador error:", e);
    return new Response(JSON.stringify({ titulo: "Análise indisponível", analise: "", acao: "" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
