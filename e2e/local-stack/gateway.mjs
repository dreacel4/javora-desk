// Mimics Supabase's API gateway: /auth/v1 -> GoTrue, /rest/v1 -> PostgREST.
import http from "node:http";
const routes = [["/auth/v1", 9999], ["/rest/v1", 3001]];
http.createServer((req, res) => {
  const r = routes.find(([p]) => req.url.startsWith(p));
  if (!r) { res.writeHead(404, { "content-type": "application/json" }); return res.end('{"message":"not available in local e2e stack"}'); }
  const path = req.url.slice(r[0].length) || "/";
  const headers = { ...req.headers, host: "localhost" };
  const p = http.request({ host: "127.0.0.1", port: r[1], path, method: req.method, headers }, (up) => {
    res.writeHead(up.statusCode, up.headers); up.pipe(res);
  });
  p.on("error", (e) => { res.writeHead(502); res.end(String(e)); });
  req.pipe(p);
}).listen(54321, "127.0.0.1", () => console.log("gateway on 54321"));
