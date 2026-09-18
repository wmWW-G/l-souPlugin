const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { zipSync } = require('fflate');

/** 建立隔离发布目录。t 为测试上下文；返回临时路径，文件系统失败直接抛错。 */
async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'lsou-release-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  await fs.mkdir(path.join(base, 'release'));
  return base;
}
/** 写测试 ZIP 和真实 SHA256。返回文件路径，不执行包内占位二进制；写入失败抛错。 */
async function archive(base, target, overrides = {}) {
  const version = '1.0.12', windows = target === 'windows-x64';
  const { targets } = await import('../scripts/desktop-targets.mjs');
  const resources = `resources/${target}/` + (windows ? '' : 'LSOUWorkbench.app/Contents/Resources/');
  const entries = {
    'plugin.json': JSON.stringify({ name: 'lsou-workbench', version, description: 'fixture' }),
    [`resources/${target}/build.json`]: JSON.stringify({ version, target, triple: targets[target].triple, runtimeVerified: false }),
    'scripts/desktop-mcp.cjs': `const version = '${version}';\nconst status = { buildRevision: 'v${version}' };`,
    'connectors/connectors.json': JSON.stringify({ mcpServers: { 'lsou-desktop': { command: windows ? './resources/windows-x64/runtime/node.exe' : '/bin/sh', args: windows ? ['scripts/desktop-mcp.cjs'] : ['scripts/launch-mcp.sh'] } } }),
    [windows ? `resources/${target}/lsou-workbench.exe` : `resources/${target}/LSOUWorkbench.app/Contents/MacOS/lsou-workbench`]: 'fixture-native',
    [resources + `runtime/${windows ? 'node.exe' : 'node'}`]: 'fixture-node',
    [resources + 'payload/desktop/bootstrap.cjs']: '// fixture bootstrap',
    ...overrides,
  };
  const file = path.join(base, 'release', `lsou-workbench-${version}-${target}.zip`);
  const bytes = zipSync(Object.fromEntries(Object.entries(entries).map(([name, text]) => ['lsou-workbench/' + name, Buffer.from(text)])));
  await fs.writeFile(file, bytes);
  await fs.writeFile(file + '.sha256', `${crypto.createHash('sha256').update(bytes).digest('hex')}  ${path.basename(file)}\n`);
  return file;
}

test('正式版本按数值递增，拒绝同版本或降级，修订后缀不能代替版本', async () => {
  const { compareVersion, assertNewVersion } = await import('../scripts/manage-release.mjs');
  assert.equal(compareVersion('1.0.10', '1.0.9'), 1);
  const catalog = { artifacts: [{ version: '1.0.10' }, { version: '1.0.11' }] };
  for (const version of ['1.0.10', '1.0.11', '1.0.11-update-r2', '01.0.12']) assert.throws(() => assertNewVersion(version, catalog));
  assert.doesNotThrow(() => assertNewVersion('1.0.12', catalog));
});

test('版本准备同步全部入口并保持 Cargo 语法；漏同步会阻止正式打包', async t => {
  const base = await fixture(t);
  const { assertSourceVersions, setSourceVersion, assertPackageVersion } = await import('../scripts/manage-release.mjs');
  for (const file of ['package.json', 'package-lock.json', 'plugin/plugin.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'plugin/scripts/desktop-mcp.cjs', 'frontend/main.jsx']) {
    await fs.mkdir(path.dirname(path.join(base, file)), { recursive: true });
    await fs.copyFile(file, path.join(base, file));
  }
  const old = await assertSourceVersions(base);
  const next = old.split('.').map(Number); next[2]++;
  const version = next.join('.'), catalog = { artifacts: [{ version: old }] };
  await fs.writeFile(path.join(base, 'release-manifest.json'), JSON.stringify(catalog));
  await assert.rejects(assertPackageVersion(base), /冻结/);
  await setSourceVersion(version, catalog, base);
  assert.equal(await assertPackageVersion(base), version);
  assert.match(await fs.readFile(path.join(base, 'src-tauri/Cargo.toml'), 'utf8'), new RegExp(`version = "${version.replaceAll('.', '\\.')}"\\n`));
  await fs.writeFile(path.join(base, 'plugin/plugin.json'), JSON.stringify({ name: 'lsou-workbench', version: old }));
  await assert.rejects(assertSourceVersions(base), /版本未同步/);
});

test('冻结记录可识别重新计算了校验文件的同名改包，并要求三平台完整', async t => {
  const base = await fixture(t);
  const { inspectArtifact, verifyCurrent } = await import('../scripts/manage-release.mjs');
  const artifacts = [];
  for (const target of ['macos-arm64', 'macos-x64', 'windows-x64']) artifacts.push(await inspectArtifact(await archive(base, target)));
  const catalog = { pluginId: 'lsou-workbench', current: Object.fromEntries(artifacts.map(item => [item.target, item.file])), artifacts };
  assert.equal((await verifyCurrent(catalog, base)).length, 3);
  await assert.rejects(verifyCurrent({ ...catalog, current: { 'windows-x64': catalog.current['windows-x64'] } }, base), /三平台/);
  await archive(base, 'windows-x64', { 'README.md': 'changed after approval' });
  await assert.rejects(verifyCurrent(catalog, base), /冻结包已改变/);
});

test('包内版本、平台和路径异常不会被文件名或校验文件掩盖', async t => {
  const base = await fixture(t);
  const { inspectArtifact } = await import('../scripts/manage-release.mjs');
  let file = await archive(base, 'windows-x64', { 'scripts/desktop-mcp.cjs': "const version = '1.0.10';" });
  await assert.rejects(inspectArtifact(file), /版本不一致/);
  file = await archive(base, 'windows-x64', { 'resources/macos-arm64/unexpected': 'mixed' });
  await assert.rejects(inspectArtifact(file), /混入其他平台/);
  file = await archive(base, 'windows-x64', { '../outside.txt': 'unsafe' });
  await assert.rejects(inspectArtifact(file), /目录结构/);
});

test('源码指纹对实际文件变更敏感，不把日志或验收记录混入构建输入', async t => {
  const base = await fixture(t);
  const { productionSourceDigest } = await import('../scripts/manage-release.mjs');
  for (const file of ['package.json', 'package-lock.json', 'vite.config.mjs', 'server.js', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'src-tauri/tauri.conf.json']) {
    await fs.mkdir(path.dirname(path.join(base, file)), { recursive: true });
    await fs.writeFile(path.join(base, file), '{}');
  }
  for (const directory of ['plugin', 'lib', 'desktop', 'public', 'frontend', 'scripts', 'src-tauri/src', 'src-tauri/boot', 'src-tauri/icons']) await fs.mkdir(path.join(base, directory), { recursive: true });
  const before = await productionSourceDigest(base);
  await fs.writeFile(path.join(base, 'DEVELOPMENT_LOG.md'), 'new verification');
  assert.equal(await productionSourceDigest(base), before);
  await fs.writeFile(path.join(base, 'server.js'), 'new implementation');
  assert.notEqual(await productionSourceDigest(base), before);
});
