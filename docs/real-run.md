# 真实运行记录

- 时间：2026-11-06 （UTC）
- 区域：华东-上海一（cn-east-3），`CODEARTS_REQ_ENDPOINT=https://projectman-ext.cn-east-3.myhuaweicloud.com`
- 项目：TestDemo（project_id `d9b02289185448db8ceec7115f15327b`）
- 凭证通过环境变量注入，本文件不含 AK/SK。

## 1. --help

```text
$ node req-cli.mjs issue create --help
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

## 2. 创建工作项

```text
$ node req-cli.mjs project list
共 1 个项目
d9b02289185448db8ceec7115f15327b  scrum    TestDemo

$ node req-cli.mjs issue create "登录页白屏" --project-id d9b02289185448db8ceec7115f15327b --tracker 3 --priority 3 --json
{
  "id": 713668353,
  "name": "登录页白屏",
  "tracker": {
    "id": 3,
    "name": "Bug"
  },
  "priority": {
    "id": 3,
    "name": "高"
  },
  "severity": {
    "id": 12,
    "name": "一般"
  },
  "status": {
    "id": 1,
    "name": "新建"
  },
  "project_id": "d9b02289185448db8ceec7115f15327b",
  "assigned_user": "hid_wk_461e2jr6dis3",
  "begin_time": "",
  "end_time": "",
  "done_ratio": 0
}
$ echo $?
0
```

## 3. 智能体驱动

由一个**全新的智能体**完成：事先不了解本工具，也不读源码和 README，只能运行 `--help`。给它的指令是：

> 用 req-cli 在我的项目里创建一个 Bug：标题"首页加载缓慢"，优先级高，重要程度一般，描述写"打开首页加载缓慢"。

智能体依次执行的命令：

```text
node req-cli.mjs --help
node req-cli.mjs issue create --help
node req-cli.mjs project list --help
node req-cli.mjs project list --search TestDemo --json
node req-cli.mjs issue create "首页加载缓慢" --project-id d9b02289185448db8ceec7115f15327b --tracker 3 --priority 3 --severity 12 --description "打开首页加载缓慢" --json
```

输出（退出码 0）：

```json
{
  "id": 713668355,
  "name": "首页加载缓慢",
  "tracker": {"id": 3, "name": "Bug"},
  "priority": {"id": 3, "name": "高"},
  "severity": {"id": 12, "name": "一般"},
  "status": {"id": 1, "name": "新建"},
  "project_id": "d9b02289185448db8ceec7115f15327b",
  "done_ratio": 0
}
```

智能体从 `--help` 推断参数的依据：
- 总帮助说明 `project list` 用于获取 `--project-id`，于是先按名称搜索项目；
- “Bug” → `--tracker 3`（帮助中列出“3 Bug”）；
- “优先级高” → `--priority 3`（“1 低 / 2 中 / 3 高”）；
- “重要程度一般” → `--severity 12`（“10 关键 / 11 重要 / 12 一般 / 13 提示”）；
- 标题作为位置参数传入，`--json` 用于取得结构化输出。

**结论**：只靠 `--help` 中的约定，智能体就选对了子命令和全部参数，一次创建成功。

## 4. 控制台核对

在 CodeArts 需求管理控制台的 TestDemo 项目中，应能看到两条 Bug：
- #713668353「登录页白屏」，优先级 高
- #713668355「首页加载缓慢」，优先级 高，重要程度 一般
