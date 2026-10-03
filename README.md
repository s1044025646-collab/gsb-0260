# 人民币中文大写金额转换与规范写法核验（后端）

只做后端：TypeScript + Node.js + 内置 SQLite（`node:sqlite`，无需安装数据库）。
提供 HTTP API 与命令行（CLI），在 Windows 本地直接运行，**不依赖 Docker、WSL、付费服务或任何在线 API**。

## 环境要求

- Node.js **>= 22.5**（开发与实测环境为 Node v25.5；使用其内置的 `node:sqlite`）。
- npm。无需全局安装其他东西。

## 快速开始

```powershell
npm install
npm run build      # TypeScript 编译到 dist/
npm test           # 运行 vitest 测试（37 个用例）
npm start          # 启动 HTTP API，默认自动选择一个空闲端口
npm run demo       # CLI 内置演示
```

指定端口：

```powershell
$env:PORT="8080"; npm start
```

不设置 `PORT`（或 `PORT=0`）时监听操作系统分配的空闲端口，启动后在控制台打印实际地址，
例如 `http://127.0.0.1:49680`。仅绑定 `127.0.0.1`（本机）。

## 唯一规范化口径（规则版本 `rmb-upper-v1`）

本项目只承认下面这一套写法，**不接受各类民间简写、繁体异体字或其他记账习惯**。

1. **范围**：`0` 到 `999999999999.99`（含）。单位仅元、角、分。不支持负数、外币。
2. **字符集**（反向核验只接受这些字）：
   `零壹贰叁肆伍陆柒捌玖 拾佰仟万亿 元角分 整`。
3. **整数部分按四位一组**，从低到高为「个组、万组（万）、亿组（亿）」：
   - 组内位值固定为「仟、佰、拾」递降；
   - 某组为 0 且其后仍有非零组时，只在文本中保留**一个**「零」（跨组零不重复）；
   - 非零组数值不足 1000 时组前补**一个**「零」，例如 `10001 -> 壹万零壹元整`；
   - 跨亿位的空万组与跨万位零合并为同一个「零」，例如
     `100000001.00 -> 壹亿零壹元整`。
4. **小数/后缀固定规则**（本项目唯一选择）：
   - 整数金额（角、分皆 0）：以「**元整**」结尾；零金额固定为「**零元整**」；
   - 有角有分：`元X角Y分`，结尾**不加**「整」；
   - 有角无分：`元X角整`（**固定加「整」**）；
   - 有分无角：`元零Y分`（角位**固定补「零」**）。

确定例子：

| 数字金额 | 规范大写 |
| --- | --- |
| `1001.05` | `壹仟零壹元零伍分` |
| `100000001.00` | `壹亿零壹元整` |
| `0` | `零元整` |
| `0.50` | `零元伍角整` |
| `0.05` | `零元零壹分` |
| `10010` | `壹万零壹拾元整` |
| `100001000` | `壹亿零壹仟元整` |
| `999999999999.99` | `玖仟玖佰玖拾玖亿玖仟玖佰玖拾玖万玖仟玖佰玖拾玖元玖角玖分` |

## 数字金额输入规则

- 数字金额一律以**字符串**传输，按字符解析，**不经过浮点数**猜测精度。
- 外围空白：去除；内部空白、逗号等任何非数字字符：拒绝。
- 小数少于两位：按补零处理（`12.3 -> 12.30`）；**超过两位：拒绝，不自动舍入**。
- 前导零：允许并规范化（`001001.05 -> 1001.05`）。
- 不允许 `+`/`-`、指数、全角数字；负数直接拒绝。

## 反向核验如何保证严格

解析大写文字时先做结构检查并定位错误（非法字符、单位次序错误、重复单位、缺元、多元等），
随后**重新生成规范形式并与原文逐字比对**：

- 完全一致才返回成功金额；
- 可解析但非规范（如 `壹元叁分`、`壹拾贰元零叁角整`）返回 `NONCANONICAL_FORM`，
  消息里给出「规范形式应为…」，但**不会静默把错写文字当成成功金额**。

### 错误码

