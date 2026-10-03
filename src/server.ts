import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { ConvertService } from "./service.js";
import { Store } from "./db.js";

const DATA_DIR = process.env.RMB_DATA_DIR
  ? resolve(process.env.RMB_DATA_DIR)
  : resolve(process.cwd(), "data");
const store = new Store(resolve(DATA_DIR, "rmb.sqlite"));
const service = new ConvertService(store);

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolvePromise, reject) => {
    let body = "";
    req.on("data", (c: Buffer) => {
      body += c.toString("utf8");
      if (body.length > 1_000_000) {
        reject(new Error("PAYLOAD_TOO_LARGE"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (body.trim() === "") return resolvePromise({});
      try {
        resolvePromise(JSON.parse(body) as Record<string, unknown>);
      } catch {
        reject(new Error("INVALID_JSON"));
      }
    });
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  try {
    if (req.method === "GET" && path === "/health") {
      return send(res, 200, { ok: true, ruleVersion: service.ruleVersion });
    }

    if (req.method === "POST" && path === "/api/to-chinese") {
      const json = await readJson(req);
      if (typeof json.input !== "string") {
        return send(res, 400, { error: { code: "E_PARAM", message: "缺少字符串参数 input" } });
      }
      const report = service.toChinese(json.input);
      return send(res, report.valid ? 200 : 422, report);
    }

    if (req.method === "POST" && path === "/api/verify") {
      const json = await readJson(req);
      if (typeof json.input !== "string") {
        return send(res, 400, { error: { code: "E_PARAM", message: "缺少字符串参数 input" } });
      }
      const report = service.verify(json.input);
      return send(res, report.valid ? 200 : 422, report);
    }

    if (req.method === "POST" && path === "/api/batch") {
      const json = await readJson(req);
      const direction = json.direction;
      if (direction !== "amount2cn" && direction !== "cn2amount") {
        return send(res, 400, {
          error: { code: "E_PARAM", message: 'direction 必须为 "amount2cn" 或 "cn2amount"' },
        });
      }
      if (!Array.isArray(json.items) || json.items.length === 0 || json.items.length > 1000) {
        return send(res, 400, {
          error: { code: "E_PARAM", message: "items 必须为 1-1000 条的数组，元素形如 {input}" },
        });
      }
      const badItem = json.items.findIndex((it) => !it || typeof (it as { input: unknown }).input !== "string");
      if (badItem >= 0) {
        return send(res, 400, {
          error: { code: "E_PARAM", message: `第 ${badItem} 条缺少字符串 input` },
        });
      }
      const items = json.items as { input: string }[];
      const report = service.batch(items, direction);
      return send(res, report.failed === 0 ? 200 : 207, report);
    }

    if (req.method === "GET" && path === "/api/history") {
      const limit = Math.min(Number(url.searchParams.get("limit") ?? "50") || 50, 1000);
      const direction = url.searchParams.get("direction") ?? undefined;
      if (direction && direction !== "amount2cn" && direction !== "cn2amount") {
        return send(res, 400, { error: { code: "E_PARAM", message: "非法 direction" } });
      }
      return send(res, 200, { items: service.history(limit, direction) });
    }

    if (req.method === "GET" && path === "/api/export") {
      return send(res, 200, { ruleVersion: service.ruleVersion, items: service.exportAll() });
    }

    return send(res, 404, { error: { code: "E_NOT_FOUND", message: "接口不存在" } });
  } catch (e) {
    const message = (e as Error).message;
    if (message === "INVALID_JSON") {
      return send(res, 400, { error: { code: "E_PARAM", message: "请求体不是合法 JSON" } });
    }
    if (message === "PAYLOAD_TOO_LARGE") {
      return send(res, 413, { error: { code: "E_TOO_LARGE", message: "请求体过大" } });
    }
    return send(res, 500, { error: { code: "E_INTERNAL", message: String((e as Error).message) } });
  }
});

const requestedPort = Number(process.env.PORT ?? "0");
server.listen(requestedPort, "127.0.0.1", () => {
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : requestedPort;
  console.log(`人民币大写金额服务已启动（规则版本 ${service.ruleVersion}）`);
  console.log(`监听地址: http://127.0.0.1:${port}`);
  console.log(`数据目录: ${DATA_DIR}`);
  console.log("接口: POST /api/to-chinese | POST /api/verify | POST /api/batch | GET /api/history | GET /api/export");
});
