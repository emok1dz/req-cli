import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildIssueBody, EXIT, main } from '../lib/cli.mjs';

const PID = '526cefde62004de2b62b5e8dd2c2b3af';
const ENV = { CODEARTS_REQ_ENDPOINT: 'https://projectman-ext.cn-north-4.myhuaweicloud.com', CODEARTS_REQ_AK: 'AK123', CODEARTS_REQ_SK: 'SK456' };
const ISSUE = {
  id: 1377843, name: '登录页白屏', done_ratio: 0,
  tracker: { id: 3, name: 'Bug' }, priority: { id: 3, name: '高' }, severity: { id: 12, name: '一般' }, status: { id: 1, name: '新建' },
  project: { project_id: PID, project_name: 'Demo' },
};

/** 运行 CLI，收集 stdout/stderr/请求 */
async function run(argv, { env = ENV, status = 200, body = ISSUE, raw, throws } = {}) {
  const out = [], err = [], calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, ...init });
    if (throws) throw throws;
    return new Response(raw ?? JSON.stringify(body), { status });
  };
  const code = await main(argv, { env, fetch, now: () => new Date(Date.UTC(2026, 10, 3)), stdout: (s) => out.push(s), stderr: (s) => err.push(s) });
  return { code, out: out.join('\n'), err: err.join('\n'), calls };
}

const create = (...extra) => ['issue', 'create', '登录页白屏', '--project-id', PID, '--tracker', '3', '--priority', '3', ...extra];

describe('--help 与版本', () => {
  test('无参数显示总帮助，退出码 0', async () => {
    const r = await run([]);
    assert.equal(r.code, 0);
    assert.match(r.out, /issue create <title>/);
    assert.match(r.out, /CODEARTS_REQ_ENDPOINT/);
    assert.match(r.out, /退出码/);
  });
  test('issue create --help 列出必填/选填标志、示例与退出码', async () => {
    const r = await run(['issue', 'create', '--help']);
    assert.equal(r.code, 0);
    for (const s of ['--project-id', '--tracker', '--priority', '--description', '--status-id', '--severity', '--assigned-to', '--parent-issue', '--iteration', '--begin', '--end', '--json', '示例', '3 Bug', '12 一般']) {
      assert.ok(r.out.includes(s), `帮助缺少 ${s}`);
    }
    assert.equal(r.calls.length, 0);
  });
  test('-h 简写、project list --help、--version', async () => {
    assert.match((await run(['issue', 'create', '-h'])).out, /用法/);
    assert.match((await run(['project', 'list', '--help'])).out, /--search/);
    assert.equal((await run(['--version'])).out, '1.0.0');
  });
});

