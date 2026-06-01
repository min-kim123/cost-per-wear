import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Scans the user's full Gmail history for purchase receipts and adds them to the closet table.
// Tracks the newest email's internalDate in user_tokens.last_scanned_at so sync-gmail
// can pick up from there instead of re-scanning old messages.
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";
const OPENAI_API = "https://api.openai.com/v1/chat/completions";

const EMAILS_PER_OPENAI_BATCH = 5; // emails combined into one OpenAI call
const GMAIL_FETCH_CONCURRENCY = 20; // parallel Gmail body fetches
const MAX_EMAILS = 50;
const MAX_BODY_CHARS = 8000; // truncate each body to keep batches manageable

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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
  console.log("REFRESHED ACCESS TOKEN", data.access_token);
  return data.access_token;
}

async function fetchAllReceiptMessageIds(
  accessToken: string,
): Promise<string[]> {
  console.log("FETCHING ALL RECEIPT MESSAGE IDs", accessToken);
  const query = encodeURIComponent(
    "subject:((order OR receipt OR purchase OR confirmation) " +
      '-off -sale -"ends soon" -free -kickoff -"shop our" -"shop the")',
  );
  const ids: string[] = [];
  let pageToken: string | undefined;

  while (ids.length < MAX_EMAILS) {
    const remaining = MAX_EMAILS - ids.length;
    console.log("REMAINING EMAILS", remaining);
    let url = `${GMAIL_API}/users/me/messages?q=${query}&maxResults=${Math.min(remaining, 500)}`;
    console.log("URL", url);
    if (pageToken) url += `&pageToken=${pageToken}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json();

    // CRITICAL FIX: If Google returns an error or a 400/500 format object instead of data,
    // catch it here before trying to loop over it.
    if (!res.ok) {
      console.error("Gmail API Error response:", data);
      break;
    }

    const messages: { id: string }[] = data.messages ?? [];
    for (const m of messages) ids.push(m.id);

    pageToken = data.nextPageToken;

    // If there is no next page token, or Google returned zero results,
    // break immediately to prevent an infinite loop / invalid query crash.
    if (!pageToken || messages.length === 0) break;
  }

  console.log("FETCHED ALL RECEIPT MESSAGE IDs", ids, " , ", ids.length);
  return ids.slice(0, MAX_EMAILS);//slice to MAX_EMAILS to prevent overwhelming the server
}

type EmailResult = {
  id: string;
  body: string;
  internalDate: number; // milliseconds epoch
};

// Senders or domains to instantly drop during the scanning phase
const SENDER_BLACKLIST = [
  "doordash",
  "chipotle",
  "uber",
  "lyft",
  "instacart",
  "grubhub",
  "starbucks",
  "netflix",
  "spotify",
  "amazon",
  "apple music",
  "ulta",
  "sephora",
  "bestbuy",
  "chick-fil-a",
  "crumbl",
  "dunkin",
  "kfc",
  "mcdonalds",
  "pizza hut",
  "subway",
  "taco bell",
  "wendys",
];

async function fetchEmailBody(
  accessToken: string,
  messageId: string,
): Promise<EmailResult | null> {
  // Notice it can now return null
  const res = await fetch(
    `${GMAIL_API}/users/me/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const data = await res.json();
  const internalDate = parseInt(data.internalDate ?? "0", 10);
  const headers = data.payload?.headers ?? [];

  // 1. Extract Subject and From fields
  const subject =
    headers.find((h: any) => h.name?.toLowerCase() === "subject")?.value ?? "";
  const fromSender =
    headers.find((h: any) => h.name?.toLowerCase() === "from")?.value ?? "";

  // 2. RUN THE BLACKLIST CHECK
  const isBlacklisted = SENDER_BLACKLIST.some(
    (term) =>
      fromSender.toLowerCase().includes(term) ||
      subject.toLowerCase().includes(term),
  );

  if (isBlacklisted) {
    console.log(
      `⏩ SKIPPING BLACKLISTED SENDER: [${fromSender}] - Subject: ${subject}`,
    );
    return null; // Return null so the main loop filters it out
  }

  function locateBodyData(payload: any): { text?: string; html?: string } {
    let result: { text?: string; html?: string } = {};

    // Check this specific part independently
    if (payload.mimeType === "text/plain" && payload.body?.data) {
      result.text = payload.body.data;
    }
    if (payload.mimeType === "text/html" && payload.body?.data) {
      result.html = payload.body.data;
    }

    // Recursively absorb structural components from child layers
    if (payload.parts) {
      for (const part of payload.parts) {
        const nested = locateBodyData(part);
        if (nested.text) result.text = nested.text;
        if (nested.html) result.html = nested.html;
      }
    }
    // console.log("FOUND BODY DATA", result);
    return result;
  }

  function decodeBase64Url(encoded: string): string {
    try {
      const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return new TextDecoder("utf-8").decode(bytes);
    } catch {
      return "";
    }
  }

  // Strip CSS/JS/tags before sending to OpenAI to maximise useful content per token
  function cleanHtml(html: string): string {
    // console.log("CLEANING HTML", html);
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  const foundData = locateBodyData(data.payload ?? data);
  let rawContent = "";

  // 1. Decode the content first
  if (foundData.html) {
    rawContent = decodeBase64Url(foundData.html);
    // 2. Strip the massive <style> blocks from the string IMMEDIATELY
    rawContent = cleanHtml(rawContent);
    console.log("CLEANED HTML", rawContent);
  } else if (foundData.text) {
    rawContent = decodeBase64Url(foundData.text);
  }

  // 3. Now that only text remains, it is safe to slice safely to your token limit
  return {
    id: messageId,
    body: rawContent.slice(0, MAX_BODY_CHARS),
    internalDate,
  };
}

type ParsedItem = {
  name: string;
  brand: string | null;
  cost: number | null;
  purchased_date: string | null;
};

// Parse a batch of email bodies in a single OpenAI call
async function parseEmailBatch(bodies: string[]): Promise<ParsedItem[]> {
  console.log("PARSING EMAIL BATCH IN OPENAI CALL", bodies);
  const combined = bodies
    .map((b, i) => `=== EMAIL ${i + 1} ===\n${b}`)
    .join("\n\n");

  const res = await fetch(OPENAI_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" }, // Forces valid JSON
      messages: [
        {
          role: "system",
          content:
            "You are a shopping receipt parser. Extract clothing/jewelry/accessories that the user has purchased from the emails below. " +
            "Only include items that the user has actually purchased — ignore advertisements, promotions, or items not bought. " +
            "Return a JSON object containing an array named 'items'. Each object in the array should have fields: name (string), brand (string|null), cost (number|null), purchased_date (ISO date string|null). Only include clothing/fashion/accessories items. If there are none, return []. " +
            "Respond with ONLY the JSON object, no explanation.",
        },
        { role: "user", content: combined },
      ],
    }),
  });

  //unpacking openai response
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? "[]";
  try {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

Deno.serve(async (req) => {
  console.log("DENO SERVER REQUEST RECEIVED", req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return Response.json(
        { error: "Missing auth header" },
        { status: 401, headers: corsHeaders },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userError || !user) {
      return Response.json(
        { error: "Unauthorized" },
        { status: 401, headers: corsHeaders },
      );
    }

    const { data: tokenRow, error: tokenError } = await supabase
      .from("user_tokens")
      .select("refresh_token")
      .eq("user_id", user.id)
      .eq("provider", "google")
      .single();

    if (tokenError || !tokenRow) {
      return Response.json(
        { error: "No Gmail token found" },
        { status: 400, headers: corsHeaders },
      );
    }

    const accessToken = await refreshAccessToken(tokenRow.refresh_token);

    console.log("UPDATING ACCESS TOKEN", accessToken);
    await supabase
      .from("user_tokens")
      .update({
        access_token: accessToken,
        expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
      })
      .eq("user_id", user.id)
      .eq("provider", "google");
    // Fetch up to MAX_EMAILS matching message IDs (full history, no date filter)
    const allIds = await fetchAllReceiptMessageIds(accessToken);
    if (allIds.length === 0) {
      return Response.json(
        { message: "No matching emails found", items_added: 0 },
        { headers: corsHeaders },
      );
    }

    // Fetch all email bodies in parallel, GMAIL_FETCH_CONCURRENCY at a time
    const emailResults: EmailResult[] = [];
    for (let i = 0; i < allIds.length; i += GMAIL_FETCH_CONCURRENCY) {
      const chunk = allIds.slice(i, i + GMAIL_FETCH_CONCURRENCY);
      const fetched = await Promise.all(
        chunk.map((id) => fetchEmailBody(accessToken, id)),
      );
      const validEmails = fetched.filter((e): e is EmailResult => e !== null && e.body.length > 0);
      emailResults.push(...validEmails);
    }
    // Add your debug log:
    console.log(`Fetched ${emailResults.length} emails`);
    for (const e of emailResults) {
      // console.log(`--- ${e.id} (${e.internalDate}) ---`);
      console.log("email body: ", e.body.slice(0, 500)); // first 500 chars to keep logs readable
    }
    // Then return early so nothing below runs:
    return Response.json(
      { debug: true, emails_fetched: emailResults.length },
      { headers: corsHeaders },
    );

    //   // Split into batches for OpenAI, then run all batches in parallel
    //   const openAiBatches: EmailResult[][] = [];
    //   for (let i = 0; i < emailResults.length; i += EMAILS_PER_OPENAI_BATCH) {
    //     openAiBatches.push(emailResults.slice(i, i + EMAILS_PER_OPENAI_BATCH));
    //   }

    //   let batchResults = [];
    //   try {
    //     batchResults = await Promise.all(
    //       openAiBatches.map(async (batch) => {
    //         const items = await parseEmailBatch(batch.map((e) => e.body));
    //         return { batch, items };
    //       }),
    //     );
    //   } catch (openAiError) {
    //     // If OpenAI completely errors out, you should still fail the execution block,
    //     // but do NOT advance or run the DB writes to preserve state integrity.
    //     throw new Error(
    //       `OpenAI Processing Pipeline Failed: ${openAiError.message}`,
    //     );
    //   }

    //   // Insert closet items
    //   let itemsAdded = 0;
    //   const itemsToInsert = batchResults.flatMap(({ items }) =>
    //     items.map((item) => ({
    //       user_id: user.id,
    //       name: item.name,
    //       brand: item.brand ?? null,
    //       cost: item.cost ?? null,
    //       purchased_date: item.purchased_date ?? null,
    //       wears: 0,
    //       cpw: item.cost ?? null,
    //     })),
    //   );

    //   if (itemsToInsert.length > 0) {
    //     const { error: insertError } = await supabase
    //       .from("closet")
    //       .insert(itemsToInsert);

    //     // CRITICAL: Halt execution if the database write fails
    //     if (insertError) {
    //       throw new Error(
    //         `Database insert failed: ${insertError.message}. Halting sync to prevent data loss.`,
    //       );
    //     }

    //     itemsAdded = itemsToInsert.length;
    //   }

    //   // Save the newest email's timestamp (in seconds, +1 buffer) so sync-gmail
    //   // can use after:<timestamp> to skip everything we just scanned
    //   const maxInternalDateMs = emailResults.reduce(
    //     (max, e) => Math.max(max, e.internalDate),
    //     0,
    //   );
    //   if (maxInternalDateMs > 0) {
    //     const lastScannedAt = Math.floor(maxInternalDateMs / 1000) + 1;
    //     await supabase
    //       .from("user_tokens")
    //       .update({ last_scanned_at: lastScannedAt })
    //       .eq("user_id", user.id)
    //       .eq("provider", "google");
    //   }

    //   return Response.json(
    //     { items_added: itemsAdded, emails_scanned: emailResults.length },
    //     { headers: corsHeaders },
    //   );
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500, headers: corsHeaders },
    );
  }
});
