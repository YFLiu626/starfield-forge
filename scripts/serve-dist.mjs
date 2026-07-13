import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const root = resolve("dist");
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || "127.0.0.1";

const mime = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"]
]);

function resolveRequest(url) {
  const cleanPath = decodeURIComponent(new URL(url, `http://${host}:${port}`).pathname);
  const normalized = normalize(cleanPath).replace(/^([/\\])+/, "");
  const target = resolve(join(root, normalized));
  if (target !== root && !target.startsWith(root + sep)) {
    return null;
  }
  if (existsSync(target) && statSync(target).isFile()) {
    return target;
  }
  return join(root, "index.html");
}

const server = createServer((request, response) => {
  const target = resolveRequest(request.url || "/");
  if (!target || !existsSync(target)) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "content-type": mime.get(extname(target)) || "application/octet-stream",
    "cache-control": target.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable"
  });
  createReadStream(target).pipe(response);
});

server.listen(port, host, () => {
  console.log(`Starfield Forge running at http://${host}:${port}/`);
});
