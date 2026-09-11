/** Dev-server HTTP surface for Application Edit + runtime health. */
export function appEditHttpPlugin() {
  return {
    name: "mineforge-app-edit-http",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const rawUrl = req.url ?? "";
          const pathOnly = rawUrl.split("?", 1)[0] ?? "";
          const interesting =
            pathOnly === "/api/runtime" ||
            pathOnly.startsWith("/api/runtime/") ||
            pathOnly.startsWith("/api/app-edit") ||
            pathOnly.startsWith("/__preview/");
          if (!interesting) {
            next();
            return;
          }
          const host = req.headers.host ?? "127.0.0.1";
          const proto = req.socket?.encrypted ? "https" : "http";
          const url = new URL(rawUrl, `${proto}://${host}`);
          const chunks = [];
          if (req.method !== "GET" && req.method !== "HEAD") {
            await new Promise((resolve, reject) => {
              req.on("data", (c) => chunks.push(c));
              req.on("end", resolve);
              req.on("error", reject);
            });
          }
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) {
            if (typeof v === "string") headers.set(k, v);
            else if (Array.isArray(v)) headers.set(k, v.join(", "));
          }
          const method = (req.method ?? "GET").toUpperCase();
          const body =
            method === "GET" || method === "HEAD" ? undefined : Buffer.concat(chunks);
          const request = new Request(url, { method, headers, body });
          const mod = await server.ssrLoadModule("/src/ai/http.server.ts");
          const response = await mod.handleAppEditHttp(request);
          if (!response) {
            next();
            return;
          }
          res.statusCode = response.status;
          response.headers.forEach((value, key) => {
            res.setHeader(key, value);
          });
          const buf = Buffer.from(await response.arrayBuffer());
          res.end(buf);
        } catch (err) {
          console.error("[app-edit-http]", err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: false, error: "Request failed" }));
          }
        }
      });
    },
  };
}
