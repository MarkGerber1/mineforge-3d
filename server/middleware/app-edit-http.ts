import { handleAppEditHttp } from "../../src/ai/http.server.ts";

interface HttpEvent {
  url: URL;
  req: { method: string; headers: Headers; text?: () => Promise<string> };
}

export default async function appEditHttpMiddleware(
  event: HttpEvent,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  const path = event.url.pathname;
  const interesting =
    path === "/api/runtime" ||
    path.startsWith("/api/runtime/") ||
    path.startsWith("/api/app-edit") ||
    path.startsWith("/__preview/");
  if (!interesting) return next();
  const method = (event.req.method ?? "GET").toUpperCase();
  let body: string | undefined;
  if (method !== "GET" && method !== "HEAD" && typeof event.req.text === "function") {
    body = await event.req.text();
  }
  const request = new Request(event.url, {
    method,
    headers: event.req.headers,
    body: method === "GET" || method === "HEAD" ? undefined : body,
  });
  const response = await handleAppEditHttp(request);
  if (!response) return next();
  return response;
}
