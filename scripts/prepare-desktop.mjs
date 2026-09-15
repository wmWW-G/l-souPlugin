import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { root, selectedTarget } from './desktop-targets.mjs';
import { assertCleanRelease } from './verify-release-data.mjs';
const target = selectedTarget();
const cache = path.join(root, '.build-cache');
await fs.mkdir(cache, { recursive: true });
const version = 'v22.22.0';
const distribution = `node-${version}-${target.platform === 'win32' ? 'win' : 'darwin'}-${target.arch}`;
const filename = distribution + (target.platform === 'win32' ? '.zip' : '.tar.gz');
const archive = path.join(cache, filename);
const base = `https://nodejs.org/dist/${version}`;

/** 下载官方资源并重试瞬时网络错误。url 为 HTTPS 地址，返回 Buffer；三次失败抛错。 */
async function download(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw new Error(`下载失败 HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) { if (attempt === 2) throw error; }
  }
}
if (!await fs.stat(archive).catch(() => null)) await fs.writeFile(archive, await download(`${base}/${filename}`));
const checksums = (await download(`${base}/SHASUMS256.txt`)).toString('utf8');
const expected = checksums.split('\n').find(line => line.trimEnd().endsWith(`  ${filename}`))?.split(' ')[0];
const actual = crypto.createHash('sha256').update(await fs.readFile(archive)).digest('hex');
if (!expected || actual !== expected) throw new Error('Node 官方校验和不匹配');
// macOS 与现代 Windows 均自带 bsdtar，可读取官方 tar.gz / zip；无 shell 字符串拼接。
execFileSync('tar', ['-xf', archive, '-C', cache]);
const runtime = path.join(root, 'src-tauri/runtime');
await fs.rm(runtime, { force: true, recursive: true });
await fs.mkdir(runtime, { recursive: true });
const nodeName = target.platform === 'win32' ? 'node.exe' : 'node';
await fs.copyFile(path.join(cache, distribution, target.platform === 'win32' ? 'node.exe' : 'bin/node'), path.join(runtime, nodeName));
await fs.chmod(path.join(runtime, nodeName), 0o755);
await fs.copyFile(path.join(cache, distribution, 'LICENSE'), path.join(runtime, 'NODE-LICENSE'));
const payload = path.join(root, 'src-tauri/payload');
await fs.rm(payload, { force: true, recursive: true });
await fs.mkdir(payload, { recursive: true });
// 白名单复制；绝不把开发机账号、密钥、日志、测试与设计资料打包。
for (const entry of ['server.js', 'lib', 'desktop']) await fs.cp(path.join(root, entry), path.join(payload, entry), { recursive: true });
await fs.cp(path.join(root, 'public'), path.join(payload, 'public'), { recursive: true });
await fs.cp(path.join(root, 'dist'), path.join(payload, 'public'), { recursive: true });
await assertCleanRelease(payload);
await fs.mkdir(path.join(root, 'plugin/desktop'), { recursive: true });
for (const file of ['platform.cjs', 'runtime.cjs', 'diagnostics.cjs', 'command-compat.cjs']) await fs.copyFile(path.join(root, 'desktop', file), path.join(root, 'plugin/desktop', file));
console.log(`桌面资源已准备：${target.name}，Node 官方 SHA256 校验通过`);
