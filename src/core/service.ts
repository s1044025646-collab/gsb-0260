import { ERROR_MESSAGES, RULE_VERSION } from './constants.js';
import { decodeWords } from './decoder.js';
import { encodeAmount } from './encoder.js';
import { parseNumberAmount } from './amount.js';
import type { ConvertResult } from './types.js';

/** 数字金额 -> 规范大写。 */
export function toWords(input: string): ConvertResult {
  const parsed = parseNumberAmount(input);
  if (!parsed.ok) {
    const code = parsed.code!;
    return {
      ok: false,
      direction: 'to-words',
      input: input ?? '',
      ruleVersion: RULE_VERSION,
      failure: {
        code,
        message: ERROR_MESSAGES[code],
        position: parsed.position,
        token: parsed.token,
      },
    };
  }
  const encoded = encodeAmount(parsed.amount!);
  return {
    ok: true,
    direction: 'to-words',
    input: String(input),
    normalized: parsed.amount!.normalized,
    words: encoded.words,
    groups: encoded.groups,
    fraction: {
      jiao: parsed.amount!.jiao,
      fen: parsed.amount!.fen,
      words: encoded.fractionWords,
    },
    ruleVersion: RULE_VERSION,
  };
}

/** 规范大写 -> 数字金额（严格核验，非规范写法失败而非静默纠正）。 */
export function toNumber(input: string): ConvertResult {
  const decoded = decodeWords(input);
  if (!('amount' in decoded)) {
    return {
      ok: false,
      direction: 'to-number',
      input: input ?? '',
      ruleVersion: RULE_VERSION,
      failure: decoded,
    };
  }
  const encoded = encodeAmount(decoded.amount);
  return {
    ok: true,
    direction: 'to-number',
    input: String(input).trim(),
    normalized: decoded.amount.normalized,
    words: encoded.words,
    groups: encoded.groups,
    fraction: {
      jiao: decoded.amount.jiao,
      fen: decoded.amount.fen,
      words: encoded.fractionWords,
    },
    ruleVersion: RULE_VERSION,
  };
}
