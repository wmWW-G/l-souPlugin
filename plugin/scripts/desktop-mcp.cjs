'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { desktopPaths, supportDirectory, systemCompatibility } = require('../desktop/platform.cjs');
const { diagnoseDesktop, inspectPackage } = require('../desktop/diagnostics.cjs');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const version = '1.0.9';
if (process.argv.includes('--version')) { console.log(version); process.exit(0); }
const root = path.resolve(__dirname, '..');
const logDir = supportDirectory();
fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });
const log = fs.openSync(path.join(logDir, 'plugin.log'), 'a', 0o600);
let child;
let state = 'stopped';
let closing = false;
let repairPromise;
let stopPromise;
let lifecycleRevision = 0;
let startupTimer;
let recoveryState = 'idle';
let lastRecovery = null;

/** 写入无敏感内容的生命周期日志。text 为字符串，返回 void；磁盘错误会抛出。 */
function record(text) { fs.writeSync(log, `${new Date().toISOString()} [plugin] ${text}\n`); }
/** 启动或复用本插件窗口。参数无，返回状态对象；启动错误转为状态。 */
function start() {
  if (child || closing || stopPromise) return status();
  if(!systemCompatibility().supported){state="unsupported_os";record("系统版本不满足要求：需要macOS 11.0及以上");return status();}
  let executable;
  try {
    const selected = desktopPaths(root);
    executable = selected.executable;
    fs.accessSync(executable);
    fs.accessSync(selected.node);
    // Accio 解压可能清除可执行位；同时恢复原生窗口和它使用的 Node，不能只修窗口程序。
    if (process.platform !== 'win32') {
      fs.chmodSync(executable, 0o755);
      fs.chmodSync(selected.node, 0o755);
    }
  } catch { state = 'missing_platform_build'; record('安装包缺少当前系统的桌面程序，请安装对应版本'); return status(); }
  state = 'starting'; record('启动 Tauri');
  child = spawn(executable, [], { cwd: root, windowsHide: true, env: { ...process.env, LSOU_PLUGIN_PARENT_PID: String(process.pid) }, stdio: ['ignore', 'pipe', log] });
  const current = child;
  startupTimer = setTimeout(() => { if (child === current && state === 'starting') { state = 'error'; record('启动等待超时，请运行来搜诊断'); } }, 90000);
  readline.createInterface({ input: child.stdout }).on('line', line => {
    if (child !== current || state === 'stopping') return;
    if (line === 'LSOU_DESKTOP_READY') { clearTimeout(startupTimer); state = 'ready'; record('Tauri 后端就绪'); }
    if (line === 'LSOU_DESKTOP_ERROR') { clearTimeout(startupTimer); state = 'error'; record('Tauri 启动失败'); }
  });
  child.on('error', () => { if (child !== current) return; clearTimeout(startupTimer); child = null; state = 'error'; record('无法启动 Tauri'); });
  child.on('exit', code => {
    if (child === current) {
      clearTimeout(startupTimer);
      child = null;
      state = closing || state === 'stopping' || code === 0 ? 'stopped' : 'error';
      record(`Tauri 已退出，状态 ${state}，退出码 ${code ?? 'signal'}`);
    }
  });
  return status();
}
/** 返回不含路径/凭据的桌面状态；无参数，返回对象，不抛异常。 */
function status() {
  const messages = {
    stopping: '正在停止本会话的工作台，请等待结束后再启动。',
    stopped: '工作台待命，点击启动页按钮即可打开。', starting: '正在打开工作台并连接当前店铺。', ready: '工作台后端已就绪；此状态不能单独证明用户已看见窗口。',
    unsupported_os: '当前系统不受支持：此版本需要macOS 11.0及以上，窗口尚未打开。',
    error: '工作台启动失败，请让 Accio 读取来搜本机日志并反馈错误摘要。',
    missing_platform_build: '安装包缺少当前系统版本，请导入与电脑芯片对应的独立安装包。',
  };
  return { application: '来搜国际站经营工作台', version, buildRevision: 'lifecycle-r1', frontend: 'React', desktop: 'Tauri', backend: 'Node.js', state,
    platform: process.platform, architecture: process.arch, compatibility:systemCompatibility(), message: messages[state],
    pending: state === 'starting' || state === 'stopping', recoveryState, lastRecovery,
    scope: 'current_mcp_session', backendReady: state === 'ready',
    windowVerified: false, businessDataVerified: false,
    ...(state === 'starting' || state === 'stopping' || recoveryState === 'running' ? { nextCheckAfterMs: 2000 } : {}) };
}
/** 等待启动的最终状态；最多等待指定毫秒数，不把 starting 当作成功。 */
async function waitForStartup(timeout = 90000) {
  const deadline = Date.now() + timeout;
  while (state === 'starting' && Date.now() < deadline && !closing) await new Promise(resolve => setTimeout(resolve, 200));
  return status();
}
/** 给单次工具响应设置 20 秒预算；operation 继续由当前 MCP 管理，超时时返回 pending，不结束进程或伪报成功。 */
async function withinClientDeadline(operation, pendingResult) {
  let timer;
  try {
    return await Promise.race([operation, new Promise(resolve => {
      timer = setTimeout(() => resolve(pendingResult()), 20000);
    })]);
  } finally { clearTimeout(timer); }
}
/** 停止本 MCP 持有的子进程。无参数，返回 Promise<boolean>；信号失败/超时返回 false，不抛出或扫描其他进程。 */
async function stopFailedChild() {
  const current = child;
  if (!current) return true;
  return new Promise(resolve => {
    let escalation;
    let deadline;
    /** 完成退出等待并撤销监听/定时器，避免迟到的信号误伤随后启动的窗口。 */
    const finish = stopped => {
      clearTimeout(escalation); clearTimeout(deadline);
      current.removeListener('exit', exited);
      resolve(stopped);
    };
    /** exit 是本次持有的进程退出证据；kill 返回成功本身不能代替该证据。 */
    const exited = () => finish(true);
    current.once('exit', exited);
    escalation = setTimeout(() => { try { current.kill('SIGKILL'); } catch { finish(false); } }, 1800);
    deadline = setTimeout(() => finish(false), 5000);
    try { current.kill('SIGTERM'); } catch { finish(false); }
  });
}
/** 停止工作台但保留 MCP 待命。无参数，返回共享 Promise<结果>；取消已有恢复，不删除配置或结束其他会话。 */
function stopDesktop() {
  if (stopPromise) return stopPromise;
  lifecycleRevision += 1;
  clearTimeout(startupTimer);
  const hadChild = Boolean(child);
  state = hadChild ? 'stopping' : 'stopped';
  record('开始停止本会话工作台');
  stopPromise = stopFailedChild().then(stopped => {
    state = stopped ? 'stopped' : 'error';
    record(`停止工作台结束 confirmed=${stopped}`);
    return { ok: stopped, desktop: status(), ownedWindowStopped: stopped,
      backendShutdownVerified: false,
      message: stopped
        ? (hadChild ? '本会话工作台进程已退出，后端按既有生命周期机制清理；MCP 保持待命，可再次启动。'
          : '本会话没有运行中的工作台，保持待命；未检查或关闭独立打开的窗口。')
        : '尚未确认本会话工作台退出，请读取诊断；未结束其他进程。' };
  }).finally(() => { stopPromise = null; });
  return stopPromise;
}
/** 执行一次有限恢复：补齐随包可执行权限、重新发现当前会话、重启本 MCP 的失败窗口并验证。 */
async function repairOnce() {
  const revision = lifecycleRevision;
  const cancelled = () => revision !== lifecycleRevision || closing || Boolean(stopPromise);
  const cancelledResult = () => ({ ok: false, cancelled: true, actions, desktop: status(), message: '恢复已被停止请求取消，未重新启动工作台。' });
  record('开始有限启动恢复');
  const actions = [];
  const packaged = inspectPackage(root);
  if (packaged.present && !packaged.executable && process.platform !== 'win32') {
    try {
      const selected = desktopPaths(root);
      for (const file of [selected.executable, selected.node]) fs.chmodSync(file, 0o755);
      actions.push('restored_packaged_executable_permissions');
    } catch { record('随包程序权限恢复失败'); }
  }
  const before = await diagnoseDesktop(root, status());
  if (cancelled()) return cancelledResult();
  if (!before.environmentReady || closing) return { ok: false, actions, diagnosis: before };
  if (state === 'ready') return { ok: true, actions, diagnosis: before, message: '本会话后端已经就绪，保留现有窗口。' };
  // 手工打开的另一个单实例窗口不属于本 MCP；不通过全局 kill 强制关闭它。
  if (!child && before.lastStartup?.processAlive) {
    return { ok: false, actions, diagnosis: before, message: '已有独立打开的来搜窗口。请关闭该窗口后再让 Accio 打开工作台；未强制结束其他进程。' };
  }
  if (state !== 'starting') {
    const stopped = await stopFailedChild();
    if (cancelled()) return cancelledResult();
    if (!stopped) return { ok: false, actions, desktop: status(), message: '旧窗口尚未退出，未启动新窗口。' };
    start();
    actions.push('rediscovered_session_and_restarted_desktop');
  }
  const after = await waitForStartup();
  if (cancelled()) return cancelledResult();
  record(`启动恢复结束 state=${after.state}`);
  return { ok: after.state === 'ready', actions, desktop: after,
    ...(after.state === 'ready' ? { message: '后端已就绪，请继续核对 Tauri 窗口和真实店铺数据。' } : { diagnosis: await diagnoseDesktop(root, after) }) };
}
/** 合并重复恢复请求，避免两个工具调用同时关闭/启动窗口。 */
function repair() {
  if (stopPromise) return Promise.resolve({ ok: false, pending: true, desktop: status(), message: '正在停止工作台，未执行恢复。' });
  if (!repairPromise) {
    recoveryState = 'running';
    lastRecovery = null;
    repairPromise = repairOnce().then(result => {
      lastRecovery = { ok: result.ok, actions: result.actions, message: result.message || '恢复结果已记录，可读取诊断核对失败阶段。' };
      return result;
    }).catch(() => {
      record('启动恢复发生异常');
      lastRecovery = { ok: false, actions: [], message: '恢复检查未完成，请读取诊断。' };
      return lastRecovery;
    }).finally(() => { recoveryState = 'completed'; repairPromise = null; });
  }
  return withinClientDeadline(repairPromise, () => ({ ok: false, pending: true, desktop: status(),
    message: '恢复仍在进行，尚未确认成功。请稍后读取 lsou_desktop_status；保持插件启用，不重复重启。' }));
}
/** 回复 JSON-RPC；id 为请求标识，result 为 JSON 对象；返回 void，管道关闭时由进程事件处理。 */
function reply(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n'); }
/** 终止本会话：参数无，返回 void；不删除用户数据。Tauri 发现父进程退出后自行清理后端。 */
function shutdown() {
  if (closing) return;
  closing = true; clearTimeout(startupTimer); record('插件会话结束');
  if (!child) return process.exit(0);
  // 先释放单实例窗口，再结束 MCP 会话，确保重新加载不会复用正在退出的旧窗口。
  child.once('exit', () => process.exit(0));
  child.kill('SIGTERM');
  setTimeout(() => { child?.kill('SIGKILL'); process.exit(0); }, 1500);
}
const tools = [
  { name: 'lsou_desktop_stop', description: '停止本 MCP 会话启动的来搜窗口，触发所属后端清理；保留插件待命，可再次启动。不删除数据、不关闭 Accio 或其他会话。', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'lsou_desktop_launchpad', description: '取得来搜可交互 HTML 启动页。将返回的 widget 代码块原样渲染到回复；本工具不启动窗口、不查询店铺。', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'lsou_desktop_status', description: '读取来搜 Tauri 桌面工作台运行状态，不查询店铺数据。', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'lsou_desktop_diagnose', description: '诊断来搜启动：检查系统、随包程序、当前 Accio 会话、国际站 CLI 和经营 schema；只返回脱敏结果，不修改设置。', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'lsou_desktop_repair', description: '执行一次有限启动恢复：恢复随包程序执行权限、重新发现当前会话并重启本插件失败窗口；不安装软件、不改账号授权、不写店铺数据。', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'lsou_desktop_open', description: '打开来搜 React + Tauri 工作台及其 Node.js 后端；已经运行时复用。', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
];
// 独立诊断入口在 MCP 或 Tauri 无法连接时仍可运行；不会打开窗口，也不会等待 stdin。
if (process.argv.includes('--diagnose')) {
  diagnoseDesktop(root, status()).then(result => process.stdout.write(JSON.stringify(result) + '\n')).catch(() => {
    process.stdout.write(JSON.stringify({ ok: false, code: 'DIAGNOSTIC_FAILED', message: '诊断未完成，请核对插件包是否完整。' }) + '\n');
    process.exitCode = 1;
  });
} else {
const input = readline.createInterface({ input: process.stdin });
input.on('line', async line => {
  let request;
  try {
    request = JSON.parse(line);
    if (request.id === undefined) return;
    if (request.method === 'initialize') return reply(request.id, { protocolVersion: request.params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'lsou-desktop', version } });
    if (request.method === 'ping') return reply(request.id, {});
    if (request.method === 'tools/list') return reply(request.id, { tools });
    if (request.method === 'resources/list') return reply(request.id, { resources: [] });
    if (request.method === 'prompts/list') return reply(request.id, { prompts: [] });
    if (request.method === 'tools/call' && tools.some(tool => tool.name === request.params?.name)) {
      if (request.params.arguments && Object.keys(request.params.arguments).length) return reply(request.id, { isError: true, content: [{ type: 'text', text: '此工具不接受参数。' }] });
      const name = request.params.name;
      if (name === 'lsou_desktop_launchpad') {
        const html = fs.readFileSync(path.join(root, 'skills/lsou-launchpad/assets/launchpad.html'), 'utf8');
        // widget 已有自己的 HTML 文档；只提取样式和 body 内容，避免让模型重新生成设计。
        const style = html.match(/<style>[\s\S]*?<\/style>/)?.[0];
        const body = html.match(/<body>([\s\S]*?)<\/body>/)?.[1]?.trim();
        if (!style || !body) throw new Error('Launchpad template is incomplete');
        return reply(request.id, { content: [{ type: 'text', text: '```widget lsou_launchpad\n' + style + '\n' + body + '\n```' }] });
      }
      if (name === 'lsou_desktop_open') start();
      const result = name === 'lsou_desktop_diagnose' ? await diagnoseDesktop(root, status())
        : name === 'lsou_desktop_stop' ? await stopDesktop() : name === 'lsou_desktop_repair' ? await repair() : name === 'lsou_desktop_open'
          ? await withinClientDeadline(waitForStartup(), () => ({ ...status(), message: '工作台仍在启动，尚未确认就绪。请稍后读取 lsou_desktop_status；保持插件启用。' })) : status();
      return reply(request.id, { content: [{ type: 'text', text: JSON.stringify(result) }] });
    }
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } }) + '\n');
  } catch { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request?.id ?? null, error: { code: -32603, message: 'Desktop request failed' } }) + '\n'); }
});
input.on('close', shutdown);
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
process.stdout.on('error', shutdown);
// 用户选择先看 Accio HTML 启动页，再点击开工。MCP 连接不抢先打开窗口。
record('插件已连接，等待用户点击启动工作台');

}
