const TARGETS = [
  { name: "שופרסל", url: "https://prices.shufersal.co.il/" },
  { name: "Cerberus - רמי לוי, אושר עד, יוחננוף", url: "https://url.publishedprices.co.il/login" },
  { name: "קרפור", url: "https://prices.carrefour.co.il/" },
  { name: "laib - ויקטורי, מחסני השוק", url: "https://laibcatalog.co.il/" },
  { name: "סופר-פארם", url: "https://prices.super-pharm.co.il/" },
];

async function probe(t) {
  const start = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(t.url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0" } });
    const text = await res.text();
    return { name: t.name, ok: res.ok, status: res.status, ms: Date.now() - start,
      snippet: text.slice(0, 150).replace(/\s+/g, " ") };
  } catch (e) {
    return { name: t.name, ok: false, ms: Date.now() - start,
      error: e.name === "AbortError" ? "timeout" : String(e.cause?.code || e.message) };
  } finally { clearTimeout(timer); }
}

export default async () => {
  const results = await Promise.all(TARGETS.map(probe));
  return new Response(JSON.stringify({ region: process.env.AWS_REGION, results }, null, 2),
    { headers: { "content-type": "application/json; charset=utf-8" } });
};

export const config = { path: "/test-chains" };
