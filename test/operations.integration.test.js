'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createOperations, failure } = require('../lib/operations');

/** 隔离测试装置：运行真实HTTP与运营模块，只替换外部Workctl。@param {object} t 测试上下文。@returns {Promise<object>} 请求与日志。@throws 服务或文件错误。 */
async function fixture(t) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lsou-operations-test-'));
  const old = process.env.OPERATIONS_STATE_DIR; process.env.OPERATIONS_STATE_DIR = tmp;
  const calls = []; let override = null, service, operations;
  const runWorkctl = async args => {
    const params = JSON.parse(await fs.readFile(args[args.indexOf('--json-file') + 1], 'utf8'));
    const call = { command: args.slice(0, 3).join(' '), params, yes: args.includes('--yes') }; calls.push(call);
    if (override) { const response = await override(call); if (response) return response; }
    let data = { businessSuccess: true };
    if (call.command.endsWith('query-recent-conversation')) data = { conversations: [{ conversationId: 'conv-not-decomposable', sellerAliId: 555, buyerAliId: 777, buyerName: 'Buyer', lastMessage: 'Hello' }], cursor: 12345 };
    if (call.command.endsWith('list-conversation-msg')) data = { messages: [{ content: '<img src=x onerror=alert(1)>', senderName: 'Buyer' }], cursor: 999 };
    if (call.command.endsWith('get-buyer-basic')) data = { buyerLevel: 'L3' };
    if (call.command.endsWith('product-ai-image-generate')) data = { requestKey: 'remote-request-1', taskStatus: 'PROCESSING' };
    if (call.command.endsWith('product-ai-image-generate-result')) data = { status: 'SUCCESS', imageUrls: ['https://example.com/result.png'] };
    return { ok: true, durationMs: 1, parsed: { success: true, data } };
  };
  const start = async () => {
    operations = createOperations({ runWorkctl, pushLog: () => {}, callEndpoint: async () => ({ ok: true, data: { recordCount: 1, data: [{ id: 123456789, categoryId: 789, subject: 'Test product', prodImage: 'https://example.com/product.png' }] } }) });
    service = http.createServer((req, res) => operations.handle(req, res, new URL(req.url, 'http://localhost')));
    await new Promise(resolve => service.listen(0, '127.0.0.1', resolve));
  };
  await start();
  const request = async (route, data, headers = {}) => {
    const base = `http://127.0.0.1:${service.address().port}`;
    const response = await fetch(base + '/api/operations/' + route, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) });
    return { status: response.status, ...await response.json() };
  };
  const until = async id => {
    for (let n = 0; n < 100; n++) {
      const job = (await request('jobs')).jobs.find(j => j.id === id);
      if (job && !['queued', 'running'].includes(job.status)) return job;
      await new Promise(r => setTimeout(r, 10));
    }
    throw new Error('任务未结束');
  };
  t.after(async () => {
    await new Promise(resolve => service.close(resolve));
    if (old === undefined) delete process.env.OPERATIONS_STATE_DIR; else process.env.OPERATIONS_STATE_DIR = old;
    await fs.rm(tmp, { recursive: true, force: true });
  });
  return { request, until, calls, registerProduct: row => operations.registerProduct(row), setOverride: fn => { override = fn; }, restart: async () => { await new Promise(resolve => service.close(resolve)); await start(); } };
}
/** 形成最终确认请求。@param {string} action 动作。@param {object} params 参数。@param {string} productRef 引用。@returns {object} 请求。@throws 无。 */
function confirmed(action, params, productRef) { return { action, params, productRef, idempotencyKey: crypto.randomUUID(), confirmed: true, acknowledgement: 'CONFIRM_OPERATIONS_WRITE' }; }

test('五条运营链路通过真实HTTP边界，参数和实体关联来自平台', async t => {
  const f = await fixture(t);
  for (const [action, params, expected] of [
    ['orders', { start: 20, limit: 20 }, 'icbu trade list-trade-list-mcp'],
    ['logistics', { currentPage: 2, pageSize: 20, statusList: ['TRANSPORTING'] }, 'icbu logistics list'],
    ['risk', {}, 'icbu trade shop-risk-diagnosis'],
    ['stars', { locale: 'zh_CN' }, 'icbu other icbu-starrating-cgs-pc-page-data-open'],
    ['channel-trend', { startDate: '2026-08-07', endDate: '2026-09-05', channelType: '搜索', dimensionType: 'shop_uv', statisticsType: 'day', terminalType: 'TOTAL' }, 'icbu advisor data-advisor-shop-channel-trend'],
  ]) { assert.equal((await f.request('read', { action, params })).ok, true); assert.equal(f.calls.at(-1).command, expected); }
  const product = (await f.request('read', { action: 'products', params: {} })).items[0];
  assert.equal(product.productId, undefined);
  assert.equal((await f.request('read', { action: 'market-detail', params: { productRef: product.ref } })).ok, true);
  assert.deepEqual(f.calls.at(-1).params, { cateId: 789 });
  const conversations = await f.request('read', { action: 'conversations', params: {} });
  const conversation = conversations.items[0]; assert.equal(conversation.sellerAliId, undefined);
  assert.equal((await f.request('read', { action: 'messages', params: { conversationRef: conversation.ref } })).ok, true);
  assert.equal(f.calls.at(-1).params.selfAliId, 555); assert.equal(f.calls.at(-1).params.conversationId, 'conv-not-decomposable');
  assert.equal((await f.request('read', { action: 'buyer-basic', params: { conversationRef: conversation.ref } })).ok, true);
  assert.equal(f.calls.at(-1).params.contactAliId, 777);
  assert.equal((await f.request('read', { action: 'messages', params: { conversationRef: conversation.ref, selfAliId: 888 } })).ok, false);
  assert.equal((await f.request('read', { action: 'orders', params: { arbitraryCommand: 'rm' } })).ok, false);
});

