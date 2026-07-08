// Wakes the user's iPhone(s) with a silent push so the app can process closet
// items flagged needs_bg_removal (added on web/Android, where the on-device
// subject lift isn't available). Called by clients right after they insert or
// update a flagged row.
//
// The push is data-only (`_contentAvailable`) — no banner or sound — and iOS
// gives the app ~30s of background time to run the cutout and re-upload. If
// the push is throttled or the app was force-quit, the item stays flagged and
// is processed on next app open instead.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EXPO_PUSH_API = "https://exp.host/--/api/v2/push/send";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Identify the caller from the JWT supabase-js sends automatically.
    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const {
      data: { user },
    } = await supabase.auth.getUser(jwt);
    if (!user) {
      return Response.json({ error: "Not authenticated" }, { status: 401, headers: corsHeaders });
    }

    const { data: tokens, error } = await supabase
      .from("push_tokens")
      .select("token")
      .eq("user_id", user.id);
    if (error) throw new Error(error.message);

    if (!tokens || tokens.length === 0) {
      return Response.json({ sent: 0 }, { headers: corsHeaders });
    }

    const messages = tokens.map(({ token }) => ({
      to: token,
      _contentAvailable: true,
      priority: "normal",
      data: { type: "bg-removal" },
    }));

    const pushRes = await fetch(EXPO_PUSH_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(messages),
    });
    const pushData = await pushRes.json().catch(() => null);

    // Prune tokens for devices that uninstalled the app.
    const tickets: { status: string; details?: { error?: string } }[] =
      pushData?.data ?? [];
    const dead = tokens
      .filter((_, i) => tickets[i]?.details?.error === "DeviceNotRegistered")
      .map(({ token }) => token);
    if (dead.length > 0) {
      await supabase.from("push_tokens").delete().in("token", dead);
    }

    return Response.json(
      { sent: tokens.length - dead.length },
      { headers: corsHeaders },
    );
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500, headers: corsHeaders },
    );
  }
});
