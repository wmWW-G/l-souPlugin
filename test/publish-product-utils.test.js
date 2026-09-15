'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

let publishUtils = {};
try {
  // 生产辅助模块会同时被浏览器和 Node 测试加载。首次 RED 阶段允许模块尚不存在，
  // 让下面的行为断言以“缺少功能”失败，而不是让测试进程因 require 报错中断。
  publishUtils = require(path.join(__dirname, '..', 'public', 'publish-product-utils.js'));
} catch (_) {
  publishUtils = {};
}

test('参考商品映射会保留平台属性、价格和履约参数', () => {
  assert.equal(typeof publishUtils.mapReferenceProductToDraft, 'function');

  const categoryConfig = {
    fields: [
      { key: 'audience', attrId: 200001175, multiSelect: false, enumProp: true, inputProp: false, control: 'select', choices: ['Unisex'] },
      { key: 'functions', attrId: 210194090, multiSelect: true, enumProp: true, inputProp: false, control: 'multi', choices: ['Sleep Tracker', 'Heart Rate Tracker'] },
      { key: 'origin', attrId: 1, multiSelect: false, enumProp: true, inputProp: false, control: 'region', choices: ['China'] },
    ],
  };
  const reference = {
    title: 'Existing Watch',
    attributes: [
      { attrNameId: 200001175, attrValue: 'Unisex' },
      { attrNameId: 210194090, attrValue: 'Sleep Tracker' },
      { attrNameId: 210194090, attrValue: 'Heart Rate Tracker' },
      { attrNameId: 1, attrValue: 'China' },
    ],
    keywords: ['smart watch', 'health watch'],
    trade: {
      saleType: 'normal', moq: 10, inventory: 280, priceUnit: 4,
      ladderPrices: [{ minQuantity: 10, unitPrice: 25.85 }],
      sku: [{ skuCode: 'RED', stock: 100, unitPrice: 25.85, skuAttributes: [{ attrName: 'Color', attrValue: 'Red' }] },
        { skuCode: 'BLUE', stock: 180, unitPrice: 27, skuAttributes: [{ attrName: 'Color', attrValue: 'Blue' }] }],
    },
    fulfillment: {
      ladderPeriod: [{ quantity: 500, period: 5 }],
      pkgLength: 17.1, pkgWidth: 9.6, pkgHeight: 6.3, pkgWeight: 0.133,
      logisticsProperty: ['general_cargo_0'], shippingTemplateId: 2058614109,
    },
    sellingPoints: ['AMOLED display', 'ECG detection'],
    images: { primary: ['https://cdn.example.com/watch.jpg'] },
  };

  const draft = publishUtils.mapReferenceProductToDraft(reference, categoryConfig, {
    fallbackTitle: 'Fallback title',
    fallbackImage: 'https://cdn.example.com/fallback.jpg',
  });

  assert.deepEqual(draft.attributes, {
    audience: 'Unisex',
    functions: ['Sleep Tracker', 'Heart Rate Tracker'],
    origin: 'China',
  });
  assert.equal(draft.moq, 10);
  assert.deepEqual(draft.keywords, ['smart watch', 'health watch']);
  draft.keywords.push('new keyword');
  assert.deepEqual(reference.keywords, ['smart watch', 'health watch']);
  assert.equal(publishUtils.mapReferenceProductToDraft({ keywords: [] }, { fields: [] }).keywordSource, 'reference');
  assert.equal(draft.inventory, 280);
  assert.equal(draft.priceUnitId, 4);
  assert.deepEqual(draft.priceTiers, [{ minQuantity: 10, unitPrice: 25.85 }]);
  assert.deepEqual(draft.skus, reference.trade.sku);
  draft.skus[0].skuAttributes[0].attrValue = 'Changed';
  assert.equal(reference.trade.sku[0].skuAttributes[0].attrValue, 'Red');
  assert.deepEqual(draft.leadTimeTiers, [{ maxQuantity: 500, days: 5 }]);
  assert.deepEqual(draft.package, { length: 17.1, width: 9.6, height: 6.3, weight: 0.133 });
  assert.deepEqual(draft.logisticsProperty, ['general_cargo_0']);
  assert.equal(draft.shippingTemplateId, 2058614109);
});

test('复制同类会创建独立草稿且不会与原商品共享可变数组', () => {
  assert.equal(typeof publishUtils.clonePublishProductDraft, 'function');

  const source = {
    id: 'publish-original',
    title: 'Existing Watch',
    selected: false,
    schemaLoading: true,
    status: 'ready',
    attributes: { functions: ['Sleep Tracker'] },
    gallery: ['https://cdn.example.com/watch.jpg'],
    keywords: ['smart watch'],
    priceTiers: [{ minQuantity: 10, unitPrice: 25.85 }],
    skus: [{ skuCode: 'RED', skuAttributes: [{ attrName: 'Color', attrValue: 'Red' }], unitPrice: 25.85, stock: 280 }],
    leadTimeTiers: [{ maxQuantity: 500, days: 5 }],
    package: { length: 17.1, width: 9.6, height: 6.3, weight: 0.133 },
    logisticsProperty: ['general_cargo_0'],
    sellingPoints: ['AMOLED display'],
    uploads: [],
  };

  const clone = publishUtils.clonePublishProductDraft(source, 'publish-copy');
  clone.attributes.functions.push('Heart Rate Tracker');
  clone.priceTiers[0].unitPrice = 20;
  clone.skus[0].stock = 5;
  assert.deepEqual(clone.keywords, ['smart watch']);
  clone.keywords.push('new keyword');
  assert.deepEqual(source.keywords, ['smart watch']);

  assert.equal(clone.id, 'publish-copy');
  assert.equal(clone.selected, true);
  assert.equal(clone.schemaLoading, false);
  assert.equal(clone.status, 'needs_attention');
  assert.deepEqual(source.attributes.functions, ['Sleep Tracker']);
  assert.equal(source.priceTiers[0].unitPrice, 25.85);
  assert.equal(source.skus[0].stock, 280);
});

test('发布结果优先显示具体错误，缺失评分保持未知并保留真实零分', () => {
  for (const finalScore of [null, undefined, '', ' ', 'invalid']) {
    const failure = publishUtils.publishResultDetail({ status: 'failed', finalScore, message: '发品 JSON 校验未通过', errorCode: 'JSON_VAL_EMPTY_SKU' }, ['商品规格']);
    assert.match(failure, /商品规格列表为空/);
    assert.match(failure, /JSON_VAL_EMPTY_SKU/);
    assert.doesNotMatch(failure, /质量分/);
    assert.equal(publishUtils.publishResultDetail({ status: 'saved_draft', finalScore }), '质量分暂未返回');
  }
  assert.equal(publishUtils.publishResultDetail({ status: 'submitted', finalScore: 0 }), '质量分 0');
  assert.match(publishUtils.publishResultDetail({ status: 'failed', message: '网络连接失败', finalScore: 0 }), /^网络连接失败/);
});