| 错误码 | 含义 |
| --- | --- |
| `EMPTY_INPUT` | 输入为空 |
| `INVALID_NUMBER` | 数字金额格式不合法（含内部空白、正号等） |
| `NEGATIVE_NOT_SUPPORTED` | 不支持负数 |
| `TOO_MANY_FRACTION_DIGITS` | 小数位超过两位（拒绝舍入） |
| `VALUE_OUT_OF_RANGE` | 超出 `0 ~ 999999999999.99` |
| `ILLEGAL_CHARACTER` | 含字符集之外的字 |
| `DUPLICATE_UNIT` | 位值/大单位或角重复（如 `壹亿亿万整`、`贰角叁角`） |
| `UNIT_ORDER_ERROR` | 单位次序错误（如 `壹万亿元整`、`壹仟佰元整`） |
| `MISSING_UNIT` | 单位前缺数字，或大组为空 |
| `MISSING_YUAN` / `DUPLICATE_YUAN` | 缺「元」/「元」出现多次 |
| `INVALID_ZERO_USAGE` | 「零」连用、结尾或后接位值 |
| `NONCANONICAL_FORM` | 能还原数值但不符合本项目规范写法 |

失败报告均带 `position`（去外围空白后原文中的 0 基下标）与 `token`。

## HTTP API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查 |
| POST | `/api/to-words` | `{"input":"1001.05"}` 数字 -> 大写 |
| POST | `/api/to-number` | `{"input":"壹仟零壹元零伍分"}` 大写 -> 数字（严格核验） |
| POST | `/api/batch` | `{"direction":"to-words","items":[...]}` 批量（1~500 条），逐条返回结果与 `failedIndexes` |
| GET | `/api/history?direction=&ok=&limit=&offset=` | 历史查询 |
| GET | `/api/history/{id}` | 单条完整报告 |
| GET | `/api/export` | 导出全部报告 JSON |

成功返回 HTTP 200；单条核验失败返回 HTTP **422**，响应体仍含完整失败原因与位置；
批量始终返回 200，由各条目自己的 `ok` 和顶层 `failedIndexes` 标出具体失败条目；
请求 JSON 非法等参数问题返回 400。每次调用（成功或失败）都写入 SQLite，
失败记录是独立的新行，**不会覆盖任何成功报告**。

PowerShell 调用示例：

```powershell
Invoke-RestMethod http://127.0.0.1:8080/api/to-words -Method POST `
  -ContentType 'application/json; charset=utf-8' -Body '{"input":"100000001.00"}'
```

## CLI

```powershell
node dist/cli/index.js to-words 1001.05
node dist/cli/index.js to-number "壹仟零壹元零伍分"
node dist/cli/index.js batch to-words examples/batch-to-words.json
node dist/cli/index.js history --fail -n 10
node dist/cli/index.js export data/export.json
node dist/cli/index.js demo
```

CLI 核验失败时退出码为 1，参数用法错误为 2，便于脚本判断。

## 数据目录

SQLite 数据库固定位于项目内：`data/rmb.sqlite`，首次运行自动创建。
表 `conversions` 保存：方向、输入、成功与否、规则版本 `rmb-upper-v1`、完整 JSON 报告与时间。
重启服务后历史与同一条目的分组解释仍可读取。

## 项目结构

```
src/core/constants.ts  规范口径、字符集、错误码（规则版本唯一来源）
src/core/types.ts      类型定义
src/core/amount.ts     字符串数值解析（零浮点）
src/core/encoder.ts    四位分组 + 跨组零 + 角分后缀编码
src/core/decoder.ts    严格结构解析 + 规范形式重新生成比对
src/core/service.ts    双向服务入口
src/db/store.ts        node:sqlite 持久化
src/api/server.ts      HTTP API
src/cli/index.ts       CLI 与演示
tests/core.test.ts     固定基准对、边界、错误顺序、小范围双向枚举
```

## 范围限制

- 仅人民币元/角/分，`0 ~ 999999999999.99`；不处理负数、外币、票据审批、会计记账场景。
- 只承认简体大写数字与上述单位字，不识别「两」「毛」「块」「正」或繁体等异体。
- 只提供 API 与 CLI，不含任何前端页面。
