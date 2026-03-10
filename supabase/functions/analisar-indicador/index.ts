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
      if (c.filhas && c.filhas.length > 0) {
        const filhasText = c.filhas.map((f: any) => `    ↳ ${f.nome}: R$ ${Math.abs(f.valor).toLocaleString("pt-BR")} (${f.pct_faturamento.toFixed(1)}% fat)`).join("\n");
        line += `\n${filhasText}`;
      }
      return line;
    }).join("\n");

    const userPrompt = `Indicador: ${indicador} — ${mes_referencia}
Valor atual: ${valor_atual.toFixed(1)}% (${valor_absoluto.toLocaleString("pt-BR")} sobre faturamento ${faturamento.toLocaleString("pt-BR")})
Status: ${status} (verde>${limite_verde}% · âmbar>${limite_ambar}%)
Direção: ${direcao === "maior_melhor" ? "quanto maior, melhor" : "quanto menor, melhor"}
Histórico 6 meses: ${historicoText || "não disponível"}
Fórmula: ${formula}
Composição detalhada:
${composicaoText || "não disponível"}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 600,
        system: `Você é um consultor financeiro sênior da GPI Inteligência Financeira.
Analise os dados financeiros com precisão técnica e linguagem direta.
Sempre em português brasileiro.

REGRAS:
- Cite SEMPRE nomes reais dos subgrupos e categorias recebidos
- Nunca use termos genéricos como 'alguns custos' ou 'certas despesas'
- Se uma categoria específica se destaca (>10% faturamento ou crescimento >30% vs anterior), mencione pelo nome
- analise deve ter 2-3 frases com dados concretos e percentuais
- alerta só preencher se status âmbar ou vermelho, senão null
- acao deve ser específica: 'Renegociar contrato de Motoboy (12,3% fat)' não 'Reduzir despesas operacionais'
${instrucao_especifica ? `\nContexto adicional para este indicador: ${instrucao_especifica}\n` : ''}
Responda APENAS com JSON válido no formato:
{
  "titulo": "string curta de status (máx 8 palavras)",
  "contexto": "1 frase situando o cenário geral do indicador",
  "analise": "2-3 frases identificando causas específicas — citar nomes reais de subgrupos e categorias recebidos",
  "alerta": "1 frase sobre o principal risco se não agir (apenas se status âmbar ou vermelho, senão null)",
  "acao": "1 ação concreta e específica — citar conta ou subgrupo pelo nome (máx 20 palavras)"
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
        return new Response(JSON.stringify({ titulo: "Análise temporariamente indisponível", contexto: null, analise: "Limite de requisições atingido. Tente novamente em alguns segundos.", alerta: null, acao: "" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ titulo: "Análise indisponível", contexto: null, analise: "Não foi possível gerar a análise no momento.", alerta: null, acao: "Tente novamente em alguns instantes." }), {
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
      return new Response(JSON.stringify({ titulo: "Análise indisponível", contexto: null, analise: "Não foi possível gerar a análise no momento.", alerta: null, acao: "Tente novamente em alguns instantes." }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (e) {
    console.error("analisar-indicador error:", e);
    return new Response(JSON.stringify({ titulo: "Análise indisponível", contexto: null, analise: "Não foi possível gerar a análise no momento.", alerta: null, acao: "Tente novamente em alguns instantes." }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});