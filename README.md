# req-cli 需求管理命令行工具

ICT 大赛实践赛题 **1.11「CLI-如何将华为云服务封装成CLI」** 作品。

`req-cli` 把华为云 **CodeArts 需求管理**的「创建工作项」API（4.8.16 CreateIssueV4，`POST /v4/projects/{project_id}/issue`）封装成一条命令。它对人、脚本、智能体都友好：子命令清晰、`--help` 完整、支持 `--json`、退出码可区分错误类型。工具使用 AK/SK 签名鉴权，**不依赖任何第三方包**。

## 好 CLI 的六要素在本工具中的落地

| 要素 | 实现 |
| --- | --- |
| 清晰的子命令 | `req-cli issue create <title>`（做什么）；另有 `req-cli project list` 用于查 project_id |
| 完整的 --help | 总帮助、`issue create --help`、`project list --help`，每个都有用法、参数说明、示例和退出码 |
| 参数与标志 | 位置参数放标题；标志放控制项。API 文档中的“必选/取值范围”逐一翻译成必填标志和校验（枚举、32 位 UUID、yyyy-mm-dd 日期、结束不早于开始） |
| 正确的退出码 | `0` 成功 · `1` API 错误 · `2` 参数错误 · `3` 网络异常 · `4` 缺少配置 |
| 结构化输出 | `--json` 输出 id、name、tracker、priority、severity、status 等；出错时也输出 `{"error":{...}}` |
| 错误写到 stderr | 中文错误原因和处理提示写到 stderr；API 错误透传 error_code / error_msg / request_id |

## 安装

需要 Node.js 18 或更高版本，没有其他依赖。

```bash
git clone https://github.com/emok1dz/req-cli.git && cd req-cli
node req-cli.mjs --help        # 直接运行
npm link                       # 可选：注册为全局命令 req-cli
```

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `CODEARTS_REQ_ENDPOINT` | 需求管理终端节点，例如 `https://projectman-ext.cn-north-4.myhuaweicloud.com` |
| `CODEARTS_REQ_AK` | 华为云访问密钥 Access Key Id |
| `CODEARTS_REQ_SK` | 华为云访问密钥 Secret Access Key |

PowerShell：
```powershell
$env:CODEARTS_REQ_ENDPOINT = "https://projectman-ext.cn-north-4.myhuaweicloud.com"
$env:CODEARTS_REQ_AK       = "你的Access Key Id"
$env:CODEARTS_REQ_SK       = "你的Secret Access Key"
```

bash：
```bash
export CODEARTS_REQ_ENDPOINT="https://projectman-ext.cn-north-4.myhuaweicloud.com"
export CODEARTS_REQ_AK="你的Access Key Id"
export CODEARTS_REQ_SK="你的Secret Access Key"
```

AK/SK 获取方式：华为云控制台 → 我的凭证 → 访问密钥 → 新增访问密钥。**不要**把 AK/SK 写进代码或提交到仓库。

## 用法

```text
用法:
  req-cli issue create <title> --project-id <uuid> --tracker <类型> --priority <级别> [选项]

创建一个工作项。<title> 为标题，1~512 个字符。

必填:
  --project-id <uuid>          项目 32 位 UUID（可用 "req-cli project list" 查询）
  --tracker <2|3|5|6|7>        工作项类型：2 Task / 3 Bug / 5 Epic / 6 Feature / 7 Story
  --priority <1|2|3>           优先级：1 低 / 2 中 / 3 高

选填:
  --description <text>         工作项描述
  --status-id <1..6>           状态，默认 1：1 新建 / 2 进行中 / 3 已解决 / 4 测试中 / 5 已关闭 / 6 已拒绝
  --severity <10..13>          重要程度：10 关键 / 11 重要 / 12 一般 / 13 提示
  --assigned-to <n>            处理人数字 id
  --parent-issue <n>           父工作项 ID（创建子工作项时使用）
  --iteration <n>              迭代 ID
  --begin <yyyy-mm-dd>         开始日期
  --end <yyyy-mm-dd>           结束日期（不早于开始日期）
  --json                       以 JSON 输出响应（id、name、tracker、priority、status 等）
  -h, --help                   显示本帮助

示例:
  req-cli issue create "登录页白屏" --project-id 526cefde62004de2b62b5e8dd2c2b3af --tracker 3 --priority 3 --json
  req-cli issue create "首页加载缓慢" --project-id <uuid> --tracker 3 --priority 3 --severity 12 --description "打开首页加载缓慢"

退出码:
  0 成功 | 1 API 返回错误 | 2 参数错误 | 3 网络异常 | 4 缺少配置
```

```bash
# 1. 找到项目 ID
node req-cli.mjs project list --search Demo

# 2. 创建一个 Bug
node req-cli.mjs issue create "登录页白屏" --project-id <项目ID> --tracker 3 --priority 3 --json
echo $?        # 0 表示成功（PowerShell 用 $LASTEXITCODE）

# 3. 在脚本里组合使用
node req-cli.mjs issue create "首页加载缓慢" --project-id <项目ID> --tracker 3 --priority 3 --severity 12 --json \
  && echo "创建成功" || echo "创建失败，退出码 $?"
```

## 让智能体驱动

因为接口约定清楚，智能体不看源码，只读 `--help` 就能正确调用。例如对智能体说：

> 用 req-cli 在我的项目里创建一个 Bug：标题“首页加载缓慢”，优先级高，重要程度一般，描述写“打开首页加载缓慢”。

它会翻译成：

```bash
node req-cli.mjs issue create "首页加载缓慢" --project-id <项目ID> --tracker 3 --priority 3 --severity 12 --description "打开首页加载缓慢" --json
```

## 测试

```bash
npm test
```

共 46 个用例，全部使用假 `fetch` 或子进程运行，不访问云服务：

| 测试文件 | 覆盖内容 |
| --- | --- |
| `test/signer.test.mjs` | AK/SK 签名：与华为云官方 Python SDK 的签名结果逐字节比对 |
| `test/cli.test.mjs` | 帮助内容、请求构造、`--json`、17 种参数错误、缺配置、API 400/401/502、网络异常、SK 不泄露、project list |
| `test/e2e.test.mjs` | 以子进程运行：真实退出码，以及 stdout / stderr 分流 |

用假 AK/SK 请求真实接口时，会返回 `HTTP 401 APIGW.0301`，退出码为 1，并给出鉴权提示。这说明签名和请求链路正常。

## 目录结构

```
req-cli.mjs        入口（bin）
lib/cli.mjs        命令解析、参数校验、调用 API、输出与退出码
lib/signer.mjs     AK/SK 签名（SDK-HMAC-SHA256）
test/              node:test 测试
docs/              真实运行记录（运行后填写）
```
