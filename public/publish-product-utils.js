/* 产品发布纯数据辅助函数：浏览器和 Node 测试共用，不访问 DOM 或外部接口。 */
'use strict';

(function exposePublishProductUtils(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LsouPublishUtils = api;
})(typeof window !== 'undefined' ? window : globalThis, function createPublishProductUtils() {
  // 商品主副图的统一上限；前端选择、批量导入和服务端提交共用，规格图/商详图不在此限额内。
  const MAX_PRODUCT_IMAGES = 6;
  // 工作区的资源保护边界，独立于平台主图上限；不将它解释为国际站规则。
  const MAX_DETAIL_ITEMS = 100;

  // 2026-09-15 从当前账号完整商品 mediaInfoDTO.imageSet 核实的分类；非完整平台枚举。
  // 未识别的来源图集仍保留原 ID，不能根据名称猜测一个平台编号。
  const PUBLISH_IMAGE_SETS = Object.freeze({
    detailImage: Object.freeze([['200', '场景图'], ['110', '规格参数图'], ['350', '其他商品图片']]),
    companyImage: Object.freeze([['400', '公司介绍'], ['500', '工厂情况'], ['550', '定制能力'],
      ['700', '包装运输'], ['750', '其他公司介绍'], ['450', '公司优势'], ['650', '参展情况']]),
  });

  /** @param {*} value 平台图集ID或空值。@returns {string} 有界原ID，空字符串代表未分组。@throws {Error} 非法ID。 */
  function publishImageSetId(value) {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) throw new Error('图片图集编号格式不正确，请重新选择图集');
    return value;
  }

  /** @param {object} detail 工作区详情。@param {string} key 图片字段。@returns {string[]} 当前勾选ID；旧资料默认全部带入。@throws {Error} 选择结构或ID非法。 */
  function selectedPublishImageSets(detail, key) {
    const selection = detail?.imageGroupSelection;
    if (selection !== undefined && (!selection || typeof selection !== 'object' || Array.isArray(selection))) throw new Error('图片图集选择格式不正确');
    const ids = selection?.[key];
    if (ids !== undefined && (!Array.isArray(ids) || ids.length > MAX_DETAIL_ITEMS + 20)) throw new Error('图片图集选择格式不正确');
    return [...new Set((ids ?? (detail?.[key] || []).map(row => row?.imageSetId)).map(publishImageSetId))];
  }

  /** @param {object} detail 工作区详情。@param {string} key 图片字段。@returns {object[]} 本次勾选图片，引用原对象供界面读取。@throws {Error} 非法图集结构。 */
  function selectedPublishDetailImages(detail, key) {
    const selected = new Set(selectedPublishImageSets(detail, key));
    return (detail?.[key] || []).filter(row => selected.has(publishImageSetId(row?.imageSetId)));
  }

  /** @param {object} detail 工作区详情。@param {string} key 图片字段。@returns {Array<{id:string,label:string}>} 已核实选项及原商品其他图集。@throws {Error} 非法图集结构。 */
  function publishImageSetOptions(detail, key) {
    const options = new Map([['', '未分组'], ...(PUBLISH_IMAGE_SETS[key] || [])]);
    for (const id of [...selectedPublishImageSets(detail, key), ...(detail?.[key] || []).map(row => publishImageSetId(row.imageSetId))]) {
      if (!options.has(id)) options.set(id, `原商品图集（${id}）`);
    }
    return [...options].map(([id, label]) => ({ id, label }));
  }

  /** 创建独立的空详情数据。无参数；返回图文和问答对象；不抛异常。 */
  function createPublishDetail() {
    return { detailImage: [], companyDesc: '', companyImage: [], faqs: [] };
  }

  /**
   * 校验提交详情，保留图片顺序和文字，拒绝本地预览地址而非悄悄丢图。
   * @param {object|undefined} value 工作区详情，图片为 {url,text,imageSetId?}，问答为 {question,answer}。
   * @returns {object} 独立、可提交的详情副本；完全空白问答行不提交。
   * @throws {Error} 字段类型、资源数量、远程地址或问答不完整时抛出中文错误。
   */
  function normalizePublishDetail(value) {
    if (value === undefined) return createPublishDetail();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('商品详情格式不正确');
    const result = createPublishDetail();
    for (const [key, label] of [['detailImage', '商详图'], ['companyImage', '公司图片'], ['faqs', '常见问答']]) {
      const rows = value[key] ?? [];
      if (!Array.isArray(rows) || rows.length > MAX_DETAIL_ITEMS) throw new Error(`${label}最多支持 ${MAX_DETAIL_ITEMS} 项`);
      const included = key === 'faqs' ? rows : selectedPublishDetailImages(value, key);
      result[key] = included.map((row, index) => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`${label}第 ${index + 1} 项格式不正确`);
        const keys = key === 'faqs' ? ['question', 'answer'] : ['url', 'text'];
        const item = Object.fromEntries(keys.map(field => {
          if (row[field] !== undefined && typeof row[field] !== 'string') throw new Error(`${label}第 ${index + 1} 项必须填写文本`);
          return [field, (row[field] || '').trim()];
        }));
        if (key === 'faqs') {
          if (Boolean(item.question) !== Boolean(item.answer)) throw new Error(`常见问答第 ${index + 1} 项需同时填写问题和回答`);
        } else {
          if (!isRemoteImage(item.url)) throw new Error(`${label}第 ${index + 1} 张尚未上传成功，请重试或移除`);
          const id = publishImageSetId(row.imageSetId);
          if (id) item.imageSetId = id;
        }
        return item;
      }).filter(row => key !== 'faqs' || row.question || row.answer);
    }
    if (value.companyDesc !== undefined && typeof value.companyDesc !== 'string') throw new Error('公司介绍必须填写文本');
    result.companyDesc = (value.companyDesc || '').trim();
    return result;
  }
  // 中文含义依据当前国际站生意助手 product-score-rules.md 扣分项对照表。
  // 只翻译平台实际返回的项目，不由本地分数推算问题、阈值或扣分值。
  const QUALITY_REASON_LABELS = Object.freeze({
    category: '类目与标题或属性不匹配', imageText: '图片与商品文字描述不一致',
    name_capitalize_first_letter: '标题首字母未大写', image_num: '主图数量不足', ggs_image_num: '主图数量不足',
    imageSubTitle: '图片与副标题不匹配', imageQualityBad: '图片清晰度或分辨率不足', image_scale: '图片尺寸不符合平台要求',
    title_repeat: '标题存在重复词或信息堆砌', title_spell: '标题存在拼写错误', title_bad: '标题含不当信息',
    title_word_miss_core_error: '标题缺少核心词', selling_point_attribute_conflict: '卖点与属性描述冲突',
    attribute_less_or_repeat: '属性填写不完整或存在重复', price: '价格合理性检测未通过',
    inventory: '规格库存不足以满足最小起订量', moq_incomplete: '最小起订量信息不完整',
    sku_text: '规格文本描述不规范', sku_image: '规格图片不完整或质量不佳', range_price: '价格区间不明确',
    shipping_cal: '物流费用不可计算', lead_time_exist: '交期信息未满足平台要求', lead_time: '交期服务未满足平台要求',
    moq_price_ability: '最小起订量对应的价格竞争力不足', shipping_fee_weight: '运费占比或重量、体积信息不合理',
    price_ability: '价格竞争力不足', keyword_length: '关键词总长度不足', keyword_core_less: '关键词缺少核心词',
    keyword_repeat: '关键词重复', keyword_bad: '关键词含不当信息', keyword_name_impact: '关键词与标题不一致',
    detail_bad: '详情描述质量不佳', product_certification: '缺少产品认证', free_samples: '未提供样品服务',
    light_customization: '未开启定制服务', trend_product: '平台未判定为趋势品', main_video_bad: '主图视频质量不佳',
    payment_method: '支付方式配置不完整', core_country_arrival_guarantee: '核心国家未配置到货保障',
    anything_core_country_delivery_by: '有核心国家未配置到货保障',
  });
  /**
   * 将任意值转换为有限数字；缺失或非法值保持为空，避免给参考商品编造参数。
   *
   * @param {*} value - WorkCTL 返回的数字候选值。
   * @returns {number|null} 有限数字或 null。
   * @throws {Error} 不主动抛出异常。
   */
  function finiteNumberOrNull(value) {
    if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  /**
   * 判断地址能否被国际站服务端读取；本地 blob/data 地址不能用于复制发品。
   *
   * @param {*} value - 图片地址候选值。
   * @returns {boolean} 仅公开 HTTP(S) 地址返回 true。
   * @throws {Error} URL 解析错误会被捕获并返回 false。
   */
  function isRemoteImage(value) {
    try {
      const url = new URL(String(value || ''));
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
      return false;
    }
  }

  /**
   * 检查复制是否会带走尚未取得远程地址的图片。
   * @param {object} product 本地商品，包含 gallery/image 和 uploads 上传记录。
   * @returns {string} 不可复制时返回中文原因；空字符串表示可以复制（无图片草稿也可复制）。
   * @throws {Error} 不主动抛出异常。
   */
  function publishCopyBlockedReason(product) {
    const uploads = Array.isArray(product?.uploads) ? product.uploads : [];
    if (uploads.some(record => record.status === 'failed')) return '图片上传失败，请重试或删除失败图片后再复制';
    if (uploads.some(record => record.status !== 'uploaded' || !isRemoteImage(record.remoteUrl))) {
      return '图片尚未上传完成，请等待全部图片上传成功后再复制';
    }
    const images = [product?.image, ...(Array.isArray(product?.gallery) ? product.gallery : []),
      ...['detailImage', 'companyImage'].flatMap(key => (product?.detail?.[key] || []).map(row => row.url))].filter(Boolean);
    return images.some(url => !isRemoteImage(url)) ? '图片尚未取得可用地址，请完成上传或删除该图片后再复制' : '';
  }

  /**
   * 将平台扣分项转换为中文，保留原文供未知编码排查。
   * @param {*} value deductReasons 单项（当前服务返回字符串）。
   * @returns {{text:string,raw:string}} 中文原因及未经改写的原始文本；空项返回空文本。
   * @throws {Error} 不主动抛出异常。
   */
  function translatePublishQualityReason(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    const known = Object.hasOwn(QUALITY_REASON_LABELS, raw) ? QUALITY_REASON_LABELS[raw] : '';
    return { raw, text: known || (/[\u3400-\u9fff]/.test(raw) ? raw : raw ? '平台返回了其他扣分项，请查看原始原因' : '') };
  }

  /**
   * 整理质量分展示状态；仅使用平台 lowScore 标记，不硬编码达标线或满分。
   * @param {object} job 已有发布/草稿回执。
   * @returns {object} 原始分数、中文原因、提示和视觉状态，缺失分数保持 null。
   * @throws {Error} 不主动抛出异常。
   */
  function publishQualitySummary(job = {}) {
    const score = ['number', 'string'].includes(typeof job.finalScore) ? finiteNumberOrNull(job.finalScore) : null;
    const reasons = [...new Set(Array.isArray(job.deductReasons) ? job.deductReasons : [])]
      .map(translatePublishQualityReason).filter(reason => reason.text);
    const low = job.lowScore === true;
    const tone = low || reasons.length ? 'warning' : score !== null && job.lowScore === false ? 'good' : 'neutral';
    const label = low ? '平台判定分数偏低' : reasons.length ? '存在扣分项'
      : score === null ? '质量分暂未返回' : job.lowScore === false ? '平台未标记低分' : '平台未返回达标判定';
    const emptyReason = low ? '平台未返回具体扣分原因' : score === null ? '暂时无法判断质量分是否达标' : '本次未返回扣分项';
    return { score, reasons, tone, label, emptyReason, message: String(job.qualityScoreMessage || '').trim() };
  }

  /**
   * 按当前实时类目字段，把现有商品属性从 attrNameId 映射到前端业务字段键。
   *
   * 多选属性会合并同一 attrNameId 的多条值；固定枚举仅保留当前 Schema 仍允许的
   * 选项，防止旧商品的过期值直接进入新商品发布队列。
   *
   * @param {Array<object>} sourceAttributes - 现有商品的属性列表。
   * @param {object} categoryConfig - 当前类目的实时字段配置。
   * @returns {Record<string,string|string[]>} 可直接交给本地草稿的属性对象。
   * @throws {Error} 不主动抛出异常，格式异常时返回对应字段的空值。
   */
  function mapReferenceAttributes(sourceAttributes, categoryConfig) {
    const valuesById = new Map();
    (Array.isArray(sourceAttributes) ? sourceAttributes : []).forEach(attribute => {
      const attrId = Number(attribute?.attrNameId);
      const value = String(attribute?.attrValue ?? '').trim();
      if (!Number.isSafeInteger(attrId) || attrId <= 0 || !value) return;
      if (!valuesById.has(attrId)) valuesById.set(attrId, []);
      if (!valuesById.get(attrId).includes(value)) valuesById.get(attrId).push(value);
    });

    return Object.fromEntries((categoryConfig?.fields || []).map(field => {
      const values = valuesById.get(Number(field.attrId)) || [];
      const allowedValues = field.enumProp && field.control !== 'region' && !field.inputProp && field.choices?.length
        ? values.filter(value => field.choices.includes(value))
        : values;
      return [field.key, field.multiSelect || field.control === 'multi' ? allowedValues : (allowedValues[0] || '')];
    }));
  }

  /**
   * 读取参考商品的关键词；标准发布字段为空时，兼容当前商品模板中明确命名的关键词属性。
   * @param {object} reference - 参考接口返回的 keywords 数组和当前商品 texts 列表，兼容本地旧缓存。
   * @returns {{keywords:string[],keywordSource:string,referenceKeywordsEmpty:boolean}} 最多5个关键词及来源状态。
   * @throws {Error} 不主动抛出异常；缺失或非文本资料按空值处理。
   */
  function readReferenceKeywords(reference) {
    const standard = [...new Set((Array.isArray(reference?.keywords) ? reference.keywords : [])
      .filter(value => typeof value === 'string').map(value => value.trim()).filter(Boolean))].slice(0, 5);
    if (standard.length) return { keywords: standard, keywordSource: 'reference', referenceKeywordsEmpty: false };

    // WorkCTL 模板会把自定义属性“Keywords:”和分隔冒号合成“Keywords:: 值”。
    // 只匹配整条、明确标注的属性，不扫描商品描述或推荐商品，更不能把标题推测成原关键词。
    const values = (Array.isArray(reference?.texts) ? reference.texts : []).flatMap(text => {
      if (typeof text !== 'string') return [];
      const match = text.trim().match(/^(?:keywords?|关键词)[ \t]*[:：]+[ \t]*([^:：\s][^\r\n]*)$/i);
      return match ? [match[1].trim().slice(0, 40)] : [];
    });
    const keywords = [...new Set(values.filter(Boolean))].slice(0, 5);
    return { keywords, keywordSource: keywords.length ? 'reference-attribute' : 'reference', referenceKeywordsEmpty: !keywords.length };
  }

  /**
   * 将后端返回的现有商品详情转换为一条新发布草稿的覆盖字段。
   *
   * @param {object} reference - `/api/publish/account-reference` 返回的参考商品。
   * @param {object} categoryConfig - 当前账号实时类目 Schema 的前端配置。
   * @param {{fallbackTitle?:string,fallbackImage?:string,selectedImages?:string[]}} [options={}] - 列表标题、缩略图及用户已选旧图兜底。
   * @returns {object} 可传给 `createPublishProduct` 的标题、图片、属性、交易和履约字段。
   * @throws {Error} 不主动抛出异常；缺失字段保持为空，交给页面明确提示补全。
   */
  function mapReferenceProductToDraft(reference, categoryConfig, options = {}) {
    const selectedImages = (Array.isArray(options.selectedImages) ? options.selectedImages : []).filter(isRemoteImage);
    const responseImages = ['primary', 'sku', 'detail'].flatMap(type =>
      Array.isArray(reference?.images?.[type]) ? reference.images[type] : []
    ).filter(isRemoteImage);
    const fallbackImage = isRemoteImage(options.fallbackImage) ? options.fallbackImage : '';
    const gallery = [...new Set(selectedImages.length ? selectedImages : [...responseImages, fallbackImage])].slice(0, MAX_PRODUCT_IMAGES);

    const trade = reference?.trade || {};
    const fulfillment = reference?.fulfillment || {};
    const priceTiers = (Array.isArray(trade.ladderPrices) ? trade.ladderPrices : []).map(tier => ({
      minQuantity: finiteNumberOrNull(tier?.minQuantity),
      unitPrice: finiteNumberOrNull(tier?.unitPrice),
    })).filter(tier => Number.isInteger(tier.minQuantity) && tier.minQuantity >= 1 && tier.unitPrice > 0);
    const leadTimeTiers = (Array.isArray(fulfillment.ladderPeriod) ? fulfillment.ladderPeriod : []).map(tier => ({
      maxQuantity: finiteNumberOrNull(tier?.quantity),
      days: finiteNumberOrNull(tier?.period),
    })).filter(tier => Number.isInteger(tier.maxQuantity) && tier.maxQuantity >= 1 && Number.isInteger(tier.days) && tier.days >= 1);

    return {
      title: String(reference?.title || options.fallbackTitle || '').trim().slice(0, 128),
      image: gallery[0] || '',
      gallery,
      imageCount: gallery.length,
      detail: reference?.detail ? JSON.parse(JSON.stringify(reference.detail)) : {
        ...createPublishDetail(),
        detailImage: (reference?.images?.detail || []).filter(isRemoteImage).map(url => ({ url, text: '' })),
      },
      ...readReferenceKeywords(reference),
      attributes: mapReferenceAttributes(reference?.attributes, categoryConfig),
      saleType: ['normal', 'batch'].includes(trade.saleType) ? trade.saleType : 'normal',
      batchNum: finiteNumberOrNull(trade.batchNum) ?? 1,
      moq: finiteNumberOrNull(trade.moq) ?? '',
      inventory: finiteNumberOrNull(trade.inventory) ?? '',
      priceUnitId: finiteNumberOrNull(trade.priceUnit),
      priceTiers,
      skus: JSON.parse(JSON.stringify(Array.isArray(trade.sku) ? trade.sku : [])),
      leadTimeTiers,
      package: {
        length: finiteNumberOrNull(fulfillment.pkgLength) ?? '',
        width: finiteNumberOrNull(fulfillment.pkgWidth) ?? '',
        height: finiteNumberOrNull(fulfillment.pkgHeight) ?? '',
        weight: finiteNumberOrNull(fulfillment.pkgWeight) ?? '',
      },
      logisticsProperty: Array.isArray(fulfillment.logisticsProperty)
        ? [...new Set(fulfillment.logisticsProperty.map(value => String(value || '').trim()).filter(Boolean))]
        : [],
      shippingTemplateId: finiteNumberOrNull(fulfillment.shippingTemplateId),
      sellingPoints: (Array.isArray(reference?.sellingPoints) && reference.sellingPoints.length
        ? reference.sellingPoints : reference?.texts || [])
        .map(value => String(value || '').trim()).filter(Boolean).slice(0, 5),
    };
  }

  /**
   * 深拷贝一条待发布商品，供“复制同类”快速创建可独立编辑的新草稿。
   *
   * @param {object} source - 当前待发布商品。
   * @param {string} newId - 新草稿的本地唯一 ID。
   * @returns {object} 与源商品不共享数组或嵌套对象的新草稿。
   * @throws {TypeError} 源商品不是普通对象、新 ID 为空或图片尚未取得远程地址时抛出。
   */
  function clonePublishProductDraft(source, newId) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      throw new TypeError('请选择需要复制的商品');
    }
    if (!String(newId || '').trim()) throw new TypeError('复制商品缺少新的本地标识');
    const blockedReason = publishCopyBlockedReason(source);
    if (blockedReason) throw new TypeError(blockedReason);
    const clone = JSON.parse(JSON.stringify(source));
    clone.id = String(newId);
    clone.selected = true;
    clone.schemaLoading = false;
    // 成功副本只复用远程图片，不复制 File/临时预览/上传任务，避免失效预览和重复上传。
    clone.uploads = [];
    // 新草稿即使字段完整，也必须重新经过当前页面的发布前检查。
    clone.status = 'needs_attention';
    return clone;
  }

  /**
   * 创建待填写的规格，不虚构颜色、型号、编码、价格或库存。
   * @returns {object} 独立空规格，数字为空时由服务端按单规格/阶梯价规则处理。
   * @throws {Error} 不主动抛出异常。
   */
  function createEmptyPublishSku() {
    return { skuCode: '', skuAttributes: [{ attrNameId: null, attrName: '', attrValueId: null, attrValue: '', imageUrl: null }], stock: null, unitPrice: null };
  }

  /**
   * 生成队列与结果弹窗共用的说明；失败优先显示原因，未知评分不会显示成零。
   * @param {object} job - 服务端任务摘要。
   * @param {string[]} [fieldLabels=[]] - 已翻译的待检查区域。
   * @returns {string} 供调用方 HTML 转义的纯文本。
   * @throws {Error} 不主动抛出异常。
   */
  function publishResultDetail(job, fieldLabels = []) {
    if (job.status === 'failed') {
      const codes = { JSON_VAL_EMPTY_SKU: '商品规格列表为空，请补齐规格资料', JSON_VAL_SKU_NO_ATTR: '商品规格缺少名称或值，请补齐规格资料' };
      const message = codes[job.errorCode] || job.message || '任务失败，请检查商品资料';
      return `${message}${fieldLabels.length ? `；请检查：${fieldLabels.join('、')}` : ''}${job.errorCode ? `（${job.errorCode}）` : ''}`;
    }
    const score = finiteNumberOrNull(job.finalScore);
    if (score !== null) return `质量分 ${score}${job.deductReasons?.length ? ` · ${job.deductReasons.map(translatePublishQualityReason).map(reason => reason.text).filter(Boolean).join('；')}` : ''}`;
    return ['saved_draft', 'submitted'].includes(job.status) ? (job.qualityScoreMessage || '质量分暂未返回') : (job.message || '');
  }

  return { MAX_PRODUCT_IMAGES, MAX_DETAIL_ITEMS, PUBLISH_IMAGE_SETS, publishImageSetId, selectedPublishImageSets,
    selectedPublishDetailImages, publishImageSetOptions, createPublishDetail, normalizePublishDetail,
    mapReferenceProductToDraft, clonePublishProductDraft, publishCopyBlockedReason,
    translatePublishQualityReason, publishQualitySummary, finiteNumberOrNull, createEmptyPublishSku, publishResultDetail };
});
