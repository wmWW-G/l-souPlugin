import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { root, selectedTarget } from './desktop-targets.mjs';
import { assertSourceVersions, productionSourceDigest } from './manage-release.mjs';
const target = selectedTarget();
await assertSourceVersions();
// 明确编译目标，防止构建机环境把最低系统版本抬高。
if(target.platform==='darwin')process.env.MACOSX_DEPLOYMENT_TARGET='11.0';
/** 运行项目 Node 工具。entry 为项目相对入口，args 为字符串数组；失败抛出并停止构建。 */
function runNode(entry, args = []) { execFileSync(process.execPath, [path.join(root, entry), ...args], { cwd: root, stdio: 'inherit' }); }
runNode('node_modules/vite/bin/vite.js', ['build', '--config', 'vite.config.mjs']);
runNode('scripts/prepare-desktop.mjs', ['--target', target.name]);
const sourceDigest = await productionSourceDigest();
const args = ['build', '--target', target.triple];
if (target.platform === 'darwin') args.push('--bundles', 'app');
else {
  // 插件内直接运行 EXE；资源与随包 Node 由本脚本放置，无需同事运行安装器/编译器。
  args.push('--no-bundle');
  if (process.platform !== 'win32') args.push('--runner', 'cargo-xwin');
}
args.push('--', '--locked');
runNode('node_modules/@tauri-apps/cli/tauri.js', args);
const output = path.join(root, '.build-cache', 'desktop', target.name);
await fs.rm(output, { force: true, recursive: true });
await fs.mkdir(output, { recursive: true });
const binaryRoot = path.join(root, 'src-tauri', 'target', target.triple, 'release');
if (target.platform === 'darwin') {
  await fs.cp(path.join(binaryRoot, 'bundle/macos/来搜工作台.app'), path.join(output, 'LSOUWorkbench.app'), { recursive: true });
  execFileSync('codesign', ['--verify', '--deep', '--strict', path.join(output, 'LSOUWorkbench.app')], { stdio: 'inherit' });
} else {
  await fs.copyFile(path.join(binaryRoot, 'lsou-workbench.exe'), path.join(output, 'lsou-workbench.exe'));
  for (const entry of ['payload', 'runtime']) await fs.cp(path.join(root, 'src-tauri', entry), path.join(output, entry), { recursive: true });
  // 某些 WebView2 链接方式会产生旁置 DLL；存在时随 EXE 一起交付。
  for (const entry of await fs.readdir(binaryRoot)) if (entry.toLowerCase().endsWith('.dll')) await fs.copyFile(path.join(binaryRoot, entry), path.join(output, entry));
}
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
if (sourceDigest !== await productionSourceDigest()) throw new Error('构建期间源码发生变化，请重新构建');
await fs.writeFile(path.join(output, 'build.json'), JSON.stringify({ version: pkg.version, target: target.name, triple: target.triple, builtAt: new Date().toISOString(), sourceDigest, runtimeVerified: false }, null, 2));
console.log(`原生构建完成：${output}；仍需目标系统实机验收。`);
