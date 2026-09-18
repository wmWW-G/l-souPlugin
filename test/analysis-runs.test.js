'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createAnalysisRuns, validatedHtml } = require('../lib/analysis-runs');
const period = { mode: 'week', startDate: '2026-09-07', endDate: '2026-09-13' };

/** 仅用于回传机制测试的完整静态报告；不代替真实模型业务验收。 */
function report(title = '经营分析') {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title><style>body{color:#222}</style></head><body><h1>${title}</h1><p>本次选择2026年9月7日至13日的自然周。已有经营资料不足以判断原因，先核对同周期的商品、曝光、点击、询盘与成交；历史结论保留原日期，只作为待核实的参考，不把建议描述成已经执行。</p><table><tr><th>对象</th><th>建议与依据</th></tr><tr><td>指定商品</td><td>补齐同期明细再判断，不把缺失数据当成零，不因一天没有询盘直接停止投放。</td></tr></table></body></html>`;
}

/** 创建全新的隔离服务和固定文件定位器；调用方必须通过t.after清理。 */
function fixture(t, scope = 'test-account') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-runs-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const calls = [], config = { scope, root, launch: async url => { calls.push(new URL(url)); }, log: () => {} };
  const dir = path.join(root, crypto.createHash('sha256').update(scope).digest('hex').slice(0, 20));
  return { root, config, calls, dir, store: createAnalysisRuns(config), output: id => path.join(dir, id, 'report.html') };
}

