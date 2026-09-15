import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { zipSync } from 'fflate';
import { root, selectedTarget } from './desktop-targets.mjs';
import { assertCleanRelease } from './verify-release-data.mjs';
const release = path.join(root, 'release');
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
if(process.argv.includes('--universal'))throw new Error('仅提供Mac、Intel Mac、Windows独立安装包，请使用--target选择平台');
const names = [selectedTarget().name];
// 先核对所选平台构建与版本，避免将旧产物重新封装。
for (const name of names) {
  const dir = path.join(root, '.build-cache/desktop', name);
  const build = JSON.parse(await fs.readFile(path.join(dir, 'build.json'), 'utf8'));
  if (build.target !== name || build.version !== pkg.version) throw new Error(`构建版本不一致：${name}`);
  await fs.access(path.join(dir, name.startsWith('macos') ? 'LSOUWorkbench.app/Contents/MacOS/lsou-workbench' : 'lsou-workbench.exe'));
  // 独立诊断与 Tauri 后端必须使用同一套发现逻辑，避免诊断通过而窗口仍运行旧代码。
  const resource = name.startsWith('macos') ? path.join(dir, 'LSOUWorkbench.app/Contents/Resources') : dir;
  for (const file of ['platform.cjs', 'runtime.cjs', 'diagnostics.cjs', 'bootstrap.cjs', 'command-compat.cjs']) {
    const source = await fs.readFile(path.join(root, 'desktop', file));
    const packaged = await fs.readFile(path.join(resource, 'payload/desktop', file));
    if (!source.equals(packaged)) throw new Error(`桌面启动代码已变更，请先重新构建：${name}/${file}`);
  }
}
const label = names[0];
const stage = path.join(release, `stage-${label}`);
const output = path.join(stage, 'lsou-workbench');
await fs.mkdir(release, { recursive: true });
await fs.rm(stage, { recursive: true, force: true });
await fs.cp(path.join(root, 'plugin'), output, { recursive: true });
for (const file of ['platform.cjs', 'runtime.cjs', 'diagnostics.cjs', 'command-compat.cjs']) await fs.copyFile(path.join(root, 'desktop', file), path.join(output, 'desktop', file));
for (const name of names) {
  await fs.cp(path.join(root, '.build-cache/desktop', name), path.join(output, 'resources', name), { recursive: true });
  if (name.startsWith('macos')) execFileSync('codesign', ['--verify', '--deep', '--strict', path.join(output, 'resources', name, 'LSOUWorkbench.app')], { stdio: 'inherit' });
}
{
  // 各独立安装包直接调用随包Node，不依赖外部Node环境。
  const file = path.join(output, 'connectors/connectors.json');
  const config = JSON.parse(await fs.readFile(file, 'utf8'));
  const server = config.mcpServers['lsou-desktop'];
  if (names[0] === 'windows-x64') {
    server.command = './resources/windows-x64/runtime/node.exe';
    server.args = ['scripts/desktop-mcp.cjs'];
  } else { server.command = '/bin/sh'; server.args = ['scripts/launch-mcp.sh']; }
  await fs.writeFile(file, JSON.stringify(config, null, 2));
}
const validator = path.join(stage, 'validate-plugin.cjs');
// 随源码保留用户指定官方验证器原文，避免构建机依赖开发者账号路径。
await fs.copyFile(process.env.ACCIO_PLUGIN_VALIDATOR || path.join(root, 'scripts/validate-plugin.cjs'), validator);
execFileSync(process.execPath, [validator, output], { stdio: 'inherit' });
const entries = {};
// 即使复用旧构建缓存，也必须重新阻断随包样本和账号数据，不能只依赖准备阶段。
await assertCleanRelease(output);
/** 遍历正式包并保留 ZIP 可执行权限。dir 为当前目录，relative 为 ZIP 路径；遇私密文件/链接即抛错。 */
async function collect(dir, relative = 'lsou-workbench') {
  for (const item of await fs.readdir(dir, { withFileTypes: true })) {
    if (item.name === '.DS_Store') continue;
    if (/^\.env|\.log$|gateway-cli\.json|credentials/i.test(item.name)) throw new Error(`不允许打包的文件：${item.name}`);
    const file = path.join(dir, item.name);
    const name = `${relative}/${item.name}`;
    if (item.isSymbolicLink()) throw new Error(`交付不允许未处理符号链接：${name}`);
    if (item.isDirectory()) await collect(file, name);
    else {
      const stat = await fs.stat(file);
      entries[name] = [await fs.readFile(file), { os: 3, attrs: (stat.mode & 0xffff) << 16 }];
    }
  }
}
await collect(output);
const zip = path.join(release, `lsou-workbench-${pkg.version}-${label}.zip`);
await fs.writeFile(zip, zipSync(entries, { level: 6 }));
const sha = crypto.createHash('sha256').update(await fs.readFile(zip)).digest('hex');
await fs.writeFile(zip + '.sha256', `${sha}  ${path.basename(zip)}\n`);
console.log(`Plugin ZIP: ${zip}\nSHA256: ${sha}\n包含平台: ${names.join(', ')}`);