test('已有商品必须保存后提交，并拒绝伪造引用、并发重复和跨源写入', async t => {
  const f = await fixture(t); const ref = (await f.request('read', { action: 'products' })).items[0].ref;
  const save = confirmed('save-edit', { basic: { productTitle: 'New title' }, detail: { productSellingPoint: 'Verified benefit' } }, ref);
  assert.equal((await f.request('jobs', { ...save, confirmed: false })).ok, false);
  assert.equal((await f.request('jobs', save, { Origin: 'https://evil.example' })).ok, false);
  assert.equal((await f.request('jobs', { ...save, productRef: 'forged' })).ok, false);
  const [a, b] = await Promise.all([f.request('jobs', save), f.request('jobs', save)]);
  assert.equal(a.job.id, b.job.id); assert.equal((await f.until(a.job.id)).status, 'succeeded');
  assert.equal(f.calls.filter(c => c.command.includes('product-edit-draft')).length, 2);
  assert.equal((await f.request('jobs', { ...save, params: { basic: { productTitle: 'Different' } } })).ok, false);
  const submit = await f.request('jobs', confirmed('submit-edit', { savedJobId: a.job.id }, ref));
  assert.equal((await f.until(submit.job.id)).status, 'submitted');
  assert.equal(f.calls.at(-1).command, 'icbu product submit-draft');
  await f.restart();
  assert.equal((await f.request('jobs', save)).job.id, a.job.id);
  assert.equal(f.calls.filter(c => c.command.includes('product-edit-draft')).length, 2);
});

test('素材生成凭据跨重启保留，轮询不会再次创建任务', async t => {
  const f = await fixture(t);
  const body = confirmed('image-generate', { abilityCode: 'imageGenerate', imageUrl: 'https://example.com/product.png', prompt: 'Outdoor scene' });
  const queued = await f.request('jobs', body); const job = await f.until(queued.job.id);
  assert.equal(job.status, 'submitted'); assert.equal(job.canPoll, true); assert.equal(job.requestKey, undefined);
  await f.restart();
  const result = await f.request(`jobs/${job.id}/poll`, {});
  assert.equal(result.job.status, 'succeeded'); assert.deepEqual(result.job.urls, ['https://example.com/result.png']);
  assert.equal(f.calls.filter(c => c.command === 'icbu product product-ai-image-generate').length, 1);
  assert.equal(f.calls.at(-1).params.requestKey, 'remote-request-1');
  assert.equal((await f.request('jobs', confirmed('image-generate', { abilityCode: 'imageGenerate', imageUrl: 'http://127.0.0.1/p.png' }))).ok, false);
});

test('嵌套业务失败与不确定写入不会被标记完成或自动重试', async t => {
  assert.ok(failure({ success: true, data: JSON.stringify({ businessSuccess: false, errorMsg: 'Rejected' }) }));
  const f = await fixture(t);
  f.setOverride(async call => call.command.endsWith('product-ai-image-generate') ? { ok: false, parsed: null, stderr: 'timeout' } : null);
  const body = confirmed('image-generate', { abilityCode: 'imageGenerate', imageUrl: 'https://example.com/p.png' });
  const response = await f.request('jobs', body);
  assert.equal((await f.until(response.job.id)).status, 'unknown');
  await f.restart(); await f.request('jobs', body);
  assert.equal(f.calls.length, 1);
});

test('部分草稿失败会保留完成步数，并阻止将失败任务提交上线', async t => {
  const f = await fixture(t); const ref = (await f.request('read', { action: 'products' })).items[0].ref;
  f.setOverride(async call => call.command.endsWith('product-edit-draft-detail') ? { ok: true, parsed: { success: true, data: { businessSuccess: false, errorMsg: '详情校验失败' } } } : null);
  const response = await f.request('jobs', confirmed('save-edit', { basic: { productTitle: 'New title' }, detail: { productSellingPoint: 'New text' } }, ref));
  const job = await f.until(response.job.id);
  assert.equal(job.status, 'failed'); assert.equal(job.completedSteps, 1); assert.match(job.message, /详情校验失败/);
  assert.equal((await f.request('jobs', confirmed('submit-edit', { savedJobId: job.id }, ref))).ok, false);
  assert.equal(f.calls.some(c => c.command.endsWith('submit-draft')), false);
});

test('生成结果明确失败时结束任务并关闭轮询', async t => {
  const f = await fixture(t);
  const response = await f.request('jobs', confirmed('image-generate', { abilityCode: 'imageGenerate', imageUrl: 'https://example.com/p.png' }));
  await f.until(response.job.id);
  f.setOverride(async call => call.command.endsWith('product-ai-image-generate-result') ? { ok: true, parsed: { success: true, data: { status: 'FAILED', message: '额度不足' } } } : null);
  const result = await f.request(`jobs/${response.job.id}/poll`, {});
  assert.equal(result.job.status, 'failed'); assert.match(result.job.message, /额度不足/); assert.equal(result.job.canPoll, false);
});

/** 验证同名商品也按服务端实体引用编辑，避免按标题选错目标。 */
test('四象限商品引用区分同名商品并拒绝无效编号', async t => {
  const f = await fixture(t);
  const first = f.registerProduct({id: 111111, subject: 'Same title'});
  const second = f.registerProduct({id: 222222, subject: 'Same title'});
  assert.notEqual(first, second);
  assert.equal(f.registerProduct({id: 'invalid'}), null);
  const response = await f.request('read', {action: 'product-info', params: {productRef: second, queryType: 'trunk'}});
  assert.equal(response.ok, true);
  assert.equal(f.calls.at(-1).params.productId, 222222);
});
