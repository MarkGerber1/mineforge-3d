/**
 * Stable workers.dev reverse proxy in front of the live full-stack process.
 * Origin is injected at deploy time (wrangler [vars].ORIGIN). This hostname
 * is the canonical URL; the origin tunnel is an unpublished hop.
 */
const HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
]);

export default {
  async fetch(request, env) {
    const origin = String(env.ORIGIN || "").replace(/\/$/, "");
    if (!/^https?:\/\//i.test(origin)) {
      return Response.json({ ok: false, error: "origin-unconfigured" }, { status: 502 });
    }
    const incoming = new URL(request.url);
    const dest = new URL(incoming.pathname + incoming.search, origin);
    const headers = new Headers();
    for (const [k, v] of request.headers) {
      if (HOP.has(k.toLowerCase())) continue;
      headers.append(k, v);
    }
    headers.set("x-forwarded-host", incoming.host);
    headers.set("x-forwarded-proto", "https");
    headers.set("x-mf-canonical-host", incoming.host);
    const visitor = request.headers.get("cf-connecting-ip");
    if (visitor) headers.set("x-mf-visitor-ip", visitor);
    const init = { method: request.method, headers, redirect: "manual" };
    if (request.method !== "GET" && request.method !== "HEAD") init.body = request.body;
    let res;
    try {
      res = await fetch(dest, init);
    } catch {
      return Response.json({ ok: false, error: "origin-unreachable" }, { status: 502 });
    }
    const out = new Headers();
    for (const [k, v] of res.headers) {
      if (HOP.has(k.toLowerCase())) continue;
      out.append(k, v);
    }
    out.set("x-mf-canonical", "1");
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
  },
};
