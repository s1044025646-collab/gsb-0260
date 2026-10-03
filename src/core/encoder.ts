import { DIGITS, GROUP_UNITS, UNIT4 } from './constants.js';
import type { GroupExplanation, ParsedAmount } from './types.js';

/**
 * 单个四位组的组内大写。
 * 例：1001 -> 壹仟零壹；0101 -> 零壹佰零壹（调用方决定该前导零是否保留）；
 * 0010 -> 壹拾；0000 -> ''。
 */
function encodeGroupInner(groupDigits: string): string {
  let words = '';
  let pendingZero = false;
  let started = false;
  for (let pos = 0; pos < 4; pos += 1) {
    const d = Number(groupDigits[pos]);
    if (d === 0) {
      if (started) pendingZero = true;
      continue;
    }
    if (pendingZero) words += '零';
    words += DIGITS[d] + UNIT4[3 - pos];
    started = true;
    pendingZero = false;
  }
  return words;
}

export interface EncodeOutput {
  words: string;
  groups: GroupExplanation[];
  integerWords: string;
  fractionWords: string;
}

/** 将已解析金额编码为规范大写，并产出分组解释。 */
export function encodeAmount(amount: ParsedAmount): EncodeOutput {
  const groups: GroupExplanation[] = [];
  for (let g = 2; g >= 0; g -= 1) {
    const start = (2 - g) * 4;
    const digits = amount.integer.slice(start, start + 4);
    groups.push({
      index: g,
      digits,
      value: Number(digits),
      unit: GROUP_UNITS[g],
      innerWords: encodeGroupInner(digits),
      leadingZero: false,
    });
  }

  let integerWords = '';
  let emitted = false;
  let gapZero = false;
  for (const group of groups) {
    if (group.value === 0) {
      if (emitted) gapZero = true;
      continue;
    }
    group.leadingZero = emitted && (gapZero || group.value < 1000);
    if (group.leadingZero) integerWords += '零';
    integerWords += group.innerWords + group.unit;
    emitted = true;
    gapZero = false;
  }

  const j = Number(amount.jiao);
  const f = Number(amount.fen);
  let fractionWords: string;
  if (j === 0 && f === 0) {
    fractionWords = '元整';
  } else if (j > 0 && f > 0) {
    fractionWords = `元${DIGITS[j]}角${DIGITS[f]}分`;
  } else if (j > 0 && f === 0) {
    fractionWords = `元${DIGITS[j]}角整`;
  } else {
    fractionWords = `元零${DIGITS[f]}分`;
  }

  if (integerWords === '' && j === 0 && f === 0) {
    return { words: '零元整', groups, integerWords: '', fractionWords: '元整' };
  }

  const head = integerWords === '' ? '零' : integerWords;
  return {
    words: head + fractionWords,
    groups,
    integerWords,
    fractionWords,
  };
}
