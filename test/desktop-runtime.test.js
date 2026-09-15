'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, fork } = require('node:child_process');
const { once } = require('node:events');
const { resolveAccioEnvironment } = require('../desktop/runtime.cjs');

/** 创建隔离运行目录；t 为测试上下文；返回路径，文件错误会抛出。 */
async function directory(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lsou-native-test-')); t.after(() => fs.rm(root, { force: true, recursive: true })); return root; }

test('desktop resolves last active space and does not use historical account path', async t => {
  const root = await directory(t);
  const space = '999_212003';
  const write = async (name, value) => { const file = path.join(root, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(value)); };
  await write('999/.accio/runtime/gateway-cli.json', { password: 'test-only-token', url: 'http://localhost:4097' });
  await write(`${space}/plugins/installed/alibaba-com-seller-assistant/clis/clis.json`, { tools: [{ id: 'workctl', source: { version: '0.1.55' } }] });
  const executable = path.join(root, space, 'plugins/data/cli-tools/plugins/alibaba-com-seller-assistant/tools/workctl/versions/0.1.55/prefix/bin/workctl');
  await fs.mkdir(path.dirname(executable), { recursive: true }); await fs.writeFile(executable, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const server = http.createServer((req, res) => res.end(JSON.stringify({ bootTiming: { stages: [{ stage: 'resource_identity_gate', detail: { storageKey: 'old' } }, { stage: 'resource_identity_gate', detail: { storageKey: space } }] } })));
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close());
  const env = await resolveAccioEnvironment({ accountsRoot: root, healthUrl: `http://127.0.0.1:${server.address().port}`, verify: false });
  assert.equal(env.WORKCTL_BIN, executable); assert.equal(env.ACCIO_ACTIVE_SPACE, space); assert.equal(env.ACCIO_GATEWAY_TOKEN, 'test-only-token');
  assert.ok(env.PATH.startsWith(path.dirname(process.execPath)));
});

test('native backend uses allocated port, requires session cookie and retains same-origin write protection', async t => {
  const root = await directory(t);
  const child = fork(path.resolve('server.js'), [], { env: { ...process.env, PORT: '0', LSOU_DESKTOP_TOKEN: 'test-desktop-token', ACCIO_ACTIVE_SPACE: 'test', OPERATIONS_STATE_DIR: root }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  t.after(() => child.kill());
  const [ready] = await once(child, 'message');
  assert.equal(ready.type, 'lsou:ready'); assert.ok(ready.port > 0);
  const url = `http://127.0.0.1:${ready.port}`;
  assert.equal((await fetch(url + '/api/endpoints')).status, 403);
  const redirect = await fetch(url + '/?desktopTicket=test-desktop-token', { redirect: 'manual' });
  assert.equal(redirect.status, 302); assert.equal(redirect.headers.get('location'), '/');
  assert.match(redirect.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  const cookie = 'lsou_session=test-desktop-token';
  const endpoints = await fetch(url + '/api/endpoints', { headers: { cookie } });
  assert.equal(endpoints.status, 200); assert.ok((await endpoints.json()).endpoints.length > 0);
  assert.equal((await fetch(url + '/api/endpoints', { headers: { cookie, origin: 'https://untrusted.example' } })).status, 403);
  child.disconnect(); await once(child, 'exit');
});

test('plugin MCP initializes and lists desktop tools without returning credentials', async t => {
  const child = spawn(process.execPath, ['plugin/scripts/desktop-mcp.cjs'], { env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  let output = ''; child.stdout.on('data', data => { output += data; });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } }) + '\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'lsou_desktop_status' } }) + '\n');
  child.stdin.end(); await once(child, 'exit');
  const replies = output.trim().split('\n').map(JSON.parse);
  assert.equal(replies[0].result.serverInfo.version, require('../package.json').version); assert.deepEqual(replies[1].result.tools.map(tool => tool.name).sort(), ['lsou_desktop_diagnose', 'lsou_desktop_launchpad', 'lsou_desktop_open', 'lsou_desktop_repair', 'lsou_desktop_status', 'lsou_desktop_stop']);
  assert.equal(JSON.parse(replies[2].result.content[0].text).state, 'stopped'); assert.doesNotMatch(output, /ACCIO_GATEWAY_TOKEN|password|\/Users\//);
});

test('all delivery platforms select separate native applications and private configuration paths', () => {
  const { desktopPaths, supportDirectory, targetFor } = require('../desktop/platform.cjs');
  assert.equal(desktopPaths('/plugin', 'darwin', 'arm64').target, 'macos-arm64');
  assert.equal(desktopPaths('/plugin', 'darwin', 'x64').target, 'macos-x64');
  const windows = desktopPaths('/plugin', 'win32', 'x64');
  assert.ok(windows.executable.endsWith(path.join('windows-x64', 'lsou-workbench.exe')));
  assert.ok(windows.node.endsWith(path.join('runtime', 'node.exe')));
  assert.equal(supportDirectory({ platform: 'win32', home: '/user', env: { LOCALAPPDATA: '/private-appdata' } }), path.join('/private-appdata', 'com.lsou.workbench'));
  assert.throws(() => targetFor('linux', 'x64'), /暂不支持/);
  assert.throws(() => targetFor('win32', 'ia32'), /暂不支持/);
});

test('Windows Workctl discovery bypasses cmd shims and keeps CLI arguments separate', async t => {
  const root = await directory(t);
  const write = async (name, value) => { const file = path.join(root, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(value)); };
  const space = '888_212003';
  await write('888/.accio/runtime/gateway-cli.json', { password: 'test-windows-token' });
  await write(`${space}/plugins/installed/alibaba-com-seller-assistant/clis/clis.json`, { tools: [{ id: 'workctl', source: { version: '0.1.55' } }] });
  const packagePath = `${space}/plugins/data/cli-tools/plugins/alibaba-com-seller-assistant/tools/workctl/versions/0.1.55/prefix/node_modules/@accio-ai/cli`;
  await write(`${packagePath}/package.json`, { bin: { workctl: 'bin/with spaces.cjs' } });
  const entry = path.join(root, packagePath, 'bin/with spaces.cjs');
  await fs.mkdir(path.dirname(entry), { recursive: true }); await fs.writeFile(entry, '// fixture');
  const server = http.createServer((req, res) => res.end(JSON.stringify({ bootTiming: { stages: [{ stage: 'resource_identity_gate', detail: { storageKey: space } }] } })));
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close());
  const calls = [];
  const options = { platform: 'win32', accountsRoot: root, healthUrl: `http://127.0.0.1:${server.address().port}`, execFile: async (command, args, config) => { calls.push({ command, args, config }); return { stdout: '{"success":true}' }; } };
  const env = await resolveAccioEnvironment(options);
  assert.equal(env.WORKCTL_BIN, process.execPath);
  assert.equal(env.WORKCTL_ENTRY, entry);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args, [entry, 'health', '--format', 'json']);
  assert.equal(calls[0].config.shell, undefined);
  assert.equal(calls[0].config.windowsHide, true);
  assert.ok(env.PATH.includes(';'));
  await write(`${packagePath}/package.json`, { bin: { workctl: '../outside.cjs' } });
  await assert.rejects(resolveAccioEnvironment(options), /入口不合法/);
});

test('Mac MCP restores both executable permissions when the user requests launch', { skip: process.platform !== 'darwin' }, async t => {
  const root = await directory(t);
  const { desktopPaths } = require('../desktop/platform.cjs');
  const selected = desktopPaths(root);
  await fs.mkdir(path.join(root, 'scripts'), { recursive: true });
  await fs.mkdir(path.join(root, 'desktop'), { recursive: true });
  await fs.copyFile('plugin/scripts/desktop-mcp.cjs', path.join(root, 'scripts/desktop-mcp.cjs'));
  for (const file of ['platform.cjs', 'runtime.cjs', 'diagnostics.cjs']) await fs.copyFile('desktop/' + file, path.join(root, 'desktop', file));
  await fs.appendFile(path.join(root, 'desktop/platform.cjs'), "\nmodule.exports.supportDirectory = () => path.join(__dirname, '../test-state');\n");
  for (const file of [selected.executable, selected.node]) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '#!/bin/sh\nexit 0\n', { mode: 0o644 });
  }
  const child = spawn(process.execPath, [path.join(root, 'scripts/desktop-mcp.cjs')], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  child.stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');
  await once(child.stdout, 'data');
  assert.equal((await fs.stat(selected.executable)).mode & 0o777, 0o644);
  child.stdin.write('{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"lsou_desktop_open","arguments":{}}}\n');
  await once(child.stdout, 'data');
  assert.equal((await fs.stat(selected.executable)).mode & 0o777, 0o755);
  assert.equal((await fs.stat(selected.node)).mode & 0o777, 0o755);
  child.stdin.end(); await once(child, 'exit');
});

test('macOS 11系统检查接受Big Sur且拒绝更早版本',()=>{
  const {systemCompatibility}=require('../desktop/platform.cjs');
  assert.equal(systemCompatibility('darwin','20.6.0').supported,true);
  assert.equal(systemCompatibility('darwin','19.6.0').supported,false);
  assert.equal(systemCompatibility('darwin','25.0.0').supported,true);
  assert.equal(systemCompatibility('darwin','unknown').supported,false);
  assert.equal(systemCompatibility('win32','10.0').supported,true);
});

/** 模拟 Accio 的当前空间与 CLI 安装记录；返回可重复修改的 fixture，不读取真实账号。 */
async function runtimeFixture(t, platform = 'darwin') {
  const root = await directory(t);
  const space = '777_212003';
  const pluginRoot = path.join(root, space, 'plugins');
  const toolRoot = path.join(pluginRoot, 'data/cli-tools/plugins/alibaba-com-seller-assistant/tools/workctl');
  const write = async (file, data) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(data)); };
  await write(path.join(root, '777/.accio/runtime/gateway-cli.json'), { password: 'private-fixture-token' });
  await write(path.join(pluginRoot, 'installed/alibaba-com-seller-assistant/clis/clis.json'), { tools: [{ id: 'workctl', source: { version: '0.1.58' } }] });
  const prefix = path.join(toolRoot, 'generations/0.1.58/batch-current/prefix');
  const packageRoot = path.join(prefix, platform === 'win32' ? 'node_modules/@accio-ai/cli' : 'lib/node_modules/@accio-ai/cli');
  await write(path.join(packageRoot, 'package.json'), { name: '@accio-ai/cli', version: '0.1.58', bin: { workctl: 'bin/workctl.cjs' } });
  const entry = path.join(packageRoot, 'bin/workctl.cjs');
  await fs.mkdir(path.dirname(entry), { recursive: true }); await fs.writeFile(entry, '// fixture');
  const executable = platform === 'win32' ? path.join(prefix, 'workctl.cmd') : path.join(prefix, 'bin/workctl');
  await fs.mkdir(path.dirname(executable), { recursive: true }); await fs.writeFile(executable, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const registry = { 'alibaba-com-seller-assistant': { enabled: true, cliToolStates: { workctl: { status: 'installed', installedVersion: '0.1.58', resolvedPath: executable } } } };
  const saveRegistry = () => write(path.join(pluginRoot, 'plugins.json'), registry);
  await saveRegistry();
  const server = http.createServer((req, res) => res.end(JSON.stringify({ bootTiming: { stages: [{ stage: 'resource_identity_gate', detail: { storageKey: space } }] } })));
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close());
  return { root, pluginRoot, toolRoot, prefix, packageRoot, executable, entry, registry, saveRegistry, write,
    options: { platform, accountsRoot: root, healthUrl: `http://127.0.0.1:${server.address().port}`, verify: false, env: {} } };
}

