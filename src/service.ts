// 转换服务：封装正向转换、反向核验、批量处理与持久化

import { RULE_VERSION, amountToChinese, AmountError } from "./core/converter.js";
import { parseChinese, type ParseReport } from "./core/parser.js";
import { Store } from "./db.js";

export { RULE_VERSION };

export interface ForwardReport {
  direction: "amount2cn";
  ruleVersion: string;
  input: string;
  valid: boolean;
  amount: string | null;
  canonicalChinese: string | null;
  groups:
    | {
        groupIndex: number;
        groupUnit: string;
        rawDigits: string;
        value: number;
        intraText: string;
      }[]
    | null;
  jiao: number | null;
  fen: number | null;
  error?: { code: string; message: string; position: number | null };
}

export class ConvertService {
  readonly ruleVersion = RULE_VERSION;

  constructor(private store: Store) {}

  toChinese(raw: string, persist = true): ForwardReport {
    const input = typeof raw === "string" ? raw.trim() : "";
    let report: ForwardReport;
    try {
      const r = amountToChinese(input);
      report = {
        direction: "amount2cn",
        ruleVersion: RULE_VERSION,
        input,
        valid: true,
        amount: r.amount,
        canonicalChinese: r.chinese,
        groups: r.groups,
        jiao: r.jiao,
        fen: r.fen,
      };
    } catch (e) {
      const err = e as AmountError;
      report = {
        direction: "amount2cn",
        ruleVersion: RULE_VERSION,
        input,
        valid: false,
        amount: null,
        canonicalChinese: null,
        groups: null,
        jiao: null,
        fen: null,
        error: { code: err.code, message: err.message, position: err.position ?? null },
      };
    }
    if (persist) {
      const id = this.store.save("amount2cn", input, RULE_VERSION, report);
      (report as ForwardReport & { id?: number }).id = id;
    }
    return report;
  }

  verify(raw: string, persist = true): ParseReport {
    const input = typeof raw === "string" ? raw.trim() : "";
    const report = parseChinese(input, RULE_VERSION);
    if (persist) {
      const id = this.store.save("cn2amount", input, RULE_VERSION, report);
      (report as ParseReport & { id?: number }).id = id;
    }
    return report;
  }

  batch(
    items: { input: string }[],
    direction: "amount2cn" | "cn2amount",
  ): {
    direction: string;
    total: number;
    succeeded: number;
    failed: number;
    results: unknown[];
  } {
    const results = items.map((item, index) => {
      const r =
        direction === "amount2cn"
          ? this.toChinese(item.input, true)
          : this.verify(item.input, true);
      // 每条都独立落库，错误条目不覆盖成功报告；附带条目定位
      return { index, input: item.input, report: r };
    });
    const failed = results.filter((r) => (r as { report: { valid: boolean } }).report.valid === false).length;
    return {
      direction,
      total: items.length,
      succeeded: items.length - failed,
      failed,
      results,
    };
  }

  history(limit: number, direction?: string) {
    return this.store.history(limit, direction).map((row) => ({
      ...row,
      report: JSON.parse(row.report) as unknown,
    }));
  }

  exportAll() {
    return this.store.all().map((row) => ({
      ...row,
      report: JSON.parse(row.report) as unknown,
    }));
  }
}
