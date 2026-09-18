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

test('标准关键词为空时兼容当前参考商品的 Keywords 自定义属性和旧缓存', () => {
  // 保留线上响应中的双冒号：自定义属性名本身带冒号，模板序列化再添加一个。
  const reference = { keywords: [], texts: ['Model: M5 Smart Watch', 'Keywords:: M5 Smart Watch Band'] };
  const draft = publishUtils.mapReferenceProductToDraft(reference, { fields: [] });
  assert.deepEqual(draft.keywords, ['M5 Smart Watch Band']);
  assert.equal(draft.keywordSource, 'reference-attribute');
  assert.equal(draft.referenceKeywordsEmpty, false);
  const clone = publishUtils.clonePublishProductDraft(draft, 'copy');
  clone.keywords[0] = 'edited keyword';
  assert.deepEqual(draft.keywords, ['M5 Smart Watch Band']);
  assert.deepEqual(reference.keywords, []);
  assert.equal(reference.texts[1], 'Keywords:: M5 Smart Watch Band');

  const standard = publishUtils.mapReferenceProductToDraft({ ...reference, keywords: ['original search keyword'] }, { fields: [] });
  assert.deepEqual(standard.keywords, ['original search keyword']);
  assert.equal(standard.keywordSource, 'reference');
  const normalized = publishUtils.mapReferenceProductToDraft({ texts: [' KEYWORDS: smart band ', '关键词：smart band', 'Keyword: health tracker'] }, { fields: [] });
  assert.deepEqual(normalized.keywords, ['smart band', 'health tracker']);
});

