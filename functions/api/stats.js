function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  };
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}
function parseWindowToMs(windowStr) {
  if (!windowStr) return null;
  const m = /^(\d+)(m|h|d)$/i.exec(windowStr.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (!Number.isFinite(n) || n <= 0) return null;
  if (unit === "m") return n * 60 * 1000;
  if (unit === "h") return n * 60 * 60 * 1000;
  if (unit === "d") return n * 24 * 60 * 60 * 1000;
  return null;
}
function nzTimeFromIso(iso) {
  try {
    return new Intl.DateTimeFormat("en-NZ", {
      timeZone: "Pacific/Auckland",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch { return iso; }
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const auth = request.headers.get("Authorization") || "";
  if (!env.API_TOKEN || auth !== `Bearer ${env.API_TOKEN}`) return json({ error: "Unauthorized" }, 401);

  const url = new URL(request.url);

  let fromIso, toIso;
  const windowStr = url.searchParams.get("window");
  const windowMs = parseWindowToMs(windowStr);

  if (windowMs) {
    const to = new Date();
    const from = new Date(Date.now() - windowMs);
    toIso = to.toISOString();
    fromIso = from.toISOString();
  } else {
    const fromParam = url.searchParams.get("from");
    const toParam = url.searchParams.get("to");
    if (fromParam && toParam) {
      const fromD = new Date(fromParam);
      const toD = new Date(toParam);
      if (isNaN(fromD.getTime()) || isNaN(toD.getTime()) || fromD >= toD) return json({ error: "Invalid from/to" }, 400);
      fromIso = fromD.toISOString();
      toIso = toD.toISOString();
    } else {
      const to = new Date();
      const from = new Date(Date.now() - 24 * 60 * 60 * 1000);
      toIso = to.toISOString();
      fromIso = from.toISOString();
    }
  }

  const allTimeTotal = await env.DB.prepare(`SELECT COUNT(*) AS total FROM nfk_events`).first();
  const allTimePerName = await env.DB.prepare(
    `SELECT name, COUNT(*) AS count FROM nfk_events GROUP BY name ORDER BY count DESC, name ASC`
  ).all();

  const rangeTotal = await env.DB.prepare(
    `SELECT COUNT(*) AS total
     FROM nfk_events
     WHERE created_at_utc >= ? AND created_at_utc <= ?`
  ).bind(fromIso, toIso).first();

  const rangePerName = await env.DB.prepare(
    `SELECT name, COUNT(*) AS count
     FROM nfk_events
     WHERE created_at_utc >= ? AND created_at_utc <= ?
     GROUP BY name
     ORDER BY count DESC, name ASC`
  ).bind(fromIso, toIso).all();

  const recent = await env.DB.prepare(
    `SELECT created_at_utc, name
     FROM nfk_events
     WHERE created_at_utc >= ? AND created_at_utc <= ?
     ORDER BY id DESC
     LIMIT 50`
  ).bind(fromIso, toIso).all();

  return json({
    range: {
      from_utc: fromIso, to_utc: toIso,
      from_nz: nzTimeFromIso(fromIso),
      to_nz: nzTimeFromIso(toIso),
    },
    all_time_total: allTimeTotal?.total ?? 0,
    all_time_per_name: allTimePerName?.results ?? [],
    range_total: rangeTotal?.total ?? 0,
    range_per_name: rangePerName?.results ?? [],
    recent: (recent?.results ?? []).map(r => ({
      name: r.name,
      created_at_utc: r.created_at_utc,
      created_at_nz: nzTimeFromIso(r.created_at_utc),
    })),
  });
}
