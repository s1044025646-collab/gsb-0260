import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { ConvertResult } from '../core/types.js';

export interface HistoryRow {
  id: number;
  direction: string;
  input: string;
  ok: number;
  rule_version: string;
  report: string;
  created_at: string;
}

export class ReportStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    const absolute = resolve(dbPath);
    mkdirSync(dirname(absolute), { recursive: true });
    this.db = new DatabaseSync(absolute);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        direction TEXT NOT NULL,
        input TEXT NOT NULL,
        ok INTEGER NOT NULL,
        rule_version TEXT NOT NULL,
        report TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_conv_dir ON conversions(direction);');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_conv_ok ON conversions(ok);');
  }

  /** 保存一次转换/核验的完整报告；成功与失败都保留。 */
  save(result: ConvertResult): number {
    const stmt = this.db.prepare(`
      INSERT INTO conversions (direction, input, ok, rule_version, report)
      VALUES (?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      result.direction,
      result.input,
      result.ok ? 1 : 0,
      result.ruleVersion,
      JSON.stringify(result),
    );
    return Number(info.lastInsertRowid);
  }

  list(options: { direction?: string; ok?: boolean; limit?: number; offset?: number } = {}): HistoryRow[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (options.direction) {
      clauses.push('direction = ?');
      params.push(options.direction);
    }
    if (options.ok !== undefined) {
      clauses.push('ok = ?');
      params.push(options.ok ? 1 : 0);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;
    const stmt = this.db.prepare(
      `SELECT * FROM conversions ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    );
    return stmt.all(...params, limit, offset) as unknown as HistoryRow[];
  }

  get(id: number): HistoryRow | undefined {
    const stmt = this.db.prepare('SELECT * FROM conversions WHERE id = ?');
    return stmt.get(id) as unknown as HistoryRow | undefined;
  }

  close(): void {
    this.db.close();
  }
}

export function defaultDbPath(): string {
  return resolve(process.cwd(), 'data', 'rmb.sqlite');
}
