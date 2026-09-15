'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fork } = require('node:child_process');
const { resolveAccioEnvironment, startupIssue } = require('./runtime.cjs');
const { supportDirectory } = require('./platform.cjs');
const support = supportDirectory();
fs.mkdirSync(support, { recursive: true, mode: 0o700 });
const log = fs.openSync(path.join(support, 'desktop.log'), 'a', 0o600);
let backend;
let stopped = false;
let startupState = 'connecting';
let readyTimer;

/** 保存固定字段的启动摘要；state/code 为枚举；原子替换，写入失败不输出原始异常。 */
function saveStatus(state, code) {
  startupState = state;
  try {
    const file = path.join(support, 'startup-status.json');
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ checkedAt: new Date().toISOString(), state,
      nativePid: Number(process.env.LSOU_NATIVE_PID || 0), ...(code ? { code: startupIssue(code).code } : {}) }), { mode: 0o600 });
    fs.renameSync(temporary, file);
  } catch { record('启动摘要写入失败'); }
}
/** 报告固定分类错误；error 仅取已知 code；不输出命令、stderr 或凭据。 */
function reportFailure(error) {
  if (stopped) return;
  const issue = startupIssue(error?.code);
  saveStatus('error', issue.code);
  record(`启动失败 [${issue.code}] ${issue.message}`);
  process.stdout.write(JSON.stringify({ type: 'error', message: `${issue.message}。${issue.action}（${issue.code}）` }) + '\n');
  stop(1);
}
/** 最多三次重新发现临时未就绪依赖；失败重读当前会话，不复用旧 token，不安装或回退 CLI。 */
async function connect() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await resolveAccioEnvironment({ onCheck: check => record(`检查通过 ${check.stage}${check.version ? ` version=${check.version}` : ''}${check.source ? ` source=${check.source}` : ''}`) });
    } catch (error) {
      const issue = startupIssue(error.code);
      if (!issue.retryable || attempt === 3 || stopped) throw error;
      record(`等待依赖后重试 ${attempt}/3 [${issue.code}]`);
      await new Promise(resolve => setTimeout(resolve, 1500));
      if (stopped) throw error;
    }
  }
}

/** 记录生命周期；message 为不含凭据的字符串；返回 void，日志写入失败会抛错。 */
function record(message) { fs.writeSync(log, `${new Date().toISOString()} [desktop] ${message}\n`); }
/** 停止后端；code 为退出码；返回 void；进程不存在不抛错。 */
function stop(code = 0) {
  if (stopped) return;
  stopped = true;
  clearTimeout(readyTimer);
  if (startupState !== 'error') saveStatus('stopped');
  record('停止后端');
  backend?.kill('SIGTERM');
  setTimeout(() => { backend?.kill('SIGKILL'); process.exit(code); }, 1200);
}
/** 启动当前账号后端，返回 Promise<void>；依赖错误交由顶层显示。 */
async function main() {
  record('开始识别当前 Accio Work 会话');
  saveStatus('connecting');
  const env = await connect();
  if (stopped) return;
  // 本机 Dify 配置独立于可分发插件；图片上传直接复用上面发现的 Accio 会话。
  const configFile = path.join(support, 'desktop.env');
  if (fs.existsSync(configFile)) {
    const allowed = new Set(['DIFY_API_KEY', 'DIFY_API_BASE_URL', 'DIFY_ANALYSIS_API_KEY', 'DIFY_CHATFLOW_API_KEY']);
    for (const line of fs.readFileSync(configFile, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^([A-Z_]+)=(.*)$/);
      if (match && allowed.has(match[1])) env[match[1]] = match[2].trim();
    }
  }
  const ticket = crypto.randomBytes(32).toString('hex');
  backend = fork(path.join(__dirname, '../server.js'), [], {
    execPath: process.execPath, cwd: path.join(__dirname, '..'),
    env: { ...env, PORT: '0', LSOU_DESKTOP_TOKEN: ticket, LSOU_PUBLIC_DIR: path.join(__dirname, '../public'),
      ...(process.platform === 'win32' ? { OPERATIONS_STATE_DIR: path.join(support, 'operations') } : {}) },
    stdio: ['ignore', log, log, 'ipc'],
  });
  backend.on('message', message => {
    if (message.type === 'lsou:ready' && Number.isInteger(message.port)) {
      clearTimeout(readyTimer);
      saveStatus('ready');
      record('后端已就绪');
      process.stdout.write(JSON.stringify({ type: 'ready', url: `http://127.0.0.1:${message.port}/?desktopTicket=${ticket}` }) + '\n');
    }
  });
  backend.on('error', () => reportFailure({ code: 'BACKEND_EXITED' }));
  backend.on('exit', () => { if (!stopped) reportFailure({ code: 'BACKEND_EXITED' }); });
  readyTimer = setTimeout(() => reportFailure({ code: 'BACKEND_TIMEOUT' }), 15000);
  const owner = Number(process.env.LSOU_NATIVE_PID || 0);
  if (owner > 1) setInterval(() => { try { process.kill(owner, 0); } catch { stop(); } }, 1000).unref();
}
process.on('SIGTERM', () => stop());
process.on('SIGINT', () => stop());
main().catch(reportFailure);
