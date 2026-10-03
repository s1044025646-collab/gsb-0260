// 人民币中文大写金额核心转换模块
// 规则版本：RMB-CAPS-RULES-1.0（唯一规范化口径，详见 README）

export const RULE_VERSION = "RMB-CAPS-RULES-1.0";

export const MAX_INTEGER = 999_999_999_999; // 999999999999.99

export const DIGITS = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"] as const;
// 组内位值：个(空)、拾、佰、仟
const INTRA_UNITS = ["", "拾", "佰", "仟"] as const;
// 四位一组，从低到高的跨组单位：个(空)、万、亿
const GROUP_UNITS = ["", "万", "亿"] as const;

export type ErrorCode =
  | "E_EMPTY"
  | "E_INVALID_NUMBER"
  | "E_PRECISION_EXCEEDED"
  | "E_OUT_OF_RANGE"
  | "E_ILLEGAL_CHAR"
  | "E_UNIT_ORDER"
  | "E_DUPLICATE_UNIT"
  | "E_MALFORMED"
  | "E_NONCANONICAL";

export class AmountError extends Error {
  code: ErrorCode;
  position?: number;
  constructor(code: ErrorCode, message: string, position?: number) {
    super(message);
    this.name = "AmountError";
    this.code = code;
    this.position = position;
  }
}

export interface GroupExplanation {
  /** 组序号，0 为个组，1 为万组，2 为亿组 */
  groupIndex: number;
  /** 跨组单位："" / "万" / "亿" */
  groupUnit: string;
  /** 该组四位原始数字，如 "0001" */
  rawDigits: string;
  /** 该组数值 0-9999 */
  value: number;
  /** 组内大写（不含跨组单位），全零组为 "" */
  intraText: string;
}

/** 将规范十进制金额字符串转换为中文大写，同时返回分组解释（正向）。 */
export function amountToChinese(input: string): {
  amount: string;
  chinese: string;
  groups: GroupExplanation[];
  jiao: number;
  fen: number;
} {
  const normalized = normalizeNumericInput(input);
  const signless = normalized;

  let intPart: string;
  let decPart: string;
  if (signless.includes(".")) {
    const [a, b] = signPart(signless);
    intPart = a;
    decPart = (b ?? "").padEnd(2, "0");
  } else {
    intPart = signless;
    decPart = "00";
  }

  // 公开前导零规则：允许前导零，按数值规范化（"001.2" -> "1.20"）
  intPart = intPart.replace(/^0+(?=\d)/, "");
  const jiao = Number(decPart[0]);
  const fen = Number(decPart[1]);

  if ([...intPart].length > 12 || BigInt(intPart) > BigInt(MAX_INTEGER)) {
    throw new AmountError(
      "E_OUT_OF_RANGE",
      `超出允许范围（0 到 ${MAX_INTEGER}.99）：${intPart}`,
    );
  }

  const amount = `${intPart}.${decPart}`;

  const digitVals = [...intPart].map((c) => Number(c));
  const groups = buildGroups(digitVals);

  let intText = "";
  let lastEmittedGroup = -1;
  for (let g = groups.length - 1; g >= 0; g--) {
    const info = groups[g]!;
    if (info.value === 0) continue;
    if (lastEmittedGroup !== -1) {
      const gap = lastEmittedGroup - g;
      // 跨组补零：中间存在空组，或本组不足四位（千位为 0）
      if (gap > 1 || info.value < 1000) intText += "零";
    }
    intText += info.intraText + info.groupUnit;
    lastEmittedGroup = g;
  }
  if (intText === "") intText = "零";

  let suffix: string;
  if (jiao === 0 && fen === 0) suffix = "元整";
  else if (jiao !== 0 && fen === 0) suffix = `元${DIGITS[jiao]}角整`;
  else if (jiao !== 0 && fen !== 0) suffix = `元${DIGITS[jiao]}角${DIGITS[fen]}分`;
  else suffix = `元零${DIGITS[fen]}分`; // 有分无角补零

  return { amount, chinese: intText + suffix, groups, jiao, fen };
}

function signPart(s: string): [string, string | undefined] {
  const idx = s.indexOf(".");
  return [s.slice(0, idx), s.slice(idx + 1)];
}

/** 校验并规范化数字入参：去外围空白；拒绝非数字字符、多小数点、超过两位小数。 */
export function normalizeNumericInput(raw: string): string {
  if (typeof raw !== "string") {
    throw new AmountError("E_INVALID_NUMBER", "金额必须以字符串传输");
  }
  const s = raw.trim(); // 公开规则：允许并去除外围空白
  if (s === "") throw new AmountError("E_EMPTY", "输入为空");
  if (!/^\d+(\.\d+)?$/.test(s)) {
    // 细分常见错误，给出明确原因
    if (/^[-+]/.test(s)) {
      const idx = s.search(/[-+]/);
      throw new AmountError("E_INVALID_NUMBER", "不支持负数或正负号", idx);
    }
    const bad = [...s].findIndex((c) => !/[\d.]/.test(c));
    if (bad >= 0) {
      throw new AmountError("E_INVALID_NUMBER", `非法字符 "${s[bad]}"，只允许数字与小数点`, bad);
    }
    throw new AmountError("E_INVALID_NUMBER", "数字格式不正确（小数点至多一个，且整数部分不可为空）");
  }
  const decimals = s.includes(".") ? s.slice(s.indexOf(".") + 1) : "";
  if (decimals.length > 2) {
    throw new AmountError(
      "E_PRECISION_EXCEEDED",
      `小数部分最多两位，收到 ${decimals.length} 位；不自动舍入`,
      s.indexOf(".") + 3,
    );
  }
  return s;
}

function buildGroups(digitVals: number[]): GroupExplanation[] {
  // 从右向左每四位一组
  const groups: GroupExplanation[] = [];
  const total = digitVals.length;
  let groupIndex = 0;
  for (let end = total; end > 0; end -= 4) {
    const start = Math.max(0, end - 4);
    const slice = digitVals.slice(start, end);
    const padded = Array(4 - slice.length).fill(0).concat(slice);
    const rawDigits = padded.join("");
    const value = Number(rawDigits);
    groups.push({
      groupIndex,
      groupUnit: (GROUP_UNITS[groupIndex] ?? "") as string,
      rawDigits,
      value,
      intraText: renderIntraGroup(padded),
    });
    groupIndex++;
  }
  if (groups.length === 0) {
    groups.push({
      groupIndex: 0,
      groupUnit: "",
      rawDigits: "0000",
      value: 0,
      intraText: "",
    });
  }
  return groups;
}

/** 组内转换：按 仟/佰/拾/个 输出位值，连续零合并，去掉组尾零。 */
function renderIntraGroup(padded: number[]): string {
  let out = "";
  for (let pos = 0; pos < 4; pos++) {
    const d = padded[pos]!;
    if (d === 0) {
      if (!out.endsWith("零") && out !== "") out += "零";
    } else {
      out += DIGITS[d] + (INTRA_UNITS[3 - pos] ?? "");
    }
  }
  return out.replace(/零+$/, "");
}
