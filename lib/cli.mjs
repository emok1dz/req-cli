// req-cli 的核心：参数解析与校验、调用 CodeArts Req API、输出与退出码。
// 所有 I/O（env、fetch、stdout、stderr、当前时间）都通过 deps 注入，方便测试。
import { parseArgs } from 'node:util';
import { canonicalQuery, signRequest } from './signer.mjs';

export const VERSION = '1.0.0';

export const EXIT = { OK: 0, API_ERROR: 1, USAGE: 2, NETWORK: 3, CONFIG: 4 };

export const TRACKERS = { 2: 'Task', 3: 'Bug', 5: 'Epic', 6: 'Feature', 7: 'Story' };
export const PRIORITIES = { 1: '低', 2: '中', 3: '高' };
export const STATUSES = { 1: '新建', 2: '进行中', 3: '已解决', 4: '测试中', 5: '已关闭', 6: '已拒绝' };
export const SEVERITIES = { 10: '关键', 11: '重要', 12: '一般', 13: '提示' };

const fmtEnum = (m) => Object.entries(m).map(([k, v]) => `${k} ${v}`).join(' / ');

export const HELP = {
  root: `req-cli ${VERSION} — 华为云 CodeArts 需求管理命令行工具

用法:
  req-cli <命令> <子命令> [参数] [标志]

命令:
  issue create <title>   创建工作项（CreateIssueV4，POST /v4/projects/{project_id}/issue）
  project list           查询项目列表，用于获取 --project-id（ListProjectsV4，GET /v4/projects）

全局标志:
  --json                 以 JSON 输出（stdout），便于脚本与智能体解析
  -h, --help             显示帮助
  -v, --version          显示版本

环境变量:
  CODEARTS_REQ_ENDPOINT  需求管理终端节点，如 https://projectman-ext.cn-north-4.myhuaweicloud.com
  CODEARTS_REQ_AK        华为云访问密钥 Access Key Id
  CODEARTS_REQ_SK        华为云访问密钥 Secret Access Key（AK/SK 签名鉴权）

退出码:
  0 成功 | 1 API 返回错误 | 2 参数错误 | 3 网络异常 | 4 缺少配置

使用 "req-cli issue create --help" 查看具体命令的帮助。`,

  issueCreate: `用法:
  req-cli issue create <title> --project-id <uuid> --tracker <类型> --priority <级别> [选项]

创建一个工作项。<title> 为标题，1~512 个字符。

必填:
  --project-id <uuid>          项目 32 位 UUID（可用 "req-cli project list" 查询）
  --tracker <2|3|5|6|7>        工作项类型：${fmtEnum(TRACKERS)}
  --priority <1|2|3>           优先级：${fmtEnum(PRIORITIES)}

选填:
  --description <text>         工作项描述
  --status-id <1..6>           状态，默认 1：${fmtEnum(STATUSES)}
  --severity <10..13>          重要程度：${fmtEnum(SEVERITIES)}
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
  0 成功 | 1 API 返回错误 | 2 参数错误 | 3 网络异常 | 4 缺少配置`,

  projectList: `用法:
  req-cli project list [--search <关键词>] [--limit <1..1000>] [--offset <n>] [--json]

查询当前用户可见的项目，输出 project_id，供 "issue create --project-id" 使用。

选填:
  --search <text>    按名称或描述模糊搜索
  --limit <n>        每页条数，默认 20
  --offset <n>       分页起点，默认 0，须为 limit 的整数倍
  --json             以 JSON 输出
  -h, --help         显示本帮助

示例:
  req-cli project list --search Demo --json`,
};

