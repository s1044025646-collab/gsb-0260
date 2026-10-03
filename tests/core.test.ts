import { describe, expect, it } from 'vitest';
import { toWords } from '../src/core/service.js';
import { toNumber } from '../src/core/service.js';

// 人工固定的「数字金额 -> 规范大写」基准文字对（非由实现自动生成）。
const FIXED_PAIRS: Array<[string, string]> = [
  ['0', '零元整'],
  ['0.00', '零元整'],
  ['10', '壹拾元整'],
  ['100', '壹佰元整'],
  ['1000', '壹仟元整'],
  ['10000', '壹万元整'],
  ['10001', '壹万零壹元整'],
  ['100010001', '壹亿零壹万零壹元整'],
  ['1001.05', '壹仟零壹元零伍分'],
  ['100000001.00', '壹亿零壹元整'],
  ['999999999999.99', '玖仟玖佰玖拾玖亿玖仟玖佰玖拾玖万玖仟玖佰玖拾玖元玖角玖分'],
  ['0.10', '零元壹角整'],
  ['0.01', '零元零壹分'],
  ['5.55', '伍元伍角伍分'],
  ['10010', '壹万零壹拾元整'],
];

describe('数字金额 -> 大写（人工基准对）', () => {
  for (const [input, expected] of FIXED_PAIRS) {
    it(`${input} => ${expected}`, () => {
      const result = toWords(input);
      expect(result.ok, result.ok ? '' : result.failure.message).toBe(true);
      if (result.ok) expect(result.words).toBe(expected);
    });
  }
});

describe('补零、去空白与前导零规则', () => {
  it('一位小数补零：12.3 => 12.30 壹拾贰元叁角整', () => {
    const r = toWords('12.3');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.normalized).toBe('12.30');
      expect(r.words).toBe('壹拾贰元叁角整');
    }
  });
  it('外围空白去除，内部空白拒绝', () => {
    const ok = toWords('  42.00  ');
    expect(ok.ok).toBe(true);
    const bad = toWords('1 00');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.failure.code).toBe('INVALID_NUMBER');
  });
  it('前导零规范化：001001.05', () => {
    const r = toWords('001001.05');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.normalized).toBe('1001.05');
      expect(r.words).toBe('壹仟零壹元零伍分');
    }
  });
  it('超过两位小数拒绝且不舍入', () => {
    const r = toWords('1.999');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.code).toBe('TOO_MANY_FRACTION_DIGITS');
  });
  it('负数拒绝', () => {
    const r = toWords('-3.00');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.code).toBe('NEGATIVE_NOT_SUPPORTED');
  });
  it('越界拒绝', () => {
    const r = toWords('1000000000000.00');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.code).toBe('VALUE_OUT_OF_RANGE');
  });
});

describe('大写 -> 数字（反向核验）', () => {
  it('基准对全部可反向解析为原规范金额', () => {
    for (const [num, words] of FIXED_PAIRS) {
      const r = toNumber(words);
      expect(r.ok, `${words}: ${r.ok ? '' : r.failure.message}`).toBe(true);
      if (r.ok) {
        const expectedNum = num.includes('.') ? num : `${num}.00`;
        expect(r.normalized).toBe(expectedNum);
      }
    }
  });

  const failures: Array<[string, string, string]> = [
    ['壹2元整', 'ILLEGAL_CHARACTER', '非法字符'],
    ['壹元贰角叁角', 'DUPLICATE_UNIT', '角重复'],
    ['壹亿亿万整', 'DUPLICATE_UNIT', '亿重复'],
    ['壹万亿元整', 'UNIT_ORDER_ERROR', '万亿次序'],
    ['壹元叁分', 'NONCANONICAL_FORM', '有分无角须补零'],
    ['壹元贰角', 'NONCANONICAL_FORM', '有角无分固定加整'],
    ['壹仟佰元整', 'UNIT_ORDER_ERROR', '组内单位次序'],
    ['壹拾拾元整', 'UNIT_ORDER_ERROR', '重复位值次序'],
    ['壹零零元整', 'INVALID_ZERO_USAGE', '连续零'],
    ['壹元', 'NONCANONICAL_FORM', '整数须元整'],
    ['壹元元整', 'DUPLICATE_YUAN', '多元'],
    ['壹角整', 'MISSING_YUAN', '缺元'],
  ];

  for (const [input, code, note] of failures) {
    it(`拒绝「${input}」(${note})`, () => {
      const r = toNumber(input);
      expect(r.ok, `应当失败: ${note}`).toBe(false);
      if (!r.ok) {
        expect(r.failure.code).toBe(code);
        expect(typeof r.failure.position === 'number').toBe(true);
      }
    });
  }

  it('非规范但可解析的写法不静默成功，且返回规范形式提示', () => {
    const r = toNumber('壹拾贰元零叁角整');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.code).toBe('NONCANONICAL_FORM');
      expect(r.failure.message).toContain('壹拾贰元叁角整');
    }
  });
});

describe('小范围双向独立验证（枚举核对）', () => {
  it('0.00 ~ 9.99 逐分枚举：编码后必须能反向且分组零衔接正确', () => {
    for (let cents = 0; cents < 1000; cents += 1) {
      const normalized = `${Math.floor(cents / 100)}.${String(Math.floor((cents % 100) / 10))}${cents % 10}`;
      const forward = toWords(normalized);
      expect(forward.ok, normalized).toBe(true);
      if (!forward.ok) continue;
      expect(forward.words.includes('零零')).toBe(false);
      const backward = toNumber(forward.words);
      expect(backward.ok, `${forward.words}: ${backward.ok ? '' : backward.failure.message}`).toBe(true);
      if (backward.ok) expect(backward.normalized).toBe(normalized);
    }
  });

  it('整百整千与十的固定文字', () => {
    expect((toWords('20').ok && (toWords('20') as { words: string }).words)).toBe('贰拾元整');
    expect((toWords('200').ok && (toWords('200') as { words: string }).words)).toBe('贰佰元整');
    expect((toWords('2000').ok && (toWords('2000') as { words: string }).words)).toBe('贰仟元整');
  });
});
