'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);

// 错误文案只从固定表产生；底层 stderr、账号路径和登录凭据不会进入诊断输出。
const ISSUES = {
  ACCIO_UNAVAILABLE: ['无法连接本机 Accio Work', '打开 Accio Work 并等待加载完成，再重试。', true],
  SPACE_UNAVAILABLE: ['Accio Work 尚未提供活动空间', '在 Accio Work 中完成登录并进入需要使用的空间。', true],
  CREDENTIALS_MISSING: ['当前 Accio Work 登录会话尚未就绪', '在 Accio Work 中完成登录，再重试连接。', true],
  PLUGIN_MISSING: ['当前空间未安装国际站生意助手', '在当前空间安装并启用国际站生意助手。', false],
  PLUGIN_DISABLED: ['当前空间的国际站生意助手未启用', '在 Accio Work 插件管理中启用国际站生意助手。', false],
  WORKCTL_INSTALLING: ['Accio Work 正在安装国际站连接工具', '等待 Accio Work 完成插件更新后重试。', true],
  WORKCTL_MISSING: ['未找到当前版本的国际站连接工具', '在 Accio Work 中检查国际站生意助手的安装状态，完成安装或修复后重试。', false],
  WORKCTL_PERMISSION: ['国际站连接工具不可执行', '通过 Accio Work 修复国际站生意助手安装；无需更改系统安全设置。', false],
  WORKCTL_ENTRY_INVALID: ['国际站连接工具入口不合法', '通过 Accio Work 重新安装当前版本的国际站生意助手。', false],
  WORKCTL_OS_UNSUPPORTED: ['国际站连接工具与当前系统不兼容', '将系统版本和此错误码反馈给提供插件的人，核对工具的系统要求。', false],
  GATEWAY_AUTH_FAILED: ['当前 Accio Work 会话认证未通过', '在 Accio Work 中重新登录当前账号后重试。', false],
  WORKCTL_TIMEOUT: ['国际站连接检查超时', '等待 Accio Work 完成加载后重试；持续失败时反馈诊断结果。', true],
  WORKCTL_HEALTH_FAILED: ['国际站连接工具健康检查失败', '在 Accio Work 中检查国际站生意助手状态，再运行诊断。', false],
  SCHEMA_UNAVAILABLE: ['国际站经营接口尚不可用', '检查当前空间的国际站生意助手是否加载完成，再重试。', true],
  PUBLISH_SCHEMA_UNAVAILABLE: ['国际站产品发布接口尚不可用', '检查国际站生意助手的产品发布能力是否加载完成。', false],
  BACKEND_EXITED: ['来搜后端服务已退出', '让 Accio Work 使用来搜启动排障 Skill 检查并重试。', false],
  BACKEND_TIMEOUT: ['来搜后端未在限定时间内就绪', '让 Accio Work 使用来搜启动排障 Skill 重新诊断。', false],
  STARTUP_FAILED: ['来搜启动检查未完成', '让 Accio Work 使用来搜启动排障 Skill 读取诊断结果。', false],
};

/** 返回可公开的固定故障信息；code 为枚举名；未知值收敛为 STARTUP_FAILED，不抛错。 */
function startupIssue(code) {
  if (!Object.hasOwn(ISSUES, code)) code = 'STARTUP_FAILED';
  const [message, action, retryable] = ISSUES[code];
  return { code, message, action, retryable };
}
/** 构建安全异常；code 为固定错误码；不附加原始异常以防被日志展开。 */
function failure(code) { return Object.assign(new Error(startupIssue(code).message), { code }); }
/** 读取 JSON；file 为路径，code 为对外错误码；读取/格式失败只抛安全异常。 */
function readJson(file, code) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw failure(code); } }
/** 检查路径是否位于 root 内；不依赖字符串前缀；参数为绝对路径，返回布尔值。 */
function inside(root, file) {
  const relative = path.relative(root, file);
  return relative !== '' && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
}

