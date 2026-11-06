import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const json = (res, status, data) => {
  if (!res.destroyed) {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(JSON.stringify(data));
  }
};
export async function readBody(req, limit = 24 * 1024 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("请求内容过大");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export function validateRequest(data) {
  if (
    !data ||
    typeof data.baseUrl !== "string" ||
    typeof data.model !== "string" ||
    !data.model.trim() ||
    !Array.isArray(data.messages) ||
    !data.messages.length
  )
    throw new Error("请填写有效的接口地址、模型 ID 和消息");
  const url = new URL(data.baseUrl.replace(/\/+$/, "") + "/chat/completions");
  if (url.username || url.password || url.search || url.hash)
    throw new Error("接口地址不能包含账号、参数或片段");
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
  )
    throw new Error("远程接口必须使用 HTTPS；本机接口可以使用 HTTP");
  if (
    data.apiKey !== undefined &&
    (typeof data.apiKey !== "string" || /[\r\n]/.test(data.apiKey))
  )
    throw new Error("API Key 格式无效");
  if (
    data.messages.some(
      (m) =>
        !m ||
        !["system", "user", "assistant"].includes(m.role) ||
        !(typeof m.content === "string" || Array.isArray(m.content)),
    )
  )
    throw new Error("消息格式无效");
  return url;
}
export async function createApp({
  production = false,
  upstreamFetch = fetch,
} = {}) {
  const vite = production
    ? undefined
    : await (
        await import("vite")
      ).createServer({
        root,
        server: { middlewareMode: true },
        appType: "spa",
      });
  const server = http.createServer(async (req, res) => {
    const host = req.headers.host || "";
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) {
      json(res, 403, { error: "本地服务仅允许本机访问" });
      return;
    }
    const path = new URL(req.url || "/", `http://${host}`).pathname;
    if (path === "/api/health") {
      json(res, 200, { ok: true });
      return;
    }
    if (path === "/api/chat") {
      if (req.method !== "POST") {
        json(res, 405, { error: "仅支持 POST 请求" });
        return;
      }
      if (req.headers.origin && req.headers.origin !== `http://${host}`) {
        json(res, 403, { error: "请求来源不受允许" });
        return;
      }
      if (!req.headers["content-type"]?.startsWith("application/json")) {
        json(res, 415, { error: "需要 JSON 请求" });
        return;
      }
      const controller = new AbortController();
      let forwarding = false;
      const timer = setTimeout(() => controller.abort(), 120000);
      res.on("close", () => {
        if (!res.writableEnded) controller.abort();
      });
      try {
        const data = await readBody(req);
        const url = validateRequest(data);
        forwarding = true;
        const response = await upstreamFetch(url, {
          method: "POST",
          redirect: "error",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            ...(data.apiKey ? { Authorization: `Bearer ${data.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: data.model,
            messages: data.messages,
            stream: false,
          }),
        });
        if (!response.ok) {
          json(res, 502, {
            error: `模型服务返回 ${response.status}，请检查接口、密钥、模型权限和额度`,
          });
          return;
        }
        const result = await response.json();
        const content = result.choices?.[0]?.message?.content;
        const text =
          typeof content === "string"
            ? content
            : Array.isArray(content)
              ? content.map((p) => p.text || "").join("\n")
              : "";
        if (!text.trim()) {
          json(res, 502, { error: "接口未返回可用的文本回答，请检查模型协议" });
          return;
        }
        json(res, 200, {
          text,
          tokens: Number.isFinite(result.usage?.total_tokens)
            ? result.usage.total_tokens
            : undefined,
        });
      } catch (error) {
        json(res, forwarding ? 502 : 400, {
          error: controller.signal.aborted
            ? "模型响应超时或已取消"
            : error instanceof Error &&
                !/fetch|network|redirect/i.test(error.message)
              ? error.message
              : "模型连接失败，请检查服务地址与网络",
        });
      } finally {
        clearTimeout(timer);
      }
      return;
    }
    if (path.startsWith("/api/")) {
      json(res, 404, { error: "接口不存在" });
      return;
    }
    if (vite) {
      vite.middlewares(req, res);
      return;
    }
    const dist = resolve(root, "dist");
    try {
      let filename = resolve(dist, "." + decodeURIComponent(path));
      if (filename !== dist && !filename.startsWith(dist + sep)) {
        res.writeHead(403);
        res.end();
        return;
      }
      const info = await stat(filename).catch(() => null);
      if (!info?.isFile()) filename = resolve(dist, "index.html");
      const types = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript",
        ".css": "text/css",
        ".png": "image/png",
        ".svg": "image/svg+xml",
        ".jpg": "image/jpeg",
        ".woff2": "font/woff2",
      };
      res.writeHead(200, {
        "Content-Type": types[extname(filename)] || "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(await readFile(filename));
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });
  return {
    server,
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await vite?.close();
    },
  };
}
