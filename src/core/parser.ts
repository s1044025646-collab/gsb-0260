// 人民币中文大写金额反向核验模块（严格解析，只接受规范写法）

import {
  AmountError,
  DIGITS,
  type ErrorCode,
  type GroupExplanation,
  MAX_INTEGER,
  amountToChinese,
} from "./converter.js";

const DIGIT_CHARS: Set<string> = new Set<string>(DIGITS);
const ALLOWED = new Set([
  ...DIGITS,
  "零",
  "拾",
  "佰",
  "仟",
  "万",
  "亿",
  "元",
  "角",
  "分",
  "整",
]);
const INTRA_UNIT_CHARS = ["仟", "佰", "拾"] as const; // 组内单位从高到低
const DIGIT_VALUE: Record<string, number> = Object.fromEntries(
  DIGITS.map((d, i) => [d, i]),
);

export interface ParseReport {
  direction: "cn2amount";
  ruleVersion: string;
  /** 去外围空白后的原文 */
  input: string;
  valid: boolean;
  canonical: boolean;
  /** 解析得到的规范金额；失败时为 null */
  amount: string | null;
  /** 由金额重新生成的规范大写；失败时为 null */
  canonicalChinese: string | null;
  /** 整数部分分组解释；失败时为 null */
  groups: GroupExplanation[] | null;
  jiao: number | null;
  fen: number | null;
  error?: { code: ErrorCode; message: string; position: number | null };
}

interface Parsed {
  intValue: bigint;
  groups: GroupExplanation[];
  jiao: number;
  fen: number;
}

/** 核验大写文字。无论成功失败都返回结构化报告；不静默修正错写。 */
export function parseChinese(raw: string, ruleVersion: string): ParseReport {
  const input = typeof raw === "string" ? raw.trim() : "";
  const base: ParseReport = {
    direction: "cn2amount",
    ruleVersion,
    input,
    valid: false,
    canonical: false,
    amount: null,
    canonicalChinese: null,
    groups: null,
    jiao: null,
    fen: null,
  };

  if (input === "") {
    return fail(base, "E_EMPTY", "输入为空", null);
  }

  // 1) 非法字符
  for (let i = 0; i < input.length; i++) {
    if (!ALLOWED.has(input[i]!)) {
      return fail(base, "E_ILLEGAL_CHAR", `非法字符 "${input[i]}"（不接受简体以外的异体/繁体字）`, i);
    }
  }

  // 2) 元/单位重复
  for (const ch of ["元", "角", "分", "整", "亿", "万"] as const) {
    const first = input.indexOf(ch);
    const second = input.indexOf(ch, first + 1);
    if (first >= 0 && second >= 0) {
      return fail(base, "E_DUPLICATE_UNIT", `单位 "${ch}" 重复出现`, second);
    }
  }

  const yuanPos = input.indexOf("元");
  if (yuanPos < 0) {
    return fail(base, "E_MALFORMED", '缺少整数单位 "元"', null);
  }
  const intText = input.slice(0, yuanPos);
  const fracText = input.slice(yuanPos + 1);

  // 3) 单位次序：角/分/整 不得出现在元之前
  for (const ch of ["角", "分", "整"] as const) {
    const p = intText.indexOf(ch);
    if (p >= 0) {
      return fail(base, "E_UNIT_ORDER", `单位 "${ch}" 出现在 "元" 之前，单位次序错误`, p);
    }
  }

  let parsed: Parsed;
  try {
    const { value, groups } = parseIntPart(intText, 0);
    const frac = parseFraction(fracText, yuanPos + 1);
    parsed = { intValue: value, groups, jiao: frac.jiao, fen: frac.fen };
  } catch (e) {
    if (e instanceof AmountError) {
      return fail(base, e.code, e.message, e.position ?? null);
    }
    throw e;
  }

  if (parsed.intValue > BigInt(MAX_INTEGER)) {
    return fail(base, "E_OUT_OF_RANGE", `整数部分超出最大值 ${MAX_INTEGER}`, null);
  }

  const amount = `${parsed.intValue.toString()}.${parsed.jiao}${parsed.fen}`;
  let regenerated: ReturnType<typeof amountToChinese>;
  try {
    regenerated = amountToChinese(amount);
  } catch (e) {
    if (e instanceof AmountError) return fail(base, e.code, e.message, e.position ?? null);
    throw e;
  }

  base.amount = amount;
  base.canonicalChinese = regenerated.chinese;
  base.groups = parsed.groups;
  base.jiao = parsed.jiao;
  base.fen = parsed.fen;

  if (regenerated.chinese !== input) {
    // 可解析但非规范：不静默当作成功
    return fail(
      base,
      "E_NONCANONICAL",
      `非规范写法：规范形式应为 "${regenerated.chinese}"`,
      firstDifferingPos(input, regenerated.chinese),
    );
  }

  base.valid = true;
  base.canonical = true;
  return base;
}

