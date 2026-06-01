import { createClient } from "https://esm.sh/@supabase/supabase-js@2";



//stores the refresh token and access token to the user_tokens table, done server side so the tokens are stored securely
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return Response.json({ error: "Missing auth header" }, { status: 401, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (userError || !user) {
      return Response.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }

    const { refresh_token, access_token } = await req.json();
    if (!refresh_token) {
      return Response.json({ error: "Missing refresh_token" }, { status: 400, headers: corsHeaders });
    }

    const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();

    const { error } = await supabase.from("user_tokens").upsert(
      {
        user_id: user.id,
        provider: "google",
        refresh_token,
        access_token: access_token ?? null,
        expires_at: expiresAt,
      },
      { onConflict: "user_id,provider" },
    );

    if (error) {
      return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
    }

    return Response.json({ success: true }, { headers: corsHeaders });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500, headers: corsHeaders },
    );
  }
});
