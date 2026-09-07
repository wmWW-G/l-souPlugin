/* 产品发布纯数据辅助函数：浏览器和 Node 测试共用，不访问 DOM 或外部接口。 */
'use strict';

(function exposePublishProductUtils(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LsouPublishUtils = api;
})(typeof window !== 'undefined' ? window : globalThis, function createPublishProductUtils() {
  /**
   * 将任意值转换为有限数字；缺失或非法值保持为空，避免给参考商品编造参数。
   *
   * @param {*} value - WorkCTL 返回的数字候选值。
   * @returns {number|null} 有限数字或 null。
   * @throws {Error} 不主动抛出异常。
   */
  function finiteNumberOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
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
    const gallery = [...new Set(selectedImages.length ? selectedImages : [...responseImages, fallbackImage])].slice(0, 10);

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
      keywords: [...new Set((Array.isArray(reference?.keywords) ? reference.keywords : [])
        .map(value => String(value || '').trim()).filter(Boolean))].slice(0, 5),
      attributes: mapReferenceAttributes(reference?.attributes, categoryConfig),
      saleType: ['normal', 'batch'].includes(trade.saleType) ? trade.saleType : 'normal',
      batchNum: finiteNumberOrNull(trade.batchNum) ?? 1,
      moq: finiteNumberOrNull(trade.moq) ?? '',
      inventory: finiteNumberOrNull(trade.inventory) ?? '',
      priceUnitId: finiteNumberOrNull(trade.priceUnit),
      priceTiers,
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
   * @throws {TypeError} 源商品不是普通对象或新 ID 为空时抛出。
   */
  function clonePublishProductDraft(source, newId) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      throw new TypeError('请选择需要复制的商品');
    }
    if (!String(newId || '').trim()) throw new TypeError('复制商品缺少新的本地标识');
    const clone = JSON.parse(JSON.stringify(source));
    clone.id = String(newId);
    clone.selected = true;
    clone.schemaLoading = false;
    // 新草稿即使字段完整，也必须重新经过当前页面的发布前检查。
    clone.status = 'needs_attention';
    return clone;
  }

  return { mapReferenceProductToDraft, clonePublishProductDraft };
});
