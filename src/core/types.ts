import type { ErrorCode } from './constants.js';

/** 规范化后的金额各部分（均为字符串，避免浮点处理）。 */
export interface ParsedAmount {
  /** 12 位定长整数字符串，如 '000000001001'。 */
  integer: string;
  /** 角，'0'~'9'。 */
  jiao: string;
  /** 分，'0'~'9'。 */
  fen: string;
  /** 规范数字金额，如 '1001.05'。 */
  normalized: string;
  /** 以分为单位的整数值，用于范围比较。 */
  totalCents: bigint;
}

export interface GroupExplanation {
  /** 组序号：0=个组，1=万组，2=亿组。 */
  index: number;
  /** 本组的四位数字，如 '1001'。 */
  digits: string;
  /** 本组数值（整数）。 */
  value: number;
  /** 组大单位：'' / '万' / '亿'。 */
  unit: string;
  /** 本组组内大写，全零组为空串。 */
  innerWords: string;
  /** 该组是否在最终文本前补「零」。 */
  leadingZero: boolean;
}

export interface ConvertSuccess {
  ok: true;
  direction: 'to-words' | 'to-number';
  input: string;
  normalized: string;
  words: string;
  groups: GroupExplanation[];
  fraction: { jiao: string; fen: string; words: string };
  ruleVersion: string;
}

export interface FailureInfo {
  code: ErrorCode;
  message: string;
  /** 出错字符在「去除外围空白后的原文」中的位置（0 基）。 */
  position?: number;
  /** 出错片段（如非法字符或出错单位）。 */
  token?: string;
}

export interface ConvertFailure {
  ok: false;
  direction: 'to-words' | 'to-number';
  input: string;
  failure: FailureInfo;
  ruleVersion: string;
}

export type ConvertResult = ConvertSuccess | ConvertFailure;
