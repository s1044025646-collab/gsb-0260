import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../db.js";
import { ConvertService } from "../service.js";

let dir: string;
let store: Store;
let service: ConvertService;

before(() => {
  dir = mkdtempSync(join(tmpdir(), "rmb-test-"));
  store = new Store(join(dir, "test.sqlite"));
  service = new ConvertService(store);
});

after(() => {
  try {
    store.close();
  } catch {
    // 第二个用例模拟重启后已关闭，忽略
  }
});

test("批量成功与错误条目都落库，错误标出具体条目且不覆盖成功报告", () => {
  const report = service.batch(
    [
      { input: "1001.05" },
      { input: "1.005" },
      { input: "100000001.00" },
    ],
    "amount2cn",
  );
  assert.equal(report.total, 3);
  assert.equal(report.succeeded, 2);
  assert.equal(report.failed, 1);
  const failed = report.results[1] as {
    index: number;
    report: { valid: boolean; error: { code: string } };
  };
  assert.equal(failed.index, 1);
  assert.equal(failed.report.valid, false);
  assert.equal(failed.report.error.code, "E_PRECISION_EXCEEDED");

  const history = service.history(100);
  assert.equal(history.length, 3);
  const successRow = history.find((h) => h.input === "1001.05");
  assert.ok(successRow);
  assert.equal((successRow.report as { valid: boolean }).valid, true);
});

test("反向核验错误同样持久化，重启后可读取同一解释", () => {
  const v = service.verify("壹佰佰元整");
  assert.equal(v.valid, false);

  // 重新打开数据库模拟重启
  store.close();
  store = new Store(join(dir, "test.sqlite"));
  const reopened = store;
  const service2 = new ConvertService(reopened);
  const rows = service2.history(100, "cn2amount");
  const found = rows.find((r) => r.input === "壹佰佰元整");
  assert.ok(found);
  const report = found.report as { error: { code: string }; groups?: unknown };
  assert.equal(report.error.code, "E_DUPLICATE_UNIT");
  reopened.close();
});
