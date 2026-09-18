'use strict';

const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const test = require('node:test');
const http = require('node:http');
const { once } = require('node:events');

const execFileAsync = promisify(execFile);

test('start.sh 从 Accio 当前运行态解析凭据和 Workctl 后再启动服务', async t => {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'workctl-start-test-'));
  const accountsRoot = path.join(temporaryDirectory, 'accounts');
  const fakeBinDirectory = path.join(temporaryDirectory, 'bin');
  const accountId = '12345';
  const activeSpace = '12345_678';
  const workctlVersion = '9.9.9';
  const gatewayFile = path.join(accountsRoot, accountId, '.accio', 'runtime', 'gateway-cli.json');
  const cliManifest = path.join(
    accountsRoot,
    activeSpace,
    'plugins',
    'installed',
    'alibaba-com-seller-assistant',
    'clis',
    'clis.json'
  );
  const expectedWorkctl = path.join(
    accountsRoot,
    activeSpace,
    'plugins',
    'data',
    'cli-tools',
    'plugins',
    'alibaba-com-seller-assistant',
    'tools',
    'workctl',
    'versions',
    workctlVersion,
    'prefix',
    'bin',
    'workctl'
  );
  const sandbox = path.join(temporaryDirectory, 'app');
  await mkdir(path.join(sandbox, 'desktop'), { recursive: true });
  await copyFile(path.resolve(__dirname, '../start.sh'), path.join(sandbox, 'start.sh'));
  await copyFile(path.resolve(__dirname, '../desktop/runtime.cjs'), path.join(sandbox, 'desktop/runtime.cjs'));

  // 测试结束时只删除本测试创建的临时账号树，不接触用户真实 Accio 文件。
  t.after(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  await mkdir(path.dirname(gatewayFile), { recursive: true });
  await mkdir(path.dirname(cliManifest), { recursive: true });
  await mkdir(path.dirname(expectedWorkctl), { recursive: true });
  await mkdir(fakeBinDirectory, { recursive: true });

  await writeFile(gatewayFile, JSON.stringify({
    url: 'http://localhost:4097',
    password: 'test-only-token',
  }));
  await writeFile(cliManifest, JSON.stringify({
    tools: [{ id: 'workctl', source: { version: workctlVersion } }],
  }));
  const health = http.createServer((req, res) => res.end(JSON.stringify({ bootTiming: { stages: [
    { stage: 'resource_identity_gate', detail: { storageKey: accountId } },
    { stage: 'resource_identity_gate', detail: { storageKey: activeSpace } },
  ] } })));
  health.listen(0, '127.0.0.1'); await once(health, 'listening'); t.after(() => health.close());
  await writeFile(expectedWorkctl, `#!/bin/sh
# publishflow --help 使用普通文本，其余健康检查和动态 schema 使用 JSON。
# 这个分支确保启动脚本确实核对正式发布和参考商品两条编排命令。
if [ "$1" = "publishflow" ]; then
  printf '%s\\n' 'publish-from-json query-template-info-by-id'
else
  printf '%s\\n' '{"success":true}'
fi
`);
  await writeFile(path.join(sandbox, 'server.js'), `
'use strict';
process.stdout.write(JSON.stringify({
  tokenMatches: process.env.ACCIO_GATEWAY_TOKEN === 'test-only-token',
  gatewayUrl: process.env.ACCIO_LOCAL_GATEWAY_URL,
  workctlBin: process.env.WORKCTL_BIN,
  activeSpace: process.env.ACCIO_ACTIVE_SPACE,
  runtimeSource: process.env.LSOU_WORKCTL_SOURCE
}));
`);

  await chmod(expectedWorkctl, 0o700);
  const startScript = path.join(sandbox, 'start.sh');
  const { stdout } = await execFileAsync('/bin/bash', [startScript], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      ACCIO_ACCOUNTS_ROOT: accountsRoot,
      NODE_BIN: process.execPath,
      NODE_OPTIONS: '',
      ACCIO_HEALTH_URL: `http://127.0.0.1:${health.address().port}`,
      PATH: `${fakeBinDirectory}:${process.env.PATH}`,
    },
    timeout: 3000,
  });
  const result = JSON.parse(stdout.trim().split('\n').at(-1));

  assert.deepEqual(result, {
    tokenMatches: true,
    gatewayUrl: 'http://localhost:4097',
    workctlBin: expectedWorkctl,
    activeSpace,
    runtimeSource: 'versions',
  });
});