export class CliError extends Error {
  constructor(code, message, exitCode, details = {}) {
    super(message);
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

const usage = (msg, help) => new CliError('INVALID_ARGUMENTS', msg, EXIT.USAGE, { help });

// ------------------------------------------------------------------ 参数校验

function intIn(name, value, allowed, help) {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw usage(`${name} 必须是整数，收到 "${value}"`, help);
  const n = Number(value);
  if (allowed && !(n in allowed)) throw usage(`${name} 取值非法："${value}"，可选 ${fmtEnum(allowed)}`, help);
  return n;
}

function date(name, value, help) {
  if (value === undefined) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (!m || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) throw usage(`${name} 必须是有效日期，格式 yyyy-mm-dd，收到 "${value}"`, help);
  return value;
}

/** issue create 的参数 → 请求体（不合法时抛 CliError，exit 2） */
export function buildIssueBody(positionals, v) {
  const help = HELP.issueCreate;
  if (positionals.length === 0) throw usage('缺少 <title>（工作项标题）', help);
  if (positionals.length > 1) throw usage(`标题只能有一个，收到多个：${positionals.map((p) => `"${p}"`).join(' ')}（含空格的标题请加引号）`, help);
  const title = positionals[0].trim();
  if (title.length < 1 || title.length > 512) throw usage('标题长度须为 1~512 个字符', help);

  const missing = ['project-id', 'tracker', 'priority'].filter((k) => v[k] === undefined);
  if (missing.length) throw usage(`缺少必填参数：${missing.map((k) => `--${k}`).join('、')}`, help);
  if (!/^[0-9a-zA-Z]{32}$/.test(v['project-id'])) throw usage(`--project-id 必须是 32 位字母数字组成的 UUID，收到 "${v['project-id']}"`, help);

  const body = {
    name: title,
    tracker_id: intIn('--tracker', v.tracker, TRACKERS, help),
    priority_id: intIn('--priority', v.priority, PRIORITIES, help),
    status_id: intIn('--status-id', v['status-id'] ?? '1', STATUSES, help),
  };
  const sev = intIn('--severity', v.severity, SEVERITIES, help);
  if (sev !== undefined) body.severity_id = sev;
  for (const [flag, key] of [['assigned-to', 'assigned_id'], ['parent-issue', 'parent_issue_id'], ['iteration', 'iteration_id']]) {
    const n = intIn(`--${flag}`, v[flag], null, help);
    if (n !== undefined) body[key] = n;
  }
  if (v.description !== undefined) {
    if (v.description.length > 200000) throw usage('--description 长度不能超过 200000', help);
    body.description = v.description;
  }
  const begin = date('--begin', v.begin, help);
  const end = date('--end', v.end, help);
  if (begin) body.begin_time = begin;
  if (end) body.end_time = end;
  if (begin && end && end < begin) throw usage(`--end（${end}）不能早于 --begin（${begin}）`, help);
  return { projectId: v['project-id'], body };
}

// ------------------------------------------------------------------ 配置与请求

export function loadConfig(env) {
  const endpoint = (env.CODEARTS_REQ_ENDPOINT || '').trim().replace(/\/+$/, '');
  const ak = (env.CODEARTS_REQ_AK || '').trim();
  const sk = (env.CODEARTS_REQ_SK || '').trim();
  const missing = [['CODEARTS_REQ_ENDPOINT', endpoint], ['CODEARTS_REQ_AK', ak], ['CODEARTS_REQ_SK', sk]].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    throw new CliError('MISSING_CONFIG', `缺少环境变量：${missing.join('、')}`, EXIT.CONFIG, {
      hint: 'PowerShell: $env:CODEARTS_REQ_AK="..."；bash: export CODEARTS_REQ_AK="..."（详见 README）',
    });
  }
  if (!/^https:\/\/[^/]+$/.test(endpoint)) throw new CliError('MISSING_CONFIG', `CODEARTS_REQ_ENDPOINT 格式不正确：${endpoint}（应形如 https://projectman-ext.cn-north-4.myhuaweicloud.com）`, EXIT.CONFIG);
  return { endpoint, ak, sk };
}

const HINTS = {
  400: '参数被服务端拒绝：检查 tracker 与父工作项的层级关系（Epic→Feature→Story→Task/Bug）、迭代/处理人 ID 是否属于该项目。',
  401: '鉴权失败：检查 AK/SK 是否正确、是否已停用，以及本机时间是否准确。',
  403: '无权限：确认已加入该项目，且 IAM 用户具备 codeartsreq:workitem:create 权限。',
  404: '资源不存在：检查 --project-id 是否正确，以及终端节点区域是否与项目所在区域一致。',
};

export async function request(cfg, { method, path, query, body }, deps) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== '') params.append(k, String(v));
  const qs = canonicalQuery(params);
  const url = `${cfg.endpoint}${path}${qs ? `?${qs}` : ''}`;
  const payload = body === undefined ? '' : JSON.stringify(body);
  const headers = signRequest({ method, url, headers: { 'Content-Type': 'application/json' }, body: payload, ak: cfg.ak, sk: cfg.sk, date: deps.now() });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 20000);
  let res;
  try {
    res = await deps.fetch(url, { method, headers, body: payload || undefined, signal: controller.signal });
  } catch (err) {
    const msg = err?.name === 'AbortError' ? '请求超时' : `无法连接 ${cfg.endpoint}：${err?.cause?.code || err?.message || err}`;
    throw new CliError('NETWORK_ERROR', msg, EXIT.NETWORK);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = null;
  }
  if (!res.ok || data === null) {
    throw new CliError('API_ERROR', `API 返回错误（HTTP ${res.status}）：${data?.error_msg || text.slice(0, 200)}`, EXIT.API_ERROR, {
      http_status: res.status,
      error_code: data?.error_code ?? null,
      error_msg: data?.error_msg ?? null,
      request_id: data?.request_id ?? null,
      hint: HINTS[res.status],
    });
  }
  return data;
}

