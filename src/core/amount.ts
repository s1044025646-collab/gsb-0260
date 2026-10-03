import { MAX_VALUE } from './constants.js';
import type { ParsedAmount } from './types.js';

export interface NumberParseOutcome {
  ok: boolean;
  /** 失败码（与 constants.ErrorCode 中的子集对应）。 */
  code?: 'EMPTY_INPUT' | 'NEGATIVE_NOT_SUPPORTED' | 'INVALID_NUMBER'
    | 'TOO_MANY_FRACTION_DIGITS' | 'VALUE_OUT_OF_RANGE';
  position?: number;
  token?: string;
  amount?: ParsedAmount;
}

const DIGIT_RE = /^[0-9]$/;

/**
 * 解析数字金额字符串。
 * 规则：去外围空白；拒绝内部空白/逗号；负号拒绝；前导零允许；
 * 小数少于两位补零，超过两位拒绝；范围 0 ~ 999999999999.99。
 */
export function parseNumberAmount(rawInput: string): NumberParseOutcome {
  if (rawInput == null) {
    return { ok: false, code: 'EMPTY_INPUT' };
  }
  const input = String(rawInput);
  const trimmed = input.trim();
  if (trimmed === '') {
    return { ok: false, code: 'EMPTY_INPUT' };
  }

  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === '-') {
      return { ok: false, code: 'NEGATIVE_NOT_SUPPORTED', position: i, token: ch };
    }
    if (ch === '+') {
      return { ok: false, code: 'INVALID_NUMBER', position: i, token: ch };
    }
    if (ch !== '.' && !DIGIT_RE.test(ch)) {
      return { ok: false, code: 'INVALID_NUMBER', position: i, token: ch };
    }
  }

  const dotCount = trimmed.split('.').length - 1;
  if (dotCount > 1) {
    const secondDot = trimmed.indexOf('.', trimmed.indexOf('.') + 1);
    return { ok: false, code: 'INVALID_NUMBER', position: secondDot, token: '.' };
  }

  let intPart: string;
  let fracPart: string;
  const dotIndex = trimmed.indexOf('.');
  if (dotIndex === -1) {
    intPart = trimmed;
    fracPart = '';
  } else {
    intPart = trimmed.slice(0, dotIndex);
    fracPart = trimmed.slice(dotIndex + 1);
  }

  if (intPart === '' && fracPart === '') {
    return { ok: false, code: 'INVALID_NUMBER', token: trimmed };
  }
  if (intPart === '') intPart = '0';
  if (intPart.length > 12) {
    return { ok: false, code: 'VALUE_OUT_OF_RANGE' };
  }
  if (fracPart.length > 2) {
    return { ok: false, code: 'TOO_MANY_FRACTION_DIGITS', position: dotIndex + 3, token: fracPart[2] };
  }

  const intNorm = intPart.replace(/^0+(?=.)/, '');
  const paddedInt = intNorm.padStart(12, '0');
  const jiao = fracPart.length >= 1 ? fracPart[0] : '0';
  const fen = fracPart.length === 2 ? fracPart[1] : '0';
  const normalized = `${intNorm}.${jiao}${fen}`;

  let totalCents: bigint = BigInt(intNorm) * 100n + BigInt(jiao) * 10n + BigInt(fen);
  if (totalCents > MAX_VALUE) {
    return { ok: false, code: 'VALUE_OUT_OF_RANGE' };
  }
  if (totalCents < 0n) totalCents = 0n; // 防御性，负数已在前面拒绝

  return {
    ok: true,
    amount: { integer: paddedInt, jiao, fen, normalized, totalCents },
  };
}
