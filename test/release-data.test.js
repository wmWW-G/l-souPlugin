'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const source = require('node:fs').readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

/** 从实际页面源码读取完整顶层函数，供有界DOM/API替身执行；不存在则断言失败。 */
function pageFunction(name) {
  const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?^\\}`, 'm'));
  assert.ok(match, name);
  return match[0];
}

test('交付检查拒绝快照目录与编译进前端的历史样本', async t => {
  const { assertCleanRelease } = await import('../scripts/verify-release-data.mjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lsou-clean-check-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'demo-data'));
  await assert.rejects(assertCleanRelease(root), /禁止/);
  await fs.rm(path.join(root, 'demo-data'), { recursive: true });
  await fs.writeFile(path.join(root, 'bundle.js'), 'const keyword="smart watch";');
  await assert.rejects(assertCleanRelease(root), /固定行业/);
  await fs.writeFile(path.join(root, 'bundle.js'), 'const keyword="";');
  assert.equal(await assertCleanRelease(root), 1);
});

test('行业查询跟随当前商家类目，缺类目不发起其他行业查询', async () => {
  for (const category of ['merchant-A-category', 'merchant-B-category', null]) {
    const calls = [], nodes = {};
    const context = vm.createContext({ flowMarketLoading: false, summaryRows: category ? [{ cateId: category }] : [],
      $: key => nodes[key] ||= {}, dates: () => ({}), renderMarketOpportunity: () => {},
      api: async (name, params) => { calls.push({ name, params }); return { ok: true, data: [] }; } });
    vm.runInContext(pageFunction('loadFlowMarket'), context);
    await context.loadFlowMarket();
    const market = calls.filter(call => call.name.startsWith('market-'));
    assert.equal(market.length, category ? 3 : 0);
    for (const call of market) assert.equal(call.params.cateId, category);
  }
});

test('RFQ空词不自动查询手表，显式产品词才发起商机查询且不读取演示快照', async () => {
  for (const keyword of ['', 'stainless steel bottle']) {
    const calls = [], nodes = {}, state = { compareIds: new Set(), quoteIds: new Set(), compareVersion: 0, quoteVersion: 0 };
    const context = vm.createContext({ rfqState: state, $: key => nodes[key] ||= {}, num: value => Number(value || 0),
      rfqPriorityScore: () => 0, renderRfqCountries: () => {}, renderRfqKpis: () => {}, renderRfqHistory: () => {},
      renderRfqRights: () => {}, applyRfqFilters: () => {},
      fetch: () => { throw new Error('不应读取演示入口'); },
      api: async (name, params) => { calls.push({ name, params }); return { ok: true, data: { items: [], total: 0 } }; } });
    vm.runInContext(pageFunction('loadRfq'), context);
    await context.loadRfq(keyword);
    assert.equal(calls.length, keyword ? 3 : 1);
    if (keyword) assert.equal(calls.find(row => row.name === 'rfq-internal-search').params.searchText, keyword);
    else assert.match(nodes['#rfqOpportunityList'].innerHTML, /请输入/);
  }
});

test('新建草稿不继承样本类目、图片、卖点、价格或包装参数', () => {
  const context = vm.createContext({ PUBLISH_CATEGORY_CONFIG: { unselected: { categoryId: null, label: '请选择类目', fields: [] } },
    window: { LsouPublishUtils: require('../public/publish-product-utils') },
    defaultPublishAttributes: () => ({}), publishAttributeProgress: () => ({ completed: 0, total: 0 }) });
  vm.runInContext(pageFunction('createPublishProduct'), context);
  const result = context.createPublishProduct();
  assert.equal(result.categoryId, null);
  assert.equal(result.image, ''); assert.equal(result.gallery.length, 0); assert.equal(result.keywords.length, 0);
  assert.equal(result.sellingPoints.filter(Boolean).length, 0);
  assert.equal(result.priceTiers[0].unitPrice, ''); assert.equal(result.package.weight, '');
});