function fail(r: ParseReport, code: ErrorCode, message: string, position: number | null): ParseReport {
  r.valid = false;
  r.canonical = false;
  r.error = { code, message, position };
  return r;
}

function firstDifferingPos(a: string, b: string): number | null {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return i;
  }
  return null;
}

interface GroupParse {
  value: number; // 0-9999
  digits: number[]; // 长度 4
}

/**
 * 解析整数部分。offset 为该片段在原文中的起始下标（用于失败位置定位）。
 * 结构：[亿组 亿] [万组 万] [个组]，组间由跨组单位界定。
 */
function parseIntPart(text: string, offset: number): { value: bigint; groups: GroupExplanation[] } {
  if (text === "") {
    throw new AmountError("E_MALFORMED", '"元" 之前缺少整数金额', offset);
  }
  if (text === "零") {
    const groups = makeGroupsFromInt(0n);
    return { value: 0n, groups };
  }

  const yiIdx = text.indexOf("亿");
  const wanIdx = text.indexOf("万");

  let yiGroup: number | null = null;
  let wanGroup: number | null = null;
  let geGroup: number | null = null;

  if (yiIdx >= 0) {
    if (wanIdx >= 0 && wanIdx < yiIdx) {
      throw new AmountError("E_UNIT_ORDER", '"万" 出现在 "亿" 之前，单位次序错误', offset + wanIdx);
    }
    const yiText = text.slice(0, yiIdx);
    if (yiText === "") {
      throw new AmountError("E_MALFORMED", '"亿" 之前缺少数字', offset + yiIdx);
    }
    yiGroup = parseGroup(yiText, offset).value;

    const afterYi = text.slice(yiIdx + 1);
    if (afterYi === "") {
      wanGroup = 0;
      geGroup = 0;
    } else {
      const wIdx = afterYi.indexOf("万");
      if (wIdx >= 0) {
        const wanSeg = stripLeadZero(afterYi.slice(0, wIdx), offset + yiIdx + 1);
        const wanText = wanSeg.text;
        const geSeg = stripLeadZero(afterYi.slice(wIdx + 1), offset + yiIdx + 1 + wIdx + 1);
        const geText = geSeg.text;
        if (wanText === "") {
          throw new AmountError("E_MALFORMED", '"万" 之前缺少数字', wanSeg.zeroPos);
        }
        wanGroup = parseGroup(wanText, offset + yiIdx + 1).value;
        geGroup = geText === "" ? 0 : parseGroup(geText, geSeg.offset).value;
      } else {
        // 无万字，afterYi 整体是个组（空万组由跨组零体现）
        wanGroup = 0;
        const geSeg = stripLeadZero(afterYi, offset + yiIdx + 1);
        geGroup = parseGroup(geSeg.text, geSeg.offset).value;
      }
    }
  } else if (wanIdx >= 0) {
    const wanText = text.slice(0, wanIdx);
    const geSeg = stripLeadZero(text.slice(wanIdx + 1), offset + wanIdx + 1);
    const geText = geSeg.text;
    if (wanText === "") {
      throw new AmountError("E_MALFORMED", '"万" 之前缺少数字', offset + wanIdx);
    }
    wanGroup = parseGroup(wanText, offset).value;
    geGroup = geText === "" ? 0 : parseGroup(geText, geSeg.offset).value;
  } else {
    geGroup = parseGroup(text, offset).value;
  }

  const value =
    BigInt(yiGroup ?? 0) * 100000000n +
    BigInt(wanGroup ?? 0) * 10000n +
    BigInt(geGroup ?? 0);

  return { value, groups: makeGroupsFromInt(value) };
}

function makeGroupsFromInt(value: bigint): GroupExplanation[] {
  // 复用正向转换的分组逻辑以保证解释一致
  const regenerated = amountToChinese(`${value.toString()}.00`);
  return regenerated.groups;
}

