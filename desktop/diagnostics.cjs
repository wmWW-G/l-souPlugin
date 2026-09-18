'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { desktopPaths, supportDirectory, systemCompatibility } = require('./platform.cjs');
const { diagnoseAccioEnvironment, startupIssue } = require('./runtime.cjs');

/** 读取最后一次启动的安全摘要；仅取固定状态/错误码/时间，不输出日志原文、任意字段或路径。 */
function lastStartup(directory = supportDirectory()) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(directory, 'startup-status.json'), 'utf8'));
    const checkedAt = new Date(data.checkedAt).toISOString();
    const state = ['connecting', 'ready', 'error', 'stopped'].includes(data.state) ? data.state : 'unknown';
    const native = Number.isInteger(data.nativePid) && data.nativePid > 1;
    let processAlive = native ? false : null;
    if (native) {
      try { process.kill(data.nativePid, 0); processAlive = true; } catch { /* 历史记录不代表进程仍在。 */ }
    }
    return { checkedAt, state, source: native ? 'tauri' : 'standalone', processAlive, issue: data.code ? startupIssue(data.code) : null };
  } catch { return null; }
}

/** 读取原生启动日志末尾的固定字段。directory 为私有目录；返回安全事件，不输出原始日志/路径/环境值，损坏记录跳过。 */
function nativeStartup(directory = supportDirectory()) {
  // 错误正文只在本机保存，不自动进入 MCP 返回；由排障时读取并复核脱敏摘要。
  let evidenceAvailable = false;
  try { evidenceAvailable = fs.statSync(path.join(directory, 'native-evidence.log')).size > 0; } catch { /* 旧版或尚未启动。 */ }
  const stages = new Set(['native_entry', 'tauri_setup_enter', 'resource_resolve_failed', 'package_missing',
    'node_spawn_begin', 'node_spawned', 'node_spawn_failed', 'job_ready', 'job_failed', 'backend_ready',
    'backend_error', 'backend_stdout_closed', 'backend_stdout_error', 'backend_exit', 'navigate_failed',
    'native_exit', 'native_panic', 'native_build_failed', 'node_stderr', 'node_module_missing', 'node_syntax_error', 'node_option_error']);
  let file;
  try {
    file = fs.openSync(path.join(directory, 'native.log'), 'r');
    const size = fs.fstatSync(file).size;
    const buffer = Buffer.alloc(Math.min(size, 32768));
    fs.readSync(file, buffer, 0, buffer.length, Math.max(0, size - buffer.length));
    const events = [];
    for (const line of buffer.toString('utf8').split('\n')) {
      try {
        const row = JSON.parse(line);
        if (!stages.has(row.stage) || !Number.isSafeInteger(row.timestampMs) || !Number.isInteger(row.nativePid) || row.nativePid < 1) continue;
        const event = { checkedAt: new Date(row.timestampMs).toISOString(), nativePid: row.nativePid, stage: row.stage };
        for (const key of ['osCode', 'exitCode', 'parentPid']) if (Number.isInteger(row[key])) event[key] = row[key];
        for (const key of ['nodeOptionsSet', 'nodeChannelSet']) if (typeof row[key] === 'boolean') event[key] = row[key];
        events.push(event);
      } catch { /* 文件正在追加或存在坏行时，保留其他有效事件。 */ }
    }
    return { events: events.slice(-24), evidenceAvailable, evidenceFile: 'native-evidence.log', message: '原生阶段日志是历史证据；按时间与 nativePid 对照本次启动。本机 native-evidence.log 含限量脱敏 stderr/panic，读取后仅反馈必要错误摘要，不上传整份日志。' };
  } catch { return { events: [], evidenceAvailable, evidenceFile: 'native-evidence.log', message: '尚无可读取的原生阶段日志。' }; }
  finally { if (file !== undefined) fs.closeSync(file); }
}

/** 检查本插件目标程序与 Node 是否完整；root 为插件目录；返回布尔状态，不启动程序或修改文件。 */
function inspectPackage(root) {
  try {
    const paths = desktopPaths(root);
    const files = [paths.executable, paths.node];
    const present = files.every(file => { try { return fs.statSync(file).isFile(); } catch { return false; } });
    const executable = present && files.every(file => { try { fs.accessSync(file, process.platform === 'win32' ? fs.constants.R_OK : fs.constants.X_OK); return true; } catch { return false; } });
    return { ok: present && executable, target: paths.target, present, executable,
      issue: !present ? 'PACKAGE_INCOMPLETE' : !executable ? 'PACKAGE_PERMISSION' : null };
  } catch { return { ok: false, present: false, executable: false, issue: 'PLATFORM_UNSUPPORTED' }; }
}

/** 生成 Skill 可读取的脱敏诊断；root 为插件目录，desktop 为当前 MCP 状态；返回只读检查结果，不抛内部异常。 */
async function diagnoseDesktop(root, desktop) {
  const runtime = await diagnoseAccioEnvironment();
  const compatibility = systemCompatibility();
  const packageState = inspectPackage(root);
  const last = lastStartup();
  return { checkedAt: new Date().toISOString(), environmentReady: runtime.ok && packageState.ok && compatibility.supported,
    platform: process.platform, architecture: process.arch, compatibility, package: packageState,
    runtime, desktop, lastStartup: last, nativeStartup: nativeStartup(),
    message: '诊断只验证启动依赖；后端就绪、窗口可见、店铺数据读取分别验收。' };
}
module.exports = { diagnoseDesktop, inspectPackage, lastStartup, nativeStartup };