describe('issue create 成功路径', () => {
  test('构造 POST /v4/projects/{id}/issue 请求体与签名', async () => {
    const r = await run(create('--severity', '12', '--description', '打开首页加载缓慢', '--begin', '2026-11-01', '--end', '2026-11-30', '--assigned-to', '4091', '--iteration', '11302238'));
    assert.equal(r.code, EXIT.OK);
    const c = r.calls[0];
    assert.equal(c.method, 'POST');
    assert.equal(c.url, `https://projectman-ext.cn-north-4.myhuaweicloud.com/v4/projects/${PID}/issue`);
    assert.deepEqual(JSON.parse(c.body), {
      name: '登录页白屏', tracker_id: 3, priority_id: 3, status_id: 1, severity_id: 12,
      assigned_id: 4091, iteration_id: 11302238, description: '打开首页加载缓慢', begin_time: '2026-11-01', end_time: '2026-11-30',
    });
    assert.match(c.headers.Authorization, /^SDK-HMAC-SHA256 Access=AK123, SignedHeaders=content-type;host;x-sdk-date, Signature=[0-9a-f]{64}$/);
    assert.equal(c.headers['X-Sdk-Date'], '20261103T000000Z');
    assert.match(r.out, /已创建工作项 #1377843「登录页白屏」 类型 Bug · 优先级 高 · 重要程度 一般 · 状态 新建/);
  });
  test('--json 输出可解析的结构化结果', async () => {
    const r = await run(create('--json'));
    const j = JSON.parse(r.out);
    assert.equal(j.id, 1377843);
    assert.deepEqual(j.tracker, { id: 3, name: 'Bug' });
    assert.deepEqual(j.status, { id: 1, name: '新建' });
    assert.equal(j.project_id, PID);
    assert.equal(r.err, '');
  });
  test('--json 可以写在任意位置', async () => {
    const r = await run(['issue', 'create', '--json', 'T', '--project-id', PID, '--tracker', '2', '--priority', '1']);
    assert.equal(r.code, 0);
    assert.equal(JSON.parse(r.out).id, 1377843);
  });
  test('子工作项：--parent-issue', async () => {
    const r = await run(create('--parent-issue', '1679822'));
    assert.equal(JSON.parse(r.calls[0].body).parent_issue_id, 1679822);
  });
});

describe('参数错误 → 退出码 2，stderr 中文提示，不发请求', () => {
  const cases = [
    ['缺标题', ['issue', 'create', '--project-id', PID, '--tracker', '3', '--priority', '3'], /缺少 <title>/],
    ['多个位置参数', ['issue', 'create', '登录页', '白屏', '--project-id', PID, '--tracker', '3', '--priority', '3'], /含空格的标题请加引号/],
    ['缺 --project-id', ['issue', 'create', 'T', '--tracker', '3', '--priority', '3'], /缺少必填参数：--project-id/],
    ['缺多个必填', ['issue', 'create', 'T', '--project-id', PID], /--tracker、--priority/],
    ['project-id 格式', ['issue', 'create', 'T', '--project-id', 'abc', '--tracker', '3', '--priority', '3'], /32 位/],
    ['tracker 非法', create().map((x) => (x === '3' ? '4' : x)), /--tracker 取值非法/],
    ['priority 非法', ['issue', 'create', 'T', '--project-id', PID, '--tracker', '3', '--priority', '5'], /--priority 取值非法/],
    ['severity 非法', create('--severity', '9'), /--severity 取值非法/],
    ['status 非法', create('--status-id', '7'), /--status-id 取值非法/],
    ['数字参数非整数', create('--assigned-to', 'abc'), /--assigned-to 必须是整数/],
    ['日期格式', create('--begin', '2026/11/01'), /yyyy-mm-dd/],
    ['日期不存在', create('--end', '2026-02-30'), /有效日期/],
    ['结束早于开始', create('--begin', '2026-11-10', '--end', '2026-11-01'), /不能早于/],
    ['未知标志', create('--foo', 'x'), /未知参数/],
    ['标志缺值', ['issue', 'create', 'T', '--project-id'], /缺少取值|未知参数|argument missing/],
    ['未知命令', ['issue', 'delete'], /未知命令/],
    ['标题过长', ['issue', 'create', 'x'.repeat(513), '--project-id', PID, '--tracker', '3', '--priority', '3'], /1~512/],
  ];
  for (const [name, argv, re] of cases) {
    test(name, async () => {
      const r = await run(argv);
      assert.equal(r.code, EXIT.USAGE, r.err);
      assert.match(r.err, re);
      assert.equal(r.calls.length, 0);
    });
  }
  test('--json 时错误也输出 JSON', async () => {
    const r = await run(['issue', 'create', 'T', '--project-id', PID, '--json']);
    assert.equal(r.code, EXIT.USAGE);
    assert.equal(JSON.parse(r.out).error.code, 'INVALID_ARGUMENTS');
  });
});

describe('配置、API 与网络错误', () => {
  test('缺配置 → 退出码 4，不发请求', async () => {
    const r = await run(create(), { env: {} });
    assert.equal(r.code, EXIT.CONFIG);
    assert.match(r.err, /CODEARTS_REQ_ENDPOINT、CODEARTS_REQ_AK、CODEARTS_REQ_SK/);
    assert.equal(r.calls.length, 0);
  });
  test('终端节点格式错误 → 退出码 4', async () => {
    const r = await run(create(), { env: { ...ENV, CODEARTS_REQ_ENDPOINT: 'projectman-ext.cn-north-4.myhuaweicloud.com' } });
    assert.equal(r.code, EXIT.CONFIG);
  });
  test('API 400 → 退出码 1，透传 error_code/error_msg', async () => {
    const r = await run(create('--json'), { status: 400, body: { error_code: 'PM.02177501', error_msg: 'tracker parent invalid' } });
    assert.equal(r.code, EXIT.API_ERROR);
    const e = JSON.parse(r.out).error;
    assert.deepEqual([e.http_status, e.error_code, e.error_msg], [400, 'PM.02177501', 'tracker parent invalid']);
    assert.match(r.err, /HTTP 400/);
  });
  test('API 401 → 提示检查 AK/SK', async () => {
    const r = await run(create(), { status: 401, body: { error_code: 'APIGW.0301', error_msg: 'Incorrect IAM authentication information', request_id: 'rid' } });
    assert.equal(r.code, EXIT.API_ERROR);
    assert.match(r.err, /AK\/SK/);
  });
  test('非 JSON 响应 → 退出码 1', async () => {
    const r = await run(create(), { status: 502, raw: '<html>Bad Gateway</html>' });
    assert.equal(r.code, EXIT.API_ERROR);
    assert.match(r.err, /Bad Gateway/);
  });
  test('网络异常 → 退出码 3', async () => {
    const r = await run(create(), { throws: new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }) });
    assert.equal(r.code, EXIT.NETWORK);
    assert.match(r.err, /ENOTFOUND/);
  });
  test('错误信息中不出现 SK', async () => {
    const r = await run(create('--json'), { status: 401, body: { error_code: 'APIGW.0301', error_msg: 'x' } });
    assert.ok(!(r.out + r.err).includes('SK456'));
  });
});

describe('project list', () => {
  test('GET /v4/projects 并输出 project_id', async () => {
    const r = await run(['project', 'list', '--search', 'Demo 项目', '--json'], { body: { total: 1, projects: [{ project_id: PID, project_name: 'Demo', project_type: 'scrum' }] } });
    assert.equal(r.code, 0);
    assert.equal(r.calls[0].method, 'GET');
    assert.equal(r.calls[0].url, 'https://projectman-ext.cn-north-4.myhuaweicloud.com/v4/projects?limit=20&offset=0&search=Demo%20%E9%A1%B9%E7%9B%AE');
    assert.equal(JSON.parse(r.out).projects[0].project_id, PID);
  });
  test('offset 不是 limit 整数倍 → 退出码 2', async () => {
    assert.equal((await run(['project', 'list', '--offset', '5'])).code, EXIT.USAGE);
  });
});

test('buildIssueBody 纯函数：默认状态 1（新建）', () => {
  assert.equal(buildIssueBody(['T'], { 'project-id': PID, tracker: '7', priority: '2' }).body.status_id, 1);
});
