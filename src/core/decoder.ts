import { DIGITS, LEGAL_CHARS } from './constants.js';
import { encodeAmount } from './encoder.js';
import type { FailureInfo, ParsedAmount } from './types.js';
import { MAX_VALUE } from './constants.js';

type Fail = FailureInfo;

const digitValue = (ch: string): number => DIGITS.indexOf(ch as never);

interface SegmentResult {
  value: number;
}

const UNIT_POS: Record<string, number> = { 仟: 3, 佰: 2, 拾: 1 };

/**
 * 解析单个四位组片段（不含「万」「亿」），base 为片段在整体字符串中的起始下标。
 * 只接受编码器产出的严格组内形式。
 */
function parseSegment(seg: string, base: number): SegmentResult | Fail {
  if (seg === '') return { value: 0 };
  let i = 0;
  let lastPos = 4;
  let zeroPending = false;
  let value = 0;
  while (i < seg.length) {
    const ch = seg[i];
    if (ch === '零') {
      if (i === 0 || zeroPending === false) {
        // 允许：段首零（低位组补零），或两个位值之间的跨位零。
      }
      if (zeroPending) {
        return { code: 'INVALID_ZERO_USAGE', message: '「零」连续出现', position: base + i, token: '零' };
      }
      zeroPending = true;
      i += 1;
      continue;
    }
    const dv = digitValue(ch);
    if (dv >= 0) {
      let pos = 0;
      if (i + 1 < seg.length && seg[i + 1] in UNIT_POS) {
        pos = UNIT_POS[seg[i + 1]];
        i += 1;
      }
      if (pos >= lastPos) {
        return { code: 'UNIT_ORDER_ERROR', message: '组内位值次序错误（须为仟佰拾递降）', position: base + i, token: seg[i] };
      }
      if (zeroPending && lastPos !== 4 && lastPos - pos < 2) {
        return { code: 'INVALID_ZERO_USAGE', message: '相邻位值之间不应出现「零」', position: base + i - 1, token: '零' };
      }
      value += dv * 10 ** pos;
      lastPos = pos;
      zeroPending = false;
      i += 1;
      continue;
    }
    if (ch in UNIT_POS) {
      if (lastPos !== 4) {
        return { code: 'UNIT_ORDER_ERROR', message: '位值单位次序错误或重复', position: base + i, token: ch };
      }
      return { code: 'MISSING_UNIT', message: '位值单位前缺少数字', position: base + i, token: ch };
    }
    return { code: 'UNIT_ORDER_ERROR', message: '组内出现意外单位', position: base + i, token: ch };
  }
  if (zeroPending) {
    return { code: 'INVALID_ZERO_USAGE', message: '「零」不可结尾', position: base + seg.length - 1, token: '零' };
  }
  return { value };
}

function isFail(x: unknown): x is Fail {
  return typeof x === 'object' && x !== null && 'code' in x;
}

/** 解析角分片段（「元」之后的部分），start 为「元」之后的下标。 */
function parseFraction(
  seg: string,
  start: number,
): { jiao: number; fen: number; noncanonical?: boolean } | Fail {
  if (seg === '整') return { jiao: 0, fen: 0 };
  if (seg === '') return { code: 'NONCANONICAL_FORM', message: '整数金额须以「元整」结尾', position: start };
  let i = 0;
  let jiao = -1;
  let fen = -1;
  if (seg[0] === '零') {
    if (seg.length !== 3 || seg[2] !== '分' || digitValue(seg[1]) < 0) {
      // 形如「零X角整」：数值可还原（角=X），但写法非规范，交调用方做规范形式比对。
      if (/^零[壹贰叁肆伍陆柒捌玖]角整$/.test(seg)) {
        return { jiao: digitValue(seg[1]), fen: 0, noncanonical: true };
      }
      return { code: 'UNIT_ORDER_ERROR', message: '有分无角的规范形式为「元零X分」', position: start + i, token: seg[i] };
    }
    return { jiao: 0, fen: digitValue(seg[1]) };
  }
  while (i < seg.length) {
    const dv = digitValue(seg[i]);
    if (dv < 0) {
      return { code: 'UNIT_ORDER_ERROR', message: '角分部分单位次序错误', position: start + i, token: seg[i] };
    }
    const unit = seg[i + 1];
    if (unit === '角') {
      if (jiao !== -1) return { code: 'DUPLICATE_UNIT', message: '「角」重复', position: start + i + 1, token: '角' };
      jiao = dv;
      i += 2;
      const next = seg[i];
      if (next === undefined) {
        return { jiao, fen: 0, noncanonical: true };
      }
      if (next === '整') {
        if (i + 1 !== seg.length) return { code: 'UNIT_ORDER_ERROR', message: '「整」后不允许再有字符', position: start + i + 1, token: seg[i + 1] };
        return { jiao, fen: 0 };
      }
      const fv = digitValue(next);
      if (fv >= 0 && seg[i + 1] === '角') {
        return { code: 'DUPLICATE_UNIT', message: '「角」重复', position: start + i + 1, token: '角' };
      }
      if (fv < 0 || seg[i + 1] !== '分') {
        return { code: 'UNIT_ORDER_ERROR', message: '角之后只允许「X分」或「整」', position: start + i, token: next };
      }
      fen = fv;
      i += 2;
      if (i !== seg.length) return { code: 'UNIT_ORDER_ERROR', message: '「分」后不允许再有字符', position: start + i, token: seg[i] };
      return { jiao, fen };
    }
      if (unit === '分') {
        if (jiao !== -1) return { code: 'UNIT_ORDER_ERROR', message: '分不可位于角之前', position: start + i + 1, token: '分' };
        return { jiao: 0, fen: dv, noncanonical: true };
      }
    return { code: 'UNIT_ORDER_ERROR', message: '角分部分单位次序错误', position: start + i + 1, token: unit };
  }
  return { code: 'UNIT_ORDER_ERROR', message: '角分部分不完整', position: start + i, token: seg[i - 1] };
}