const pick = (o) => (o ? { id: o.id, name: o.name } : null);

export function summarizeIssue(d, body) {
  return {
    id: d.id,
    name: d.name,
    tracker: pick(d.tracker) ?? { id: body.tracker_id, name: TRACKERS[body.tracker_id] },
    priority: pick(d.priority) ?? { id: body.priority_id, name: PRIORITIES[body.priority_id] },
    severity: pick(d.severity) ?? (body.severity_id ? { id: body.severity_id, name: SEVERITIES[body.severity_id] } : null),
    status: pick(d.status) ?? { id: body.status_id, name: STATUSES[body.status_id] },
    project_id: d.project?.project_id ?? null,
    assigned_user: d.assigned_user?.name ?? null,
    begin_time: d.begin_time ?? null,
    end_time: d.end_time ?? null,
    done_ratio: d.done_ratio ?? 0,
  };
}

// ------------------------------------------------------------------ 主入口

const GLOBAL_OPTS = { json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' } };
const ISSUE_OPTS = {
  ...GLOBAL_OPTS,
  'project-id': { type: 'string' }, tracker: { type: 'string' }, priority: { type: 'string' },
  description: { type: 'string' }, 'status-id': { type: 'string' }, severity: { type: 'string' },
  'assigned-to': { type: 'string' }, 'parent-issue': { type: 'string' }, iteration: { type: 'string' },
  begin: { type: 'string' }, end: { type: 'string' },
};
const PROJECT_OPTS = { ...GLOBAL_OPTS, search: { type: 'string' }, limit: { type: 'string' }, offset: { type: 'string' } };

export async function main(argv, deps = {}) {
  const d = {
    env: process.env, fetch: globalThis.fetch, now: () => new Date(),
    stdout: (s) => process.stdout.write(s + '\n'), stderr: (s) => process.stderr.write(s + '\n'), ...deps,
  };
  const wantsJson = argv.includes('--json');
  try {
    const [cmd, sub, ...rest] = argv;
    if (!cmd || cmd === '-h' || cmd === '--help') { d.stdout(HELP.root); return EXIT.OK; }
    if (cmd === '-v' || cmd === '--version') { d.stdout(VERSION); return EXIT.OK; }

    if (cmd === 'issue' && sub === 'create') return await issueCreate(rest, d, wantsJson);
    if (cmd === 'project' && sub === 'list') return await projectList(rest, d, wantsJson);
    if ((cmd === 'issue' || cmd === 'project') && (!sub || sub === '-h' || sub === '--help')) {
      d.stdout(cmd === 'issue' ? HELP.issueCreate : HELP.projectList);
      return EXIT.OK;
    }
    throw usage(`未知命令：${[cmd, sub].filter(Boolean).join(' ')}`, HELP.root);
  } catch (err) {
    return fail(err, d, wantsJson);
  }
}

function parse(args, options, help) {
  try {
    return parseArgs({ args, options, allowPositionals: true, strict: true });
  } catch (err) {
    throw usage(err.message.replace(/^Unknown option/, '未知参数').replace(/^Option '(.+?)' argument missing/, '参数 $1 缺少取值'), help);
  }
}

async function issueCreate(args, d, wantsJson) {
  const { values, positionals } = parse(args, ISSUE_OPTS, HELP.issueCreate);
  if (values.help) { d.stdout(HELP.issueCreate); return EXIT.OK; }
  const { projectId, body } = buildIssueBody(positionals, values); // 先校验参数
  const cfg = loadConfig(d.env); // 再读配置；缺配置不发请求
  const data = await request(cfg, { method: 'POST', path: `/v4/projects/${projectId}/issue`, body }, d);
  const issue = summarizeIssue(data, body);
  if (wantsJson) d.stdout(JSON.stringify(issue, null, 2));
  else d.stdout(`✔ 已创建工作项 #${issue.id}「${issue.name}」 类型 ${issue.tracker?.name} · 优先级 ${issue.priority?.name}${issue.severity ? ` · 重要程度 ${issue.severity.name}` : ''} · 状态 ${issue.status?.name}`);
  return EXIT.OK;
}

async function projectList(args, d, wantsJson) {
  const { values, positionals } = parse(args, PROJECT_OPTS, HELP.projectList);
  if (values.help) { d.stdout(HELP.projectList); return EXIT.OK; }
  if (positionals.length) throw usage(`project list 不接受位置参数：${positionals.join(' ')}`, HELP.projectList);
  const limit = intIn('--limit', values.limit ?? '20', null, HELP.projectList);
  const offset = intIn('--offset', values.offset ?? '0', null, HELP.projectList);
  if (limit < 1 || limit > 1000) throw usage('--limit 须为 1~1000', HELP.projectList);
  if (offset % limit !== 0) throw usage('--offset 须为 --limit 的整数倍', HELP.projectList);
  const cfg = loadConfig(d.env);
  const data = await request(cfg, { method: 'GET', path: '/v4/projects', query: { offset, limit, search: values.search } }, d);
  const projects = (data.projects || []).map((p) => ({ project_id: p.project_id, project_name: p.project_name, project_type: p.project_type }));
  if (wantsJson) d.stdout(JSON.stringify({ total: data.total ?? projects.length, projects }, null, 2));
  else d.stdout([`共 ${data.total ?? projects.length} 个项目`, ...projects.map((p) => `${p.project_id}  ${p.project_type?.padEnd(7) ?? ''}  ${p.project_name}`)].join('\n'));
  return EXIT.OK;
}

function fail(err, d, wantsJson) {
  const e = err instanceof CliError ? err : new CliError('INTERNAL_ERROR', String(err?.message || err), EXIT.API_ERROR);
  const { help, ...details } = e.details;
  if (wantsJson) d.stdout(JSON.stringify({ error: { code: e.code, message: e.message, ...details } }, null, 2));
  d.stderr(`错误 [${e.code}]：${e.message}`);
  if (details.hint) d.stderr(`提示：${details.hint}`);
  if (help && !wantsJson) d.stderr(`\n${help.split('\n').slice(0, 2).join('\n')}\n（使用 --help 查看完整帮助）`);
  return e.exitCode;
}
