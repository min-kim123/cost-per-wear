import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";
const OPENAI_API = "https://api.openai.com/v1/chat/completions";

// Refresh a Google access token using the stored refresh token
async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

// Search Gmail for recent purchase/receipt emails (last 24h)
async function fetchReceiptMessageIds(accessToken: string): Promise<string[]> {
  const query = encodeURIComponent(
    "subject:(order OR receipt OR purchase OR confirmation) newer_than:1d",
  );
  const res = await fetch(
    `${GMAIL_API}/users/me/messages?q=${query}&maxResults=20`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const data = await res.json();
  return (data.messages ?? []).map((m: { id: string }) => m.id);
}

// Fetch a single email's plain-text body
async function fetchEmailBody(
  accessToken: string,
  messageId: string,
): Promise<string> {
  const res = await fetch(
    `${GMAIL_API}/users/me/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const data = await res.json();

  const parts: Array<{ mimeType: string; body: { data?: string }; parts?: unknown[] }> =
    data.payload?.parts ?? [data.payload];

  function extractText(
    parts: Array<{ mimeType: string; body: { data?: string }; parts?: unknown[] }>,
  ): string {
    for (const part of parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return atob(part.body.data.replace(/-/g, "+").replace(/_/g, "/"));
      }
      if (part.parts) {
        const nested = extractText(
          part.parts as Array<{ mimeType: string; body: { data?: string }; parts?: unknown[] }>,
        );
        if (nested) return nested;
      }
    }
    return "";
  }

  return extractText(parts).slice(0, 4000);
}

type ParsedItem = {
  name: string;
  brand: string | null;
  cost: number | null;
  purchased_date: string | null;
};

// Use OpenAI to extract clothing items from an email body
async function parseEmailForClothingItems(body: string): Promise<ParsedItem[]> {
  const res = await fetch(OPENAI_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You are a shopping receipt parser. Extract clothing and fashion items from purchase receipts. " +
            "Return a JSON array of objects with fields: name (string), brand (string|null), cost (number|null), purchased_date (ISO date string|null). " +
            "Only include clothing/fashion/accessories items. If there are no clothing items, return an empty array []. " +
            "Respond with ONLY the JSON array, no explanation.",
        },
        { role: "user", content: body },
      ],
    }),
  });
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? "[]";
  try {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

Deno.serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // Get all users with a stored Google token
    const { data: tokens, error: tokensError } = await supabase
      .from("user_tokens")
      .select("user_id, refresh_token, access_token, expires_at")
      .eq("provider", "google");

    if (tokensError) throw new Error(tokensError.message);
    if (!tokens || tokens.length === 0) {
      return Response.json({ message: "No users to sync" });
    }

    const results: Array<{ user_id: string; items_added: number; error?: string }> = [];

    for (const token of tokens) {
      try {
        const accessToken = await refreshAccessToken(token.refresh_token);

        await supabase
          .from("user_tokens")
          .update({
            access_token: accessToken,
            expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
          })
          .eq("user_id", token.user_id)
          .eq("provider", "google");

        const messageIds = await fetchReceiptMessageIds(accessToken);
        if (messageIds.length === 0) {
          results.push({ user_id: token.user_id, items_added: 0 });
          continue;
        }

        // Filter out already-processed messages
        const { data: processed } = await supabase
          .from("gmail_processed_messages")
          .select("message_id")
          .eq("user_id", token.user_id)
          .in("message_id", messageIds);

        const processedIds = new Set(
          (processed ?? []).map((r: { message_id: string }) => r.message_id),
        );
        const newIds = messageIds.filter((id) => !processedIds.has(id));

        let itemsAdded = 0;
        for (const msgId of newIds) {
          const body = await fetchEmailBody(accessToken, msgId);
          if (!body) continue;

          const items = await parseEmailForClothingItems(body);
          for (const item of items) {
            const { error: insertError } = await supabase.from("closet_items").insert({
              user_id: token.user_id,
              name: item.name,
              brand: item.brand ?? null,
              cost: item.cost ?? null,
              purchased_date: item.purchased_date ?? null,
              wears: 0,
              cpw: item.cost ?? null,
            });
            if (!insertError) itemsAdded++;
          }

          await supabase.from("gmail_processed_messages").insert({
            user_id: token.user_id,
            message_id: msgId,
          });
        }

        results.push({ user_id: token.user_id, items_added: itemsAdded });
      } catch (err) {
        results.push({
          user_id: token.user_id,
          items_added: 0,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    return Response.json({ synced: results.length, results });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
});
