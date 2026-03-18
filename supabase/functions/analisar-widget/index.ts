import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const instrucaoPorTipo: Record<string, string> = {
  card_resumo: `Você é um consultor financeiro da GPI analisando um card de resumo financeiro. Analise a composição das contas, identifique concentrações de risco ou oportunidade, comente a tendência vs mês anterior e sugira uma ação prática.`,
  comparativo: `Você é um consultor financeiro da GPI analisando uma variação entre dois meses. Explique o que mudou, por que isso importa para o negócio, e o que o empresário deve fazer a respeito.`,
  grafico_barras: `Você é um consultor financeiro da GPI analisando a evolução mensal de contas financeiras. Identifique tendências, sazonalidade, acelerações ou deteriorações e sugira ação.`,
  grafico_pizza: `Você é um consultor financeiro da GPI analisando a composição de um grupo financeiro. Avalie concentração, diversificação, dependência e riscos dessa distribuição.`,
  indicador: `Você é um consultor financeiro da GPI analisando um indicador financeiro com meta definida. Comente a distância da meta, o que está causando esse resultado e 2 ações concretas para melhorar.`,
  cruzamento: `Você é um consultor financeiro da GPI analisando a relação entre duas contas financeiras. Explique o que esse índice revela sobre a saúde do negócio e se está melhorando ou piorando.`,
  detalhamento: `Você é um consultor financeiro da GPI analisando o detalhamento de categorias financeiras. Identifique as contas mais relevantes, concentrações, anomalias e oportunidades de redução ou crescimento.`,
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const {
      widget_id, cliente_id, tipo, titulo, competencia,
      valores, resultado, resultado_pct,
      variacao_mes_anterior, meta, meta_direcao,
      contexto_cliente,
    } = await req.json();

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");

    // Build hash
    const hashInput = (valores as any[])
      .map((v: any) => `${v.nome}:${v.valor}`)
      .sort()
      .join('|') + `|resultado:${resultado}`;
    const hash = btoa(hashInput).slice(0, 32);

    // Build prompt
    const valoresText = (valores as any[]).map((v: any) =>
      `- ${v.nome}: R$ ${v.valor.toFixed(2)}${v.av_pct ? ` (${v.av_pct.toFixed(1)}% do fat.)` : ''}${v.pct_total ? ` (${v.pct_total.toFixed(1)}% do total)` : ''}`
    ).join('\n');

    let extras = '';
    if (variacao_mes_anterior !== undefined && variacao_mes_anterior !== null) {
      extras += `\nVariação vs mês anterior: ${variacao_mes_anterior > 0 ? '+' : ''}${variacao_mes_anterior.toFixed(1)}%`;
    }
    if (meta !== undefined && meta !== null) {
      extras += `\nMeta definida: ${meta}% (${meta_direcao === 'menor_melhor' ? 'quanto menor melhor' : 'quanto maior melhor'})`;
    }

    const userContent = `Cliente: ${contexto_cliente}
Widget: ${titulo} (${tipo})
Competência: ${competencia}
Valores:
${valoresText}
Resultado principal: R$ ${resultado}${resultado_pct != null ? ` (${resultado_pct.toFixed(1)}%)` : ''}${extras}

Escreva uma análise consultiva em português brasileiro, em prosa corrida (sem bullets), com no máximo 200 palavras.
Tom: direto, técnico mas acessível, focado em ação.
Termine sempre com uma frase de ação começando com "→".`;

    const systemPrompt = instrucaoPorTipo[tipo] || instrucaoPorTipo.card_resumo;

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
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic API error:", response.status, errText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit atingido. Tente novamente em alguns segundos." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`Anthropic error: ${response.status}`);
    }

    const data = await response.json();
    const analiseTexto = data.content?.[0]?.text || "";

    // Save to DB
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    const geradoEm = new Date().toISOString();
    await sb.from("painel_widgets").update({
      analise_ia: analiseTexto,
      analise_gerada_em: geradoEm,
      analise_hash: hash,
      updated_at: geradoEm,
    }).eq("id", widget_id);

    return new Response(JSON.stringify({
      analise: analiseTexto,
      gerado_em: geradoEm,
      hash,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analisar-widget error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
