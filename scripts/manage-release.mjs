import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { unzipSync } from 'fflate';
import { root, targets } from './desktop-targets.mjs';

const catalogName = 'release-manifest.json';
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
/** 读取本地 JSON。file 为绝对路径，返回对象；读取或解析错误直接阻止发布。 */
async function json(file) { return JSON.parse(await fs.readFile(file, 'utf8')); }
/** 比较正式版本号。a、b 为 x.y.z，返回 -1/0/1；非法版本抛错，避免按字符串排序。 */
export function compareVersion(a, b) {
  if (!stableVersion.test(a) || !stableVersion.test(b)) throw new Error('正式版本必须使用 x.y.z，不接受文件名修订号代替版本');
  const left = a.split('.').map(BigInt), right = b.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}
/** 核对全部版本入口。base 为源码根目录，返回版本；任一入口遗漏或不一致则抛错。 */
export async function assertSourceVersions(base = root) {
  const pkg = await json(path.join(base, 'package.json'));
  compareVersion(pkg.version, pkg.version);
  const lock = await json(path.join(base, 'package-lock.json'));
  const plugin = await json(path.join(base, 'plugin/plugin.json'));
  if (pkg.name !== 'lsou-workbench' || plugin.name !== pkg.name || (plugin.id && plugin.id !== pkg.name)) throw new Error('正式更新必须保持插件 ID lsou-workbench');
  const found = {
    plugin: plugin.version, tauri: (await json(path.join(base, 'src-tauri/tauri.conf.json'))).version,
    lock: lock.version, lockRoot: lock.packages?.['']?.version,
  };
  for (const [file, pattern] of [
    ['src-tauri/Cargo.toml', /\[package\]\s+name = "lsou-workbench"\s+version = "([^"]+)"/],
    ['src-tauri/Cargo.lock', /\[\[package\]\]\s+name = "lsou-workbench"\s+version = "([^"]+)"/],
    ['plugin/scripts/desktop-mcp.cjs', /const version = '([^']+)'/],
    ['frontend/main.jsx', /applicationVersion: '([^']+)'/],
  ]) found[file] = (await fs.readFile(path.join(base, file), 'utf8')).match(pattern)?.[1];
  for (const [name, version] of Object.entries(found)) if (version !== pkg.version) throw new Error(`版本未同步：${name}`);
  return pkg.version;
}
/** 拒绝重用已发布版本。version 为待发版本，catalog 为记录；无返回值，旧版或同版重发抛错。 */
export function assertNewVersion(version, catalog) {
  compareVersion(version, version);
  for (const artifact of catalog.artifacts) if (compareVersion(version, artifact.version) <= 0) throw new Error(`版本 ${version} 已冻结或低于已发布版本；请先递增版本号`);
}
/** 供打包入口调用：核对身份、全部版本和已冻结记录；返回当前版本，不修改文件。 */
export async function assertPackageVersion(base = root) {
  const version = await assertSourceVersions(base);
  const catalog = await json(path.join(base, catalogName));
  assertNewVersion(version, catalog);
  return version;
}
/** 计算正式构建输入的内容指纹。base 为源码根目录；返回 SHA256，缺文件或符号链接抛错。 */
export async function productionSourceDigest(base = root) {
  const hash = crypto.createHash('sha256');
  /** 按稳定路径顺序读取文件；相对路径与内容同时入哈希，避免改名/漏文件无法检测。 */
  async function visit(relative) {
    const file = path.join(base, relative), stat = await fs.lstat(file);
    if (stat.isSymbolicLink()) throw new Error('构建输入不能包含未审查的符号链接');
    if (stat.isDirectory()) {
      for (const name of (await fs.readdir(file)).filter(name => name !== '.DS_Store').sort()) await visit(path.join(relative, name));
    } else hash.update(relative.split(path.sep).join('/') + '\0').update(await fs.readFile(file)).update('\0');
  }
  for (const relative of ['package.json', 'package-lock.json', 'vite.config.mjs', 'plugin', 'server.js', 'lib', 'desktop', 'public', 'frontend', 'scripts', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'src-tauri/tauri.conf.json', 'src-tauri/src', 'src-tauri/boot', 'src-tauri/icons']) await visit(relative);
  return hash.digest('hex');
}
/**
 * 读取正式 ZIP 的实际身份、版本、平台与 SHA256；file 为路径。
 * 返回可登记的元数据；不执行包内程序。非法路径、平台混包、版本不一致会抛错。
 */
