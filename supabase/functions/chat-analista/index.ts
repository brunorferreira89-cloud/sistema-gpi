import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages, system_prompt } = await req.json();
    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "messages array required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");

    const tools = [
      {
        name: "atualizar_meta_conta",
        description: "Atualiza a meta de uma conta específica do plano de contas para o mês alvo. Usar quando o operador pedir para ajustar, aumentar, reduzir ou definir a meta de uma conta específica.",
        input_schema: {
          type: "object",
          properties: {
            conta_id: { type: "string", description: "UUID exato da conta no plano de contas" },
            conta_nome: { type: "string", description: "Nome exato da conta conforme plano de contas" },
            meta_tipo: { type: "string", enum: ["pct", "valor"], description: "pct = percentual sobre o realizado | valor = valor absoluto em R$" },
            meta_valor: { type: "number", description: "Valor do ajuste. Para pct: positivo = aumento, negativo = redução. Para valor: diferença em R$." },
          },
          required: ["conta_id", "conta_nome", "meta_tipo", "meta_valor"],
        },
      },
      {
        name: "aplicar_meta_grupo",
        description: "Aplica o mesmo percentual de ajuste em TODAS as contas de um grupo ou subgrupo. Usar quando o operador pedir para ajustar um grupo inteiro.",
        input_schema: {
          type: "object",
          properties: {
            grupo_nome: { type: "string", description: "Nome do grupo ou subgrupo" },
            contas_ids: { type: "array", items: { type: "string" }, description: "Array de UUIDs de todas as contas filhas do grupo" },
            meta_tipo: { type: "string", enum: ["pct", "valor"] },
            meta_valor: { type: "number" },
          },
          required: ["grupo_nome", "contas_ids", "meta_tipo", "meta_valor"],
        },
      },
      {
        name: "limpar_metas_mes",
        description: "Remove TODAS as metas do mês alvo para este cliente. Ação irreversível — usar apenas quando o operador pedir explicitamente para limpar ou zerar todas as metas.",
        input_schema: {
          type: "object",
          properties: {
            competencia: { type: "string", description: "Mês alvo no formato YYYY-MM-01" },
            confirmacao_explicita: { type: "boolean", description: "Deve ser true — confirma que o operador pediu explicitamente" },
          },
          required: ["competencia", "confirmacao_explicita"],
        },
      },
    ];

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
        system: system_prompt || "",
        messages,
        tools,
        tool_choice: { type: "auto" },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic error:", response.status, errText);
      return new Response(JSON.stringify({ error: "AI error", status: response.status }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const data = await response.json();
    return new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("chat-analista error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