test('runtime follows Accio installed path after versions moves to generations', async t => {
  const fixture = await runtimeFixture(t);
  const env = await resolveAccioEnvironment(fixture.options);
  assert.equal(env.WORKCTL_BIN, fixture.executable);
  assert.equal(env.LSOU_WORKCTL_SOURCE, 'registry');
  assert.equal(env.LSOU_WORKCTL_VERSION, '0.1.58');
});

test('runtime recovers a stale registry using only the declared version in current space', async t => {
  const f = await runtimeFixture(t);
  f.registry['alibaba-com-seller-assistant'].cliToolStates.workctl.resolvedPath = path.join(f.toolRoot, 'versions/0.1.58/prefix/bin/workctl');
  await f.saveRegistry();
  const env = await resolveAccioEnvironment(f.options);
  assert.equal(env.WORKCTL_BIN, f.executable);
  assert.equal(env.LSOU_WORKCTL_SOURCE, 'generations');
  await fs.rm(f.prefix, { recursive: true });
  await assert.rejects(resolveAccioEnvironment(f.options), error => error.code === 'WORKCTL_MISSING');
});

test('runtime rejects another account and symlinks outside current managed tool root', async t => {
  const f = await runtimeFixture(t);
  const outside = path.join(f.root, 'another-account/cli');
  await fs.mkdir(path.dirname(outside), { recursive: true }); await fs.writeFile(outside, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  await fs.rm(f.executable); await fs.symlink(outside, f.executable);
  f.options.env.PHOENIX_PLUGIN_CLI_WORKCTL_PATH = outside;
  await assert.rejects(resolveAccioEnvironment(f.options), error => error.code === 'WORKCTL_MISSING');
});

test('runtime keeps installation-in-progress and disabled-plugin errors distinct', async t => {
  const f = await runtimeFixture(t);
  const plugin = f.registry['alibaba-com-seller-assistant'];
  plugin.cliToolStates.workctl.status = 'installing'; await f.saveRegistry();
  await assert.rejects(resolveAccioEnvironment(f.options), error => error.code === 'WORKCTL_INSTALLING');
  plugin.enabled = false; await f.saveRegistry();
  await assert.rejects(resolveAccioEnvironment(f.options), error => error.code === 'PLUGIN_DISABLED');
});

test('Windows generation registry resolves JS entry without running a cmd shell', async t => {
  const f = await runtimeFixture(t, 'win32');
  const env = await resolveAccioEnvironment(f.options);
  assert.equal(env.WORKCTL_BIN, process.execPath);
  assert.equal(env.WORKCTL_ENTRY, f.entry);
  assert.equal(env.LSOU_WORKCTL_SOURCE, 'registry');
});

test('diagnostics distinguish failed authentication without exposing credentials or command output', async t => {
  const f = await runtimeFixture(t);
  const { diagnoseAccioEnvironment } = require('../desktop/runtime.cjs');
  const report = await diagnoseAccioEnvironment({ ...f.options, verify: true, execFile: async () => {
    throw Object.assign(new Error('secret command private-fixture-token'), { stderr: '401 Unauthorized private-fixture-token /Users/private', code: 1 });
  } });
  assert.equal(report.ok, false);
  assert.equal(report.issue.code, 'GATEWAY_AUTH_FAILED');
  assert.equal(report.checks.at(-1).status, 'failed');
  assert.doesNotMatch(JSON.stringify(report), /private-fixture-token|another-account|\/Users\/|\.accio\/accounts/);
});

test('plugin diagnostic CLI runs without launching a desktop and never exposes runtime credentials', async t => {
  const f = await runtimeFixture(t);
  const child = spawn(process.execPath, ['plugin/scripts/desktop-mcp.cjs', '--diagnose'], {
    env: { ...process.env, LSOU_MCP_TEST: '1', ACCIO_ACCOUNTS_ROOT: f.root, ACCIO_HEALTH_URL: f.options.healthUrl },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  let output = ''; child.stdout.on('data', data => { output += data; });
  const [code] = await once(child, 'exit');
  assert.equal(code, 0);
  const report = JSON.parse(output);
  assert.equal(report.desktop.state, 'stopped');
  assert.equal(report.package.ok, false); // 源码插件目录没有可交付的原生程序。
  assert.doesNotMatch(output, /private-fixture-token|\.accio\/accounts|\/Users\//);
});

test('MCP recovery restarts its failed child once and preserves an already ready window', { skip: process.platform !== 'darwin' }, async t => {
  const f = await runtimeFixture(t);
  await fs.writeFile(f.executable, '#!/bin/sh\nprintf \'{"success":true}\\n\'\n', { mode: 0o755 });
  const root = await directory(t);
  await fs.mkdir(path.join(root, 'scripts'), { recursive: true });
  await fs.mkdir(path.join(root, 'desktop'), { recursive: true });
  await fs.copyFile('plugin/scripts/desktop-mcp.cjs', path.join(root, 'scripts/desktop-mcp.cjs'));
  for (const file of ['platform.cjs', 'runtime.cjs', 'diagnostics.cjs']) await fs.copyFile('desktop/' + file, path.join(root, 'desktop', file));
  await fs.appendFile(path.join(root, 'desktop/platform.cjs'), "\nmodule.exports.supportDirectory = () => path.join(__dirname, '../test-state');\n");
  const selected = require('../desktop/platform.cjs').desktopPaths(root);
  const countFile = path.join(root, 'attempts');
  await fs.mkdir(path.dirname(selected.executable), { recursive: true });
  await fs.mkdir(path.dirname(selected.node), { recursive: true });
  await fs.writeFile(selected.node, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  await fs.writeFile(selected.executable, `#!/bin/sh\nif [ -f '${countFile}' ]; then printf 'LSOU_DESKTOP_READY\\n'; else touch '${countFile}'; printf 'LSOU_DESKTOP_ERROR\\n'; fi\ntrap 'exit 0' TERM\nwhile :; do sleep 1; done\n`, { mode: 0o755 });
  const child = spawn(process.execPath, [path.join(root, 'scripts/desktop-mcp.cjs')], {
    env: { ...process.env, ACCIO_ACCOUNTS_ROOT: f.root, ACCIO_HEALTH_URL: f.options.healthUrl }, stdio: ['pipe', 'pipe', 'ignore'],
  });
  t.after(() => child.kill());
  const replies = new Map();
  require('node:readline').createInterface({ input: child.stdout }).on('line', line => { const reply = JSON.parse(line); replies.set(reply.id, reply.result); });
  let id = 0;
  const call = async name => {
    const current = ++id;
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: current, method: 'tools/call', params: { name, arguments: {} } }) + '\n');
    const deadline = Date.now() + 8000;
    while (!replies.has(current) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(replies.has(current), `MCP ${name} returned a result`);
    return JSON.parse(replies.get(current).content[0].text);
  };
  assert.equal((await call('lsou_desktop_status')).state, 'stopped');
  assert.equal(await fs.stat(countFile).then(() => true, () => false), false);
  assert.equal((await call('lsou_desktop_open')).state, 'error');
  let status;
  for (let i = 0; i < 30; i++) { status = await call('lsou_desktop_status'); if (status.state === 'error') break; await new Promise(resolve => setTimeout(resolve, 20)); }
  assert.equal(status.state, 'error');
  const recovery = await call('lsou_desktop_repair');
  assert.equal(recovery.ok, true);
  assert.equal(recovery.desktop.state, 'ready');
  assert.deepEqual(recovery.actions, ['rediscovered_session_and_restarted_desktop']);
  const repeated = await call('lsou_desktop_repair');
  assert.equal(repeated.ok, true);
  assert.deepEqual(repeated.actions, []);
  assert.equal(repeated.desktop, undefined);
  const evidence = await call('lsou_desktop_status');
  assert.equal(evidence.backendReady, true);
  assert.equal(evidence.windowVerified, false);
  assert.equal(evidence.businessDataVerified, false);
  const stopped = await call('lsou_desktop_stop');
  assert.equal(stopped.ok, true);
  assert.equal(stopped.desktop.state, 'stopped');
  assert.equal(stopped.desktop.scope, 'current_mcp_session');
  assert.equal((await call('lsou_desktop_stop')).ok, true);
  assert.equal((await call('lsou_desktop_open')).state, 'ready');
  child.stdin.end(); await once(child, 'exit');
});

test('Mac launcher explains wrong-chip package before attempting missing Node', { skip: process.platform !== 'darwin' }, async t => {
  const root = await directory(t);
  await fs.mkdir(path.join(root, 'scripts'), { recursive: true });
  await fs.copyFile('plugin/scripts/launch-mcp.sh', path.join(root, 'scripts/launch-mcp.sh'));
  await fs.mkdir(path.join(root, 'resources', process.arch === 'arm64' ? 'macos-x64' : 'macos-arm64'), { recursive: true });
  const child = spawn('/bin/sh', [path.join(root, 'scripts/launch-mcp.sh'), '--diagnose'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', data => { output += data; });
  await once(child, 'exit');
  assert.equal(JSON.parse(output).code, 'PACKAGE_WRONG_PLATFORM');
  assert.doesNotMatch(output, /\/Users\/|No such file|chmod:/);
});

test('slow desktop open and repair return pending before the client deadline and keep the same child', { skip: process.platform !== 'darwin', timeout: 32000 }, async t => {
  const f = await runtimeFixture(t);
  await fs.writeFile(f.executable, '#!/bin/sh\nprintf \'{"success":true}\\n\'\n', { mode: 0o755 });
  const root = await directory(t);
  await fs.mkdir(path.join(root, 'scripts'), { recursive: true });
  await fs.mkdir(path.join(root, 'desktop'), { recursive: true });
  await fs.copyFile('plugin/scripts/desktop-mcp.cjs', path.join(root, 'scripts/desktop-mcp.cjs'));
  for (const file of ['platform.cjs', 'runtime.cjs', 'diagnostics.cjs']) await fs.copyFile('desktop/' + file, path.join(root, 'desktop', file));
  await fs.appendFile(path.join(root, 'desktop/platform.cjs'), "\nmodule.exports.supportDirectory = () => path.join(__dirname, '../test-state');\n");
  const selected = require('../desktop/platform.cjs').desktopPaths(root);
  await fs.mkdir(path.dirname(selected.executable), { recursive: true });
  await fs.mkdir(path.dirname(selected.node), { recursive: true });
  await fs.writeFile(selected.node, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  // 用一个真实、暂不就绪的子进程重现 30 秒客户端期限；文件信号到达后才报告 ready。
  await fs.writeFile(selected.executable, `#!/bin/sh\nprintf x >> '${root}/starts'\ntrap 'exit 0' TERM\nwhile [ ! -f '${root}/continue' ]; do sleep 0.1; done\nprintf 'LSOU_DESKTOP_READY\\n'\nwhile :; do sleep 1; done\n`, { mode: 0o755 });
  const child = spawn(process.execPath, [path.join(root, 'scripts/desktop-mcp.cjs')], {
    env: { ...process.env, ACCIO_ACCOUNTS_ROOT: f.root, ACCIO_HEALTH_URL: f.options.healthUrl }, stdio: ['pipe', 'pipe', 'ignore'],
  });
  t.after(async () => { child.stdin.end(); if (child.exitCode === null) await once(child, 'exit'); });
  const replies = new Map();
  require('node:readline').createInterface({ input: child.stdout }).on('line', line => { const reply = JSON.parse(line); replies.set(reply.id, reply.result); });
  let id = 0;
  const call = async (name, timeout = 25000) => {
    const current = ++id;
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: current, method: 'tools/call', params: { name, arguments: {} } }) + '\n');
    const deadline = Date.now() + timeout;
    while (!replies.has(current) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(replies.has(current), `${name} responds before the client's 30 second deadline`);
    return JSON.parse(replies.get(current).content[0].text);
  };
  const [opened, recovery] = await Promise.all([call('lsou_desktop_open'), call('lsou_desktop_repair')]);
  assert.equal(opened.state, 'starting');
  assert.equal(opened.pending, true);
  assert.equal(recovery.pending, true);
  assert.equal(recovery.ok, false);
  assert.equal(await fs.readFile(path.join(root, 'starts'), 'utf8'), 'x');
  const [stopped, duplicate, reopening] = await Promise.all([call('lsou_desktop_stop'), call('lsou_desktop_stop'), call('lsou_desktop_open')]);
  assert.equal(stopped.ok, true);
  assert.equal(duplicate.ok, true);
  assert.equal(reopening.state, 'stopping');
  let cancelled;
  for (let i = 0; i < 40; i++) {
    cancelled = await call('lsou_desktop_status');
    if (cancelled.recoveryState === 'completed') break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(cancelled.state, 'stopped');
  assert.equal(cancelled.lastRecovery.ok, false);
  assert.equal(await fs.readFile(path.join(root, 'starts'), 'utf8'), 'x');
  await fs.writeFile(path.join(root, 'continue'), '');
  assert.equal((await call('lsou_desktop_open')).state, 'ready');
  let current;
  for (let i = 0; i < 40; i++) {
    current = await call('lsou_desktop_status', 1000);
    if (current.state === 'ready' && current.recoveryState === 'completed') break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(current.state, 'ready');
  assert.equal(current.recoveryState, 'completed');
  assert.equal(current.lastRecovery.ok, false);
  assert.equal(await fs.readFile(path.join(root, 'starts'), 'utf8'), 'xx');
});

test('native startup evidence excludes raw paths and separates standalone bootstrap from native launch', async t => {
  const root = await directory(t);
  const diagnostics = require('../desktop/diagnostics.cjs');
  assert.equal(typeof diagnostics.nativeStartup, 'function');
  const file = path.join(root, 'native.log');
  await fs.writeFile(file, 'not json\n' + JSON.stringify({ timestampMs: Date.now(), nativePid: process.pid,
    stage: 'node_spawn_failed', osCode: 2, secret: 'private-token', path: 'C:\\Users\\private',
    nodeOptionsSet: true }) + '\n');
  const evidence = diagnostics.nativeStartup(root);
  assert.equal(evidence.evidenceAvailable, false);
  await fs.writeFile(path.join(root, 'native-evidence.log'), 'private-error-text');
  const localEvidence = diagnostics.nativeStartup(root);
  assert.equal(localEvidence.evidenceAvailable, true);
  assert.doesNotMatch(JSON.stringify(localEvidence), /private-error-text/);
  assert.equal(evidence.events[0].stage, 'node_spawn_failed');
  assert.equal(evidence.events[0].osCode, 2);
  assert.doesNotMatch(JSON.stringify(evidence), /private-token|Users|secret/);
  await fs.writeFile(path.join(root, 'startup-status.json'), JSON.stringify({ checkedAt: new Date().toISOString(), state: 'ready', nativePid: 0 }));
  const historical = diagnostics.lastStartup(root);
  assert.equal(historical.source, 'standalone');
  assert.equal(historical.processAlive, null);
});
