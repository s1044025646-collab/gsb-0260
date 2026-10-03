import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { defaultDbPath, ReportStore } from '../db/store.js';
import { toNumber, toWords } from '../core/service.js';
import type { ConvertResult } from '../core/types.js';

interface BatchItem {
  index: number;
  input: string;
  result: ConvertResult;
  savedId: number | null;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1_000_000) {
        rejectBody(new Error('BODY_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', rejectBody);
  });
}

export interface AppOptions {
  dbPath?: string;
  port?: number;
}

export interface StartedApp {
  server: Server;
  port: number;
  store: ReportStore;
}

export async function startApp(options: AppOptions = {}): Promise<StartedApp> {
  const store = new ReportStore(options.dbPath ?? defaultDbPath());

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;

    if (req.method === 'GET' && path === '/health') {
      sendJson(res, 200, { status: 'ok', service: 'rmb-upper-case' });
      return;
    }

    try {
      if (req.method === 'POST' && (path === '/api/to-words' || path === '/api/to-number')) {
        let parsed: { input?: unknown };
        try {
          parsed = await readBody(req).then((text) => (text ? JSON.parse(text) : {}));
        } catch {
          sendJson(res, 400, { errorCode: 'MALFORMED_JSON', message: '请求体不是合法 JSON' });
          return;
        }
        if (typeof parsed.input !== 'string') {
          sendJson(res, 400, { errorCode: 'MISSING_INPUT', message: '缺少字符串字段 input' });
          return;
        }
        const result = path === '/api/to-words' ? toWords(parsed.input) : toNumber(parsed.input);
        const savedId = store.save(result);
        sendJson(res, result.ok ? 200 : 422, { id: savedId, ...result });
        return;
      }

      if (req.method === 'POST' && path === '/api/batch') {
        let parsed: { direction?: unknown; items?: unknown };
        try {
          parsed = await readBody(req).then((text) => (text ? JSON.parse(text) : {}));
        } catch {
          sendJson(res, 400, { errorCode: 'MALFORMED_JSON', message: '请求体不是合法 JSON' });
          return;
        }
        if (parsed.direction !== 'to-words' && parsed.direction !== 'to-number') {
          sendJson(res, 400, { errorCode: 'INVALID_DIRECTION', message: "direction 必须为 'to-words' 或 'to-number'" });
          return;
        }
        if (!Array.isArray(parsed.items) || parsed.items.length === 0 || parsed.items.length > 500) {
          sendJson(res, 400, { errorCode: 'INVALID_ITEMS', message: 'items 必须为 1~500 个字符串的数组' });
          return;
        }
        const items: BatchItem[] = [];
        parsed.items.forEach((raw, index) => {
          if (typeof raw !== 'string') {
            const failureResult: ConvertResult = {
              ok: false,
              direction: parsed.direction as 'to-words' | 'to-number',
              input: String(raw ?? ''),
              ruleVersion: 'rmb-upper-v1',
              failure: { code: 'INVALID_NUMBER', message: '该条目不是字符串，已跳过转换但保留失败记录' },
            };
            items.push({ index, input: String(raw ?? ''), result: failureResult, savedId: store.save(failureResult) });
            return;
          }
          const result = parsed.direction === 'to-words' ? toWords(raw) : toNumber(raw);
          items.push({ index, input: raw, result, savedId: store.save(result) });
        });
        const failed = items.filter((item) => !item.result.ok);
        sendJson(res, 200, {
          total: items.length,
          succeeded: items.length - failed.length,
          failed: failed.length,
          failedIndexes: failed.map((item) => item.index),
          items,
        });
        return;
      }

      if (req.method === 'GET' && path === '/api/history') {
        const direction = url.searchParams.get('direction') ?? undefined;
        const okParam = url.searchParams.get('ok');
        const limit = Math.min(Number(url.searchParams.get('limit') ?? '50') || 50, 500);
        const offset = Math.max(Number(url.searchParams.get('offset') ?? '0') || 0, 0);
        const ok = okParam === null ? undefined : okParam === 'true';
        const rows = store.list({ direction, ok, limit, offset });
        sendJson(res, 200, {
          count: rows.length,
          items: rows.map((row) => ({ ...row, report: JSON.parse(row.report) })),
        });
        return;
      }

      const one = path.match(/^\/api\/history\/(\d+)$/);
      if (req.method === 'GET' && one) {
        const row = store.get(Number(one[1]));
        if (!row) {
          sendJson(res, 404, { errorCode: 'NOT_FOUND', message: '记录不存在' });
          return;
        }
        sendJson(res, 200, { ...row, report: JSON.parse(row.report) });
        return;
      }

      if (req.method === 'GET' && path === '/api/export') {
        const rows = store.list({ limit: 500, offset: 0 });
        for (let offset = 500; ; offset += 500) {
          const more = store.list({ limit: 500, offset });
          if (more.length === 0) break;
          rows.push(...more);
        }
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': 'attachment; filename="rmb-history.json"',
        });
        res.end(JSON.stringify(rows.map((row) => JSON.parse(row.report)), null, 2));
        return;
      }

      sendJson(res, 404, { errorCode: 'NOT_FOUND', message: '未知路由' });
    } catch (error) {
      sendJson(res, 500, {
        errorCode: 'INTERNAL_ERROR',
        message: error instanceof Error && error.message === 'BODY_TOO_LARGE' ? '请求体过大' : '服务器内部错误',
      });
    }
  });

  const wantedPort = options.port ?? (process.env.PORT ? Number(process.env.PORT) : 0);
  await new Promise<void>((resolveListen) => {
    server.listen(wantedPort, '127.0.0.1', () => resolveListen());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : wantedPort;
  return { server, port, store };
}

const isMainProcess = (() => {
  try {
    return argv[1] ? resolve(fileURLToPath(import.meta.url)) === resolve(argv[1]) : false;
  } catch {
    return false;
  }
})();

if (isMainProcess) {
  const requested = process.env.PORT ? Number(process.env.PORT) : 0;
  startApp({ port: requested, dbPath: resolve(process.cwd(), 'data', 'rmb.sqlite') })
    .then(({ port }) => {
      console.log(`人民币大写金额服务已启动: http://127.0.0.1:${port}`);
      console.log('按 Ctrl+C 停止。');
    })
    .catch((error) => {
      console.error('启动失败:', error);
      process.exit(1);
    });
}