export async function inspectArtifact(file) {
  const bytes = await fs.readFile(file);
  const entries = unzipSync(bytes);
  for (const name of Object.keys(entries)) {
    if (!name.startsWith('lsou-workbench/') || name.includes('\\') || name.split('/').some(part => part === '..' || part === '.')) throw new Error('ZIP 目录结构不安全或根目录错误');
    if (/(?:^|\/)(?:\.env[^/]*|credentials[^/]*|gateway-cli\.json|demo-data|tmp|test|node_modules)(?:\/|$)|\.log$/i.test(name)) throw new Error('ZIP 含禁止交付文件');
  }
  /** 按包内相对路径读取文本；缺失会抛错，不回退到源码或旧包。 */
  const text = name => { const data = entries['lsou-workbench/' + name]; if (!data) throw new Error(`ZIP 缺少 ${name}`); return Buffer.from(data).toString('utf8'); };
  const plugin = JSON.parse(text('plugin.json'));
  if (plugin.name !== 'lsou-workbench' || (plugin.id && plugin.id !== plugin.name)) throw new Error('ZIP 插件身份不匹配');
  compareVersion(plugin.version, plugin.version);
  const builds = Object.keys(entries).filter(name => /^lsou-workbench\/resources\/[^/]+\/build\.json$/.test(name));
  if (builds.length !== 1) throw new Error('正式交付必须为单平台 ZIP');
  const build = JSON.parse(Buffer.from(entries[builds[0]]).toString('utf8'));
  const target = build.target;
  if (!Object.hasOwn(targets, target) || builds[0] !== `lsou-workbench/resources/${target}/build.json` || build.triple !== targets[target].triple || build.version !== plugin.version) throw new Error('原生构建身份或版本不一致');
  const bundledTargets = new Set(Object.keys(entries).map(name => name.match(/^lsou-workbench\/resources\/(macos-arm64|macos-x64|windows-x64)\//)?.[1]).filter(Boolean));
  if (bundledTargets.size !== 1 || !bundledTargets.has(target)) throw new Error('ZIP 混入其他平台资源');
  const script = text('scripts/desktop-mcp.cjs');
  if (script.match(/const version = '([^']+)'/)?.[1] !== plugin.version) throw new Error('ZIP 连接入口版本不一致');
  const buildRevision = script.match(/buildRevision: '([^']+)'/)?.[1];
  if (!buildRevision) throw new Error('ZIP 缺少构建标识');
  const server = JSON.parse(text('connectors/connectors.json')).mcpServers?.['lsou-desktop'];
  const windows = target === 'windows-x64';
  const command = windows ? './resources/windows-x64/runtime/node.exe' : '/bin/sh';
  const args = windows ? ['scripts/desktop-mcp.cjs'] : ['scripts/launch-mcp.sh'];
  if (server?.command !== command || JSON.stringify(server?.args) !== JSON.stringify(args)) throw new Error('ZIP 未使用对应平台的随包启动入口');
  const resource = `resources/${target}/` + (windows ? '' : 'LSOUWorkbench.app/Contents/Resources/');
  for (const name of [windows ? `resources/${target}/lsou-workbench.exe` : `resources/${target}/LSOUWorkbench.app/Contents/MacOS/lsou-workbench`, resource + `runtime/${windows ? 'node.exe' : 'node'}`, resource + 'payload/desktop/bootstrap.cjs']) {
    if (!entries['lsou-workbench/' + name]?.length) throw new Error(`ZIP 缺少原生运行文件：${name}`);
  }
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const sidecar = (await fs.readFile(file + '.sha256', 'utf8')).trim();
  if (sidecar !== `${sha256}  ${path.basename(file)}`) throw new Error('ZIP 校验文件不匹配');
  return { file: path.basename(file), target, version: plugin.version, buildRevision, bytes: bytes.length, sha256,
    builtAt: build.builtAt, sourceDigest: build.sourceDigest || null, packageVerified: true, runtimeVerified: build.runtimeVerified === true };
}
/** 核验当前三平台包与冻结记录一致。catalog、base 为记录/根目录；返回包元数据，缺包或被改动抛错。 */
export async function verifyCurrent(catalog, base = root) {
  if (catalog.pluginId !== 'lsou-workbench' || Object.keys(catalog.current).sort().join() !== Object.keys(targets).sort().join()) throw new Error('发布记录必须完整列出三平台');
  const artifacts = [];
  for (const target of Object.keys(targets)) {
    const file = catalog.current[target];
    if (file !== path.basename(file)) throw new Error('发布记录的路径必须是文件名');
    const recorded = catalog.artifacts.find(item => item.file === file && item.target === target);
    const actual = await inspectArtifact(path.join(base, 'release', file));
    if (!recorded || ['target', 'version', 'buildRevision', 'bytes', 'sha256'].some(key => actual[key] !== recorded[key])) throw new Error(`冻结包已改变：${file}`);
    artifacts.push(actual);
  }
  return artifacts;
}
/** 保存发布记录并写开发日志。catalog/message 为新记录和固定摘要；文件系统错误抛出。 */
async function saveCatalog(catalog, message) {
  const file = path.join(root, catalogName);
  await fs.writeFile(file + '.tmp', JSON.stringify(catalog, null, 2) + '\n');
  await fs.rename(file + '.tmp', file);
  await fs.appendFile(path.join(root, 'DEVELOPMENT_LOG.md'), `\n- ${new Date().toISOString()} 发布管理：${message}\n`);
}
/**
 * 统一设置下一个源码版本。version 为更高的 x.y.z，catalog 为已发布记录。
 * 先构造并校验全部改动，再写入；写入失败尝试恢复原文件，错误向调用方抛出。
 */
export async function setSourceVersion(version, catalog, base = root) {
  assertNewVersion(version, catalog);
  const old = await assertSourceVersions(base);
  if (compareVersion(version, old) <= 0) throw new Error('新源码版本必须高于当前源码版本');
  const changes = [];
  for (const file of ['package.json', 'package-lock.json', 'plugin/plugin.json', 'src-tauri/tauri.conf.json']) {
    const before = await fs.readFile(path.join(base, file), 'utf8');
    const data = JSON.parse(before); data.version = version;
    if (file === 'package-lock.json') data.packages[''].version = version;
    changes.push({ file, before, after: JSON.stringify(data, null, 2) + '\n' });
  }
  for (const [file, pattern] of [
    ['src-tauri/Cargo.toml', /(\[package\]\s+name = "lsou-workbench"\s+version = ")[^"]+/],
    ['src-tauri/Cargo.lock', /(\[\[package\]\]\s+name = "lsou-workbench"\s+version = ")[^"]+/],
    ['plugin/scripts/desktop-mcp.cjs', /(const version = ')[^']+/],
    ['frontend/main.jsx', /(applicationVersion: ')[^']+/],
  ]) {
    const before = await fs.readFile(path.join(base, file), 'utf8');
    if (!pattern.test(before)) throw new Error(`版本入口发生变化：${file}`);
    let after = before.replace(pattern, (_, prefix) => prefix + version);
    if (file.endsWith('desktop-mcp.cjs')) after = after.replace(/buildRevision: '[^']+'/, `buildRevision: 'v${version}'`);
    changes.push({ file, before, after });
  }
  try {
    for (const change of changes) await fs.writeFile(path.join(base, change.file), change.after);
    await assertSourceVersions(base);
  } catch (error) {
    for (const change of changes) await fs.writeFile(path.join(base, change.file), change.before);
    throw error;
  }
  return version;
}
/** 执行本地发布管理命令；只操作本项目，不安装插件、不请求宿主或模型。错误以非零退出。 */
async function main() {
  const catalog = await json(path.join(root, catalogName));
  const command = process.argv[2] || 'check';
  if (command === 'check') {
    const sourceVersion = await assertSourceVersions();
    const artifacts = await verifyCurrent(catalog);
    console.log(JSON.stringify({ sourceVersion, hostVersionInspected: catalog.host.versionInspected, artifacts }, null, 2));
  } else if (command === 'version') {
    const version = await setSourceVersion(process.argv[3], catalog);
    await fs.appendFile(path.join(root, 'DEVELOPMENT_LOG.md'), `\n- ${new Date().toISOString()} 发布管理：源码版本同步为 ${version}，尚未构建或发布。\n`);
    console.log(`源码版本已同步为 ${version}；请顺序构建和打包三平台，再登记发布。`);
  } else if (command === 'publish') {
    const notesIndex = process.argv.indexOf('--notes');
    const notes = notesIndex < 0 ? '' : process.argv[notesIndex + 1]?.trim();
    if (!notes || notes.length > 2000) throw new Error('登记发布时请用 --notes 提供本次实际变更与验收摘要（最多2000字）');
    const readme = path.join(root, 'README.md');
    const before = await fs.readFile(readme, 'utf8');
    const block = /<!-- release-current:start -->[\s\S]*?<!-- release-current:end -->/;
    if (!block.test(before)) throw new Error('README缺少当前包入口标记，未登记发布');
    const version = await assertPackageVersion();
    const digest = await productionSourceDigest();
    const artifacts = [];
    for (const target of Object.keys(targets)) {
      const artifact = await inspectArtifact(path.join(root, 'release', `lsou-workbench-${version}-${target}.zip`));
      if (artifact.version !== version || artifact.target !== target || artifact.sourceDigest !== digest) throw new Error('三个正式包必须使用同一新版本及当前源码构建');
      artifacts.push(artifact);
    }
    catalog.artifacts.push(...artifacts);
    catalog.current = Object.fromEntries(artifacts.map(item => [item.target, item.file]));
    catalog.history.push({ at: new Date().toISOString(), event: 'published', version, notes, files: artifacts.map(item => item.file) });
    await saveCatalog(catalog, `冻结 ${version} 三平台包及其 SHA256；${notes}`);
    const labels = { 'windows-x64': 'Windows x64', 'macos-arm64': 'Mac M 芯片', 'macos-x64': 'Intel Mac' };
    // ZIP 只在本地保存，仓库首页显示实际文件名，避免生成不存在的 GitHub 下载链接。
    const entries = artifacts.map(item => `- ${labels[item.target]}：${version} — \`release/${item.file}\``).join('\n');
    await fs.writeFile(readme, before.replace(block, `<!-- release-current:start -->\n${entries}\n<!-- release-current:end -->`));
    console.log(`已登记 ${version} 三平台正式包。`);
  } else if (command === 'prune') {
    await verifyCurrent(catalog); // 当前交付完整才能清理旧包，防止仅存的一份误删。
    const keep = new Set(Object.values(catalog.current).flatMap(file => [file, file + '.sha256']));
    const directory = path.join(root, 'release');
    const removed = (await fs.readdir(directory, { withFileTypes: true })).filter(item => item.isFile() && /^lsou-workbench-\d+\.\d+\.\d+-(macos-arm64|macos-x64|windows-x64)(?:-[a-z0-9-]+)?\.zip(?:\.sha256)?$/.test(item.name) && !keep.has(item.name)).map(item => item.name);
    console.log(JSON.stringify({ apply: process.argv.includes('--apply'), obsoleteFiles: removed }, null, 2));
    if (process.argv.includes('--apply') && removed.length) {
      for (const file of removed) await fs.unlink(path.join(directory, file));
      catalog.history.push({ at: new Date().toISOString(), event: 'pruned', files: removed });
      await saveCatalog(catalog, `删除 ${removed.length} 个被替代的 ZIP/校验文件，当前三平台包保留。`);
    }
  } else throw new Error('用法：manage-release.mjs check | version x.y.z | publish | prune [--apply]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
