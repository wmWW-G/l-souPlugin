'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const test = require('node:test');

// 只加载现有后端中的纯转换函数，不启动服务器，也不执行任何写商品命令。
const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const context = vm.createContext({ URL, Buffer, MAX_PRODUCT_IMAGES: require('../public/publish-product-utils').MAX_PRODUCT_IMAGES });
for (const name of ['publishText', 'isRemotePublishImage', 'publishReferenceNumber', 'normalizePublishSkus',
  'normalizePublishAttributes', 'normalizePublishProduct', 'findPublishResponseField', 'parseEmbeddedWorkctlData', 'hasPublishFailureSignal',
  'publishWorkctlOutcome', 'normalizeQualityReasons', 'inferPublishFailureFields', 'publishFlowOutcome']) {
  const match = source.match(new RegExp(`function ${name}\\([^]*?\\n}`));
  assert.ok(match, `Missing pure function: ${name}`);
  vm.runInContext(match[0], context);
}

/**
 * 生成有真实字段结构的合成商品输入，仅用于本地校验，不提交平台。
 * @returns {object} 独立的单规格测试商品。
 * @throws {Error} 不主动抛出异常。
 */
function product() {
  return { localId: 'sku-test', title: 'Validation Only', categoryId: 5093099,
    images: ['https://example.com/image.png'], attributes: [], sellingPoints: [],
    trade: { saleType: 'normal', moq: 10, inventory: 100, priceUnitId: 4,
      ladderPrices: [{ minQuantity: 10, unitPrice: 9.9 }],
      sku: [{ skuCode: 'RED', skuId: 987654, skuAttributes: [{ attrNameId: 10, attrName: 'Color', attrValueId: 11, attrValue: 'Red', imageUrl: null }] }] },
    fulfillment: {} };
}

test('单规格从已填表单生成完整 SKU，多规格保留独立报价与库存', () => {
  const input = product();
  const one = context.normalizePublishProduct(input, 'draft').material;
  assert.equal(one.trade.sku[0].unitPrice, 9.9);
  assert.equal(one.trade.sku[0].stock, 100);
  assert.equal(one.trade.sku[0].skuAttributes[0].attrValueId, 11);
  assert.equal('skuId' in one.trade.sku[0], false);
  assert.equal(input.trade.sku[0].stock, undefined);
  input.trade.sku[0].stock = 40;
  input.trade.sku[0].unitPrice = 8;
  input.trade.sku.push({ skuCode: 'BLUE', stock: 60, unitPrice: 12,
    skuAttributes: [{ attrName: 'Color', attrValue: 'Blue' }] });
  const multi = context.normalizePublishProduct(input, 'draft').material;
  assert.deepEqual(Array.from(multi.trade.sku, row => [row.stock, row.unitPrice]), [[40, 8], [60, 12]]);
});

test('缺少或损坏规格会在入队前阻断，空库存不转换为零', () => {
  for (const sku of [undefined, [], [{}], [{ skuAttributes: [] }], [{ skuAttributes: [{ attrName: 'Color', attrValue: '' }] }]]) {
    const input = product(); input.trade.sku = sku;
    assert.throws(() => context.normalizePublishProduct(input, 'draft'), /规格/);
  }
  const input = product();
  input.trade.inventory = '';
  input.trade.ladderPrices = [];
  const material = context.normalizePublishProduct(input, 'draft').material;
  assert.equal(material.trade.sku[0].stock, null);
  assert.equal(material.trade.sku[0].unitPrice, null);
  assert.equal('inventory' in material.trade, false);
  for (const invalid of [-1, 1.5, 'invalid']) {
    input.trade.sku[0].stock = invalid;
    assert.throws(() => context.normalizePublishProduct(input, 'draft'), /库存/);
  }
});

test('主图6张保持原顺序，7张在草稿和发布前拒绝且不静默截断', () => {
  const input = product();
  input.images = Array.from({ length: 6 }, (_, i) => `https://example.com/${i}.png`);
  const material = context.normalizePublishProduct(input, 'draft').material;
  assert.equal(material.basicInfo.images.length, 6);
  input.images.push('https://example.com/7.png');
  for (const action of ['draft', 'publish']) {
    assert.throws(() => context.normalizePublishProduct(input, action), /最多 6 张.*当前 7 张/);
  }
  assert.equal(input.images.length, 7);
});

