'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { openAW, scrub, launchErrorDetails, skillRequestMessage } = require('./aw-handoff');
const { normalizePeriod, metricDictionary } = require('./analysis-context');
const repo = path.join(__dirname, '..');
// 同一业务能力可从相关页面进入；目录仍只保留一份Skill，历史按实际入口页保存。
const catalog = JSON.parse(fs.readFileSync(path.join(repo, 'plugin/analysis-skills.json'), 'utf8')).skills.filter(s => s.output === 'html_report').map(s => ({
  ...s, ...(s.skill === 'lsou-ad-knowledge' ? { page: 'ads', page_label: '运营推广', topic_index: 3 } : {}),
  available_pages: s.skill === 'lsou-ad-diagnosis' ? ['product', 'ads'] : [s.skill === 'lsou-ad-knowledge' ? 'ads' : s.page]
}));
const maxBytes = 2 * 1024 * 1024;
const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; script-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'">`;

/** 对字符串/Buffer生成稳定指纹；返回十六进制，不保存任何凭据。 */
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

/** 读取白名单主题当前规则的指纹；name为Skill名称，缺失返回null，不接受外部路径。 */
function currentSkillHash(name) {
  if (!catalog.some(s => s.skill === name)) return null;
  const file = path.join(repo, 'plugin/skills', name, 'SKILL.md');
  return fs.existsSync(file) ? hash(fs.readFileSync(file)) : null;
}

/** 原子写入本机文件；目标路径由服务端固定，失败抛错且旧文件保持有效。 */
function write(file, value) {
  fs.writeFileSync(file + '.tmp', value, { mode: 0o600 });
  fs.renameSync(file + '.tmp', file);
}