test('关键词回填不从标题描述或推荐商品中猜词，也不把空白或对象转成关键词', () => {
  const empty = publishUtils.mapReferenceProductToDraft({
    title: 'Smart watch', keywords: ['', null, {}],
    texts: ['Model: Smart watch', 'Keywords:', 'Keywords::   ', 'Description: Keywords: advertised phrase',
      'Keywords: first line\nProduct name: other product', { keywords: 'object keyword' }],
    descComponentData: { products: [{ keywords: 'recommended product keyword' }] },
  }, { fields: [] });
  assert.deepEqual(empty.keywords, []);
  assert.equal(empty.referenceKeywordsEmpty, true);
  assert.equal(empty.keywordSource, 'reference');
  const limited = publishUtils.mapReferenceProductToDraft({ texts: Array.from({ length: 7 }, (_, i) => `Keywords:: ${i}${'x'.repeat(50)}`) }, { fields: [] });
  assert.equal(limited.keywords.length, 5);
  assert.ok(limited.keywords.every(value => value.length === 40));
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

test('复制等待全部图片取得远程地址，成功副本只复用图片而不复制上传任务', () => {
  const remote = 'https://cdn.example.com/new.jpg';
  for (const status of ['waiting', 'reading', 'uploading', 'failed', 'uploaded']) {
    const source = { image: 'blob:local', gallery: ['blob:local'], uploads: [{ status, previewUrl: 'blob:local', remoteUrl: '' }] };
    assert.ok(publishUtils.publishCopyBlockedReason(source), status);
    assert.throws(() => publishUtils.clonePublishProductDraft(source, 'copy'), /图片/);
  }
  assert.ok(publishUtils.publishCopyBlockedReason({ image: remote, gallery: [remote, 'blob:orphan'] }));
  const source = { image: remote, gallery: [remote], uploads: [{ status: 'uploaded', remoteUrl: remote, previewUrl: 'blob:expired', file: {} }] };
  assert.equal(publishUtils.publishCopyBlockedReason(source), '');
  const clone = publishUtils.clonePublishProductDraft(source, 'copy');
  assert.deepEqual(clone.gallery, [remote]);
  assert.equal(clone.image, remote);
  assert.deepEqual(clone.uploads, []);
  assert.equal(source.uploads.length, 1);
  assert.equal(publishUtils.publishCopyBlockedReason({ gallery: [], uploads: [] }), '');
});

test('质量分使用平台低分标记，翻译原因并保留未知原文，不推算阈值或缺失评分', () => {
  const result = publishUtils.publishQualitySummary({ finalScore: 3.9, lowScore: true,
    deductReasons: ['title_word_miss_core_error', '图片需要优化', 'new_platform_code', 'title_word_miss_core_error'] });
  assert.equal(result.score, 3.9);
  assert.equal(result.tone, 'warning');
  assert.equal(result.label, '平台判定分数偏低');
  assert.deepEqual(result.reasons.map(reason => reason.text), ['标题缺少核心词', '图片需要优化', '平台返回了其他扣分项，请查看原始原因']);
  assert.equal(result.reasons[2].raw, 'new_platform_code');
  assert.equal(publishUtils.publishQualitySummary({ finalScore: 3.9, lowScore: false }).tone, 'good');
  assert.equal(publishUtils.publishQualitySummary({ finalScore: 5.8, lowScore: null }).label, '平台未返回达标判定');
  assert.equal(publishUtils.publishQualitySummary({ finalScore: 0, lowScore: true }).score, 0);
  for (const finalScore of [null, undefined, '', ' ', false, NaN]) {
    const missing = publishUtils.publishQualitySummary({ finalScore });
    assert.equal(missing.score, null);
    assert.equal(missing.label, '质量分暂未返回');
  }
  assert.equal(publishUtils.publishQualitySummary({ lowScore: true }).emptyReason, '平台未返回具体扣分原因');
  assert.equal(publishUtils.translatePublishQualityReason('constructor').text, '平台返回了其他扣分项，请查看原始原因');
  assert.match(publishUtils.publishResultDetail({ status: 'saved_draft', finalScore: 3.9, deductReasons: ['title_word_miss_core_error'] }), /标题缺少核心词/);
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

test('详情独立复用，超过6张仍保留顺序、图注、公司资料与问答，复制不共享编辑', () => {
  const detail = { detailImage: Array.from({ length: 10 }, (_, i) => ({ url: `https://cdn.example.com/detail-${i}.jpg`, text: `Caption ${i}` })),
    companyDesc: 'Company\nIntroduction', companyImage: [{ url: 'https://cdn.example.com/company.jpg', text: 'Factory' }],
    faqs: [{ question: 'MOQ?', answer: '10 pieces' }] };
  const reference = { detail, images: { primary: Array.from({ length: 6 }, (_, i) => `https://cdn.example.com/main-${i}.jpg`) } };
  const product = publishUtils.mapReferenceProductToDraft(reference, { fields: [] });
  assert.equal(product.gallery.length, 6);
  assert.deepEqual(product.detail, detail);
  const copy = publishUtils.clonePublishProductDraft(product, 'copy');
  copy.detail.detailImage.reverse(); copy.detail.detailImage[0].text = 'changed';
  copy.detail.companyDesc = 'changed'; copy.detail.companyImage.pop(); copy.detail.faqs[0].answer = 'changed';
  assert.deepEqual(product.detail, detail);
  product.detail.faqs.push({ question: 'new', answer: 'yes' });
  assert.equal(reference.detail.faqs.length, 1);
  assert.equal(publishUtils.mapReferenceProductToDraft({ images: { detail: reference.images.primary } }, {}).detail.detailImage.length, 6);
});

test('详情提交拒绝临时图片、非法结构和半条问答，空详情兼容旧商品', () => {
  assert.deepEqual(publishUtils.normalizePublishDetail(), publishUtils.createPublishDetail());
  for (const key of ['detailImage', 'companyImage']) {
    for (const url of ['blob:local', 'data:image/png;base64,a', 'javascript:alert(1)', '']) {
      const product = { detail: { ...publishUtils.createPublishDetail(), [key]: [{ url, text: '' }] } };
      assert.throws(() => publishUtils.normalizePublishDetail(product.detail), /尚未上传成功/);
      if (url) assert.notEqual(publishUtils.publishCopyBlockedReason(product), '');
    }
    assert.throws(() => publishUtils.normalizePublishDetail({ [key]: Array.from({ length: 101 }, () => ({ url: 'https://example.com/1' })) }), /100/);
  }
  assert.throws(() => publishUtils.normalizePublishDetail({ faqs: [{ question: 'Q', answer: '' }] }), /同时填写/);
  assert.throws(() => publishUtils.normalizePublishDetail({ companyDesc: {} }), /文本/);
  assert.throws(() => publishUtils.normalizePublishDetail({ detailImage: 'wrong' }), /100/);
  assert.throws(() => publishUtils.normalizePublishDetail({ detailImage: [{ url: 12 }] }), /文本/);
  assert.deepEqual(publishUtils.normalizePublishDetail({ faqs: [{ question: ' ', answer: '' }] }).faqs, []);
  const source = { detailImage: [{ url: 'https://example.com/a', text: '<script>test</script>' }], companyDesc: 'a\nb' };
  const copy = publishUtils.normalizePublishDetail(source);
  assert.equal(copy.detailImage[0].text, '<script>test</script>');
  copy.detailImage[0].text = 'edited'; assert.equal(source.detailImage[0].text, '<script>test</script>');
});


test('图集ID、选择与复制保留，取消勾选可恢复，旧无分组图片继续提交', () => {
  const detail = { detailImage: [
    { url: 'https://example.com/a', text: 'A', imageSetId: '200' },
    { url: 'https://example.com/b', text: 'B', imageSetId: 'custom-42' },
    { url: 'https://example.com/c', text: 'C' },
  ], imageGroupSelection: { detailImage: ['200', ''] } };
  assert.deepEqual(publishUtils.normalizePublishDetail(detail).detailImage.map(row => row.url), ['https://example.com/a', 'https://example.com/c']);
  assert.equal(publishUtils.publishImageSetOptions(detail, 'detailImage').find(row => row.id === 'custom-42').label, '原商品图集（custom-42）');
  const copy = publishUtils.clonePublishProductDraft({ detail }, { id: 'copy' });
  copy.detail.imageGroupSelection.detailImage.push('custom-42');
  copy.detail.detailImage[0].imageSetId = '350';
  assert.equal(detail.detailImage[0].imageSetId, '200');
  assert.deepEqual(detail.imageGroupSelection.detailImage, ['200', '']);
  detail.imageGroupSelection.detailImage.push('custom-42');
  assert.equal(publishUtils.normalizePublishDetail(detail).detailImage.length, 3);
  for (const bad of [{ detailImage: '200' }, { detailImage: ['<script>'] }]) {
    assert.throws(() => publishUtils.normalizePublishDetail({ ...detail, imageGroupSelection: bad }), /图集/);
  }
  assert.throws(() => publishUtils.normalizePublishDetail({ detailImage: [{ url: 'https://example.com/a', imageSetId: {} }] }), /图集/);
});
