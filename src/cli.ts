import { resolve } from "node:path";
import { ConvertService } from "./service.js";
import { Store } from "./db.js";
import { RULE_VERSION } from "./core/converter.js";

const DATA_DIR = process.env.RMB_DATA_DIR
  ? resolve(process.env.RMB_DATA_DIR)
  : resolve(process.cwd(), "data");

function getService(): ConvertService {
  const store = new Store(resolve(DATA_DIR, "rmb.sqlite"));
  return new ConvertService(store);
}

function printReport(report: unknown): void {
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

function usage(): void {
  process.stdout.write(
    [
      "人民币中文大写金额转换与核验 CLI",
      `规则版本: ${RULE_VERSION}`,
      "",
      "用法:",
      "  npm run cli -- to <金额>          数字金额 -> 大写",
      "  npm run cli -- verify \"<大写>\"    大写 -> 金额（严格核验）",
      "  npm run cli -- batch <方向> <文件.json>",
      "      方向: to | verify；文件内容为 [\"1001.05\", ...] 或 [{\"input\":\"...\"}, ...]",
      "  npm run cli -- history [条数] [to|verify]   查询历史（默认 20 条）",
      "  npm run cli -- export [输出文件.json]        导出全部记录（默认打印到屏幕）",
      "  npm run demo                     运行内置演示",
      "",
      "环境变量:",
      "  RMB_DATA_DIR  数据目录（默认 ./data）",
      "",
    ].join("\n"),
  );
}

async function readItems(file: string): Promise<{ input: string }[]> {
  const { readFileSync } = await import("node:fs");
  const parsed = JSON.parse(readFileSync(resolve(file), "utf8")) as unknown;
  if (!Array.isArray(parsed)) throw new Error("批量文件必须是 JSON 数组");
  return parsed.map((item) =>
    typeof item === "string" ? { input: item } : (item as { input: string }),
  );
}

const demos = [
  { kind: "to", label: "整数（无角分，加“元整”）", input: "12345.00" },
  { kind: "to", label: "只有角", input: "0.60" },
  { kind: "to", label: "只有分（补零）", input: "0.07" },
  { kind: "to", label: "跨万位连续零 10001.05", input: "1001.05" },
  { kind: "to", label: "跨万位连续零 10001", input: "10001.00" },
  { kind: "to", label: "跨亿位空组 100000001.00", input: "100000001.00" },
  { kind: "verify", label: "规定例 1001.05 的大写", input: "壹仟零壹元零伍分" },
  { kind: "verify", label: "规定例 100000001.00 的大写", input: "壹亿零壹元整" },
  { kind: "verify", label: "重复单位错误（应被拒绝）", input: "壹佰佰元整" },
];

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const service = getService();

  if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
    usage();
    return;
  }

  if (cmd === "to") {
    printReport(service.toChinese(rest[0] ?? ""));
    return;
  }

  if (cmd === "verify") {
    printReport(service.verify(rest[0] ?? ""));
    return;
  }

  if (cmd === "batch") {
    const dir = rest[0];
    const file = rest[1];
    if (!file || (dir !== "to" && dir !== "verify")) {
      throw new Error("用法: batch <to|verify> <文件.json>");
    }
    const items = await readItems(file);
    printReport(service.batch(items, dir === "to" ? "amount2cn" : "cn2amount"));
    return;
  }

  if (cmd === "history") {
    const limit = Number(rest[0] ?? "20") || 20;
    const dirArg = rest[1];
    const direction =
      dirArg === "to" ? "amount2cn" : dirArg === "verify" ? "cn2amount" : undefined;
    printReport({ items: service.history(limit, direction) });
    return;
  }

  if (cmd === "export") {
    const payload = { ruleVersion: RULE_VERSION, items: service.exportAll() };
    const outFile = rest[0];
    if (outFile) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(resolve(outFile), JSON.stringify(payload, null, 2), "utf8");
      process.stdout.write(`已导出 ${payload.items.length} 条到 ${outFile}\n`);
    } else {
      printReport(payload);
    }
    return;
  }

  if (cmd === "demo") {
    process.stdout.write(`=== 人民币大写金额演示（规则版本 ${RULE_VERSION}） ===\n\n`);
    for (const d of demos) {
      process.stdout.write(`【${d.label}】\n  输入: ${d.input}\n`);
      const report =
        d.kind === "to" ? service.toChinese(d.input) : service.verify(d.input);
      if (report.valid) {
        process.stdout.write(`  规范金额: ${report.amount}\n`);
        process.stdout.write(`  规范大写: ${report.canonicalChinese}\n\n`);
      } else {
        const err = (report as { error?: { code: string; message: string; position: number | null } }).error;
        process.stdout.write(`  拒绝 [${err?.code}]${err?.position != null ? ` 位置=${err.position}` : ""}: ${err?.message}\n\n`);
      }
    }
    return;
  }

  usage();
  process.exitCode = 1;
}

main().catch((e: Error) => {
  process.stderr.write(`错误: ${e.message}\n`);
  process.exit(1);
});
