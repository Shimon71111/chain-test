import { gunzipSync, inflateRawSync } from "node:zlib";

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
const hex = (b) => [...b.subarray(0, 8)].map((x) => x.toString(16).padStart(2, "0")).join(" ");

function unpack(buf) {
  if (buf[0] === 0x1f && buf[1] === 0x8b) return { format: "gzip", data: gunzipSync(buf) };
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    const method = buf.readUInt16LE(8);
    const start = 30 + buf.readUInt16LE(26) + buf.readUInt16LE(28);
    const body = buf.subarray(start);
    return { format: "zip", data: method === 8 ? inflateRawSync(body, { finishFlush: 2 }) : body };
  }
  return { format: "plain", data: buf };
}

function decode(data) {
  if (data[0] === 0xff && data[1] === 0xfe) return { encoding: "utf16le-bom", text: data.toString("utf16le") };
  if (data[1] === 0x00) return { encoding: "utf16le", text: data.toString("utf16le") };
  return { encoding: "utf8", text: data.toString("utf8") };
}

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
    step("login", { status: login.status });

    html = await (await req("/file")).text();
    token = getToken(html) || token;

    const dirRes = await req("/file/json/dir", {
      method: "POST", headers: form,
      body: new URLSearchParams({
        sEcho: "1", iColumns: "5", sColumns: ",,,,", iDisplayStart: "0",
        iDisplayLength: "100000", sSearch: "PriceFull", bRegex: "false",
        iSortingCols: "0", cd: "/", csrftoken: token || "",
      }),
    });
    const dir = JSON.parse(await dirRes.text());
    const files = (dir.aaData || []).map((f) => f.fname).filter((n) => /^PriceFull/i.test(n)).sort();
    step("file list", { priceFullFiles: files.length });

    const fname = files.at(-1);
    const fileRes = await req("/file/d/" + fname);
    const buf = Buffer.from(await fileRes.arrayBuffer());
    step("download", { fname, status: fileRes.status, kb: Math.round(buf.length / 1024), firstBytes: hex(buf) });

    const { format, data } = unpack(buf);
    const { encoding, text } = decode(data);
    const blocks = text.match(/<Item>[\s\S]*?<\/Item>/gi) || [];
    const sample = blocks.slice(0, 5).map((b) => {
      const name = (b.match(/<ItemNa?me?>([^<]*)</i) || [])[1];
      const price = (b.match(/<ItemPrice>([^<]*)
