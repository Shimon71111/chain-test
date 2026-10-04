import { gunzipSync } from "node:zlib";

const BASE = "https://url.publishedprices.co.il";
const USER = "RamiLevi";
const jar = new Map();

function saveCookies(res) {
  const list = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of list) {
    const pair = c.split(";")[0];
    const i = pair.indexOf("=");
    jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
    headers: { "User-Agent": "Mozilla/5.0", Cookie: cookieHeader(), ...(opts.headers || {}) },
  });
  saveCookies(res);
  return res;
}

const getToken = (html) => (html.match(/name="csrftoken"\s+content="([^"]+)"/) || [])[1];
const form = { "Content-Type": "application/x-www-form-urlencoded" };
const json = (o) => new Response(JSON.stringify(o, null, 2),
  { headers: { "content-type": "application/json; charset=utf-8" } });

export default async () => {
  jar.clear();
  const t0 = Date.now();
  const steps = [];
  const step = (name, extra = {}) => steps.push({ step: name, ms: Date.now() - t0, ...extra });

  try {
    let html = await (await req("/login")).text();
    let token = getToken(html);
    step("login page", { gotToken: !!token });

    const login = await req("/login/user", {
      method: "POST", headers: form,
      body: new URLSearchParams({ r: "", username: USER, password: "", Submit: "Sign in", csrftoken: token || "" }),
    });
    step("login", { status: login.status, redirect: login.headers.get("location") });

    html = await (await req("/file")).text();
    token = getToken(html) || token;
    step("file page", { gotToken: !!token });

    const dirRes = await req("/file/json/dir", {
      method: "POST", headers: form,
      body: new URLSearchParams({
        sEcho: "1", iColumns: "5", sColumns: ",,,,", iDisplayStart: "0",
        iDisplayLength: "100000", sSearch: "PriceFull", bRegex: "false",
        iSortingCols: "0", cd: "/", csrftoken: token || "",
      }),
    });
    const dirText = await dirRes.text();
    let dir;
    try { dir = JSON.parse(dirText); }
    catch { throw new Error("file list not JSON: " + dirText.slice(0, 150)); }

    const files = (dir.aaData || []).map((f) => f.fname).filter((n) => /^PriceFull/i.test(n)).sort();
    step("file list", { priceFullFiles: files.length, sample: files.slice(-3) });
    if (!files.length) throw new Error("no PriceFull files found");

    const fname = files.at(-1);
    const fileRes = await req("/file/d/" + fname);
    const buf = Buffer.from(await fileRes.arrayBuffer());
    step("download", { fname, status: fileRes.status, kb: Math.round(buf.length / 1024) });

    const xml = (buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString("utf8");
    const items = (xml.match(/<Item>/gi) || []).length;
    const sample = [...xml.matchAll(/<ItemName>([^<]*)<\/ItemName>[\s\S]*?<ItemPrice>([^<]*)<\/ItemPrice>/gi)]
      .slice(0, 5).map((m) => `${m[1].trim()} - ${m[2]}`);
    step("parse", { items, sample });

    return json({ ok: true, totalMs: Date.now() - t0, steps });
  } catch (e) {
    return json({ ok: false, totalMs: Date.now() - t0, error: String(e.message || e), steps });
  }
};

export const config = { path: "/test-cerberus" };