/** 剥离组边界的单个跨组衔接零（规范形式中组间最多一个零）。 */
function stripLeadZero(text: string, offset: number): { text: string; offset: number; zeroPos: number } {
  if (text.startsWith("零")) {
    return { text: text.slice(1), offset: offset + 1, zeroPos: offset };
  }
  return { text, offset, zeroPos: offset };
}

/** 严格解析一个四位以内的数字组（不含跨组单位）。 */
function parseGroup(text: string, offset: number): GroupParse {
  if (text === "") {
    throw new AmountError("E_MALFORMED", "存在空的数字组", offset);
  }
  const digits = [0, 0, 0, 0];
  // 组内单位 -> 位下标（仟=0,佰=1,拾=2），个位数字无单位 -> 3
  const unitPos: Record<string, number> = { 仟: 0, 佰: 1, 拾: 2 };
  const usedPos = new Set<number>();
  let lastUnitPos = -1; // 已出现单位的最高位下标，后续单位必须严格更大（更低位）
  let pos = 0;

  while (pos < text.length) {
    const ch = text[pos]!;
    if (ch === "零") {
      // 零只能作为组内衔接，前后均为非零数字
      if (pos === 0 || pos === text.length - 1 || !DIGIT_CHARS.has(text[pos + 1]!)) {
        throw new AmountError("E_MALFORMED", '组内 "零" 只能衔接两个非零数字', offset + pos);
      }
      pos++;
      continue;
    }
    if (!DIGIT_CHARS.has(ch)) {
      if (ch === "仟" || ch === "佰" || ch === "拾") {
        // 此处不应出现单位：与上一单位相同为重复，否则为次序错误
        const prevUnit = text[pos - 1];
        if (prevUnit === ch) {
          throw new AmountError("E_DUPLICATE_UNIT", `组内单位 "${ch}" 重复`, offset + pos);
        }
        throw new AmountError("E_UNIT_ORDER", `组内单位 "${ch}" 前面缺少数字或单位次序错误`, offset + pos);
      }
      throw new AmountError("E_UNIT_ORDER", `组内意外字符 "${ch}"，单位次序错误`, offset + pos);
    }
    const value = DIGIT_VALUE[ch]!;
    pos++;
    let slot: number;
    const next = text[pos];
    if (next === "仟" || next === "佰" || next === "拾") {
      slot = unitPos[next]!;
      if (lastUnitPos !== -1 && slot <= lastUnitPos) {
        // 相同单位 -> 重复；顺序颠倒 -> 次序错误
        const code = slot === lastUnitPos ? "E_DUPLICATE_UNIT" : "E_UNIT_ORDER";
        throw new AmountError(code, `组内单位 "${next}" ${slot === lastUnitPos ? "重复" : "次序错误"}`, offset + pos);
      }
      if (usedPos.has(slot)) {
        throw new AmountError("E_DUPLICATE_UNIT", `组内单位 "${next}" 重复`, offset + pos);
      }
      usedPos.add(slot);
      lastUnitPos = slot;
      pos++;
    } else {
      slot = 3; // 个位
      if (usedPos.has(3)) {
        throw new AmountError("E_MALFORMED", "组内存在两个个位数字", offset + pos);
      }
      usedPos.add(3);
    }
    digits[slot] = value;
  }

  if (digits.every((d) => d === 0)) {
    throw new AmountError("E_MALFORMED", "数字组不能为空或全零", offset);
  }
  return { value: Number(digits.join("")), digits };
}

/** 解析元之后的小数后缀：元整 / X角整 / X角X分 / 零X分。 */
function parseFraction(text: string, offset: number): { jiao: number; fen: number } {
  if (text === "整") return { jiao: 0, fen: 0 };

  if (text.startsWith("零")) {
    const rest = text.slice(1);
  const m = /^([壹贰叁肆伍陆柒捌玖])分$/.exec(rest);
  if (!m) {
      throw new AmountError("E_MALFORMED", '"元零" 之后必须是 "X分"', offset + 1);
    }
    return { jiao: 0, fen: DIGIT_VALUE[m[1]!]! };
  }

  const m = /^([壹贰叁肆伍陆柒捌玖])角(?:整|([壹贰叁肆伍陆柒捌玖])分)$/.exec(text);
  if (m) {
    const jiao = DIGIT_VALUE[m[1]!]!;
    const fen = m[2] ? DIGIT_VALUE[m[2]]! : 0;
    return { jiao, fen };
  }

  throw new AmountError(
    "E_MALFORMED",
    '"元" 之后后缀只允许：整 / X角整 / X角X分 / 零X分',
    offset,
  );
}
