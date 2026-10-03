#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defaultDbPath, ReportStore } from '../db/store.js';
import { toNumber, toWords } from '../core/service.js';
import type { ConvertResult, GroupExplanation } from '../core/types.js';

function printResult(result: ConvertResult): void {
  if (result.ok) {
    console.log(`原文    : ${result.input}`);
    console.log(`规范金额: ${result.normalized}`);
    console.log(`规范大写: ${result.words}`);
    console.log('分组解释:');
    for (const group of result.groups as GroupExplanation[]) {
      const label = group.unit === '' ? '个组' : `${group.unit}组`;
      if (group.value === 0) {
        console.log(`  [${label}] ${group.digits} = 0（空组，仅在需要时并入跨组零）`);
      } else {
        console.log(`  [${label}] ${group.digits} -> ${group.leadingZero ? '零' : ''}${group.innerWords}${group.unit}`);
      }
    }
    console.log(`小数部分: 角=${result.fraction.jiao} 分=${result.fraction.fen} -> ${result.fraction.words}`);
    console.log(`规则版本: ${result.ruleVersion}`);
  } else {
    const pos = result.failure.position;
    console.log(`原文    : ${result.input}`);
    console.log(`结果    : 失败`);
    console.log(`错误码  : ${result.failure.code}`);
    console.log(`原因    : ${result.failure.message}`);
    if (pos !== undefined) {
      const trimmed = result.input.trim();
      console.log(`位置    : 第 ${pos} 个字符（0 基）「${trimmed[pos] ?? ''}」`);
      console.log(`          ${trimmed}`);
      console.log(`          ${' '.repeat(Math.max(pos, 0))}^`);
    }
    if (result.failure.token && result.failure.position === undefined) {
      console.log(`出错片段: ${result.failure.token}`);
    }
    process.exitCode = 1;
  }
}

function usage(): void {
  console.log([
    '人民币中文大写金额转换与核验 CLI',
    '',
    '用法:',
    '  rmb to-words <数字金额字符串>      数字金额 -> 规范大写',
    '  rmb to-number <大写文字>          规范大写 -> 数字金额（严格核验）',
    '  rmb batch <direction> <json文件>  批量核验，文件内容为字符串数组',
    '  rmb history [--ok|--fail] [-n 条数]',
    '  rmb export [输出文件路径]          导出全部历史报告 JSON（默认打印到终端）',
    '  rmb demo                          运行内置演示用例',
  ].join('\n'));
}

function runBatch(direction: 'to-words' | 'to-number', file: string): void {
  const store = new ReportStore(defaultDbPath());
  let items: unknown;
  try {
    items = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    console.error(`批量文件读取失败: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
  if (!Array.isArray(items)) {
    console.error('批量文件内容必须是 JSON 字符串数组，例如 ["1001.05","零元整"]');
    process.exit(2);
  }
  let failed = 0;
  items.forEach((raw, index) => {
    if (typeof raw !== 'string') {
      console.log(`#${index} 失败: 该条目不是字符串（${JSON.stringify(raw)}）`);
      failed += 1;
      return;
    }
    const result = direction === 'to-words' ? toWords(raw) : toNumber(raw);
    const id = store.save(result);
    if (result.ok) {
      console.log(`#${index} [id=${id}] ${raw}  =>  ${result.normalized}  ${result.words}`);
    } else {
      failed += 1;
      const pos = result.failure.position === undefined ? '' : ` @${result.failure.position}`;
      console.log(`#${index} [id=${id}] 失败: ${raw}  =>  ${result.failure.code}${pos} ${result.failure.message}`);
    }
  });
  console.log(`\n共 ${items.length} 条，成功 ${items.length - failed} 条，失败 ${failed} 条（失败条目不覆盖任何成功报告，全部独立入库）。`);
  store.close();
  if (failed > 0) process.exitCode = 1;
}

function runHistory(args: string[]): void {
  const store = new ReportStore(defaultDbPath());
  const ok = args.includes('--ok') ? true : args.includes('--fail') ? false : undefined;
  const nIndex = args.indexOf('-n');
  const limit = nIndex !== -1 ? Number(args[nIndex + 1]) || 20 : 20;
  const rows = store.list({ ok, limit });
  for (const row of rows) {
    console.log(`[${row.id}] ${row.direction} ok=${row.ok === 1} 输入=${JSON.stringify(row.input)} 时间=${row.created_at}`);
  }
  if (rows.length === 0) console.log('（暂无历史记录）');
  store.close();
}

const DEMO_CASES: Array<{ direction: 'to-words' | 'to-number'; input: string }> = [
  { direction: 'to-words', input: '100' },
  { direction: 'to-words', input: '0.50' },
  { direction: 'to-words', input: '0.05' },
  { direction: 'to-words', input: '10010' },
  { direction: 'to-words', input: '100001000' },
  { direction: 'to-number', input: '壹佰元壹角壹分' },
  { direction: 'to-number', input: '壹佰元壹角整' },
  { direction: 'to-number', input: '壹佰亿零壹元整' },
  { direction: 'to-number', input: '壹亿亿万整' },
];

function runDemo(): void {
  const store = new ReportStore(defaultDbPath());
  for (const demoCase of DEMO_CASES) {
    const result = demoCase.direction === 'to-words' ? toWords(demoCase.input) : toNumber(demoCase.input);
    store.save(result);
    console.log('----------------------------------------');
    printResult(result);
  }
  console.log('----------------------------------------');
  store.close();
}

const [command, ...rest] = process.argv.slice(2);

if (command === 'to-words' && rest[0] !== undefined) {
  printResult(toWords(rest[0]));
} else if (command === 'to-number' && rest[0] !== undefined) {
  printResult(toNumber(rest[0]));
} else if (command === 'batch' && (rest[0] === 'to-words' || rest[0] === 'to-number') && rest[1]) {
  runBatch(rest[0], resolve(process.cwd(), rest[1]));
} else if (command === 'history') {
  runHistory(rest);
} else if (command === 'export') {
  const store = new ReportStore(defaultDbPath());
  const all = store.list({ limit: 100000 });
  const text = JSON.stringify(all.map((row) => JSON.parse(row.report)), null, 2);
  if (rest[0]) {
    writeFileSync(resolve(process.cwd(), rest[0]), text, 'utf8');
    console.log(`已导出 ${all.length} 条报告到 ${rest[0]}`);
  } else {
    console.log(text);
  }
  store.close();
} else if (command === 'demo') {
  runDemo();
} else {
  usage();
  process.exitCode = 2;
}
