/**
 * 本项目唯一规范化口径（规则版本：rmb-upper-v1）
 *
 * 1. 数值范围：0 ~ 999999999999.99（含两端），仅人民币元/角/分，不支持负数。
 * 2. 大写数字仅允许：零壹贰叁肆伍陆柒捌玖；位值仅允许：拾佰仟万亿；货币单位：元角分；整。
 * 3. 整数部分按四位一组，自低到高为「个组（无大单位）、万组（万）、亿组（亿）」。
    - 每组组内按「仟佰拾」位值表示；
    - 某组为零且其后存在非零组时，最终文本只保留一个「零」，不重复；
    - 非零组数值不足 1000 时，组前补一个「零」（如 10001 -> 壹万零壹元整）。
 4. 固定后缀规则（本项目唯一口径）：
    - 整数金额（角、分均为 0）：以「元整」结尾；
    - 0 元：零元整；
    - 有角有分：X角Y分，结尾不加「整」；
    - 有角无分：X角整（固定加「整」）；
    - 有分无角：元零Y分（角位固定补「零」）。
 * 5. 数字金额以字符串传输，按字符解析，不经过浮点数。
 *    - 外围空白：去除；内部空白或逗号等分隔符：拒绝；
 *    - 小数位少于 2 位按补零处理；超过 2 位拒绝（不舍入）；
 *    - 整数部分前导零允许，按数值规范化（001.5 -> 1.50）；
 *    - 不允许正号、负号、指数、全角数字等写法。
 */

export const RULE_VERSION = 'rmb-upper-v1';

export const MAX_VALUE = 999_999_999_999_99; // 以「分」为单位

export const DIGITS = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'] as const;

export const UNIT4 = ['', '拾', '佰', '仟'] as const;

export const GROUP_UNITS = ['', '万', '亿'] as const;

/** 合法大写字符集合（用于反向核验的字符检查）。 */
export const LEGAL_CHARS = new Set<string>([
  ...DIGITS,
  '拾', '佰', '仟', '万', '亿',
  '元', '角', '分', '整',
]);

export type ErrorCode =
  | 'OK'
  | 'INVALID_NUMBER'
  | 'NEGATIVE_NOT_SUPPORTED'
  | 'TOO_MANY_FRACTION_DIGITS'
  | 'VALUE_OUT_OF_RANGE'
  | 'EMPTY_INPUT'
  | 'ILLEGAL_CHARACTER'
  | 'DUPLICATE_UNIT'
  | 'UNIT_ORDER_ERROR'
  | 'MISSING_UNIT'
  | 'MISSING_YUAN'
  | 'DUPLICATE_YUAN'
  | 'INVALID_ZERO_USAGE'
  | 'NONCANONICAL_FORM';

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  OK: '成功',
  INVALID_NUMBER: '数字金额格式不合法',
  NEGATIVE_NOT_SUPPORTED: '不支持负数金额',
  TOO_MANY_FRACTION_DIGITS: '小数位超过两位，拒绝自动舍入',
  VALUE_OUT_OF_RANGE: '金额超出允许范围 0 ~ 999999999999.99',
  EMPTY_INPUT: '输入为空',
  ILLEGAL_CHARACTER: '含非法字符（仅允许零壹贰叁肆伍陆柒捌玖拾佰仟万亿元角分整）',
  DUPLICATE_UNIT: '位值/大单位重复',
  UNIT_ORDER_ERROR: '单位次序错误',
  MISSING_UNIT: '数字缺少对应位值单位',
  MISSING_YUAN: '缺少「元」分隔位',
  DUPLICATE_YUAN: '「元」出现多次',
  INVALID_ZERO_USAGE: '「零」使用不规范（零后不可接位值）',
  NONCANONICAL_FORM: '文字可解析但与规范形式不一致',
};
