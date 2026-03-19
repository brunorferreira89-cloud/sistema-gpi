import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ success: false, error: "Não autenticado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify caller
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

    const body = await req.json();
    console.log("criar-usuario body:", JSON.stringify(body));
    const { action } = body;

    // ─── DELETE ───
    if (action === "delete") {
      const { user_id } = body;
      if (!user_id) throw new Error("user_id é obrigatório");

      // portal_usuario_clientes will cascade delete via FK
      await adminClient.from("profiles").delete().eq("id", user_id);
      const { error: deleteErr } = await adminClient.auth.admin.deleteUser(user_id);
      if (deleteErr) throw deleteErr;

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── UPDATE PASSWORD ───
    if (action === "update_password") {
      const { user_id, nova_senha } = body;
      if (!user_id) throw new Error("user_id é obrigatório");
      if (!nova_senha || nova_senha.length < 6) throw new Error("Senha deve ter pelo menos 6 caracteres");

      const { error } = await adminClient.auth.admin.updateUserById(user_id, {
        password: nova_senha,
      });
      if (error) throw error;

      return new Response(
        JSON.stringify({ success: true, message: "Senha atualizada." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── UPDATE EMAIL ───
    if (action === "update_email") {
      const { user_id, novo_email } = body;
      if (!user_id || !novo_email) throw new Error("user_id e novo_email são obrigatórios");

      const { error } = await adminClient.auth.admin.updateUserById(user_id, {
        email: novo_email,
        email_confirm: true,
      });
      if (error) throw error;

      await adminClient.from("profiles").update({ email: novo_email }).eq("id", user_id);

      return new Response(
        JSON.stringify({ success: true, message: "E-mail atualizado." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── CREATE ───
    const { email, password, nome, cliente_id, usar_convite, role: requestedRole } = body;

    if (!email || !nome) {
      throw new Error("Campos obrigatórios: email, nome");
    }
    // cliente_id is required for portal users but optional for internal users
    if (!requestedRole && !cliente_id) {
      throw new Error("Campos obrigatórios: email, nome, cliente_id");
    }
    if (!usar_convite && !password) {
      throw new Error("Senha é obrigatória quando não usar convite");
    }

    // Determine the role to assign
    const validInternalRoles = ["admin", "consultor"];
    const finalRole = (requestedRole && validInternalRoles.includes(requestedRole))
      ? requestedRole
      : "cliente";

    let newUserId: string;

    if (usar_convite) {
      const { data: invited, error: invErr } = await adminClient.auth.admin.inviteUserByEmail(email, {
        data: { nome },
      });
      if (invErr) {
        if (invErr.message?.includes("already been registered") || invErr.message?.includes("already exists")) {
          return new Response(
            JSON.stringify({ success: false, error: "email_exists" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        throw invErr;
      }
      newUserId = invited.user.id;
    } else {
      const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { nome },
      });
      if (createErr) {
        if (createErr.message?.includes("already been registered") || createErr.message?.includes("already exists")) {
          return new Response(
            JSON.stringify({ success: false, error: "email_exists" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        throw createErr;
      }
      newUserId = created.user.id;
    }

    // Update profile (trigger creates it with role='consultor')
    // Small delay to let trigger fire
    await new Promise((r) => setTimeout(r, 500));

    const profileUpdate: Record<string, any> = {
      nome,
      role: finalRole,
      email,
      portal_ativo: true,
    };
    if (cliente_id) {
      profileUpdate.cliente_id = cliente_id;
    }

    const { error: profileError } = await adminClient
      .from("profiles")
      .update(profileUpdate)
      .eq("id", newUserId);

    if (profileError) {
      // Rollback: delete auth user
      await adminClient.auth.admin.deleteUser(newUserId);
      throw new Error("Erro ao criar perfil: " + profileError.message);
    }

    // Get email for response
    return new Response(
      JSON.stringify({ success: true, profile: { id: newUserId, nome, email } }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("criar-usuario ERROR:", error.message);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
