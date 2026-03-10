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
      instrucao_especifica,
    } = await req.json();

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");

    const historicoText = (historico || []).map((h: any) => `${h.mes}: ${h.valor.toFixed(1)}%`).join(", ");
    const composicaoText = (composicao || []).map((c: any) => {
      let line = `${c.grupo ? `[${c.grupo}] ` : ''}${c.nome}: R$ ${Math.abs(c.valor).toLocaleString("pt-BR")}`;
      if (c.pct_faturamento) line += ` (${c.pct_faturamento.toFixed(1)}% fat)`;
      if (c.valor_anterior != null) line += ` | anterior: R$ ${Math.abs(c.valor_anterior).toLocaleString("pt-BR")}`;
      if (c.variacao_pct != null) line += ` (${c.variacao_pct >= 0 ? '+' : ''}${c.variacao_pct.toFixed(1)}%)`;
      return line;
    }).join("\n");

    const userPrompt = `Indicador: ${indicador} — ${mes_referencia}
Valor atual: ${valor_atual.toFixed(1)}% (${valor_absoluto.toLocaleString("pt-BR")} sobre faturamento ${faturamento.toLocaleString("pt-BR")})
Status: ${status} (verde>${limite_verde}% · âmbar>${limite_ambar}%)
Direção: ${direcao === "maior_melhor" ? "quanto maior, melhor" : "quanto menor, melhor"}
Histórico 6 meses: ${historicoText || "não disponível"}
Fórmula: ${formula}
Composição: ${composicaoText || "não disponível"}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 400,
        system: `Você é um consultor financeiro da GPI Inteligência Financeira.
Analise os indicadores financeiros do cliente de forma técnica,
objetiva e acionável. Sempre em português brasileiro.
${instrucao_especifica ? `\nContexto adicional para este indicador: ${instrucao_especifica}\n` : ''}
Responda APENAS com JSON válido no formato:
{
  "titulo": "string curta de status (máx 8 palavras)",
  "analise": "string de 2-3 frases técnicas e diretas",
  "acao": "string com 1 ação concreta recomendada (máx 15 palavras)"
}
Nunca use markdown. Nunca saia do JSON.`,
        messages: [
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic API error:", response.status, errText);

      if (response.status === 429) {
        return new Response(JSON.stringify({ titulo: "Análise temporariamente indisponível", analise: "Limite de requisições atingido. Tente novamente em alguns segundos.", acao: "" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ titulo: "Análise indisponível", analise: "Não foi possível gerar a análise no momento.", acao: "Tente novamente em alguns instantes." }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || "";

    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
      return new Response(JSON.stringify(parsed), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch {
      return new Response(JSON.stringify({ titulo: "Análise indisponível", analise: "Não foi possível gerar a análise no momento.", acao: "Tente novamente em alguns instantes." }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (e) {
    console.error("analisar-indicador error:", e);
    return new Response(JSON.stringify({ titulo: "Análise indisponível", analise: "Não foi possível gerar a análise no momento.", acao: "Tente novamente em alguns instantes." }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