export interface DecodeOutcome {
  amount: ParsedAmount;
  canonicalWords: string;
}

/** 严格解析大写文字；失败返回带位置的错误。 */
export function decodeWords(rawInput: string): DecodeOutcome | Fail {
  const trimmed = rawInput == null ? '' : String(rawInput).trim();
  if (trimmed === '') return { code: 'EMPTY_INPUT', message: '输入为空' };

  for (let i = 0; i < trimmed.length; i += 1) {
    if (!LEGAL_CHARS.has(trimmed[i])) {
      return { code: 'ILLEGAL_CHARACTER', message: `非法字符「${trimmed[i]}」`, position: i, token: trimmed[i] };
    }
  }

  // 大单位「亿」「万」在规范形式中最多各出现一次（角分部分不使用它们）。
  for (const big of ['亿', '万'] as const) {
    const first = trimmed.indexOf(big);
    if (first !== -1) {
      const second = trimmed.indexOf(big, first + 1);
      if (second !== -1) {
        return { code: 'DUPLICATE_UNIT', message: `「${big}」重复`, position: second, token: big };
      }
    }
  }

  const yuanPositions: number[] = [];
  for (let i = 0; i < trimmed.length; i += 1) {
    if (trimmed[i] === '元') yuanPositions.push(i);
  }
  if (yuanPositions.length === 0) return { code: 'MISSING_YUAN', message: '缺少「元」分隔位', position: trimmed.length };
  if (yuanPositions.length > 1) return { code: 'DUPLICATE_YUAN', message: '「元」出现多次', position: yuanPositions[1], token: '元' };

  const yuanAt = yuanPositions[0];
  const intSeg = trimmed.slice(0, yuanAt);
  const fracSeg = trimmed.slice(yuanAt + 1);

  const frac = parseFraction(fracSeg, yuanAt + 1);
  if (isFail(frac)) return frac;

  let intValue: bigint;
  if (intSeg === '零') {
    intValue = 0n;
  } else {
    if (intSeg === '') {
      return { code: 'NONCANONICAL_FORM', message: '整数部分缺失（零元应写作「零元整」）', position: 0 };
    }
    const yiAt = intSeg.indexOf('亿');
    const wanAt = intSeg.indexOf('万');
    if (wanAt !== -1 && yiAt !== -1 && wanAt < yiAt) {
      return { code: 'UNIT_ORDER_ERROR', message: '「万」不可位于「亿」之前', position: wanAt, token: '万' };
    }

    let yiPart = 0;
    let wanPart = 0;
    let gePart = 0;
    let rest = intSeg;
    let base = 0;
    const cutYi = rest.indexOf('亿');
    if (cutYi !== -1) {
      const r = parseSegment(rest.slice(0, cutYi), base);
      if (isFail(r)) return r;
      if (r.value === 0) return { code: 'MISSING_UNIT', message: '「亿」组为空', position: cutYi, token: '亿' };
      yiPart = r.value;
      rest = rest.slice(cutYi + 1);
      base += cutYi + 1;
    }
    const cutWan = rest.indexOf('万');
    if (cutWan !== -1) {
      const r = parseSegment(rest.slice(0, cutWan), base);
      if (isFail(r)) return r;
      if (r.value === 0) return { code: 'MISSING_UNIT', message: '「万」组为空', position: base + cutWan, token: '万' };
      wanPart = r.value;
      rest = rest.slice(cutWan + 1);
      base += cutWan + 1;
    }
    const gr = parseSegment(rest, base);
    if (isFail(gr)) return gr;
    gePart = gr.value;
    intValue = BigInt(yiPart) * 100000000n + BigInt(wanPart) * 10000n + BigInt(gePart);
  }

  const totalCents = intValue * 100n + BigInt(frac.jiao) * 10n + BigInt(frac.fen);
  if (totalCents > MAX_VALUE) return { code: 'VALUE_OUT_OF_RANGE', message: '金额超出允许范围 0 ~ 999999999999.99' };

  const intNorm = intValue.toString();
  const amount: ParsedAmount = {
    integer: intNorm.padStart(12, '0'),
    jiao: String(frac.jiao),
    fen: String(frac.fen),
    normalized: `${intNorm}.${frac.jiao}${frac.fen}`,
    totalCents,
  };
  const canonical = encodeAmount(amount);
  if (canonical.words !== trimmed) {
    let pos = 0;
    while (pos < trimmed.length && trimmed[pos] === canonical.words[pos]) pos += 1;
    return {
      code: 'NONCANONICAL_FORM',
      message: `非规范写法；规范形式应为「${canonical.words}」`,
      position: Math.min(pos, trimmed.length - 1),
      token: trimmed[pos] ?? trimmed[trimmed.length - 1],
    };
  }
  return { amount, canonicalWords: canonical.words };
}
