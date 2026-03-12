import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Não autenticado");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify caller is admin or consultor
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) throw new Error("Não autenticado");

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: callerProfile } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", caller.id)
      .single();

    if (!callerProfile || !["admin", "consultor"].includes(callerProfile.role)) {
      throw new Error("Sem permissão");
    }

    const { email, senha, nome, role, cliente_id, portal_ativo } = await req.json();

    if (!email || !senha || !nome || !role) {
      throw new Error("Campos obrigatórios: email, senha, nome, role");
    }

    if (!["consultor", "cliente"].includes(role)) {
      throw new Error("Role deve ser 'consultor' ou 'cliente'");
    }

    if (role === "cliente" && !cliente_id) {
      throw new Error("cliente_id é obrigatório para usuários do tipo cliente");
    }

    // Create auth user
    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password: senha,
      email_confirm: true,
      user_metadata: { nome },
    });

    if (createError) throw createError;

    // Update profile (created by trigger with default role='consultor')
    const updates: Record<string, any> = { nome, role };
    if (role === "cliente") {
      updates.cliente_id = cliente_id;
      updates.portal_ativo = portal_ativo ?? false;
    }

    const { error: profileError } = await adminClient
      .from("profiles")
      .update(updates)
      .eq("id", newUser.user!.id);

    if (profileError) throw profileError;

    return new Response(
      JSON.stringify({ success: true, user_id: newUser.user!.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
