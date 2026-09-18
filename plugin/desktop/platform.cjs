'use strict';
const path = require('node:path');
const os = require('node:os');

/** 返回正式交付目标。platform/arch 为 Node 平台名；未知组合抛错，防止误运行别的平台程序。 */
function targetFor(platform = process.platform, arch = process.arch) {
  const targets = { 'darwin-arm64': 'macos-arm64', 'darwin-x64': 'macos-x64', 'win32-x64': 'windows-x64' };
  const target = targets[`${platform}-${arch}`];
  if (!target) throw new Error(`暂不支持此系统或芯片：${platform}/${arch}`);
  return target;
}

/** 获取本机私有配置目录。options 可注入平台/home/env用于测试；返回路径，无文件写入。 */
function supportDirectory({ platform = process.platform, home = os.homedir(), env = process.env } = {}) {
  return platform === 'win32'
    ? path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'com.lsou.workbench')
    : path.join(home, 'Library', 'Application Support', 'com.lsou.workbench');
}

/** 根据目标定位插件内原生应用及资源。root 为插件根路径；返回路径对象，未知平台抛错。 */
function desktopPaths(root, platform = process.platform, arch = process.arch) {
  const target = targetFor(platform, arch);
  const base = path.join(root, 'resources', target);
  const resource = platform === 'darwin' ? path.join(base, 'LSOUWorkbench.app', 'Contents', 'Resources') : base;
  return {
    target, resource,
    executable: platform === 'darwin'
      ? path.join(base, 'LSOUWorkbench.app', 'Contents', 'MacOS', 'lsou-workbench')
      : path.join(base, 'lsou-workbench.exe'),
    node: path.join(resource, 'runtime', platform === 'win32' ? 'node.exe' : 'node'),
  };
}
/** 根据Darwin主版本判断最低macOS要求；可注入平台与内核版本测试；返回支持结果，不抛异常。 */
function systemCompatibility(platform=process.platform,release=os.release()) {
  if(platform!=='darwin')return {supported:true};
  const major=Number(String(release).split('.')[0]);
  return {supported:Number.isInteger(major)&&major>=20,minimumMacOS:'11.0',kernelRelease:release};
}
module.exports = { targetFor, supportDirectory, desktopPaths, systemCompatibility };