/**
 * 解析当前空间的 Workctl，优先使用 Accio 安装记录和注入路径，再兼容 generations / versions。
 * options 包含 pluginRoot、version、platform、registry、env；返回入口与来源；不可用时抛安全异常。
 * 只接受当前空间、当前声明版本，不搜索其他账号、全局 CLI，也不改写 Accio 安装状态。
 */
function resolveWorkctl({ pluginRoot, version, platform, registry, env }) {
  const toolRoot = path.join(pluginRoot, 'data/cli-tools/plugins/alibaba-com-seller-assistant/tools/workctl');
  const state = registry?.cliToolStates?.workctl;
  if (state?.status === 'installing') throw failure('WORKCTL_INSTALLING');
  const candidates = [];
  // resolvedPath 是 Accio 的真实安装结果，未来改变中间目录时也不必猜安装批次。
  if (state?.status === 'installed' && state.installedVersion === version && typeof state.resolvedPath === 'string') {
    candidates.push({ file: state.resolvedPath, source: 'registry' });
  }
  if (typeof env.PHOENIX_PLUGIN_CLI_WORKCTL_PATH === 'string') candidates.push({ file: env.PHOENIX_PLUGIN_CLI_WORKCTL_PATH, source: 'environment' });
  const suffix = platform === 'win32' ? 'workctl.cmd' : 'bin/workctl';
  const generations = path.join(toolRoot, 'generations', version);
  try {
    // 注册表在更新中暂时过时时，仅补查当前版本；按最近安装排序，逐个验证完整性。
    const dirs = fs.readdirSync(generations, { withFileTypes: true }).filter(item => item.isDirectory())
      .map(item => ({ name: item.name, time: fs.statSync(path.join(generations, item.name)).mtimeMs }))
      .sort((a, b) => b.time - a.time || a.name.localeCompare(b.name));
    for (const dir of dirs) candidates.push({ file: path.join(generations, dir.name, 'prefix', suffix), source: 'generations' });
  } catch { /* 旧版 Accio 没有 generations，继续检查旧目录。 */ }
  const legacyPrefix = path.join(toolRoot, 'versions', version, 'prefix');
  candidates.push({ file: path.join(legacyPrefix, suffix), source: 'versions' });
  let permissionDenied = false;
  for (const candidate of candidates) {
    const file = path.resolve(candidate.file);
    if (!inside(toolRoot, file)) continue;
    const prefix = platform === 'win32' ? path.dirname(file) : path.dirname(path.dirname(file));
    const packageRoot = path.join(prefix, platform === 'win32' ? 'node_modules/@accio-ai/cli' : 'lib/node_modules/@accio-ai/cli');
    const packageFile = path.join(packageRoot, 'package.json');
    let pkg;
    try {
      if (fs.existsSync(packageFile)) {
        pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
        // 保留旧版原生可执行入口；新目录必须核对包身份和版本，防止误用旧版/别的工具。
        if (pkg.version !== undefined && pkg.version !== version) continue;
        if (pkg.name !== undefined && pkg.name !== '@accio-ai/cli') continue;
      }
      if (candidate.source !== 'versions' && (pkg?.version !== version || pkg?.name !== '@accio-ai/cli')) continue;
      if (platform === 'win32') {
        const bin = typeof pkg?.bin === 'string' ? pkg.bin : pkg?.bin?.workctl;
        if (typeof bin !== 'string') continue;
        const entry = path.resolve(packageRoot, bin);
        if (!inside(packageRoot, entry)) throw failure('WORKCTL_ENTRY_INVALID');
        if (!inside(fs.realpathSync(toolRoot), fs.realpathSync(entry))) continue;
        fs.accessSync(entry, fs.constants.R_OK);
        return { workctl: process.execPath, entry, source: candidate.source };
      }
      if (!inside(fs.realpathSync(toolRoot), fs.realpathSync(file))) continue;
      fs.accessSync(file, fs.constants.X_OK);
      return { workctl: file, source: candidate.source };
    } catch (error) {
      if (error.code === 'WORKCTL_ENTRY_INVALID') throw error;
      if (error.code === 'EACCES' || error.code === 'EPERM') permissionDenied = true;
    }
  }
  throw failure(permissionDenied ? 'WORKCTL_PERMISSION' : 'WORKCTL_MISSING');
}

