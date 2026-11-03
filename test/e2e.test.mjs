// 端到端：以子进程方式运行 req-cli.mjs，验证真实的退出码与 stdout/stderr 分流（不访问网络）。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'req-cli.mjs');
const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CODEARTS_REQ_')));
const cli = (args, env = {}) => spawnSync(process.execPath, [BIN, ...args], { env: { ...baseEnv, ...env }, encoding: 'utf8' });

test('--help 输出到 stdout，退出码 0', () => {
  const r = cli(['issue', 'create', '--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /--project-id/);
  assert.equal(r.stderr, '');
});

test('参数错误：退出码 2，错误在 stderr，stdout 为空', () => {
  const r = cli(['issue', 'create', 'T', '--tracker', '9']);
  assert.equal(r.status, 2);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /INVALID_ARGUMENTS/);
});

test('缺配置：退出码 4；--json 时 stdout 是合法 JSON', () => {
  const r = cli(['issue', 'create', 'T', '--project-id', 'a'.repeat(32), '--tracker', '3', '--priority', '3', '--json']);
  assert.equal(r.status, 4);
  assert.equal(JSON.parse(r.stdout).error.code, 'MISSING_CONFIG');
});

test('可用于脚本判断成败（&& / ||）', () => {
  const ok = cli(['--version']);
  const bad = cli(['issue', 'nope']);
  assert.equal(ok.status, 0);
  assert.notEqual(bad.status, 0);
});
