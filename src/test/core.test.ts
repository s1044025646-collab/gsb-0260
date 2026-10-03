import { test } from "node:test";
import assert from "node:assert/strict";
import { amountToChinese, AmountError } from "../core/converter.js";
import { parseChinese } from "../core/parser.js";
import { RULE_VERSION } from "../core/converter.js";

// 人工固定的边界金额-文字基准（独立预期，非往返生成）
const FIXTURES: { amount: string; chinese: string }[] = [
  { amount: "0.00", chinese: "零元整" },
  { amount: "1.00", chinese: "壹元整" },
  { amount: "10.00", chinese: "壹拾元整" },
  { amount: "100.00", chinese: "壹佰元整" },
  { amount: "1000.00", chinese: "壹仟元整" },
  { amount: "1001.00", chinese: "壹仟零壹元整" },
  { amount: "1001.05", chinese: "壹仟零壹元零伍分" },
  { amount: "1001.50", chinese: "壹仟零壹元伍角整" },
  { amount: "1001.55", chinese: "壹仟零壹元伍角伍分" },
  { amount: "0.60", chinese: "零元陆角整" },
  { amount: "0.07", chinese: "零元零柒分" },
  { amount: "10000.00", chinese: "壹万元整" },
  { amount: "10001.00", chinese: "壹万零壹元整" },
  { amount: "100010001.00", chinese: "壹亿零壹万零壹元整" },
  { amount: "100000001.00", chinese: "壹亿零壹元整" },
  { amount: "100000000.00", chinese: "壹亿元整" },
  { amount: "200202.02", chinese: "贰拾万零贰佰零贰元零贰分" },
  { amount: "999999999999.99", chinese: "玖仟玖佰玖拾玖亿玖仟玖佰玖拾玖万玖仟玖佰玖拾玖元玖角玖分" },
];

test("人工固定基准：正向转换完全匹配", () => {
  for (const f of FIXTURES) {
    assert.equal(amountToChinese(f.amount).chinese, f.chinese, `正向失败: ${f.amount}`);
  }
});

test("人工固定基准：反向核验完全匹配", () => {
  for (const f of FIXTURES) {
    const r = parseChinese(f.chinese, RULE_VERSION);
    assert.equal(r.valid, true, `反向应有效: ${f.chinese} -> ${r.error?.message}`);
    assert.equal(r.amount, f.amount, `反向金额失败: ${f.chinese}`);
    assert.equal(r.canonicalChinese, f.chinese);
  }
});

test("少于两位小数补零；前导零与外围空白按公开规则处理", () => {
  assert.equal(amountToChinese("  1001.1 ").chinese, "壹仟零壹元壹角整");
  assert.equal(amountToChinese("0010.5").chinese, "壹拾元伍角整");
  assert.equal(amountToChinese("8").chinese, "捌元整");
});

test("超过两位小数拒绝且不舍入", () => {
  assert.throws(
    () => amountToChinese("1.005"),
    (e: unknown) => e instanceof AmountError && e.code === "E_PRECISION_EXCEEDED",
  );
});

test("越界与负数拒绝", () => {
  assert.throws(() => amountToChinese("1000000000000.00"), (e: unknown) => (e as AmountError).code === "E_OUT_OF_RANGE");
  assert.throws(() => amountToChinese("-1.00"), (e: unknown) => (e as AmountError).code === "E_INVALID_NUMBER");
  assert.throws(() => amountToChinese(""), (e: unknown) => (e as AmountError).code === "E_EMPTY");
});

test("非法字符 / 单位次序 / 重复单位 被拒绝并带错误码", () => {
  const dup = parseChinese("壹佰佰元整", RULE_VERSION);
  assert.equal(dup.valid, false);
  assert.equal(dup.error?.code, "E_DUPLICATE_UNIT");
  assert.equal(dup.error?.position, 2);

  const order = parseChinese("壹拾佰元整", RULE_VERSION);
  assert.equal(order.valid, false);
  assert.equal(order.error?.code, "E_UNIT_ORDER");

  const illegal = parseChinese("壹佰元整萬", RULE_VERSION); // 繁体萬不接受
  assert.equal(illegal.valid, false);
  assert.equal(illegal.error?.code, "E_ILLEGAL_CHAR");
});

test("可解析但非规范写法不静默成功", () => {
  // 漏写跨组零：能推断数值，但与重新生成的规范形式不一致
  const r = parseChinese("壹亿壹元整", RULE_VERSION);
  assert.equal(r.valid, false);
  assert.equal(r.error?.code, "E_NONCANONICAL");
  assert.equal(r.canonicalChinese, "壹亿零壹元整");
});

test("小范围金额双向验证（独立枚举 0..20001 全部整数 + 角分采样）", () => {
  for (let n = 0; n <= 20001; n++) {
    const amount = `${n}.00`;
    const cn = amountToChinese(amount).chinese;
    const back = parseChinese(cn, RULE_VERSION);
    assert.equal(back.valid, true, `往返核验失败: ${amount} -> ${cn} -> ${back.error?.message}`);
    assert.equal(back.amount, amount, `往返金额不一致: ${amount} -> ${cn} -> ${back.amount}`);
    assert.equal(back.canonicalChinese, cn);
  }
  // 独立小数采样：枚举全部角/分组合的一部分
  for (let j = 0; j <= 9; j++) {
    for (let f = 0; f <= 9; f += 3) {
      const amount = `1234.${j}${f}`;
      const cn = amountToChinese(amount).chinese;
      const back = parseChinese(cn, RULE_VERSION);
      assert.equal(back.amount, amount, `${amount} -> ${cn}`);
      assert.equal(back.valid, true);
    }
  }
});

test("分组解释正确反映四位分组", () => {
  const r = amountToChinese("100010001.00");
  const units = r.groups.map((g) => `${g.groupUnit}:${g.rawDigits}=${g.value}`);
  assert.deepEqual(units, [":0001=1", "万:0001=1", "亿:0001=1"]);
});
