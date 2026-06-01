import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";
const OPENAI_API = "https://api.openai.com/v1/chat/completions";

// Called when user clicks "sync gmail" in the closet screen, or on a cron schedule.
// Uses last_scanned_at from user_tokens to only fetch emails newer than the last scan.

async function refreshAccessToken(refreshToken: string): Promise<string> {
  console.log("REFRESHING ACCESS TOKEN", refreshToken);
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

// Search Gmail for receipt emails newer than lastScannedAt (Unix seconds).
// Falls back to newer_than:1d if no timestamp is available.
async function fetchReceiptMessageIds(
  accessToken: string,
  lastScannedAt: number | null,
  force: boolean,
): Promise<string[]> {
  const dateFilter = force
    ? ""
    : lastScannedAt
    ? ` after:${lastScannedAt}`
    : " newer_than:1d";

  const query = encodeURIComponent(
    `subject:(order OR receipt OR purchase OR confirmation)${dateFilter}`,
  );
  const res = await fetch(
    `${GMAIL_API}/users/me/messages?q=${query}&maxResults=50`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const data = await res.json();
  return (data.messages ?? []).map((m: { id: string }) => m.id);
}

type EmailResult = {
  id: string;
  body: string;
  internalDate: number; // milliseconds epoch
};

async function fetchEmailBody(
  accessToken: string,
  messageId: string,
): Promise<EmailResult> {
  const res = await fetch(
    `${GMAIL_API}/users/me/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const data = await res.json();

  const internalDate = parseInt(data.internalDate ?? "0", 10);

  // Recursively find text/plain and text/html content, collecting both
  // deno-lint-ignore no-explicit-any
  function locateBodyData(payload: any): { text?: string; html?: string } {
    const result: { text?: string; html?: string } = {};

    if (payload.mimeType === "text/plain" && payload.body?.data) {
      result.text = payload.body.data;
    } else if (payload.mimeType === "text/html" && payload.body?.data) {
      result.html = payload.body.data;
    }

    if (payload.parts) {
      for (const part of payload.parts) {
        const nested = locateBodyData(part);
        if (nested.text) result.text = nested.text;
        if (nested.html) result.html = nested.html;
      }
    }

    return result;
  }

  function decodeBase64Url(encoded: string): string {
    try {
      return atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
    } catch {
      return "";
    }
  }

  // Strip CSS/JS/tags before sending to OpenAI to maximise useful content per token
  function cleanHtml(html: string): string {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  const foundData = locateBodyData(data.payload ?? data);
  let rawContent = "";

  // Prefer HTML — retail receipts have richer structure there; fall back to plain text
  if (foundData.html) {
    rawContent = cleanHtml(decodeBase64Url(foundData.html));
  } else if (foundData.text) {
    rawContent = decodeBase64Url(foundData.text);
  }

  return {
    id: messageId,
    body: rawContent.slice(0, 4000),
    internalDate,
  };
}

type ParsedItem = {
  name: string;
  brand: string | null;
  cost: number | null;
  purchased_date: string | null;
};

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
            "You are a shopping receipt parser. Extract clothing/jewelry/accessories that the user has purchased from receipts. Only include items that the user has purchased, ignore advertisements or other non-purchase items." +
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

Deno.serve(async (req) => {
  let force = false;
  try {
    const body = await req.json();
    force = body?.force === true;
  } catch { /* no body or not JSON — fine */ }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // Get all users with a stored Google token
    const { data: tokens, error: tokensError } = await supabase
      .from("user_tokens")
      .select("user_id, refresh_token, last_scanned_at")
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

        const messageIds = await fetchReceiptMessageIds(
          accessToken,
          token.last_scanned_at ?? null,
          force,
        );

        if (messageIds.length === 0) {
          results.push({ user_id: token.user_id, items_added: 0 });
          continue;
        }

        let itemsAdded = 0;
        let maxInternalDateMs = 0;

        for (const msgId of messageIds) {
          const { body, internalDate } = await fetchEmailBody(accessToken, msgId);
          if (!body) continue;

          if (internalDate > maxInternalDateMs) maxInternalDateMs = internalDate;

          const items = await parseEmailForClothingItems(body);
          for (const item of items) {
            const { error: insertError } = await supabase
              .from("closet")
              .insert({
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
        }

        // Advance the cursor so next sync only fetches emails after this point
        if (maxInternalDateMs > 0) {
          const lastScannedAt = Math.floor(maxInternalDateMs / 1000) + 1;
          await supabase
            .from("user_tokens")
            .update({ last_scanned_at: lastScannedAt })
            .eq("user_id", token.user_id)
            .eq("provider", "google");
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