/** 将 CLI 错误分类；error 只用于内存判断，fallback 为枚举名；返回安全异常，不保留 stderr。 */
function cliFailure(error, fallback) {
  const raw = `${error?.stderr || ''} ${error?.stdout || ''} ${error?.message || ''}`;
  if (/401|403|unauthorized|invalid.token|token.expired|认证失败/i.test(raw)) return failure('GATEWAY_AUTH_FAILED');
  if (/dyld|symbol not found|bad cpu type|wrong architecture|not a valid win32|unsupported.*(?:os|platform)/i.test(raw)) return failure('WORKCTL_OS_UNSUPPORTED');
  if (error?.code === 'EACCES' || error?.code === 'EPERM') return failure('WORKCTL_PERMISSION');
  if (error?.killed || error?.code === 'ETIMEDOUT' || /timed? ?out/i.test(raw)) return failure('WORKCTL_TIMEOUT');
  return failure(fallback);
}

/**
 * 从当前 Accio 会话生成后端环境。options 可注入测试参数、execFile、onCheck；返回包含私密凭据的环境，禁止直接输出。
 * 依次验证会话、插件、CLI 与只读 schema；失败抛带固定 code 的安全错误。
 */
async function resolveAccioEnvironment(options = {}) {
  const inherited = options.env || process.env;
  const check = options.onCheck || (() => {});
  const healthUrl = options.healthUrl || inherited.ACCIO_HEALTH_URL || 'http://127.0.0.1:4097/health';
  let health;
  try {
    const url = new URL(healthUrl);
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw failure('ACCIO_UNAVAILABLE');
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw failure('ACCIO_UNAVAILABLE');
    health = await response.json();
  } catch { throw failure('ACCIO_UNAVAILABLE'); }
  check({ stage: 'accio', status: 'passed' });
  const space = health.bootTiming?.stages?.filter(item => item.stage === 'resource_identity_gate').at(-1)?.detail?.storageKey;
  if (typeof space !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(space)) throw failure('SPACE_UNAVAILABLE');
  const accounts = options.accountsRoot || inherited.ACCIO_ACCOUNTS_ROOT || path.join(os.homedir(), '.accio/accounts');
  const gateway = readJson(path.join(accounts, space.split('_')[0], '.accio/runtime/gateway-cli.json'), 'CREDENTIALS_MISSING');
  if (typeof gateway.password !== 'string' || !gateway.password) throw failure('CREDENTIALS_MISSING');
  check({ stage: 'session', status: 'passed' });
  const pluginRoot = path.join(accounts, space, 'plugins');
  const manifest = readJson(path.join(pluginRoot, 'installed/alibaba-com-seller-assistant/clis/clis.json'), 'PLUGIN_MISSING');
  const version = manifest.tools?.find(item => item.id === 'workctl')?.source?.version;
  if (typeof version !== 'string' || !/^[0-9A-Za-z.+-]+$/.test(version)) throw failure('WORKCTL_MISSING');
  let registry;
  try { registry = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'plugins.json'), 'utf8'))['alibaba-com-seller-assistant']; } catch { /* 兼容无注册表的旧版。 */ }
  if (registry?.enabled === false) throw failure('PLUGIN_DISABLED');
  check({ stage: 'plugin', status: 'passed', version });
  const platform = options.platform || process.platform;
  const selected = resolveWorkctl({ pluginRoot, version, platform, registry, env: inherited });
  check({ stage: 'workctl', status: 'passed', version, source: selected.source });
  const delimiter = platform === 'win32' ? ';' : ':';
  const env = { ...inherited, ACCIO_ACTIVE_SPACE: space, ACCIO_GATEWAY_TOKEN: gateway.password,
    ACCIO_LOCAL_GATEWAY_URL: gateway.url || 'http://localhost:4097', WORKCTL_BIN: selected.workctl,
    LSOU_WORKCTL_SOURCE: selected.source, LSOU_WORKCTL_VERSION: version,
    PATH: [path.dirname(process.execPath), path.dirname(selected.workctl), inherited.PATH || inherited.Path || ''].join(delimiter) };
  delete env.WORKCTL_ENTRY;
  if (selected.entry) env.WORKCTL_ENTRY = selected.entry;
  if (platform === 'win32') for (const key of Object.keys(env)) if (key !== 'PATH' && key.toUpperCase() === 'PATH') delete env[key];
  if (options.verify !== false) {
    const run = options.execFile || execFile;
    for (const [stage, args, code] of [
      ['authentication', ['health', '--format', 'json'], 'WORKCTL_HEALTH_FAILED'],
      ['schema', ['schema', 'icbu', 'advisor', 'data-advisor-shop-summary', '--format', 'json'], 'SCHEMA_UNAVAILABLE'],
    ]) {
      try {
        const { stdout } = await run(selected.workctl, selected.entry ? [selected.entry, ...args] : args, { env, windowsHide: true, timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
        if (JSON.parse(stdout).success !== true) throw { stdout };
      } catch (error) { throw cliFailure(error, code); }
      check({ stage, status: 'passed' });
    }
  }
  return env;
}

/** 运行只读诊断；options 同解析器；仅返回时间、检查结果和固定错误信息，绝不返回环境/账号/路径。 */
async function diagnoseAccioEnvironment(options = {}) {
  const checks = [];
  try {
    await resolveAccioEnvironment({ ...options, onCheck: item => checks.push(item) });
    return { ok: true, checkedAt: new Date().toISOString(), checks, issue: null };
  } catch (error) {
    const issue = startupIssue(error.code);
    checks.push({ stage: 'failure', status: 'failed', code: issue.code });
    return { ok: false, checkedAt: new Date().toISOString(), checks, issue };
  }
}
module.exports = { resolveAccioEnvironment, diagnoseAccioEnvironment, startupIssue };

/** 本地开发入口共用桌面发现逻辑，并保留原 start.sh 的发布 schema 只读预检。 */
async function startDevelopment() {
  const env = await resolveAccioEnvironment();
  const queries = [
    ['schema', 'icbu', 'product', 'new-publish-product', '--format', 'json'],
    ['publishflow', '--help'],
  ];
  for (const args of queries) {
    try {
      const { stdout } = await execFile(env.WORKCTL_BIN, env.WORKCTL_ENTRY ? [env.WORKCTL_ENTRY, ...args] : args, { env, timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
      if (args[0] === 'schema' ? JSON.parse(stdout).success !== true
        : !stdout.includes('publish-from-json') || !stdout.includes('query-template-info-by-id')) throw failure('PUBLISH_SCHEMA_UNAVAILABLE');
    } catch (error) { throw cliFailure(error, 'PUBLISH_SCHEMA_UNAVAILABLE'); }
  }
  delete process.env.WORKCTL_ENTRY;
  Object.assign(process.env, env);
  console.log(`[workctl-dashboard] 当前会话检查通过 Workctl ${env.LSOU_WORKCTL_VERSION} source=${env.LSOU_WORKCTL_SOURCE}`);
  require('../server.js');
}
if (require.main === module && process.argv.includes('--start-development')) {
  startDevelopment().catch(error => {
    const issue = startupIssue(error.code);
    console.error(`[workctl-dashboard] ${issue.message}。${issue.action}（${issue.code}）`);
    process.exitCode = 1;
  });
}
