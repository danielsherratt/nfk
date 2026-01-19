function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

function nzTimeFromIso(iso) {
  try {
    return new Intl.DateTimeFormat("en-NZ", {
      timeZone: "Pacific/Auckland",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = request.headers.get("Authorization") || "";
  if (!env.API_TOKEN || auth !== `Bearer ${env.API_TOKEN}`) return json({ error: "Unauthorized" }, 401);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: "Invalid JSON body" }, 400); }

  const name = String(body?.name || "").trim();
  if (!name) return json({ error: "Missing name" }, 400);
  if (name.length > 80) return json({ error: "Name too long" }, 400);

  const nowIso = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO nfk_events (created_at_utc, name) VALUES (?, ?)`
  ).bind(nowIso, name).run();

  // Optional quote
  const quoteRow = await env.DB.prepare(
    `SELECT text FROM quotes ORDER BY RANDOM() LIMIT 1`
  ).first();

  return json({
    ok: true,
    name,
    created_at_utc: nowIso,
    created_at_nz: nzTimeFromIso(nowIso),
    quote: quoteRow?.text || null,
  });
}
