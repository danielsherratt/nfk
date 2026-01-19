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
function nzLabelFromIso(iso, bucket) {
  try {
    const opts = bucket === "day"
      ? { timeZone: "Pacific/Auckland", year: "numeric", month: "2-digit", day: "2-digit" }
      : { timeZone: "Pacific/Auckland", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false };
    return new Intl.DateTimeFormat("en-NZ", opts).format(new Date(iso));
  } catch {
    return iso;
  }
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const auth = request.headers.get("Authorization") || "";
  if (!env.API_TOKEN || auth !== `Bearer ${env.API_TOKEN}`) return json({ error: "Unauthorized" }, 401);

  const url = new URL(request.url);

  const bucket = (url.searchParams.get("bucket") || "hour").toLowerCase(); // hour/day
  if (bucket !== "hour" && bucket !== "day") return json({ error: "bucket must be hour or day" }, 400);

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

  const fmt = bucket === "day"
    ? "%Y-%m-%dT00:00:00Z"
    : "%Y-%m-%dT%H:00:00Z";

  // total series
  const totalRows = await env.DB.prepare(
    `SELECT strftime('${fmt}', created_at_utc) AS bucket_utc, COUNT(*) AS count
     FROM nfk_events
     WHERE created_at_utc >= ? AND created_at_utc <= ?
     GROUP BY bucket_utc
     ORDER BY bucket_utc ASC`
  ).bind(fromIso, toIso).all();

  // top names in range
  const topNames = await env.DB.prepare(
    `SELECT name, COUNT(*) AS count
     FROM nfk_events
     WHERE created_at_utc >= ? AND created_at_utc <= ?
     GROUP BY name
     ORDER BY count DESC
     LIMIT 5`
  ).bind(fromIso, toIso).all();

  const topList = (topNames?.results ?? []).map(r => r.name);
  let byName = [];

  if (topList.length) {
    const placeholders = topList.map(() => "?").join(",");
    const rows = await env.DB.prepare(
      `SELECT name, strftime('${fmt}', created_at_utc) AS bucket_utc, COUNT(*) AS count
       FROM nfk_events
       WHERE created_at_utc >= ? AND created_at_utc <= ?
         AND name IN (${placeholders})
       GROUP BY name, bucket_utc
       ORDER BY bucket_utc ASC`
    ).bind(fromIso, toIso, ...topList).all();

    byName = rows?.results ?? [];
  }

  const series = (totalRows?.results ?? []).map(r => ({
    bucket_utc: r.bucket_utc,
    label_nz: nzLabelFromIso(r.bucket_utc, bucket),
    count: r.count
  }));

  return json({
    bucket,
    range: { from_utc: fromIso, to_utc: toIso },
    top_names: topList,
    total: series,
    by_name, // [{name,bucket_utc,count}]
  });
}
