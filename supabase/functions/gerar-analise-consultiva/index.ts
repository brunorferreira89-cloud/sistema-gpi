import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const {
      cliente_id, competencia, campo, indicadores, totalizadores,
      kpis, empresa_nome, segmento,
    } = await req.json();

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    // Build indicator text
    const indText = (indicadores || []).map((ind: any) => {
      let line = `${ind.nome}: R$ ${Math.abs(ind.valor_realizado || 0).toLocaleString("pt-BR")} | var: ${(ind.variacao_pct || 0).toFixed(1)}% | AV: ${(ind.av_pct || 0).toFixed(1)}%`;
      if (ind.subgrupos?.length) {
        for (const sg of ind.subgrupos) {
          line += `\n  → ${sg.nome}: R$ ${Math.abs(sg.valor || 0).toLocaleString("pt-BR")}`;
          if (sg.categorias?.length) {
            for (const cat of sg.categorias.slice(0, 5)) {
              line += `\n    · ${cat.nome}: R$ ${Math.abs(cat.valor || 0).toLocaleString("pt-BR")}`;
            }
          }
        }
      }
      return line;
    }).join("\n\n");

    const totText = totalizadores
      ? `MC: R$ ${totalizadores.MC?.toLocaleString("pt-BR")} (${totalizadores.MC_pct?.toFixed(1)}%) | RO: R$ ${totalizadores.RO?.toLocaleString("pt-BR")} (${totalizadores.RO_pct?.toFixed(1)}%) | RAI: R$ ${totalizadores.RAI?.toLocaleString("pt-BR")} (${totalizadores.RAI_pct?.toFixed(1)}%) | GC: R$ ${totalizadores.GC?.toLocaleString("pt-BR")} (${totalizadores.GC_pct?.toFixed(1)}%)`
      : "";

    const kpisText = (kpis || []).map((k: any) => `${k.nome}: ${k.valor}% [${k.status}]`).join(", ");

    const isSingleField = !!campo;

    let userPrompt: string;
    if (isSingleField) {
      const fieldLabels: Record<string, string> = {
        diagnostico: "diagnóstico financeiro com causa-consequência",
        objetivos: "objetivos para o próximo período",
        riscos: "riscos se não houver ação",
        proximos_passos: "3-5 ações concretas e mensuráveis",
      };
      userPrompt = `Empresa: ${empresa_nome} | Segmento: ${segmento} | Competência: ${competencia}

Indicadores:
${indText}

Totalizadores: ${totText}
KPIs: ${kpisText}

Benchmarks GPI: CMV<38%, CMO<25%, MC>40%, GC≥10%

Gere APENAS o campo "${campo}" (${fieldLabels[campo] || campo}).
Retorne JSON: { "${campo}": "texto" }`;
    } else {
      userPrompt = `Empresa: ${empresa_nome} | Segmento: ${segmento} | Competência: ${competencia}

Indicadores:
${indText}

Totalizadores: ${totText}
KPIs: ${kpisText}

Benchmarks GPI: CMV<38%, CMO<25%, MC>40%, GC≥10%

Gere uma análise consultiva com raciocínio de causa-consequência entre os indicadores.
Retorne APENAS JSON com esta estrutura:
{
  "diagnostico": "texto da análise diagnóstica (2-3 parágrafos, foco em causa-consequência)",
  "objetivos": "texto sobre objetivos para o próximo período (1-2 parágrafos)",
  "riscos": "texto sobre riscos se não houver ação (1-2 parágrafos)",
  "proximos_passos": "texto com 3-5 ações concretas e mensuráveis para esta semana",
  "checkpoints": {
    "faturamento": "frase curta sobre meta de faturamento",
    "custos": "frase curta sobre meta de custos operacionais",
    "despesas": "frase curta sobre meta de despesas fixas",
    "investimentos": "frase curta sobre meta de investimentos",
    "gc": "frase curta sobre objetivo de geração de caixa"
  }
}`;
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        system: `Você é o consultor financeiro da GPI Inteligência Financeira.
Sua função é gerar uma análise consultiva completa sobre os números
do mês para ser apresentada ao empresário na reunião mensal.
Raciocine sobre causa e consequência entre os 9 indicadores.
Responda APENAS com JSON válido, sem nenhum texto fora do JSON.`,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic API error:", response.status, errText);
      return new Response(JSON.stringify({ error: "Erro ao gerar análise" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);

    // Save to DB
    const existing = await sb
      .from("apresentacao_preparacao")
      .select("id")
      .eq("cliente_id", cliente_id)
      .eq("competencia", competencia)
      .maybeSingle();

    if (isSingleField) {
      if (existing.data) {
        await sb.from("apresentacao_preparacao").update({
          [campo]: parsed[campo],
          gerado_em: new Date().toISOString(),
        }).eq("id", existing.data.id);
      } else {
        await sb.from("apresentacao_preparacao").insert({
          cliente_id,
          competencia,
          [campo]: parsed[campo],
          gerado_em: new Date().toISOString(),
        });
      }
    } else {
      const record = {
        cliente_id,
        competencia,
        diagnostico: parsed.diagnostico,
        objetivos: parsed.objetivos,
        riscos: parsed.riscos,
        proximos_passos: parsed.proximos_passos,
        checkpoints_json: parsed.checkpoints || null,
        gerado_em: new Date().toISOString(),
      };
      if (existing.data) {
        await sb.from("apresentacao_preparacao").update(record).eq("id", existing.data.id);
      } else {
        await sb.from("apresentacao_preparacao").insert(record);
      }
    }

    return new Response(JSON.stringify({ success: true, data: parsed }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("gerar-analise-consultiva error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro interno" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
