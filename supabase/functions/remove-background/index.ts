// Proxies a photo to remove.bg and returns the cutout (transparent PNG) as base64.
// Keeps the remove.bg API key server-side.
//
// Tried swapping this to OpenAI's gpt-image-1(-mini) edit endpoint for cost —
// reverted. It doesn't do true segmentation: "background: transparent" came back
// fully opaque (a hallucinated neutral backdrop, not real transparency), and it
// subtly redrew garment details (buttons, fabric, shadows) each time. Not a fit
// for accurately tracking real closet items. If cost is still a concern, look at
// Clipdrop's remove-background API (real segmentation, historically cheaper than
// remove.bg) before reaching for a generative-edit model again.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("REMOVE_BG_API_KEY");
    if (!apiKey) {
      return Response.json({ error: "Background removal is not configured." }, { status: 500, headers: corsHeaders });
    }

    const { imageBase64 } = await req.json();
    if (!imageBase64 || typeof imageBase64 !== "string") {
      return Response.json({ error: "Missing imageBase64" }, { status: 400, headers: corsHeaders });
    }

    const form = new FormData();
    form.append("image_file_b64", imageBase64);
    form.append("size", "auto");

    const removeBgRes = await fetch("https://api.remove.bg/v1.0/removebg", {
      method: "POST",
      headers: { "X-Api-Key": apiKey },
      body: form,
    });

    if (!removeBgRes.ok) {
      const detail = await removeBgRes.text().catch(() => "");
      return Response.json(
        { error: `remove.bg error (${removeBgRes.status}): ${detail.slice(0, 300)}` },
        { status: 502, headers: corsHeaders },
      );
    }

    const resultBuffer = await removeBgRes.arrayBuffer();
    const resultBase64 = bufferToBase64(resultBuffer);

    return Response.json({ image: resultBase64 }, { headers: corsHeaders });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500, headers: corsHeaders },
    );
  }
});
