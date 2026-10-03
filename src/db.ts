import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface HistoryRow {
  id: number;
  direction: "amount2cn" | "cn2amount";
  input: string;
  rule_version: string;
  report: string;
  created_at: string;
}

export class Store {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    const abs = resolve(dbPath);
    mkdirSync(dirname(abs), { recursive: true });
    this.db = new DatabaseSync(abs);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        direction TEXT NOT NULL,
        input TEXT NOT NULL,
        rule_version TEXT NOT NULL,
        report TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );
    `);
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_conversions_created ON conversions(created_at DESC)",
    );
  }

  save(
    direction: "amount2cn" | "cn2amount",
    input: string,
    ruleVersion: string,
    report: unknown,
  ): number {
    const stmt = this.db.prepare(
      "INSERT INTO conversions (direction, input, rule_version, report) VALUES (?, ?, ?, ?)",
    );
    const info = stmt.run(direction, input, ruleVersion, JSON.stringify(report));
    return Number(info.lastInsertRowid);
  }

  history(limit: number, direction?: string): HistoryRow[] {
    if (direction) {
      return this.db
        .prepare(
      "SELECT * FROM conversions WHERE direction = ? ORDER BY id DESC LIMIT ?",
        )
        .all(direction, limit) as unknown as HistoryRow[];
    }
    return this.db
      .prepare("SELECT * FROM conversions ORDER BY id DESC LIMIT ?")
      .all(limit) as unknown as HistoryRow[];
  }

  all(): HistoryRow[] {
    return this.db
      .prepare("SELECT * FROM conversions ORDER BY id ASC")
      .all() as unknown as HistoryRow[];
  }

  close(): void {
    this.db.close();
  }
}