test('多选属性逐条输出官方选项，不拼接或丢弃第21项以后的选择', () => {
  const input = product();
  const values = ['THERMOMETER', 'Alarm Clock', 'Remote Control', 'Sleep Tracker', 'Fitness Tracker',
    'Passometer', 'Call Reminder', 'Answer Call', 'Push Message', 'Mood Tracker', 'Message Reminder',
    'Dial Call', 'Heart Rate Tracker', 'Gesture Control', 'Activity Tracker', 'Voice Call', 'Breath Monitor',
    'Distance Tracker', 'EMAIL', 'Sedentary Reminder', 'Video Call', 'AI Voice Assistant', 'WORLD TIME'];
  input.attributes = [{ attrNameId: 210194090, attrName: 'Function', attrValueId: -1, attrValue: values }];
  const schema = { attributes: [{ attrNameId: 210194090, attrName: 'Function', multiSelect: true, enumProp: true,
    inputProp: false, options: values.map((label, index) => ({ id: 1000 + index, label })) }] };
  const attrs = context.normalizePublishProduct(input, 'draft', schema).material.basicInfo.attr;
  assert.equal(attrs.length, 23);
  assert.deepEqual(Array.from(attrs, a => a.attrValue), values);
  assert.equal(attrs[0].attrValueId, 1000);
  assert.equal(attrs[22].attrValueId, 1022);
  assert.ok(attrs.every(a => a.attrNameId === 210194090 && a.attrValue.length <= 50));
  assert.equal(input.attributes[0].attrValue.length, 23);
});

test('单条属性超长在入队前报字段名，不能截断内容或把普通分号当多选', () => {
  const input = product();
  input.attributes = [{ attrNameId: 3, attrName: 'Model Number', attrValueId: -1, attrValue: 'A'.repeat(51) }];
  assert.throws(() => context.normalizePublishProduct(input, 'draft'), /Model Number.*50/);
  assert.equal(input.attributes[0].attrValue.length, 51);
  input.attributes[0].attrValue = 'A;B';
  assert.equal(context.normalizePublishProduct(input, 'draft').material.basicInfo.attr[0].attrValue, 'A;B');
});

test('WorkCTL pending_fix 明细成为错误原因，未返回评分不转换为零', () => {
  const parsed = { success: true, data: { status: 'pending_fix', ready: false, message: '发品 JSON 校验未通过',
    details: [{ code: 'JSON_VAL_EMPTY_SKU', error: 'SKU 列表为空', hint: '至少构造一个规格' }] } };
  const failure = context.publishFlowOutcome({ ok: true, parsed });
  assert.equal(failure.ok, false);
  assert.equal(failure.message, 'SKU 列表为空');
  assert.equal(failure.errorCode, 'JSON_VAL_EMPTY_SKU');
  assert.equal(failure.finalScore, null);
  assert.ok(failure.failureFields.includes('sku'));
  for (const score of [null, undefined, '', ' ', 0, 86]) {
    const result = context.publishFlowOutcome({ ok: true, parsed: { success: true, data: { results: [{ success: true, productId: 123, finalScore: score }] } } });
    assert.equal(result.finalScore, typeof score === 'number' ? score : null);
  }
});

test('当前安装 WorkCTL 的 validate-only 接受修复后的实际 material', {
  skip: process.env.LSOU_VALIDATE_REAL_WORKCTL !== '1',
}, async t => {
  const env = await require('../desktop/runtime.cjs').resolveAccioEnvironment({ verify: false });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsou-sku-validator-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const good = context.normalizePublishProduct(product(), 'draft').material;
  const multiple = JSON.parse(JSON.stringify(good));
  multiple.trade.sku.push({ skuCode: 'BLUE', stock: 20, unitPrice: 12, skuAttributes: [{ attrName: 'Color', attrValue: 'Blue', attrNameId: null, attrValueId: null, imageUrl: null }] });
  const old = JSON.parse(JSON.stringify(good)); delete old.trade.sku;
  for (const [name, material] of [['single', good], ['multiple', multiple], ['old-missing-sku', old]]) {
    const file = path.join(dir, `${name}.json`);
    fs.writeFileSync(file, JSON.stringify(material), { mode: 0o600 });
    // --validate-only 是必带参数：真实 CLI 仅校验/修正此临时 JSON，不创建商品。
    const args = [...(env.WORKCTL_ENTRY ? [env.WORKCTL_ENTRY] : []), 'publishflow', 'publish-from-json',
      '--input', file, '--validate-only', '--format', 'json', '--compact-output', 'off'];
    const { stdout } = await execFile(env.WORKCTL_BIN, args, { env, timeout: 15000 });
    const result = JSON.parse(stdout);
    assert.equal(result.success, true);
    if (name === 'old-missing-sku') assert.equal(result.data.details[0].code, 'JSON_VAL_EMPTY_SKU');
    else assert.equal(result.data.status, 'validated', JSON.stringify(result.data));
  }
});