/** 提取有限业务文本用于历史上下文；删除样式/标签，绝不把报告当执行指令。 */
function plain(html, limit = 4000) {
  return html.replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

/**
 * 验证完整静态报告并添加强制内容策略；html为不可信模型字符串，返回可展示/下载HTML。
 * 原文转义后的标签属于业务证据，不当成实际标签。格式不合约时抛出中文错误。
 * 校验负责反馈质量问题；内容策略和前端sandbox共同阻止报告执行程序或读取网络。
 */
function validatedHtml(html) {
  // 报告模板使用简单文档外壳。先去除完整注释，再要求真实的文档开头，
  // 不能在任意位置搜索<head>，否则注释内的伪标签可能吞掉安全策略。
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  // 模型参考已保存报告时可能保留本服务注入的同一安全策略；移除这个
  // 完全匹配的策略后重新注入一次。其他http-equiv仍拒绝，尤其是跳转。
  html = html.split(csp).join('');
  const shell = /^\s*<!doctype html>\s*<html(?:\s+lang=(?:"[a-z0-9-]+"|'[a-z0-9-]+'))?\s*>\s*<head\s*>/i;
  if (!shell.test(html) || /<!--|-->/.test(html)) throw new Error('报告文档结构不完整，请按报告模板重新保存');
  if (!/<!doctype html/i.test(html) || !/<html\b/i.test(html) || !/<head\b/i.test(html) || !/<body\b/i.test(html) || !/<\/html>\s*$/i.test(html)) throw new Error('报告尚未完整保存，请等待生成结束');
  if (/\{\{[^}]+\}\}|\[\[(?:TITLE|SUMMARY|CONTENT)/.test(html)) throw new Error('报告仍有未填写的内容，请重新生成');
  const tags = html.match(/<[a-z][^>]*>/gi) || [];
  if (tags.some(tag => /^<\s*(?:script|iframe|object|embed|form|base|link|svg|math)\b/i.test(tag) || (/^<meta\b/i.test(tag) && /\bhttp-equiv\s*=/i.test(tag)) || /[\s/]on[a-z]+\s*=/i.test(tag) || /\b(?:href|src)\s*=\s*["']?\s*(?:javascript:|https?:|\/\/)/i.test(tag))) throw new Error('报告包含外部资源、跳转或可执行内容，请重新生成静态报告');
  const visible = plain(html, maxBytes);
  if (!/<table\b/i.test(html) || visible.length < 80) throw new Error('报告缺少完整的分析正文或业务明细表');
  if (/\b(?:Workctl|Dify|MCP|Accio Work)\b|SKILL\.md|mcp__|\blsou-[a-z-]+|\/Users\/|request_id|snapshot_id/i.test(visible)) throw new Error('报告包含内部名称，请改为通俗的业务说明后重新保存');
  return html.replace(shell, match => match + csp);
}

/**
 * 创建账号隔离的分析执行及本地报告服务。
 * scope为账号隔离标识；root/launch可注入隔离测试；taskContext只读已有人工任务。
 * 返回list/generate/read/cancel；格式、存储和启动失败由调用方以中文展示。
 */
function createAnalysisRuns({ scope, root = path.join(os.homedir(), '.lsou', 'analysis-runs'), launch = openAW, taskContext = () => [], log = console.log }) {
  const dir = path.join(root, hash(String(scope)).slice(0, 20));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const indexFile = path.join(dir, 'index.json');
  const state = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : { version: 1, requests: [] };
  const launches = new Map();

  /** 保存唯一主索引；无参数，返回void，写盘失败抛错。 */
  function save() { write(indexFile, JSON.stringify(state, null, 2)); }

  /** 只从登记请求固定目录读取普通文件；size是字节上限，不接受模型提供的路径或符号链接。 */
  function reportFile(request, name) {
    const file = path.join(dir, request.id, name);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) throw new Error('报告文件不符合要求');
    return fs.readFileSync(file, 'utf8');
  }

  /** 导入已经完整落盘的报告一次，保留既有历史；迟到的取消结果不导入。 */
  function sync() {
    for (const r of state.requests) {
      if (!['pending', 'invalid'].includes(r.status) || !fs.existsSync(path.join(dir, r.id, 'report.html'))) continue;
      try {
        const html = validatedHtml(reportFile(r, 'report.html'));
        // 冻结已验收正文，后续外部对原始输出的修改不会悄悄改变历史。
        write(path.join(dir, r.id, 'accepted.html'), html);
        r.status = 'ready'; r.error = ''; r.completedAt = new Date().toISOString(); r.reportHash = hash(html); r.summary = plain(html);
        save(); log('[analysis-runs] 报告已保存', r.id, r.skill);
      } catch (error) {
        if (r.status !== 'invalid' || r.error !== error.message) { r.status = 'invalid'; r.error = error.message; save(); log('[analysis-runs] 报告待修正', r.id); }
      }
    }
  }

  /** 返回业务目录和请求摘要；无输入，不泄露本机路径、数据正文或Skill内部规则。 */
  function list() {
    sync();
    return {
      catalog: catalog.map(({ skill, topic, page, page_label, topic_index, available_pages }) => ({ skill, topic, page, page_label, topic_index, available_pages })),
      requests: state.requests.map(({ id, skill, topic, page, period, status, createdAt, completedAt, error, skillHash }) => ({ id, skill, topic, page, period, status, createdAt, completedAt, error, methodChanged: Boolean(skillHash && skillHash !== currentSkillHash(skill)) }))
    };
  }

  /**
   * 保存点击快照、Skill及模板后发起一次真实宿主分析；input为白名单业务请求。
   * 历史结论带原周期进入上下文，不能覆盖本次输入。相同编号重试幂等，资料变化则拒绝。
   */
  async function generate(input) {
    const item = catalog.find(s => s.skill === input?.skill);
    if (!item || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId || '')) throw new Error('请选择有效的分析项目后重试');
    const period = normalizePeriod(input.period);
    const entryPage = input.entry_page || item.page;
    if (!item.available_pages.includes(entryPage)) throw new Error('分析项目与当前页面不匹配，请重新选择');
    if (!Array.isArray(input.records) || (input.data != null && (typeof input.data !== 'object' || Array.isArray(input.data)))) throw new Error('本次经营资料格式不完整，请刷新后重试');
    const business = scrub({ entry_page: entryPage, period, records: input.records, data: input.data || {}, selected_product: input.selected_product || null, instruction: String(input.instruction || '').trim().slice(0, 3000), captured_at: input.captured_at || null, timezone: input.timezone || null });
    const encoded = JSON.stringify(business);
    if (Buffer.byteLength(encoded) > 1900000) throw new Error('资料过多，尚未发起分析；请缩小范围后重试');
    const fingerprint = hash(encoded);
    sync();
    const previous = state.requests.find(r => r.id === input.requestId);
    if (previous) {
      if (previous.fingerprint !== fingerprint || previous.skill !== item.skill) throw new Error('同一次请求的资料已变化，请重新点击分析');
      if (launches.has(previous.id)) await launches.get(previous.id);
      return list();
    }
    const pending = state.requests.find(r => r.skill === item.skill && ['pending','invalid'].includes(r.status) && JSON.stringify(r.period) === JSON.stringify(period));
    if (pending) throw new Error('该项目在这个周期已有分析正在生成，请等待或先取消');
    const id = input.requestId, requestDir = path.join(dir, id);
    const requestRef = `${path.basename(dir)}/${id}`;
    fs.mkdirSync(requestDir, { mode: 0o700 });
    const skillSource = path.join(repo, 'plugin/skills', item.skill);
    fs.cpSync(skillSource, path.join(requestDir, 'skill'), { recursive: true });
    const skillPath = path.join(requestDir, 'skill/SKILL.md'), output = path.join(requestDir, 'report.html'), inputFile = path.join(requestDir, 'input.json');
    const savedHistory = state.requests.filter(r => r.status === 'ready').slice().reverse();
    // 分析规则更新后，旧报告仍在历史中可查，但不能把旧方法产生的结论
    // 自动复制进新分析。按每份报告自己的Skill版本核对，而非只核对本次主题。
    const currentHashes = new Map();
    const history = savedHistory.filter(r => {
      if (!currentHashes.has(r.skill)) {
        currentHashes.set(r.skill, currentSkillHash(r.skill));
      }
      return r.skillHash && r.skillHash === currentHashes.get(r.skill);
    });
    const previousReports = history.filter(r => r.skill === item.skill).slice(0, 5);
    const relatedReports = history.filter(r => r.skill !== item.skill).slice(0, 8);
    const historyEntry = r => ({ topic: r.topic, period: r.period, generated_at: r.completedAt, summary: r.summary.slice(0, r.skill === item.skill ? 4000 : 1200), report_path: path.join(dir, r.id, 'accepted.html'), interpretation: '历史判断不是本次事实；复用前核对对象、统计范围和新资料' });
    const snapshot = {
      schema_version: 'lsou.analysis-run.v1', request_id: id, request_ref: requestRef, requested_topic: item.topic,
      ...business, captured_at: business.captured_at || new Date().toISOString(), saved_at: new Date().toISOString(),
      skill: { name: item.skill, sha256: hash(fs.readFileSync(skillPath)) }, method_basis: item.sop_basis,
      metric_dictionary: metricDictionary, existing_tasks: scrub(taskContext()),
      previous_reports: previousReports.map(historyEntry), related_reports: relatedReports.map(historyEntry),
      history_selection: { total_reports: savedHistory.length, included: previousReports.length + relatedReports.length, excluded_changed_skill: savedHistory.length - history.length, rule: '只自动引用对应分析规则版本仍有效的报告：同主题最近5份及其他主题最近8份。旧版本报告保留在历史中，不自动复用其结论；全部原件仍保存在各自请求目录' },
      result_path: output
    };
    write(inputFile, JSON.stringify(snapshot, null, 2));
    const request = { id, skill: item.skill, topic: item.topic, page: entryPage, period, status: 'pending', error: '', createdAt: new Date().toISOString(), fingerprint, skillHash: snapshot.skill.sha256 };
    state.requests.push(request); save();
    const prompt = skillRequestMessage(item.skill, period, requestRef);
    const promise = (async () => {
      try { log('[analysis-runs] 开始分析', id, item.skill); await launch('accio://chat/new?' + new URLSearchParams({ query: prompt, launchId: id, source: 'lsou-analysis' })); }
      catch (error) { request.status = 'failed'; request.error = '未能打开分析会话，请确认 Accio Work 可正常打开；仍失败请查看启动诊断'; save(); log('[analysis-runs] 启动失败', id, JSON.stringify(launchErrorDetails(error))); throw error; }
    })();
    launches.set(id, promise);
    try { await promise; } finally { launches.delete(id); }
    return list();
  }

  /** 读取当前账号指定的已保存报告；id是登记编号，返回隔离HTML及原周期，篡改或未完成时抛错。 */
  function read(id) {
    sync(); const r = state.requests.find(r => r.id === id);
    if (!r || r.status !== 'ready') throw new Error('报告尚未完成或不属于当前账号');
    const html = reportFile(r, 'accepted.html');
    if (hash(html) !== r.reportHash) throw new Error('报告文件已变化，请重新生成');
    return { id: r.id, topic: r.topic, period: r.period, html };
  }

  /** 取消本地接收，不终止宿主会话；已保存历史保持不可变，无效编号抛错。 */
  function cancel(id) {
    sync(); const r = state.requests.find(r => r.id === id);
    if (!r || !['pending', 'invalid', 'failed'].includes(r.status)) throw new Error('这份报告不能取消');
    r.status = 'cancelled'; r.error = ''; save(); log('[analysis-runs] 已取消接收', id); return list();
  }
  return { list, generate, read, cancel };
}
module.exports = { createAnalysisRuns, validatedHtml };
