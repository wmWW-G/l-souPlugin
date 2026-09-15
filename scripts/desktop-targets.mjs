import path from 'node:path';
export const root = path.resolve(import.meta.dirname, '..');
export const targets = {
  'macos-arm64': { platform: 'darwin', arch: 'arm64', triple: 'aarch64-apple-darwin' },
  'macos-x64': { platform: 'darwin', arch: 'x64', triple: 'x86_64-apple-darwin' },
  'windows-x64': { platform: 'win32', arch: 'x64', triple: 'x86_64-pc-windows-msvc' },
};
/** 解析命令行 --target（产品平台名）；argv 为参数数组，返回目标及编译配置；不支持时抛错。 */
export function selectedTarget(argv = process.argv.slice(2)) {
  const index = argv.indexOf('--target');
  const name = index < 0 ? (process.platform === 'darwin' ? `macos-${process.arch}` : `windows-${process.arch}`) : argv[index + 1];
  if (!targets[name]) throw new Error(`目标必须是 ${Object.keys(targets).join(', ')}`);
  return { name, ...targets[name] };
}