/** 唤起故障必须保留请求和系统证据，且不能把链接/资料写入日志或自动重发。 */
test('protocol launch failure persists failed state and sanitized diagnostics without retrying', async t => {
  const h = fixture(t), logs = []; let calls = 0;
  const { openAW } = require('../lib/aw-handoff');
  const store = createAnalysisRuns({ ...h.config, log: (...parts) => logs.push(parts), launch: url => openAW(url, {
    platform: 'win32', run: (_command, _args, _options, done) => {
      calls++; const error = new Error('private-user full-business-url'); error.code = 1;
      done(error, '', JSON.stringify({ stage: 'shell_execute', nativeErrorCode: 1155, hresult: -2147467259, message: 'private-user' }));
    }
  }) });
  const id = crypto.randomUUID(), input = { requestId: id, skill: 'lsou-market-positioning', period, records: [] };
  await assert.rejects(store.generate(input), /未能打开 Accio Work/);
  assert.equal(store.list().requests[0].status, 'failed');
  assert.ok(fs.existsSync(path.join(h.dir, id, 'input.json')));
  const logged = JSON.stringify(logs);
  assert.match(logged, /1155/); assert.match(logged, /启动失败/);
  assert.doesNotMatch(logged, /private-user|full-business-url|accio:\/\//);
  await store.generate(input); assert.equal(calls, 1);
});

/** 全目录请求必须真实绑定对应规则与模板，并按请求导入、恢复，不靠静态映射宣称完成。 */
test('all 31 report routes copy their own skill, preserve context and import reports exactly once', async t => {
  const h = fixture(t), catalog = h.store.list().catalog;
  assert.equal(catalog.length, 31);
  for (const item of catalog) {
    const id = crypto.randomUUID(), input = { requestId: id, skill: item.skill, period, records: [{ source: '原始资料', data: { zero: 0, unknown: null, apiKey: 'test-only' } }] };
    await h.store.generate(input);
    await h.store.generate(input);
    const file = JSON.parse(fs.readFileSync(path.join(h.dir, id, 'input.json')));
    assert.deepEqual(file.period, period);
    assert.equal(file.records[0].data.zero, 0); assert.equal(file.records[0].data.unknown, null); assert.equal(file.records[0].data.apiKey, undefined);
    assert.equal(file.skill.name, item.skill); assert.equal(file.metric_dictionary.pv.unit, '指数');
    assert.ok(fs.readFileSync(path.join(h.dir, id, 'skill/SKILL.md'), 'utf8').includes('name: ' + item.skill));
    assert.ok(fs.existsSync(path.join(h.dir, id, 'skill/assets/report.html')));
    assert.ok(h.calls.at(-1).searchParams.get('query').includes(file.result_path));
    fs.writeFileSync(h.output(id), report(item.topic));
    assert.equal(h.store.list().requests.at(-1).status, 'ready');
    assert.match(h.store.read(id).html, /Content-Security-Policy/);
    assert.equal(h.store.list().requests.length, h.calls.length);
  }
  assert.equal(h.calls.length, 31);
  const restored = createAnalysisRuns(h.config);
  assert.equal(restored.list().requests.filter(r => r.status === 'ready').length, 31);
  assert.equal(restored.list().requests.length, 31);
});

/** 历史与当前范围分开保存，取消后迟到结果不导入，其他账号无法读取正文。 */
test('history keeps original periods, cancelled late reports stay out and accounts remain isolated', async t => {
  const h = fixture(t), skill = h.store.list().catalog[0].skill, first = crypto.randomUUID();
  await h.store.generate({ requestId: first, skill, period, records: [] });
  fs.writeFileSync(h.output(first), report()); h.store.list();
  const next = crypto.randomUUID(), month = { mode: 'month', startDate: '2026-09-01', endDate: '2026-09-30' };
  await h.store.generate({ requestId: next, skill, period: month, records: [] });
  const snapshot = JSON.parse(fs.readFileSync(path.join(h.dir, next, 'input.json')));
  assert.deepEqual(snapshot.period, month); assert.deepEqual(snapshot.previous_reports[0].period, period);
  assert.ok(snapshot.previous_reports[0].summary.includes('经营分析'));
  h.store.cancel(next); fs.writeFileSync(h.output(next), report());
  assert.equal(createAnalysisRuns(h.config).list().requests.at(-1).status, 'cancelled');
  assert.throws(() => h.store.read(next), /尚未完成/);
  assert.throws(() => createAnalysisRuns({ ...h.config, scope: 'another-account' }).read(first), /当前账号/);
});

/** 规则升级后不自动把旧结论带进新请求；旧报告仍可查看，升级不删除用户历史。 */
test('changed skill versions remain in history but are excluded from new analysis context', async t => {
  const h = fixture(t), skill = h.store.list().catalog[0].skill, first = crypto.randomUUID();
  await h.store.generate({ requestId: first, skill, period, records: [] });
  fs.writeFileSync(h.output(first), report()); h.store.list();
  // 修改隔离测试索引来模拟上一版本的报告，绝不修改项目里的真实Skill文件。
  const indexFile = path.join(h.dir, 'index.json'), index = JSON.parse(fs.readFileSync(indexFile));
  index.requests[0].skillHash = 'previous-method-version';
  fs.writeFileSync(indexFile, JSON.stringify(index));
  const restored = createAnalysisRuns(h.config), next = crypto.randomUUID();
  await restored.generate({ requestId: next, skill, period, records: [] });
  const input = JSON.parse(fs.readFileSync(path.join(h.dir, next, 'input.json')));
  assert.equal(input.history_selection.total_reports, 1);
  assert.equal(input.history_selection.excluded_changed_skill, 1);
  assert.equal(input.previous_reports.length, 0); assert.equal(input.related_reports.length, 0);
  assert.equal(restored.list().requests[0].status, 'ready');
  assert.equal(restored.list().requests[0].methodChanged, true);
  assert.equal(restored.list().requests[1].methodChanged, false);
  assert.match(restored.read(first).html, /经营分析/);
});

/** 不完整/活动HTML和符号链接不能导入；冻结已保存版本避免后续修改原文件污染历史。 */
test('invalid reports can finish later, active content is rejected and accepted history is frozen', async t => {
  const h = fixture(t), skill = h.store.list().catalog[0].skill, id = crypto.randomUUID();
  await h.store.generate({ requestId: id, skill, period, records: [] });
  fs.writeFileSync(h.output(id), '<!doctype html><html>');
  assert.equal(h.store.list().requests[0].status, 'invalid');
  await assert.rejects(h.store.generate({ requestId: crypto.randomUUID(), skill, period, records: [] }), /已有分析/);
  assert.equal(h.calls.length, 1);
  fs.writeFileSync(h.output(id), report().replace('</body>', '<script>alert(1)</script></body>'));
  assert.equal(h.store.list().requests[0].status, 'invalid');
  fs.writeFileSync(h.output(id), report()); assert.equal(h.store.list().requests[0].status, 'ready');
  const accepted = h.store.read(id).html;
  fs.writeFileSync(h.output(id), report('后来修改的原始文件')); assert.equal(h.store.read(id).html, accepted);
  const next = crypto.randomUUID(); await h.store.generate({ requestId: next, skill, period, records: [] });
  fs.symlinkSync(h.output(id), h.output(next)); assert.equal(h.store.list().requests.at(-1).status, 'invalid');
  assert.throws(() => validatedHtml(report().replace('指定商品', 'WorkCTL /Users/test/SKILL.md')), /内部名称/);
  assert.throws(() => validatedHtml(report().replace('指定商品', '<img src="https://example.com/private">')), /外部资源/);
  assert.throws(() => validatedHtml(report().replace('</head>', '<meta http-equiv="refresh" content="0;url=https://example.com"></head>')), /跳转/);
  assert.throws(() => validatedHtml(report().replace('<head>', '<!-- <head> --><head>').replace('</body>', '<svg/onload=alert(1)></svg></body>')), /可执行/);
  assert.ok(validatedHtml(report().replace('<head>', '<!-- <head> --><head>')).startsWith('<!doctype html><html lang="zh-CN"><head><meta http-equiv="Content-Security-Policy"'));
  assert.doesNotThrow(() => validatedHtml(report().replace('指定商品', '&lt;img src=x onerror=alert(1)&gt;')));
  assert.equal(validatedHtml(validatedHtml(report())), validatedHtml(report()));
});

/** 错误请求在写盘/启动之前拒绝，同编号换资料不能复用旧结果，重复分析须明确结束前次请求。 */
test('request validation, payload limits and duplicate generation prevent mismatched runs', async t => {
  const h = fixture(t), skill = h.store.list().catalog[0].skill, id = crypto.randomUUID();
  const input = { requestId: id, skill, period, records: [] };
  for (const bad of [{ ...input, skill: '../other' }, { ...input, period: undefined }, { ...input, period: { mode: 'day', startDate: '2026-02-30', endDate: '2026-02-30' } }, { ...input, records: null }, { ...input, records: ['a'.repeat(1900001)] }]) await assert.rejects(h.store.generate(bad));
  assert.equal(h.calls.length, 0); assert.equal(h.store.list().requests.length, 0);
  await h.store.generate(input);
  await assert.rejects(h.store.generate({ ...input, records: [{ changed: true }] }), /资料已变化/);
  await assert.rejects(h.store.generate({ ...input, requestId: crypto.randomUUID() }), /已有分析/);
  assert.equal(h.calls.length, 1);
});
