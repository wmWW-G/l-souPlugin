#!/usr/bin/env node
/**
 * workctl 可视化数据面板 — 后端
 * 零外部依赖。只读经营接口继续使用查询白名单；产品发布则使用独立的确认、
 * 校验、幂等和串行队列边界，避免把写操作混进通用查询路由。
 */
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const PORT = Number(process.env.PORT || 8787);
const HOST = '127.0.0.1';
const WORKCTL = process.env.WORKCTL_BIN ||
  '/Users/garden/.accio/accounts/7070142663_212003/plugins/data/cli-tools/plugins/alibaba-com-seller-assistant/tools/workctl/versions/0.1.53/prefix/bin/workctl';

// ---------------------------------------------------------------------------
// 端点白名单：只读。key => { argv, flags(允许的业务参数), label }
// ---------------------------------------------------------------------------
const ENDPOINTS = {
  'shop-summary': {
    argv: ['icbu', 'advisor', 'data-advisor-shop-summary'],
    flags: ['startDate', 'endDate', 'statisticsType'],
    label: '经营大盘',
  },
  'shop-product': {
    argv: ['icbu', 'advisor', 'data-advisor-shop-product'],
    flags: ['pageNo', 'pageSize', 'orderBy', 'orderModel', 'productName',
            'prodLevel', 'minViews', 'maxViews', 'minClicks', 'maxClicks',
            'minInquiries', 'maxInquiries', 'minClickRate', 'maxClickRate',
            'p4pProd', 'hasEffect', 'starMkProd', 'bizProd', 'domain'],
    label: '商品效果',
  },
  'shop-region': {
    argv: ['icbu', 'advisor', 'data-advisor-shop-region'],
    flags: ['startDate', 'endDate', 'statisticsType', 'dimensionType', 'terminalType'],
    label: '地域分布',
  },
  'shop-flow': {
    argv: ['icbu', 'advisor', 'data-advisor-shop-flow'],
    flags: ['startDate', 'endDate', 'terminalType'],
    label: '流量渠道',
  },
  'shop-channel': {
    argv: ['icbu', 'advisor', 'data-advisor-shop-channel'],
    flags: ['startDate', 'endDate', 'statisticsType', 'terminalType'],
    label: '渠道效果',
  },
  'visitor-detail': {
    argv: ['icbu', 'advisor', 'data-advisor-visitor-detail'],
    flags: ['startDate', 'endDate', 'pageNO', 'pageSize', 'buyerCountry',
            'buyerRegion', 'orderBy', 'orderModel', 'searchKeyword',
            'isAtmFb', 'isMcFb', 'hasRemarks'],
    boolFlags: ['isAtmFb', 'isMcFb', 'hasRemarks'],
    label: '访客明细',
  },
  'account-summary': {
    argv: ['icbu', 'advisor', 'data-advisor-account-summary'],
    flags: ['startDate', 'endDate', 'statisticsType'],
    label: '员工绩效',
  },
  'flow-profile': {
    argv: ['icbu', 'advisor', 'data-advisor-shop-flow-profile'],
    flags: ['startDate', 'endDate', 'indexName', 'sourceType', 'terminalType'],
    label: '流量画像',
  },
  'customer-profile': {
    argv: ['icbu', 'advisor', 'data-advisor-shop-customer-profile'],
    flags: ['dimensionType', 'byrGroup', 'byrGrowthLevel', 'nd', 'terminalType', 'domainId'],
    label: '客户画像',
  },
  'tm-recent': {
    argv: ['icbu', 'tm', 'query-recent-conversation'],
    flags: ['domain', 'limitTimeStamp', 'selfAliId'],
    label: '最近会话',
  },
  'tm-account-diagnosis': {
    argv: ['icbu', 'tm', 'list-seller-acct-dim-diag-data'],
    flags: ['buyerType', 'dateType', 'queryDate'],
    label: '客服账号诊断',
  },
  'tm-shop-diagnosis': {
    argv: ['icbu', 'tm', 'list-seller-shop-dim-diag-data'],
    flags: ['buyerType', 'dateType', 'queryDate'],
    label: '店铺接待诊断',
  },
  'tm-quality-check': {
    argv: ['icbu', 'tm', 'list-seller-chat-quality-check'],
    flags: ['queryDate'],
    label: '聊天质检',
  },
  'product-low-score': {
    argv: ['icbu', 'product', 'diagnosis-list-low-score-products'],
    flags: ['minScore', 'maxScore'],
    label: '低质量分商品',
  },
  'product-zero-effect': {
    argv: ['icbu', 'product', 'diagnosis-list-zero-effect-products'],
    flags: [],
    label: '零效果商品',
  },
  'product-score': {
    argv: ['icbu', 'product', 'get-score'],
    flags: ['productId'],
    label: '商品质量分',
  },
  'market-country': {
    argv: ['icbu', 'product', 'data-advisor-industry-country-rank'],
    flags: ['cateId', 'orderBy', 'orderModel', 'rankType'],
    label: '行业国家机会',
  },
  'market-categories': {
    argv: ['icbu', 'product', 'data-advisor-industry-cate-rank'],
    flags: ['cateId', 'orderBy', 'orderModel', 'rankType'],
    label: '细分类目机会',
  },
  'market-opportunities': {
    argv: ['icbu', 'product', 'data-advisor-opportunity-discovery'],
    flags: ['cateId', 'countryId', 'currentPage', 'pageSize', 'sceneName', 'statCycle', 'terminalType'],
    label: '细分市场机会',
  },
  'industry-buyer-profile': {
    argv: ['icbu', 'product', 'data-advisor-industry-buyer-profile'],
    flags: ['cateId', 'indexName', 'nd', 'prodAction', 'terminalType'],
    label: '行业买家画像',
  },
  'industry-buyer-channel': {
    argv: ['icbu', 'product', 'data-advisor-industry-buyer-channel'],
    flags: ['cateId', 'indexName', 'nd', 'prodAction', 'terminalType'],
    label: '行业渠道偏好',
  },
  'ads-stat-date': {
    argv: ['icbu', 'ads', 'accio-brand-stat-date'],
    flags: [],
    label: '广告数据产出日期',
  },
  'ads-shop-profile': {
    argv: ['icbu', 'ads', 'search-customer-shop'],
    flags: [],
    label: '店铺关键词画像',
  },
  'ads-keywords': {
    argv: ['icbu', 'ads', 'search-list'],
    flags: ['productId', 'cateIdList', 'channel', 'goodsIdList', 'keywordList',
            'purchaseType', 'requestOrderProperty', 'requestPage', 'sellStatus'],
    label: '可售广告关键词',
  },
  'ads-next-resources': {
    argv: ['icbu', 'ads', 'search-next-month-auction-resource'],
    flags: ['productId', 'sellNode'],
    label: '次月广告资源',
  },
  'ads-company-effect': {
    argv: ['icbu', 'ads', 'accio-brand-comp-effect'],
    flags: ['adProductId', 'allProductId', 'cateLv2Id', 'endStatDate', 'granularity',
            'orderBy', 'pageParam', 'productIdList', 'startStatDate'],
    label: '广告公司效果',
  },
  'ads-keyword-effect': {
    argv: ['icbu', 'ads', 'search-keyword-effect'],
    flags: ['adProductId', 'endStatDate', 'granularity', 'kwStatus', 'orderBy',
            'pageParam', 'productIdList', 'resourceLockId', 'resourceLockIdList',
            'startStatDate', 'terminalType'],
    label: '广告关键词效果',
  },
  'ads-search-term-effect': {
    argv: ['icbu', 'ads', 'accio-brand-package-word-effect'],
    flags: ['adProductId', 'endStatDate', 'granularity', 'isGroupByKw', 'kw', 'kwLike',
            'orderBy', 'pageParam', 'productIdList', 'resourceLockId',
            'resourceLockIdList', 'startStatDate'],
    boolFlags: ['isGroupByKw'],
    label: '广告搜索词效果',
  },
  'ads-product-effect': {
    argv: ['icbu', 'ads', 'search-prod-effect'],
    flags: ['cateLv3Id', 'endDate', 'granularity', 'language', 'orderBy', 'pageParam',
            'prodId', 'prodLevel', 'prodNameLike', 'productIdList',
            'resourceLockIdList', 'startDate'],
    label: '广告商品效果',
  },
  'ads-achieve-rate': {
    argv: ['icbu', 'ads', 'search-achieve-rate'],
    flags: ['adProductId', 'pageParam', 'resourceLockIdList', 'statDate'],
    label: '广告达标率',
  },
  'rfq-internal-search': {
    argv: ['icbu', 'rfq', 'rfq-aw-search'],
    flags: ['pageNum', 'pageSize', 'searchText', 'fullMatchSearchText', 'batchSearchWords',
            'categoryIds', 'countryCodes', 'excludeQuoReached', 'excludeWords', 'gmtOpenEnd',
            'gmtOpenFrom', 'gmtOpenStart', 'gmtOpenTo', 'haveAnnex', 'haveImage', 'language',
            'mixRfqTags', 'openTime', 'quantityMax', 'quantityMin', 'regions'],
    boolFlags: ['excludeQuoReached', 'haveAnnex', 'haveImage'],
    label: '站内 RFQ 商机',
  },
  'rfq-external-search': {
    argv: ['icbu', 'rfq', 'external-rfq-search'],
    flags: ['keywords', 'requiredKeywords', 'countries', 'pageNum', 'pageSize',
            'attachmentAvailable', 'availableSeatsMin', 'budgetMax', 'budgetMin',
            'buyerVerified', 'expiredTimeEnd', 'expiredTimeStart', 'postTimeEnd',
            'postTimeStart', 'quantityMax', 'quantityMin'],
    boolFlags: ['attachmentAvailable', 'buyerVerified'],
    label: '站外 RFQ 商机',
  },
  'rfq-internal-detail': {
    argv: ['icbu', 'rfq', 'rfq-detail-search'],
    flags: ['encRfqId', 'language', 'rfqId', 'rfqUrl'],
    label: '站内 RFQ 详情',
  },
  'rfq-external-detail': {
    argv: ['icbu', 'rfq', 'external-rfq-detail-search'],
    flags: ['rfqId', 'rfqUrl'],
    label: '站外 RFQ 详情',
  },
  'rfq-quote-history': {
    argv: ['icbu', 'rfq', 'rfq-quote-history-search'],
    flags: ['pageSize', 'currentPage', 'documentaryStatus', 'gmtCreateFrom',
            'gmtCreateTo', 'loginId'],
    label: 'RFQ 报价历史',
  },
  'rfq-quote-rights': {
    argv: ['icbu', 'rfq', 'rfq-quote-rights-detail'],
    flags: [],
    label: 'RFQ 报价权益',
  },
};

// ---------------------------------------------------------------------------
// 缓存 + 命令日志
// ---------------------------------------------------------------------------
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;
const cmdLog = [];      // 最近执行的命令，供前端"执行日志"面板消费
const MAX_LOG = 200;

// 产品发布是远端写操作。确认常量不会充当秘密，而是强制调用方明确进入写路径，
// 同时 application/json 与同源检查可阻止普通网页表单误触本机服务。
const PUBLISH_ACKNOWLEDGEMENT = 'I_CONFIRM_PRODUCT_WRITE';
const MAX_PUBLISH_BATCH = 50;
const MAX_PUBLISH_JOBS = 200;
const MAX_PUBLISH_IMAGE_BYTES = 8 * 1024 * 1024;
const PUBLISH_IMAGE_BUCKET = String(process.env.PUBLISH_IMAGE_BUCKET || '').trim();
const PUBLISH_IMAGE_ENDPOINT = String(process.env.PUBLISH_IMAGE_ENDPOINT || '').trim();
const PUBLISH_IMAGE_PATH_PREFIX = String(process.env.PUBLISH_IMAGE_PATH_PREFIX || 'lsou-product-publish').trim();
const PUBLISH_SUBMISSION_INTERVAL_MS = Math.max(0,
  Math.min(Number(process.env.PUBLISH_SUBMISSION_INTERVAL_MS ?? 1000) || 0, 10000));
const publishJobs = [];
const publishRequests = new Map();
let publishWorkerRunning = false;
let publishLastSubmissionAt = 0;

// 发品类目和属性规则变化频率远低于经营数据，因此使用独立的长缓存。
// 缓存只存在于当前 Node 进程内；切换 Accio 账号或重启服务后会自然重新读取，
// 不会把甲店铺的类目规则永久写进乙店铺的插件包。
const PUBLISH_SCHEMA_CACHE_TTL = 30 * 60 * 1000;
const publishCategoryCache = { at: 0, categories: [] };
const publishCategorySchemaCache = new Map();
let publishCategoryLoadPromise = null;

// 计价单位和物流方案属于账号级业务选项。浏览器只展示中文业务名称，平台整数
// 编码始终保留在服务端与请求载荷内部，避免让运营人员理解或手工录入抽象 ID。
// 这些标签来自当前 Alibaba Seller Assistant 随附的已验证全局单位口径；若当前
// 店铺使用了其他单位，服务端仍会保留真实编码，并用不暴露编码的通用名称展示。
const VERIFIED_PRICE_UNIT_LABELS = new Map([
  [1, '袋'],
  [4, '件 / 个'],
  [5, '对 / 双'],
  [20, '套'],
  [25, '单位 / 台'],
  [92, '组合装'],
]);
const publishBusinessOptionsCache = { at: 0, value: null };
let publishBusinessOptionsLoadPromise = null;

// 产品发布页只需要当前账号商品的“图片 -> 类目”上下文，不需要把经营接口中的
// 负责人、详情地址、曝光点击等字段一并发给浏览器。该缓存与类目 Schema 使用
// 相同生命周期，切换账号或清空缓存后会重新读取，不会把开发账号的类目带给别人。
const publishAccountCatalogCache = { at: 0, value: null };
let publishAccountCatalogLoadPromise = null;

function pushLog(entry) {
  cmdLog.unshift(entry);
  if (cmdLog.length > MAX_LOG) cmdLog.length = MAX_LOG;
}

// ---------------------------------------------------------------------------
// 执行 workctl
// ---------------------------------------------------------------------------
/**
 * 把页面和端点配置使用的 camelCase 字段名转换成 Workctl schema 声明的
 * kebab-case 命令行参数名。
 *
 * 业务数据仍然使用 `startDate`、`pageNo` 这类字段名，便于和 Workctl 返回的
 * JSON 字段保持一致；只有真正构造 CLI 参数时才转换成 `start-date`、`page-no`。
 * 这样可以避免把 CLI 表示方式泄漏到前端数据模型中。
 *
 * @param {string} name - ENDPOINTS 中允许传递的业务参数名称。
 * @returns {string} 不带前导 `--` 的 Workctl kebab-case 参数名称。
 * @throws {TypeError} 当调用方传入的值不是字符串时，由字符串方法自然抛出。
 */
function toCliFlag(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

function buildArgs(ep, query) {
  const args = [...ep.argv];
  const bools = new Set(ep.boolFlags || []);
  for (const key of ep.flags) {
    const v = query[key];
    if (v === undefined || v === null || v === '') continue;
    if (bools.has(key)) {
      if (v === 'true' || v === true) args.push(`--${toCliFlag(key)}`);
      continue;
    }
    args.push(`--${toCliFlag(key)}`, String(v));
  }
  args.push('--format', 'json', '--compact-output', 'off');
  return args;
}

/**
 * 取得多语言商品标题中的默认文本。
 *
 * @param {*} title - WorkCTL 返回的多语言 title 对象，也可能已是字符串。
 * @returns {string} 可安全展示的标题；缺失时返回空字符串。
 * @throws {Error} 不主动抛异常，非预期结构会回退为空字符串。
 */
function localizedTitle(title) {
  if (typeof title === 'string') return title;
  return String(title?.defaultText || title?.default?.value || '');
}

/**
 * 清理 RFQ 标题和采购描述中由平台搜索高亮产生的 HTML 标签。
 *
 * @param {*} value - WorkCTL 返回的标题、详情或普通文本。
 * @returns {string} 去除标签、合并空白并限制长度后的安全文本。
 * @throws {Error} 不主动抛异常；空值会返回空字符串。
 */
function plainRfqText(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2400);
}

/**
 * 把站内 RFQ 转成页面需要的最小字段集合。
 *
 * 买家姓名、买家账号、详情链接和报价链接不会传到浏览器；页面只展示国家、
 * 买家标签、行为信号和已脱敏公司名，既保留运营判断价值，也避免 Demo 留存个人信息。
 *
 * @param {*} item - 单条站内 RFQ 原始数据。
 * @returns {object} 可用于商机列表和详情面板的脱敏 RFQ。
 * @throws {Error} 不主动抛异常；字段缺失时使用安全默认值。
 */
function shapeInternalRfq(item) {
  const behavior = item?.buyerBehaviorInfo || {};
  const purchase = item?.purchaseInfo || {};
  const attachment = Array.isArray(item?.attachments) ? item.attachments.find(file => file?.type === 'IMAGE') : null;
  return {
    id: String(item?.rfqId || ''),
    source: 'Alibaba.com',
    sourceType: 'internal',
    title: plainRfqText(item?.rfqName),
    description: plainRfqText(item?.detail),
    category: plainRfqText(item?.categoryName),
    countryCode: String(item?.countryCode || ''),
    country: plainRfqText(item?.countryName || item?.countryCode),
    createdText: plainRfqText(item?.gmtCreateText),
    createdAt: Number(item?.gmtCreate || 0),
    lastVisitTime: String(item?.lastVisitTime || ''),
    quantity: Number(item?.quantity || 0),
    quantityUnit: plainRfqText(item?.quantityUnit),
    quotedCount: Number(item?.quotedCount || 0),
    remainingQuota: Number(item?.remainingQuota || 0),
    rfqType: String(item?.rfqType || ''),
    hasImage: Boolean(attachment?.url),
    image: attachment?.url ? String(attachment.url) : '',
    company: plainRfqText(item?.companyInfo?.companyName),
    businessType: plainRfqText(purchase?.businessType),
    buyerTags: (Array.isArray(item?.buyerTags) ? item.buyerTags : [])
      .map(plainRfqText).filter(Boolean).slice(0, 8),
    frequentCategories: (Array.isArray(purchase?.frequentPurchaseCategories)
      ? purchase.frequentPurchaseCategories : []).map(plainRfqText).filter(Boolean).slice(0, 8),
    behavior: {
      loginDays: Number(behavior?.loginDays || 0),
      searchCount: Number(behavior?.searchCount || 0),
      validInquiryCount: Number(behavior?.validInquiryCount || 0),
      validRfqCount: Number(behavior?.validRfqCount || 0),
      receivedQuoteCount: Number(behavior?.receivedQuoteCount || 0),
      viewedQuoteCount: Number(behavior?.viewedQuoteCount || 0),
    },
  };
}

/**
 * 把站外 RFQ 转成与站内商机兼容的详情结构。
 *
 * @param {*} item - 单条站外 RFQ 原始数据。
 * @returns {object} 已去除买家姓名、原站链接等个人或跳转字段的商机数据。
 * @throws {Error} 不主动抛异常；字段缺失时使用安全默认值。
 */
function shapeExternalRfq(item) {
  return {
    id: String(item?.rfqId || ''),
    source: plainRfqText(item?.sourcePlatform || '站外'),
    sourceType: 'external',
    title: plainRfqText(item?.rfqTitle),
    description: plainRfqText(item?.rfqDescription),
    category: plainRfqText(item?.categoryName),
    countryCode: '',
    country: plainRfqText(item?.buyerCountry),
    createdText: String(item?.postTime || ''),
    createdAt: Number(item?.postTimeStart || item?.postTime || 0),
    expiredTime: String(item?.expiredTime || ''),
    quantity: Number(item?.quantity || 0),
    quantityUnit: plainRfqText(item?.quantityUnit),
    quotedCount: Number(item?.quoteCount || 0),
    remainingQuota: Number(item?.availableSeats || 0),
    buyerVerified: item?.buyerVerified === true,
    status: String(item?.rfqStatus || ''),
    tradeTerms: plainRfqText(item?.tradeTerms),
    paymentTerms: plainRfqText(item?.paymentTerms),
    destinationPort: plainRfqText(item?.destinationPort),
    budgetMin: item?.budgetMin ?? null,
    budgetMax: item?.budgetMax ?? null,
    currency: String(item?.currency || ''),
    hasImage: item?.attachmentAvailable === true,
    image: '',
    buyerTags: item?.buyerVerified === true ? ['Verified buyer'] : [],
    frequentCategories: [],
    behavior: {},
  };
}

/**
 * 根据页面所需最小化响应数据，避免把联系人姓名、会话标识、消息正文等
 * 非必要隐私字段发往浏览器。
 *
 * @param {string} name - ENDPOINTS 中的端点名。
 * @param {*} data - WorkCTL 原始 data 字段。
 * @returns {*} 前端实际需要的脱敏或精简数据。
 * @throws {Error} 不主动抛异常，未匹配端点保留原始数据。
 */
function shapeEndpointData(name, data) {
  if (name === 'tm-recent') {
    const conversations = Array.isArray(data?.conversations) ? data.conversations : [];
    return {
      conversations: conversations.map(item => ({
        contactCountry: item?.contactCountry || '未知',
        conversationModifyTime: item?.conversationModifyTime || null,
        hasUnread: item?.hasUnread === true,
        unreadMessageCount: Number(item?.unreadMessageCount || 0),
        tags: Array.isArray(item?.tags) ? item.tags.map(String).slice(0, 6) : [],
        latestMessage: item?.latestMessage ? {
          senderRole: item.latestMessage.senderRole || null,
          sendTime: item.latestMessage.sendTime || item.latestMessage.timestamp || null,
          messageType: item.latestMessage.messageType || null,
          isRead: item.latestMessage.isRead ?? null,
        } : null,
      })),
      hasMore: data?.hasMore === true,
      nextTimeStamp: data?.nextTimeStamp || null,
    };
  }

  if (name === 'product-low-score' || name === 'product-zero-effect') {
    return (Array.isArray(data) ? data : []).map(item => ({
      productId: item?.productId || item?.id || null,
      title: localizedTitle(item?.title) || String(item?.prodName || item?.subject || ''),
    }));
  }

  if (name === 'market-country') {
    return (Array.isArray(data) ? data : []).map(({ prodInfoList, ...item }) => item);
  }

  if (name === 'market-opportunities') {
    return (Array.isArray(data) ? data : []).map(item => ({
      sceneName: item?.sceneName || '',
      sceneNameCn: item?.sceneNameCn || '',
      countryId: item?.countryId || '',
      needsIndex: item?.needsIndex || 0,
      needsIndexQoq: item?.needsIndexQoq || 0,
      supplyIndex: item?.supplyIndex || 0,
      supplyNeedsRate: item?.supplyNeedsRate || 0,
      supplyNeedsRateQoq: item?.supplyNeedsRateQoq || 0,
      busProdRate: item?.busProdRate || 0,
      busProdRateQoq: item?.busProdRateQoq || 0,
      top3HotKw: item?.top3HotKw || '',
      statDate: item?.statDate || '',
    }));
  }

  if (name === 'ads-shop-profile') {
    const readWords = key => {
      const words = data?.[key]?.data?.wordList;
      return (Array.isArray(words) ? words : []).map(item => ({
        keyword: String(item?.keyword || ''),
        channel: String(item?.channel || ''),
        productId: Number(item?.productId || 0),
        productName: String(item?.productName || ''),
        signal: item?.dynamicRecInfo && typeof item.dynamicRecInfo === 'object'
          ? { ...item.dynamicRecInfo } : {},
      }));
    };
    const basic = data?.['客户店铺基本信息']?.data || {};
    return {
      category: String(basic['客户主营三级行业'] || basic['客户主营二级行业'] || ''),
      primaryProduct: String(basic['店铺主营产品'] || ''),
      showcaseProductCount: Number(data?.['客户店铺橱窗商品列表']?.data?.count || 0),
      highInquiryWords: readWords('店铺高询盘词列表'),
      highTrafficWords: readWords('店铺高引流词列表'),
      highP4pWords: readWords('店铺高p4p词列表'),
    };
  }

  if (name === 'rfq-internal-search' || name === 'rfq-internal-detail') {
    const items = Array.isArray(data?.items) ? data.items : (data?.rfqId ? [data] : []);
    return {
      items: items.map(shapeInternalRfq),
      total: Number(data?.totalCount ?? data?.meta?.pagination?.total ?? items.length),
      currentPage: Number(data?.currentPage || 1),
      totalPage: Number(data?.totalPage || 1),
    };
  }

  if (name === 'rfq-external-search') {
    const items = Array.isArray(data?.list) ? data.list : [];
    return {
      items: items.map(shapeExternalRfq),
      total: Number(data?.totalCount ?? data?.total ?? items.length),
      currentPage: Number(data?.pageNum || 1),
    };
  }

  if (name === 'rfq-external-detail') {
    return { items: data ? [shapeExternalRfq(data)] : [], total: data ? 1 : 0, currentPage: 1 };
  }

  if (name === 'rfq-quote-history') {
    const items = Array.isArray(data?.list) ? data.list : [];
    return {
      items: items.map(item => ({
        id: String(item?.quoteId || ''),
        rfqId: String(item?.rfqId || ''),
        title: plainRfqText(item?.rfqTitle),
        country: String(item?.buyerCountry || ''),
        buyerLevel: String(item?.buyerLevel || ''),
        quoteTime: String(item?.quoteCreateTime || ''),
        rfqTime: String(item?.rfqCreateTime || ''),
        status: plainRfqText(item?.documentaryStatus || '已报价'),
        tags: (Array.isArray(item?.quotationTags) ? item.quotationTags : [])
          .map(plainRfqText).filter(Boolean).slice(0, 6),
      })),
      total: Number(data?.totalNum ?? items.length),
      currentPage: Number(data?.currentPage || 1),
      totalPage: Number(data?.totalPage || 1),
    };
  }

  if (name === 'rfq-quote-rights') {
    return {
      availableQuote: Number(data?.availableQuoteEquity || 0),
      availableTopQuote: Number(data?.availableTopQuoteEquity || 0),
      availableGoldQuote: Number(data?.availableGoldQuoteEquity || 0),
      availableSilverQuote: Number(data?.availableSilverEnjoyEquity || 0),
      availableTravel: Number(data?.availableTravelEquity || 0),
      usedThisMonth: Number(data?.currentMonthUsedEquityCount || 0),
      sixHourQuotes: Number(data?.currentMonth6HourQuoteCount || 0),
      replyCount: Number(data?.currentMonthQuoteReplyCount || 0),
      predictedScore: Number(data?.currentMonthPredictScore || 0),
      lastMonthScore: Number(data?.lastMonthEvaluateScore || 0),
      rfqGmv: String(data?.currentMonthRfqGmv || '0'),
    };
  }

  return data;
}

function runWorkctl(args) {
  return new Promise((resolve) => {
    const started = Date.now();
    execFile(WORKCTL, args, {
      maxBuffer: 64 * 1024 * 1024,
      timeout: 120000,
      env: process.env,
    }, (err, stdout, stderr) => {
      const ms = Date.now() - started;
      const raw = String(stdout || '');
      const i = raw.indexOf('{');
      let parsed = null, parseErr = null;
      if (i >= 0) {
        try { parsed = JSON.parse(raw.slice(i)); }
        catch (e) { parseErr = e.message; }
      }
      resolve({
        ok: !err && parsed !== null,
        exitCode: err ? (err.code ?? -1) : 0,
        durationMs: ms,
        parsed,
        parseErr,
        stderr: String(stderr || '').slice(0, 2000),
        warnings: i > 0 ? raw.slice(0, i).trim() : '',
      });
    });
  });
}

/**
 * 解析 WorkCTL 某些 ICBU 工具在 data 中再次包裹的 JSON 字符串。
 *
 * @param {*} value - `runWorkctl()` 返回的 parsed.data 或其子字段。
 * @returns {*} JSON 字符串会被解析为对象；普通对象、数组和无法解析的文本原样返回。
 * @throws {Error} 不主动抛出异常，解析失败会保留原始值供上层给出可读错误。
 */
function parseEmbeddedWorkctlData(value) {
  let current = value;
  for (let depth = 0; depth < 3 && typeof current === 'string'; depth += 1) {
    try {
      current = JSON.parse(current);
    } catch (_) {
      break;
    }
  }
  return current;
}

/**
 * 从未知包装层级中找出最符合目标结构的数组。
 *
 * WorkCTL 的不同工具可能直接返回数组，也可能包装在 data/list/result 中。本函数
 * 只寻找包含目标字段的数组，避免把 options、分页信息或其他辅助数组误当主数据。
 *
 * @param {*} value - 待搜索的 WorkCTL data。
 * @param {(item:*) => boolean} predicate - 用于识别目标数组元素的函数。
 * @param {number} [depth=0] - 当前递归深度，限制异常响应造成的遍历规模。
 * @returns {Array<*>} 得分最高的目标数组；找不到时返回空数组。
 * @throws {Error} predicate 自身抛出的异常会向上传递；本项目传入的判断函数均为安全判断。
 */
function findBestWorkctlArray(value, predicate, depth = 0) {
  const parsed = parseEmbeddedWorkctlData(value);
  if (depth > 6 || parsed === null || parsed === undefined) return [];
  if (Array.isArray(parsed)) {
    if (parsed.some(predicate)) return parsed;
    let best = [];
    parsed.forEach(child => {
      const candidate = findBestWorkctlArray(child, predicate, depth + 1);
      if (candidate.length > best.length) best = candidate;
    });
    return best;
  }
  if (typeof parsed !== 'object') return [];
  let best = [];
  Object.values(parsed).forEach(child => {
    const candidate = findBestWorkctlArray(child, predicate, depth + 1);
    if (candidate.length > best.length) best = candidate;
  });
  return best;
}

/**
 * 通过权限为 0600 的临时 JSON 文件调用需要数组或嵌套参数的 WorkCTL 查询。
 *
 * @param {string[]} command - 不含 `workctl` 的命令路径，例如 `['icbu','product','list-attribute-options']`。
 * @param {object} payload - 需要写入 `--json-file` 的参数对象。
 * @param {string} prefix - 临时目录前缀，仅用于本机排障辨识。
 * @returns {Promise<object>} `runWorkctl()` 的标准结果。
 * @throws {Error} 临时目录或文件无法创建时抛出文件系统错误。
 */
async function runWorkctlWithJsonFile(command, payload, prefix) {
  const temporaryDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
  const paramsFile = path.join(temporaryDirectory, 'params.json');
  try {
    await fs.promises.writeFile(paramsFile, JSON.stringify(payload), { mode: 0o600 });
    return await runWorkctl([
      ...command,
      '--json-file', paramsFile,
      '--format', 'json',
      '--compact-output', 'off',
    ]);
  } finally {
    await fs.promises.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

/**
 * 通过权限为 0600 的临时参数文件调用需要明确确认的 WorkCTL 工具。
 *
 * 图片正文可能达到数 MB，既不能出现在进程参数里，也不应进入操作日志。本函数
 * 只把参数写入临时目录，向 WorkCTL 传递文件路径，并在命令结束后立即清理。
 *
 * @param {string[]} command - 不含 workctl 的命令路径。
 * @param {object} payload - 传给动态 WorkCTL 工具的业务参数。
 * @param {string} prefix - 临时目录前缀。
 * @returns {Promise<object>} runWorkctl() 的标准执行结果。
 * @throws {Error} 临时文件创建、写入或删除异常按 Node 文件系统错误抛出。
 */
async function runConfirmedWorkctlWithJsonFile(command, payload, prefix) {
  const temporaryDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
  const paramsFile = path.join(temporaryDirectory, 'params.json');
  try {
    await fs.promises.writeFile(paramsFile, JSON.stringify(payload), { mode: 0o600 });
    return await runWorkctl([
      ...command,
      '--json-file', paramsFile,
      '--yes',
      '--format', 'json',
      '--compact-output', 'off',
    ]);
  } finally {
    await fs.promises.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

/**
 * 把当前账号的类目树展平成只包含叶子类目的可搜索列表。
 *
 * @param {*} tree - `list-user-category` 返回的树或包装对象。
 * @returns {{id:number,name:string,path:string}[]} 去重后的叶子类目列表。
 * @throws {Error} 不主动抛出异常；无法识别的节点会被忽略。
 */
function flattenPublishCategories(tree) {
  const parsed = parseEmbeddedWorkctlData(tree);
  const roots = Array.isArray(parsed)
    ? parsed
    : findBestWorkctlArray(parsed, item => Boolean(item && typeof item === 'object' &&
        (item.categoryId ?? item.cateId ?? item.id) &&
        (item.categoryName ?? item.cateName ?? item.name)));
  const flattened = [];

  /**
   * 递归访问一个类目节点，并仅在没有可识别子类目时加入结果。
   *
   * @param {*} node - 当前类目节点。
   * @param {string[]} ancestors - 当前节点之前的类目名称路径。
   * @returns {void} 结果直接写入外围 flattened 数组。
   * @throws {Error} 不主动抛出异常。
   */
  function visit(node, ancestors) {
    if (!node || typeof node !== 'object') return;
    const id = Number(node.categoryId ?? node.cateId ?? node.catId ?? node.id);
    const name = publishText(node.categoryName ?? node.cateName ?? node.catName ?? node.name, 160);
    const children = [node.children, node.childCategories, node.childCategoryItem,
      node.childList, node.subCategories, node.categoryList]
      .find(Array.isArray) || [];
    const nextPath = name ? [...ancestors, name] : ancestors;
    if (children.length) {
      children.forEach(child => visit(child, nextPath));
      return;
    }
    if (Number.isSafeInteger(id) && id > 0 && name) {
      flattened.push({ id, name, path: nextPath.join(' > ') });
    }
  }

  roots.forEach(root => visit(root, []));
  return [...new Map(flattened.map(category => [category.id, category])).values()];
}

/**
 * 从 WorkCTL 拉取当前账号类目树；若平台首次返回空结构则只自动重读一次。
 *
 * @returns {Promise<{id:number,name:string,path:string}[]>} 当前账号的叶子类目列表。
 * @throws {Error} WorkCTL 调用失败或响应中没有可识别类目时抛出可读错误。
 */
async function fetchPublishCategoriesFromWorkctl() {
  let lastError = '当前账号没有返回可识别的叶子类目';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const result = await runWorkctl([
      'icbu', 'product', 'list-user-category',
      '--locale', 'zh_CN',
      '--format', 'json',
      '--compact-output', 'off',
    ]);
    if (!result.ok || result.parsed?.success === false) {
      lastError = result.stderr || result.parseErr || '读取当前账号类目失败';
      continue;
    }
    const categories = flattenPublishCategories(result.parsed?.data);
    if (!categories.length) continue;
    publishCategoryCache.at = Date.now();
    publishCategoryCache.categories = categories;
    pushLog({
      ts: new Date().toISOString(),
      label: '发品叶子类目',
      cmd: 'workctl icbu product list-user-category --locale zh_CN',
      ms: result.durationMs,
      cached: false,
      ok: true,
    });
    return categories;
  }
  throw new Error(lastError);
}

/**
 * 读取当前登录账号可见的国际站叶子类目，并在进程内缓存和合并并发请求。
 *
 * @returns {Promise<{id:number,name:string,path:string}[]>} 当前账号的叶子类目列表。
 * @throws {Error} 底层 WorkCTL 两次都失败或返回空结构时抛出可读错误。
 */
async function loadPublishCategories() {
  if (publishCategoryCache.categories.length &&
      Date.now() - publishCategoryCache.at < PUBLISH_SCHEMA_CACHE_TTL) {
    return publishCategoryCache.categories;
  }
  if (publishCategoryLoadPromise) return publishCategoryLoadPromise;

  publishCategoryLoadPromise = fetchPublishCategoriesFromWorkctl();
  try {
    return await publishCategoryLoadPromise;
  } finally {
    publishCategoryLoadPromise = null;
  }
}

/**
 * 将属性选项响应归一化为 `attrNameId -> 官方选项[]` 映射。
 *
 * @param {*} data - `list-attribute-options` 的 data 字段。
 * @returns {Map<number, {id:number,label:string,custom:boolean}[]>} 官方属性值映射。
 * @throws {Error} 不主动抛出异常；不完整选项会被忽略。
 */
function normalizePublishAttributeOptions(data) {
  const groups = findBestWorkctlArray(data, item => Boolean(item && typeof item === 'object' &&
    Number(item.attrNameId ?? item.attributeId ?? item.attrId) > 0 &&
    Array.isArray(item.options ?? item.optionList ?? item.attrValues)));
  const result = new Map();
  groups.forEach(group => {
    const attrNameId = Number(group.attrNameId ?? group.attributeId ?? group.attrId);
    const rawOptions = group.options ?? group.optionList ?? group.attrValues ?? [];
    const options = rawOptions.map(option => ({
      id: Number(option?.attrValueId ?? option?.valueId ?? option?.id),
      label: publishText(option?.attrValue ?? option?.value ?? option?.name, 160),
      custom: option?.custom === true,
    })).filter(option => Number.isSafeInteger(option.id) && option.label);
    result.set(attrNameId, options);
  });
  return result;
}

/**
 * 读取某个叶子类目的 PRODUCT 属性和官方下拉选项。
 *
 * @param {number} categoryId - Alibaba 叶子类目整数 ID。
 * @returns {Promise<object>} 前端可直接渲染的动态类目 Schema。
 * @throws {Error} 类目无效、属性工具失败或未返回属性时抛出可读错误。
 */
async function loadPublishCategorySchema(categoryId) {
  if (!Number.isSafeInteger(categoryId) || categoryId <= 0) throw new Error('categoryId 必须是正整数');
  const cached = publishCategorySchemaCache.get(categoryId);
  if (cached && Date.now() - cached.at < PUBLISH_SCHEMA_CACHE_TTL) return cached.schema;

  const categoriesPromise = loadPublishCategories();
  const attributeResultPromise = runWorkctlWithJsonFile(
    ['icbu', 'product', 'list-attribute'],
    { categoryId, propertyType: 'PRODUCT' },
    'lsou-workctl-attribute-'
  );
  const [categories, attributeResult] = await Promise.all([categoriesPromise, attributeResultPromise]);
  const category = categories.find(item => item.id === categoryId);
  if (!category) throw new Error(`类目 ${categoryId} 不属于当前账号返回的叶子类目`);
  if (!attributeResult.ok || attributeResult.parsed?.success === false) {
    throw new Error(attributeResult.stderr || attributeResult.parseErr || '读取类目属性失败');
  }
  const rawAttributes = findBestWorkctlArray(attributeResult.parsed?.data, item =>
    Boolean(item && typeof item === 'object' && Number(item.attrNameId ?? item.attributeId ?? item.attrId) > 0));
  if (!rawAttributes.length) throw new Error(`类目 ${categoryId} 没有返回 PRODUCT 属性`);

  const enumAttributeIds = rawAttributes
    .filter(attribute => attribute?.enumProp === true)
    .map(attribute => Number(attribute.attrNameId ?? attribute.attributeId ?? attribute.attrId))
    .filter(id => Number.isSafeInteger(id) && id > 0);
  const optionMap = new Map();
  for (let index = 0; index < enumAttributeIds.length; index += 50) {
    const attrIdList = enumAttributeIds.slice(index, index + 50);
    const optionResult = await runWorkctlWithJsonFile(
      ['icbu', 'product', 'list-attribute-options'],
      { categoryId, attrIdList },
      'lsou-workctl-attribute-options-'
    );
    if (!optionResult.ok || optionResult.parsed?.success === false) {
      throw new Error(optionResult.stderr || optionResult.parseErr || '读取类目属性选项失败');
    }
    normalizePublishAttributeOptions(optionResult.parsed?.data).forEach((options, attrNameId) => {
      optionMap.set(attrNameId, options);
    });
  }

  const attributes = rawAttributes.map(attribute => {
    const attrNameId = Number(attribute.attrNameId ?? attribute.attributeId ?? attribute.attrId);
    const enumProp = attribute.enumProp === true;
    const inputProp = attribute.inputProp === true;
    const multiSelect = attribute.multiSelect === true;
    let control = 'text';
    if (attrNameId === 1) control = 'region';
    else if (enumProp && multiSelect) control = 'multi';
    else if (enumProp && inputProp) control = 'combo';
    else if (enumProp) control = 'select';
    return {
      attrNameId,
      attrName: publishText(attribute.attrName ?? attribute.attributeName ?? attribute.name, 160),
      required: attribute.required === true,
      multiSelect,
      enumProp,
      inputProp,
      control,
      options: optionMap.get(attrNameId) || [],
      optionSource: attrNameId === 1 ? 'alibaba-publish-page' : 'workctl-live',
    };
  }).filter(attribute => attribute.attrNameId > 0 && attribute.attrName);

  const schema = {
    categoryId,
    categoryName: category?.name || `类目 ${categoryId}`,
    categoryPath: category?.path || category?.name || `类目 ${categoryId}`,
    attributes,
    requiredCount: attributes.filter(attribute => attribute.required).length,
    optionCoverage: attributes.filter(attribute => attribute.enumProp && attribute.options.length).length,
    source: 'workctl-live',
    fetchedAt: new Date().toISOString(),
  };
  publishCategorySchemaCache.set(categoryId, { at: Date.now(), schema });
  pushLog({
    ts: new Date().toISOString(),
    label: '发品类目属性',
    cmd: `workctl icbu product list-attribute + list-attribute-options --category-id ${categoryId}`,
    ms: attributeResult.durationMs,
    cached: false,
    ok: true,
  });
  return schema;
}

/**
 * 给一个正整数业务选项累计出现次数，用于选择当前店铺最常用的默认值。
 *
 * @param {Map<number, number>} counter - `平台编码 -> 出现次数` 计数器。
 * @param {*} rawValue - WorkCTL 返回的候选编码。
 * @returns {void} 无返回值；无效编码会被忽略。
 * @throws {Error} 不主动抛出异常。
 */
function countPublishBusinessOption(counter, rawValue) {
  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value <= 0) return;
  counter.set(value, (counter.get(value) || 0) + 1);
}

/**
 * 把计数器转换成前端业务下拉选项，并将出现频率最高的值排在最前面。
 *
 * 响应中虽然必须携带内部 value 供后续提交，但 label 永远不拼接整数编码，
 * 因此最终用户只会看到“件 / 个”“套”或“店铺常用计价单位”等业务名称。
 *
 * @param {Map<number, number>} counter - `平台编码 -> 出现次数` 计数器。
 * @param {Map<number, string>} labels - 已核验的官方业务名称映射。
 * @param {string} genericLabel - 无已知名称时使用的业务兜底文案。
 * @returns {{value:number,label:string,usageCount:number}[]} 排序后的业务选项。
 * @throws {Error} 不主动抛出异常。
 */
function buildPublishBusinessOptionList(counter, labels, genericLabel) {
  const entries = [...counter.entries()].sort((left, right) => right[1] - left[1] || left[0] - right[0]);
  return entries.map(([value, usageCount], index) => ({
    value,
    label: labels.get(value) || (entries.length === 1 ? genericLabel : `${genericLabel} ${index + 1}`),
    usageCount,
  }));
}

/**
 * 从当前登录账号读取一页代表商品，作为发品页自动匹配类目的依据。
 *
 * `data-advisor-shop-product` 会直接返回每件商品的 categoryId。这里保留原始行仅供
 * 服务端继续统计计价单位，给浏览器的路由会再裁剪成标题、缩略图和类目四项。
 * 使用同一份缓存还能避免发品页同时加载类目上下文与计价单位时重复调用 WorkCTL。
 *
 * @returns {Promise<{rows:object[],durationMs:number,fetchedAt:string}>} 当前账号代表商品。
 * @throws {Error} WorkCTL 不可用或当前账号没有返回商品时抛出可读错误。
 */
async function loadPublishAccountCatalog() {
  if (publishAccountCatalogCache.value &&
      Date.now() - publishAccountCatalogCache.at < PUBLISH_SCHEMA_CACHE_TTL) {
    return publishAccountCatalogCache.value;
  }
  if (publishAccountCatalogLoadPromise) return publishAccountCatalogLoadPromise;

  publishAccountCatalogLoadPromise = (async () => {
    const productResult = await callEndpoint('shop-product', {
      pageNo: '1',
      pageSize: '20',
      orderBy: 'views',
      orderModel: 'DESC',
    });
    if (!productResult.ok) throw new Error(productResult.error || '读取当前店铺商品类目失败');
    const total = Number(productResult.data?.recordCount || 0);
    const pageCount = Math.max(1, Math.ceil(total / 20));
    const remainingResults = [];
    const pageNumbers = Array.from({ length: pageCount - 1 }, (_, index) => index + 2);
    for (let index = 0; index < pageNumbers.length; index += 4) {
      // 店铺可能有数百件商品；四页一批既能覆盖全部在售类目，也不会一次启动过多
      // WorkCTL 进程。这样已有商品缩略图可以精确映射，而不是只看首页后猜类目。
      const batch = pageNumbers.slice(index, index + 4);
      const results = await Promise.all(batch.map(pageNo => callEndpoint('shop-product', {
        pageNo: String(pageNo),
        pageSize: '20',
        orderBy: 'views',
        orderModel: 'DESC',
      })));
      remainingResults.push(...results);
    }
    const rows = [productResult, ...remainingResults]
      .filter(result => result.ok)
      .flatMap(result => Array.isArray(result.data?.data) ? result.data.data : [])
      .filter(row => Number.isSafeInteger(Number(row?.categoryId)) && Number(row.categoryId) > 0);
    if (!rows.length) throw new Error('当前店铺没有返回可用于匹配类目的商品');
    return {
      rows,
      durationMs: Number(productResult.durationMs || 0) + remainingResults
        .reduce((sum, result) => sum + Number(result.durationMs || 0), 0),
      fetchedAt: new Date().toISOString(),
    };
  })();

  try {
    const value = await publishAccountCatalogLoadPromise;
    publishAccountCatalogCache.at = Date.now();
    publishAccountCatalogCache.value = value;
    return value;
  } finally {
    publishAccountCatalogLoadPromise = null;
  }
}

/**
 * 生成浏览器可消费的当前账号类目上下文。
 *
 * 内部 categoryId 必须传给后续 Schema 查询，但页面只展示类目名称与路径。商品 ID、
 * 负责人和经营指标全部丢弃；缩略图只用于将当前原型素材匹配回它所属的真实类目。
 * 默认类目按代表商品出现次数选择，供用户上传全新图片但尚未完成识别时使用。
 *
 * @param {number} limit - 最多返回多少条代表商品，范围 1 到 500。
 * @returns {Promise<object>} 脱敏商品、类目分布和账号默认类目。
 * @throws {Error} 当前账号商品或叶子类目无法读取时抛出。
 */
async function buildPublicPublishAccountContext(limit = 20) {
  const [{ rows, fetchedAt }, categories] = await Promise.all([
    loadPublishAccountCatalog(),
    loadPublishCategories(),
  ]);
  const categoryById = new Map(categories.map(category => [Number(category.id), category]));
  const counts = new Map();
  rows.forEach(row => {
    const categoryId = Number(row.categoryId);
    counts.set(categoryId, (counts.get(categoryId) || 0) + 1);
  });
  const categorySummary = [...counts.entries()].map(([categoryId, productCount]) => {
    const category = categoryById.get(categoryId);
    const sample = rows.find(row => Number(row.categoryId) === categoryId);
    const name = category?.name || publishText(sample?.cateName, 160) || '当前店铺类目';
    return {
      categoryId,
      name,
      path: category?.path || name,
      productCount,
    };
  }).sort((left, right) => right.productCount - left.productCount || left.name.localeCompare(right.name));
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 500));
  // 需要时允许前端读取全部脱敏缩略图来做精确匹配；上限 500 可覆盖常见店铺，
  // 同时避免异常账号把过大的商品列表推入浏览器。
  const products = rows.slice(0, safeLimit).map(row => {
    const categoryId = Number(row.categoryId);
    const category = categoryById.get(categoryId);
    const categoryName = category?.name || publishText(row?.cateName, 160) || '当前店铺类目';
    return {
      title: publishText(row?.subject || row?.prodName, 128) || '当前店铺商品',
      image: publishText(row?.prodImage, 1000),
      categoryId,
      categoryName,
      categoryPath: category?.path || categoryName,
    };
  });
  return {
    products,
    categories: categorySummary,
    defaultCategory: categorySummary[0] || null,
    source: 'current-account-products',
    fetchedAt,
  };
}

/**
 * 从当前账号已有商品中读取发布所需的内部业务编码。
 *
 * WorkCTL 暂无独立的通用“计价单位列表”命令，GGS 物流模板工具又只对部分卖家
 * 开放；`data-advisor-shop-product` 和 `product_query_information` 则对普通卖家可用。
 * 本函数先用前者取得店铺实际使用过的单位，再对少量代表商品读取当前运费方案。
 * 这样插件交付给其他商家时会自动适配对方账号，不会携带开发者店铺的固定 ID。
 *
 * @returns {Promise<object>} 前端可直接渲染的计价单位、物流方案和默认选择。
 * @throws {Error} 当前账号商品查询完全不可用时抛出可读错误。
 */
async function fetchPublishBusinessOptionsFromWorkctl() {
  const accountCatalog = await loadPublishAccountCatalog();
  const rows = accountCatalog.rows;
  const priceUnitCounts = new Map();
  const shippingTemplateCounts = new Map();
  rows.forEach(row => countPublishBusinessOption(priceUnitCounts, row?.priceUnit));

  // 计价单位 4 是 Alibaba.com 已核验的全局“件 / 个”编码。即使新店铺暂时没有
  // 可参考商品，用户仍可正常选择最常见的按件计价，而不需要接触内部编号。
  if (!priceUnitCounts.size) priceUnitCounts.set(4, 1);

  const sampleIds = [...new Set(rows.map(row => Number(row?.id ?? row?.productId))
    .filter(id => Number.isSafeInteger(id) && id > 0))].slice(0, 6);
  let detailDurationMs = 0;
  for (let index = 0; index < sampleIds.length; index += 3) {
    // 每批最多三条，避免为了初始化下拉选项瞬间占满同一个 Accio 网关。
    const batch = sampleIds.slice(index, index + 3);
    const results = await Promise.all(batch.map(productId => runWorkctlWithJsonFile(
      ['icbu', 'product', 'list-information'],
      {
        productId,
        queryType: 'trunk',
        componentList: ['priceUnit', 'shippingTemplate', 'logisticsProperty'],
      },
      'lsou-workctl-publish-options-'
    )));
    results.forEach(result => {
      detailDurationMs += Number(result.durationMs || 0);
      if (!result.ok || result.parsed?.success === false) return;
      const data = parseEmbeddedWorkctlData(result.parsed?.data);
      countPublishBusinessOption(priceUnitCounts,
        findPublishResponseField(data, new Set(['priceUnit'])));
      countPublishBusinessOption(shippingTemplateCounts,
        findPublishResponseField(data, new Set(['shippingTemplateId'])));
    });
  }

  const priceUnits = buildPublishBusinessOptionList(
    priceUnitCounts,
    VERIFIED_PRICE_UNIT_LABELS,
    '店铺常用计价单位'
  );
  const shippingTemplates = buildPublishBusinessOptionList(
    shippingTemplateCounts,
    new Map(),
    '店铺常用运费方案'
  );
  const value = {
    priceUnits,
    shippingTemplates,
    defaultPriceUnit: priceUnits[0]?.value || 4,
    defaultShippingTemplate: shippingTemplates[0]?.value || null,
    shippingFallbackLabel: '使用国际站默认运费设置',
    source: 'current-account-products',
    fetchedAt: new Date().toISOString(),
  };

  pushLog({
    ts: value.fetchedAt,
    label: '发品业务选项',
    cmd: 'workctl icbu advisor data-advisor-shop-product + product list-information',
    ms: Number(accountCatalog.durationMs || 0) + detailDurationMs,
    cached: false,
    ok: true,
  });
  return value;
}

/**
 * 读取并缓存当前账号的计价单位与物流方案，合并同一时刻的并发请求。
 *
 * @returns {Promise<object>} 当前账号可用的发品业务选项。
 * @throws {Error} 底层 WorkCTL 查询失败时透传业务错误。
 */
async function loadPublishBusinessOptions() {
  if (publishBusinessOptionsCache.value &&
      Date.now() - publishBusinessOptionsCache.at < PUBLISH_SCHEMA_CACHE_TTL) {
    return publishBusinessOptionsCache.value;
  }
  if (publishBusinessOptionsLoadPromise) return publishBusinessOptionsLoadPromise;
  publishBusinessOptionsLoadPromise = fetchPublishBusinessOptionsFromWorkctl();
  try {
    const value = await publishBusinessOptionsLoadPromise;
    publishBusinessOptionsCache.at = Date.now();
    publishBusinessOptionsCache.value = value;
    return value;
  } finally {
    publishBusinessOptionsLoadPromise = null;
  }
}

/**
 * 使用服务端刚读取的账号选项补齐一条浏览器商品快照。
 *
 * 浏览器传来的整数只作为“用户选了哪个下拉项”的提示，最终值必须重新落在
 * 当前账号允许集合中。未显式选择时自动使用该店铺最常用的单位和物流方案；
 * 店铺没有可读取物流模板时保持为空，让国际站使用账号默认运费设置。
 *
 * @param {*} product - 浏览器提交的商品快照。
 * @param {object} options - `loadPublishBusinessOptions()` 返回的账号选项。
 * @returns {object} 已自动匹配内部编码的新商品对象，不修改原对象。
 * @throws {Error} 用户选择的计价单位或物流方案已不属于当前账号时抛出。
 */
function applyPublishBusinessOptions(product, options) {
  const priceUnits = Array.isArray(options?.priceUnits) ? options.priceUnits : [];
  const shippingTemplates = Array.isArray(options?.shippingTemplates) ? options.shippingTemplates : [];
  const requestedPriceUnit = Number(product?.trade?.priceUnitId);
  const requestedShippingTemplate = Number(product?.fulfillment?.shippingTemplateId);
  const priceUnit = priceUnits.find(item => Number(item.value) === requestedPriceUnit) ||
    priceUnits.find(item => Number(item.value) === Number(options?.defaultPriceUnit));
  const shippingTemplate = shippingTemplates.find(item => Number(item.value) === requestedShippingTemplate) ||
    shippingTemplates.find(item => Number(item.value) === Number(options?.defaultShippingTemplate));

  if (!priceUnit) throw new Error('当前店铺暂未同步到可用计价单位，请刷新数据后重试');
  if (Number.isSafeInteger(requestedPriceUnit) && requestedPriceUnit > 0 &&
      !priceUnits.some(item => Number(item.value) === requestedPriceUnit)) {
    throw new Error('所选计价单位已不属于当前店铺，请重新选择');
  }
  if (Number.isSafeInteger(requestedShippingTemplate) && requestedShippingTemplate > 0 &&
      !shippingTemplates.some(item => Number(item.value) === requestedShippingTemplate)) {
    throw new Error('所选运费方案已不属于当前店铺，请重新选择');
  }

  return {
    ...product,
    trade: {
      ...(product?.trade || {}),
      priceUnitId: Number(priceUnit.value),
      priceUnitLabel: priceUnit.label,
    },
    fulfillment: {
      ...(product?.fulfillment || {}),
      shippingTemplateId: shippingTemplate ? Number(shippingTemplate.value) : null,
      shippingTemplateLabel: shippingTemplate?.label || options?.shippingFallbackLabel || '使用国际站默认运费设置',
    },
  };
}

/**
 * 把任意输入收敛为有长度上限的单行文本。
 *
 * 产品标题、属性名和错误信息最终都会进入页面或命令素材。统一清理控制字符，
 * 可以避免日志换行污染，也能在服务端再次落实长度边界，而不是相信浏览器校验。
 *
 * @param {*} value - 浏览器提交的任意值。
 * @param {number} maxLength - 允许保留的最大字符数。
 * @returns {string} 去除控制字符和首尾空白后的文本。
 * @throws {Error} 不主动抛出异常；空值和非字符串值会安全转换。
 */
function publishText(value, maxLength) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

/**
 * 判断图片是否为 WorkCTL/国际站服务端可读取的远程 HTTP(S) 地址。
 *
 * 浏览器的 blob: Object URL 只在当前标签页有效，传给 WorkCTL 一定无法读取，
 * 所以必须在进入真实队列前阻止，而不能让队列显示虚假的成功状态。
 *
 * @param {*} value - 待检查的图片地址。
 * @returns {boolean} 仅 http 或 https URL 返回 true。
 * @throws {Error} URL 构造失败会被本函数捕获并返回 false。
 */
function isRemotePublishImage(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

/**
 * 将页面中的单个商品收敛为 publish-from-json 可消费的平台商品 material。
 *
 * WorkCTL 动态 Schema 只把 material 声明为字符串，但 Alibaba Seller Assistant
 * 随附的 Product.xlsx 格式规范给出了内部合同：顶层 categoryId，下接 basicInfo、
 * trade、fulfillment、detail 四块。这里严格按该合同组装，不再发送本项目自造的
 * materialVersion/title/imageUrls 等扁平字段；未知的平台 ID 继续省略，绝不伪造。
 *
 * @param {*} input - 浏览器提交的一条商品快照。
 * @param {'draft'|'publish'} action - 保存远端草稿或提交正式发布。
 * @returns {{material:object, localId:string, title:string, image:string}} 清洗后的素材和页面关联字段。
 * @throws {Error} 字段缺失、类型错误或正式发布校验不通过时抛出可读错误。
 */
function normalizePublishProduct(input, action) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('商品数据必须是对象');
  }

  const localId = publishText(input.localId, 100);
  const title = publishText(input.title, 128);
  const categoryId = Number(input.categoryId);
  const categoryName = publishText(input.categoryName, 240);
  const images = [...new Set((Array.isArray(input.images) ? input.images : [])
    .filter(isRemotePublishImage).map(value => String(value)).slice(0, 10))];
  const keywords = [...new Set((Array.isArray(input.keywords) ? input.keywords : [])
    .map(value => publishText(value, 40)).filter(Boolean).slice(0, 5))];
  const sellingPoints = (Array.isArray(input.sellingPoints) ? input.sellingPoints : [])
    .map(value => publishText(value, 200)).slice(0, 5);
  const issues = [];

  if (!localId) issues.push('缺少本地商品标识');
  if (!title) issues.push('标题不能为空');
  if (!Number.isSafeInteger(categoryId) || categoryId <= 0) issues.push('叶子类目 ID 无效');
  if (!images.length) issues.push('至少需要 1 张已经上传的远程图片；浏览器本地图片不能直接发布');

  const rawAttributes = Array.isArray(input.attributes) ? input.attributes : [];
  const attributes = rawAttributes.slice(0, 80).map(item => {
    const attrNameId = Number(item?.attrNameId);
    const submittedAttrValueId = Number(item?.attrValueId);
    const attrName = publishText(item?.attrName, 120);
    const rawValue = Array.isArray(item?.attrValue) ? item.attrValue : [item?.attrValue];
    const attrValue = rawValue.map(value => publishText(value, 160)).filter(Boolean).slice(0, 20);
    return {
      attrNameId: Number.isSafeInteger(attrNameId) && attrNameId > 0 ? attrNameId : null,
      attrName,
      // 单选枚举必须保留 WorkCTL 返回的正整数 ID；多值和允许自定义的文本按
      // 平台完整素材约定使用 -1。绝不在服务端臆造某个官方枚举编码。
      attrValueId: Number.isSafeInteger(submittedAttrValueId) ? submittedAttrValueId : -1,
      attrValue: attrValue.join(';'),
      imageUrl: null,
    };
  }).filter(item => item.attrNameId && item.attrName && item.attrValue);

  const rawTrade = input.trade && typeof input.trade === 'object' ? input.trade : {};
  const saleType = ['normal', 'batch'].includes(rawTrade.saleType) ? rawTrade.saleType : '';
  const moq = Number(rawTrade.moq);
  const inventory = Number(rawTrade.inventory);
  const batchNum = Number(rawTrade.batchNum);
  const priceUnitId = Number(rawTrade.priceUnitId);
  const priceUnitLabel = publishText(rawTrade.priceUnitLabel, 80);
  const ladderPrices = (Array.isArray(rawTrade.ladderPrices) ? rawTrade.ladderPrices : [])
    .slice(0, 20).map((tier, index, all) => {
      const minQuantity = Math.trunc(Number(tier?.minQuantity));
      const nextMinimum = Math.trunc(Number(all[index + 1]?.minQuantity));
      const unitPrice = Number(tier?.unitPrice);
      return {
        ladderIndex: index,
        minQuantity,
        maxQuantity: Number.isInteger(nextMinimum) && nextMinimum > minQuantity ? nextMinimum - 1 : null,
        unitPrice: Number.isFinite(unitPrice) && unitPrice > 0 ? unitPrice : null,
      };
    });

  const rawFulfillment = input.fulfillment && typeof input.fulfillment === 'object' ? input.fulfillment : {};
  const packageInfo = rawFulfillment.package && typeof rawFulfillment.package === 'object'
    ? rawFulfillment.package : {};
  const shippingTemplateId = Number(rawFulfillment.shippingTemplateId);
  const shippingTemplateLabel = publishText(rawFulfillment.shippingTemplateLabel, 120);
  const ladderPeriod = (Array.isArray(rawFulfillment.ladderPeriod) ? rawFulfillment.ladderPeriod : [])
    .slice(0, 20).map((tier, index) => ({
      ladderIndex: index,
      quantity: Math.trunc(Number(tier?.quantity)),
      period: Math.trunc(Number(tier?.period)),
    }));
  const logisticsProperty = (Array.isArray(rawFulfillment.logisticsProperty)
    ? rawFulfillment.logisticsProperty : []).map(value => publishText(value, 80)).filter(Boolean).slice(0, 20);

  // 保存草稿允许业务字段尚未补齐；正式发布必须在服务端重新执行完整校验。
  if (action === 'publish') {
    if (images.length < 5) issues.push('正式发布至少需要 5 张远程商品图片');
    if (!attributes.length) issues.push('商品属性不能为空');
    if (sellingPoints.length !== 5 || sellingPoints.some(point => !point)) issues.push('需要完整填写 5 条卖点');
    if (!saleType) issues.push('销售方式无效');
    if (!Number.isInteger(moq) || moq < 1) issues.push('MOQ 必须是大于等于 1 的整数');
    if (!Number.isInteger(inventory) || inventory < 0) issues.push('库存必须是大于等于 0 的整数');
    if (saleType === 'batch' && (!Number.isInteger(batchNum) || batchNum < 1)) issues.push('按批售卖时每批数量必须是正整数');
    if (!(Number.isSafeInteger(priceUnitId) && priceUnitId > 0)) issues.push('计价单位尚未与当前店铺选项匹配');
    if (!ladderPrices.length || ladderPrices.some(tier => !Number.isInteger(tier.minQuantity) || tier.minQuantity < 1 || !tier.unitPrice)) issues.push('阶梯价格格式不完整');
    if (!ladderPeriod.length || ladderPeriod.some(tier => !Number.isInteger(tier.quantity) || tier.quantity < 1 || !Number.isInteger(tier.period) || tier.period < 1)) issues.push('阶梯发货期格式不完整');
    const dimensions = ['length', 'width', 'height'].map(key => Number(packageInfo[key]));
    if (!dimensions.every(value => Number.isFinite(value) && value > 0)) issues.push('包装长、宽、高必须成组填写为正数');
    if (!(Number(packageInfo.weight) > 0)) issues.push('包装毛重必须大于 0');
    // 运费模板在底层发布素材中是可选字段。当前店铺存在可用
    // 方案时会由服务端自动回填；没有可读取方案时省略，让平台使用账号默认设置。
  }

  if (issues.length) throw new Error(issues.join('；'));

  const basicInfo = {
    productTitle: title,
    ...(categoryName ? { categoryName } : {}),
    ...(keywords.length ? { productKeywords: keywords.join(',') } : {}),
    attr: attributes,
    images: images.map((newImageUrl, imageIndex) => ({ imageIndex, newImageUrl })),
  };
  const trade = {
    ...(saleType ? { saleType } : {}),
    ...(saleType === 'batch' && Number.isInteger(batchNum) ? { batchNum } : {}),
    ...(Number.isInteger(moq) ? { moq } : {}),
    ...(Number.isInteger(inventory) ? { inventory } : {}),
    ...(Number.isSafeInteger(priceUnitId) && priceUnitId > 0 ? { priceUnit: priceUnitId } : {}),
    ...(ladderPrices.length ? { ladderPrices } : {}),
  };
  const fulfillment = {
    ...(ladderPeriod.length ? { ladderPeriod } : {}),
    ...(logisticsProperty.length ? { logisticsProperty } : {}),
    ...(Number(packageInfo.length) > 0 ? { pkgLength: Number(packageInfo.length) } : {}),
    ...(Number(packageInfo.width) > 0 ? { pkgWidth: Number(packageInfo.width) } : {}),
    ...(Number(packageInfo.height) > 0 ? { pkgHeight: Number(packageInfo.height) } : {}),
    ...(Number(packageInfo.weight) > 0 ? { pkgWeight: Number(packageInfo.weight) } : {}),
    ...(Number.isSafeInteger(shippingTemplateId) && shippingTemplateId > 0 ? { shippingTemplateId } : {}),
  };
  const material = {
    categoryId,
    basicInfo,
    trade,
    fulfillment,
    detail: {
      productSellingPoint: sellingPoints.filter(Boolean).join('\n'),
    },
  };
  const encoded = JSON.stringify(material);
  if (Buffer.byteLength(encoded, 'utf8') > 50 * 1024) {
    throw new Error('商品素材超过 WorkCTL 允许的 50KB 上限');
  }

  return { material, localId, title, image: images[0] };
}

/**
 * 在嵌套的 WorkCTL 响应中查找第一个指定字段，供队列提取任务号和商品号。
 *
 * @param {*} value - WorkCTL 解析后的 JSON。
 * @param {Set<string>} keys - 可接受的字段名集合。
 * @param {number} [depth=0] - 当前递归深度，防止异常结构无限遍历。
 * @returns {*} 找到的非空字段值；找不到时返回 null。
 * @throws {Error} 不主动抛出异常。
 */
function findPublishResponseField(value, keys, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 7) return null;
  for (const [key, child] of Object.entries(value)) {
    if (keys.has(key) && child !== null && child !== undefined && child !== '') return child;
  }
  for (const child of Object.values(value)) {
    const found = findPublishResponseField(child, keys, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

/**
 * 校验浏览器上传的图片正文，防止伪造 MIME、超大请求和路径型文件名进入 OSS。
 *
 * @param {*} body - POST /api/publish/images 的 JSON 请求体。
 * @returns {{filename:string,contentType:string,base64:string,size:number}} 可直接交给 WorkCTL 的安全图片参数。
 * @throws {Error} 文件名、类型、Base64 或图片签名不符合约束时抛出可读错误。
 */
function normalizePublishImageUpload(body) {
  const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const filename = publishText(path.basename(String(body?.filename || '')), 160);
  const contentType = publishText(body?.contentType, 80).toLowerCase();
  const base64 = String(body?.base64 || '').replace(/\s+/g, '');
  if (!filename) throw new Error('请选择需要上传的图片');
  if (!allowedTypes.has(contentType)) throw new Error('图片格式仅支持 JPG、PNG 或 WEBP');
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error('图片内容不是有效的 Base64 数据');

  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length) throw new Error('图片内容为空');
  if (bytes.length > MAX_PUBLISH_IMAGE_BYTES) throw new Error('单张图片不能超过 8MB');
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isWebp = bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  const signatureMatches = (contentType === 'image/jpeg' && isJpeg) ||
    (contentType === 'image/png' && isPng) || (contentType === 'image/webp' && isWebp);
  if (!signatureMatches) throw new Error('图片实际格式与文件类型不一致，请重新选择原始图片');
  return { filename, contentType, base64, size: bytes.length };
}

/**
 * 把一张已经通过本地校验的图片上传到管理员配置的 OSS bucket。
 *
 * bucket、endpoint 和 path prefix 都只存在于服务端环境，普通运营用户不会看见、
 * 选择或提交这些基础设施参数。接口响应也只返回发品所需的远程 URL。
 *
 * @param {*} body - 浏览器图片上传请求体。
 * @returns {Promise<{url:string,filename:string,contentType:string,size:number}>} 已上传图片的公开结果。
 * @throws {Error} 存储未配置、WorkCTL 调用失败或未返回远程 URL 时抛出。
 */
async function uploadPublishImage(body) {
  if (!PUBLISH_IMAGE_BUCKET) {
    throw new Error('图片存储尚未由管理员配置，请设置 PUBLISH_IMAGE_BUCKET 后重新启动');
  }
  const image = normalizePublishImageUpload(body);
  const result = await runConfirmedWorkctlWithJsonFile(
    ['icbu', 'other', 'upload-file'],
    {
      bucket_name: PUBLISH_IMAGE_BUCKET,
      file_content: image.base64,
      filename: image.filename,
      content_type: image.contentType,
      is_base64: true,
      ...(PUBLISH_IMAGE_ENDPOINT ? { endpoint: PUBLISH_IMAGE_ENDPOINT } : {}),
      ...(PUBLISH_IMAGE_PATH_PREFIX ? { path_prefix: PUBLISH_IMAGE_PATH_PREFIX } : {}),
    },
    'lsou-workctl-image-upload-'
  );
  const outcome = publishWorkctlOutcome(result);
  if (!outcome.ok) throw new Error(outcome.message || '图片上传失败');
  const data = parseEmbeddedWorkctlData(result.parsed?.data);
  const remoteUrl = findPublishResponseField(data, new Set(['url', 'cdnUrl', 'accessUrl', 'fileUrl']));
  if (!isRemotePublishImage(remoteUrl)) throw new Error('图片已经上传，但平台没有返回可用于发品的远程地址');
  pushLog({
    ts: new Date().toISOString(),
    label: '上传发品图片',
    cmd: 'workctl icbu other upload-file --json-file [redacted] --yes',
    ms: result.durationMs,
    cached: false,
    ok: true,
  });
  return { url: String(remoteUrl), filename: image.filename, contentType: image.contentType, size: image.size };
}

/**
 * 从运营人员粘贴的 Alibaba 商品链接中提取纯数字商品号。
 *
 * 页面只要求粘贴链接，不展示 productId。服务端仍兼容纯数字输入，便于测试和
 * 排障，但无论哪种输入都只把经过严格校验的数字传给 WorkCTL。
 *
 * @param {*} value - 商品链接或纯数字商品号。
 * @returns {string} 长度 6-30 的纯数字商品号。
 * @throws {Error} 没有找到安全商品号时抛出。
 */
function extractReferenceProductId(value) {
  const input = publishText(value, 2000);
  const direct = /^\d{6,30}$/.test(input) ? input : '';
  if (direct) return direct;
  let candidate = '';
  try {
    const referenceUrl = new URL(input);
    const queryCandidate = referenceUrl.searchParams.get('productId') || referenceUrl.searchParams.get('itemId') || '';
    if (/^\d{6,30}$/.test(queryCandidate)) candidate = queryCandidate;
    if (!candidate) {
      const pathCandidates = referenceUrl.pathname.match(/\d{6,30}/g) || [];
      candidate = pathCandidates.at(-1) || '';
    }
  } catch (_) {
    const textCandidates = input.match(/\d{6,30}/g) || [];
    candidate = textCandidates.at(-1) || '';
  }
  if (!/^\d{6,30}$/.test(candidate)) throw new Error('没有从链接中识别到有效的 Alibaba 商品');
  return candidate;
}

/**
 * 将参考商品模板中的文本压平为适合网页回填的短文本数组。
 *
 * @param {*} value - query-template-info-by-id 落盘模板中的 texts 字段。
 * @param {string[]} [output=[]] - 递归过程中累积的结果。
 * @param {number} [depth=0] - 最大递归深度保护。
 * @returns {string[]} 去重且有长度边界的参考文本。
 * @throws {Error} 不主动抛出异常，未知结构会被忽略。
 */
function flattenReferenceTexts(value, output = [], depth = 0) {
  if (depth > 5 || output.length >= 30 || value === null || value === undefined) return output;
  if (typeof value === 'string') {
    const text = publishText(value, 600);
    if (text && !output.includes(text)) output.push(text);
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach(item => flattenReferenceTexts(item, output, depth + 1));
    return output;
  }
  if (typeof value === 'object') {
    Object.values(value).forEach(item => flattenReferenceTexts(item, output, depth + 1));
  }
  return output;
}

/**
 * 查询参考商品并把 WorkCTL 生成的临时模板收敛为网页可消费的内容。
 *
 * @param {*} reference - Alibaba 商品链接或纯数字商品号。
 * @returns {Promise<{categoryId:number,title:string,texts:string[]}>} 精简参考商品模板。
 * @throws {Error} 网关不可用、参考商品不存在或模板缺少类目时抛出。
 */
async function queryPublishReference(reference) {
  const productId = extractReferenceProductId(reference);
  const temporaryDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lsou-workctl-reference-'));
  try {
    const result = await runWorkctl([
      'publishflow', 'query-template-info-by-id',
      '--productId', productId,
      '--work_dir', temporaryDirectory,
      '--format', 'json',
      '--compact-output', 'off',
    ]);
    const outcome = publishWorkctlOutcome(result);
    if (!outcome.ok) throw new Error(outcome.message || '参考商品读取失败');
    const templatePath = path.join(temporaryDirectory, 'template', `ref_${productId}.json`);
    let template = null;
    try {
      template = JSON.parse(await fs.promises.readFile(templatePath, 'utf8'));
    } catch (_) {
      template = parseEmbeddedWorkctlData(result.parsed?.data);
    }
    const categoryId = Number(findPublishResponseField(template, new Set(['categoryId', 'cateId', 'catId'])));
    const titleValue = findPublishResponseField(template, new Set(['title', 'productTitle', 'subject']));
    const title = publishText(typeof titleValue === 'string' ? titleValue : localizedTitle(titleValue), 128);
    const texts = flattenReferenceTexts(template?.texts ?? template?.text ?? template?.contents ?? []);
    if (!Number.isSafeInteger(categoryId) || categoryId <= 0) throw new Error('参考商品没有返回可匹配的叶子类目');
    pushLog({
      ts: new Date().toISOString(),
      label: '读取参考商品',
      cmd: 'workctl publishflow query-template-info-by-id --productId [redacted] --work_dir [temporary]',
      ms: result.durationMs,
      cached: false,
      ok: true,
    });
    return { categoryId, title, texts };
  } finally {
    await fs.promises.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

/**
 * 递归检查 WorkCTL 业务载荷中的失败布尔值和负状态码。
 *
 * 与“取第一个字段”不同，这里必须遍历全部分支：响应中某个摘要字段为 true，
 * 不能掩盖更深层模块返回的 businessSuccess=false。
 *
 * @param {*} value - WorkCTL data 载荷或子结构。
 * @param {number} [depth=0] - 当前递归深度。
 * @returns {boolean} 任一标准失败信号存在时返回 true。
 * @throws {Error} 不主动抛出异常。
 */
function hasPublishFailureSignal(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 7) return false;
  for (const [key, child] of Object.entries(value)) {
    if (['isSuccess', 'businessSuccess', 'ok', 'processResult'].includes(key) && child === false) return true;
    if (key === 'status' && Number.isFinite(Number(child)) && Number(child) < 0) return true;
    if (hasPublishFailureSignal(child, depth + 1)) return true;
  }
  return false;
}

/**
 * 按 WorkCTL Agent 合同判断“进程成功但业务失败”的情况。
 *
 * @param {object} result - runWorkctl() 返回的进程和 JSON 结果。
 * @returns {{ok:boolean,message:string,retryable:boolean}} 归一化业务结果。
 * @throws {Error} 不主动抛出异常；缺失结构按失败处理。
 */
function publishWorkctlOutcome(result) {
  const parsed = result?.parsed;
  const data = parsed?.data;
  const errorDto = findPublishResponseField(data, new Set(['errorDTO']));
  const errorDtoHasContent = errorDto && typeof errorDto === 'object' &&
    Boolean(errorDto.errorCode || errorDto.errorMsg || errorDto.message);
  const explicitError = parsed?.error || (errorDtoHasContent ? errorDto : null);
  const ok = Boolean(result?.ok && parsed?.success !== false && !explicitError && !hasPublishFailureSignal(data));
  const message = publishText(
    explicitError?.message || explicitError?.errorMsg || explicitError?.errorCode ||
    result?.stderr || result?.parseErr || (ok ? 'WorkCTL 已接受请求' : 'WorkCTL 返回业务失败'),
    600
  );
  return { ok, message, retryable: explicitError?.retryable === true };
}

/**
 * 把平台返回的质量扣分原因整理为适合页面展示的短文本列表。
 *
 * @param {*} value - deductReasons 或兼容字段，可能是字符串、数组或对象。
 * @returns {string[]} 最多 8 条、每条不超过 240 字的扣分原因。
 * @throws {Error} 不主动抛出异常，无法识别的结构会被忽略。
 */
function normalizeQualityReasons(value) {
  const reasons = [];
  const visit = (item, depth = 0) => {
    if (depth > 4 || reasons.length >= 8 || item === null || item === undefined) return;
    if (typeof item === 'string' || typeof item === 'number') {
      const text = publishText(item, 240);
      if (text && !reasons.includes(text)) reasons.push(text);
      return;
    }
    if (Array.isArray(item)) {
      item.forEach(child => visit(child, depth + 1));
      return;
    }
    if (typeof item === 'object') {
      const preferred = item.reason || item.message || item.description || item.label || item.name;
      if (preferred) visit(preferred, depth + 1);
      else Object.values(item).forEach(child => visit(child, depth + 1));
    }
  };
  visit(value);
  return reasons;
}

/**
 * 根据平台错误文案推断右侧应提示用户检查的业务区域。
 *
 * 这里只返回稳定的页面区域键，不把 errorCode、文件路径或内部字段名直接展示给
 * 普通用户。后续编辑器使用这些键给出“图片、价格、包装”等可理解的补全入口。
 *
 * @param {*} message - WorkCTL 返回的错误文本。
 * @returns {string[]} 去重后的业务区域键。
 * @throws {Error} 不主动抛出异常。
 */
function inferPublishFailureFields(message) {
  const text = String(message || '').toLowerCase();
  const fields = [];
  const add = (key, patterns) => {
    if (patterns.some(pattern => text.includes(pattern))) fields.push(key);
  };
  add('images', ['image', '图片', '主图']);
  add('title', ['title', 'subject', '标题']);
  add('keywords', ['keyword', '关键词']);
  add('attributes', ['attribute', 'attr', '属性']);
  add('price', ['unitprice', 'skuprice', 'ladderprice', 'price', '价格']);
  add('moq', ['moq', 'minimum order', '起订']);
  add('package', ['pkgweight', 'pkglength', 'pkgwidth', 'pkgheight', 'package', '包装', '毛重']);
  add('fulfillment', ['ladderperiod', 'lead time', 'shipping', '发货', '物流']);
  add('sellingPoints', ['sellingpoint', 'detail', '卖点', '详情']);
  return [...new Set(fields)];
}

/**
 * 解析 publish-from-json 的单品结果，统一质量分、失败字段和平台商品号。
 *
 * @param {object} result - runPublishWorkctl() 返回的标准结果。
 * @returns {{ok:boolean,message:string,retryable:boolean,productId:*,taskId:*,requestId:*,errorCode:string,itemJsonPath:string,finalScore:number|null,lowScore:boolean|null,deductReasons:string[],qualityScoreMessage:string,failureFields:string[]}} 页面队列所需结果。
 * @throws {Error} 不主动抛出异常，缺失 productId 会被归为失败。
 */
function publishFlowOutcome(result) {
  const envelope = publishWorkctlOutcome(result);
  const data = parseEmbeddedWorkctlData(result?.parsed?.data);
  const foundResults = findPublishResponseField(data, new Set(['results']));
  const item = Array.isArray(foundResults) && foundResults.length
    ? parseEmbeddedWorkctlData(foundResults[0]) : data;
  const productId = findPublishResponseField(item, new Set(['productId', 'prodId']));
  const itemSuccess = findPublishResponseField(item, new Set(['success', 'isSuccess', 'businessSuccess']));
  const errorCode = publishText(findPublishResponseField(item, new Set(['errorCode', 'code'])), 120);
  const errorValue = findPublishResponseField(item, new Set(['error', 'errorMsg', 'message', 'next_step']));
  const errorMessage = publishText(
    typeof errorValue === 'object'
      ? errorValue?.message || errorValue?.errorMsg || errorValue?.reason || JSON.stringify(errorValue)
      : errorValue,
    600
  );
  const ok = Boolean(envelope.ok && itemSuccess !== false && productId !== null && productId !== undefined && productId !== '');
  const finalScoreValue = Number(findPublishResponseField(item, new Set(['finalScore', 'qualityScore', 'score'])));
  const lowScoreValue = findPublishResponseField(item, new Set(['lowScore']));
  const deductReasons = normalizeQualityReasons(findPublishResponseField(item, new Set(['deductReasons', 'deductionReasons'])));
  const qualityScoreMessage = publishText(
    findPublishResponseField(item, new Set(['qualityScoreMessage', 'scoreMessage'])), 300);
  const message = ok
    ? 'WorkCTL 已返回商品发布结果'
    : errorMessage || envelope.message || '平台未返回有效商品号，请检查商品资料';
  return {
    ok,
    message,
    retryable: envelope.retryable || findPublishResponseField(item, new Set(['retryable'])) === true,
    productId,
    taskId: findPublishResponseField(item, new Set(['taskId', 'parentTaskId', 'task_id'])),
    requestId: findPublishResponseField(item, new Set(['requestId', 'traceId'])),
    errorCode,
    itemJsonPath: publishText(findPublishResponseField(item, new Set(['itemJsonPath'])), 1000),
    finalScore: Number.isFinite(finalScoreValue) ? finalScoreValue : null,
    lowScore: typeof lowScoreValue === 'boolean' ? lowScoreValue : null,
    deductReasons,
    qualityScoreMessage,
    failureFields: inferPublishFailureFields(`${errorCode} ${message}`),
  };
}

/**
 * 确保相邻两次单品提交至少间隔配置的毫秒数。
 *
 * publish-from-json 单次可自行节流顶层数组；本页面为了保留逐条实时进度而按单品
 * 调用，因此在外层补足同等节奏，避免“串行”被误解成固定限流。
 *
 * @returns {Promise<void>} 到达下一个允许提交的时间点后结束。
 * @throws {Error} 不主动抛出异常。
 */
async function waitForPublishSubmissionSlot() {
  const remaining = PUBLISH_SUBMISSION_INTERVAL_MS - (Date.now() - publishLastSubmissionAt);
  if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
  publishLastSubmissionAt = Date.now();
}

/**
 * 使用权限为 0600 的临时 product.json 执行真实发品命令。
 *
 * 不把完整商品素材放进进程命令行或操作日志，减少本机进程列表和日志意外泄露
 * 商品内容的风险。无论命令成功或失败，finally 都会删除临时目录。
 *
 * @param {object} material - 已通过服务端白名单清洗的商品素材。
 * @param {'draft'|'publish'} action - 页面动作；publish 会映射为 Schema 的 product。
 * @returns {Promise<object>} runWorkctl() 的原始归一化结果。
 * @throws {Error} 临时文件无法创建或写入时抛出文件系统异常。
 */
async function runPublishWorkctl(material, action) {
  const temporaryDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lsou-workctl-publish-'));
  const productFile = path.join(temporaryDirectory, 'product.json');
  try {
    await fs.promises.writeFile(productFile, JSON.stringify(material), { mode: 0o600 });
    return await runWorkctl([
      'publishflow', 'publish-from-json',
      '--input', productFile,
      '--publish_type', action === 'draft' ? 'draft' : 'product',
      '--format', 'json',
      '--compact-output', 'off',
    ]);
  } finally {
    await fs.promises.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

/**
 * 只返回页面渲染队列所需字段，不把 material 或 WorkCTL 原始响应发给浏览器。
 *
 * @param {object} job - 服务进程内保存的完整队列任务。
 * @returns {object} 可公开给本地页面的脱敏任务摘要。
 * @throws {Error} 不主动抛出异常。
 */
function publicPublishJob(job) {
  return {
    id: job.id,
    localId: job.localId,
    title: job.title,
    image: job.image,
    action: job.action,
    scope: job.scope,
    // 旧进程内任务没有分组字段时按单任务回退，前端仍可显示 1/1。
    operationId: job.operationId || job.id,
    position: job.position || 1,
    total: job.total || 1,
    status: job.status,
    progress: job.progress,
    message: job.message,
    attempts: job.attempts,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    productId: job.productId,
    taskId: job.taskId,
    requestId: job.requestId,
    retryable: job.retryable === true,
    canFixAndRetry: job.canFixAndRetry === true,
    errorCode: job.errorCode || '',
    failureFields: Array.isArray(job.failureFields) ? job.failureFields : [],
    finalScore: Number.isFinite(job.finalScore) ? job.finalScore : null,
    lowScore: typeof job.lowScore === 'boolean' ? job.lowScore : null,
    deductReasons: Array.isArray(job.deductReasons) ? job.deductReasons : [],
    qualityScoreMessage: job.qualityScoreMessage || '',
  };
}

/**
 * 串行消费真实 WorkCTL 发品队列。
 *
 * 单个任务失败后继续处理下一条；由于真实发品非幂等，本函数不会
 * 自动重试。只有 WorkCTL 明确返回 retryable=true 时，页面才会提供人工重试。
 *
 * @returns {Promise<void>} 当前所有 queued 任务处理完毕后结束。
 * @throws {Error} 单任务异常会被捕获并写入该任务，不会让整个 worker 崩溃。
 */
async function processPublishQueue() {
  if (publishWorkerRunning) return;
  publishWorkerRunning = true;
  try {
    let job = publishJobs.find(item => item.status === 'queued');
    while (job) {
      job.status = 'running';
      job.progress = 50;
      job.message = job.action === 'draft' ? '正在调用 WorkCTL 保存远端草稿' : '正在调用 WorkCTL 提交正式发布';
      job.startedAt = new Date().toISOString();
      job.attempts += 1;
      try {
        await waitForPublishSubmissionSlot();
        const result = await runPublishWorkctl(job.material, job.action);
        const outcome = publishFlowOutcome(result);
        if (!outcome.ok) throw Object.assign(new Error(outcome.message), { outcome });
        job.status = job.action === 'draft' ? 'saved_draft' : 'submitted';
        job.progress = 100;
        job.message = job.action === 'draft' ? '已保存到国际站草稿箱' : '已提交国际站发布流程，请以平台审核状态为准';
        job.productId = outcome.productId ?? null;
        job.taskId = outcome.taskId ?? null;
        job.requestId = outcome.requestId ?? null;
        job.finalScore = outcome.finalScore;
        job.lowScore = outcome.lowScore;
        job.deductReasons = outcome.deductReasons;
        job.qualityScoreMessage = outcome.qualityScoreMessage;
        job.errorCode = '';
        job.failureFields = [];
        job.canFixAndRetry = false;
        job.retryable = false;
        pushLog({
          ts: new Date().toISOString(),
          label: job.action === 'draft' ? '保存商品草稿' : '提交商品发布',
          cmd: `workctl publishflow publish-from-json --input [temporary] --publish_type ${job.action === 'draft' ? 'draft' : 'product'}`,
          ms: result.durationMs,
          cached: false,
          ok: true,
        });
      } catch (error) {
        job.status = 'failed';
        job.progress = 100;
        job.message = publishText(error?.message || error, 600) || '发布任务执行失败';
        job.retryable = error?.outcome?.retryable === true;
        job.canFixAndRetry = Boolean(error?.outcome?.itemJsonPath || error?.outcome?.errorCode || error?.outcome?.failureFields?.length);
        job.errorCode = error?.outcome?.errorCode || '';
        job.failureFields = error?.outcome?.failureFields || [];
        // itemJsonPath 只留在服务进程内作为诊断证据，永远不通过 publicPublishJob 暴露。
        job.itemJsonPath = error?.outcome?.itemJsonPath || '';
        pushLog({
          ts: new Date().toISOString(),
          label: job.action === 'draft' ? '保存商品草稿' : '提交商品发布',
          cmd: `workctl publishflow publish-from-json --input [temporary] --publish_type ${job.action === 'draft' ? 'draft' : 'product'}`,
          ms: job.startedAt ? Date.now() - Date.parse(job.startedAt) : 0,
          cached: false,
          ok: false,
          err: job.message,
        });
      }
      job.finishedAt = new Date().toISOString();
      job = publishJobs.find(item => item.status === 'queued');
    }
  } finally {
    publishWorkerRunning = false;
  }
}

/**
 * 按当前账号实时类目 Schema 校验一条浏览器商品的属性 ID 与属性值。
 *
 * @param {*} product - 浏览器提交的原始商品快照。
 * @param {'draft'|'publish'} action - 草稿允许缺字段，正式发布要求所有必填属性完整。
 * @returns {Promise<void>} 校验通过时完成且不返回业务数据。
 * @throws {Error} 类目不属于当前账号、必填缺失或枚举值不是官方选项时抛出。
 */
async function validatePublishProductSchema(product, action) {
  const categoryId = Number(product?.categoryId);
  const schema = await loadPublishCategorySchema(categoryId);
  const inputAttributes = Array.isArray(product?.attributes) ? product.attributes : [];
  const submittedById = new Map(inputAttributes.map(attribute => [Number(attribute?.attrNameId), attribute]));
  const issues = [];

  schema.attributes.forEach(attribute => {
    const submitted = submittedById.get(attribute.attrNameId);
    const values = (Array.isArray(submitted?.attrValue) ? submitted.attrValue : [submitted?.attrValue])
      .flatMap(value => String(value ?? '').split(';'))
      .map(value => publishText(value, 160))
      .filter(Boolean);
    const attrValueId = Number(submitted?.attrValueId);

    if (action === 'publish' && attribute.required && !values.length) {
      issues.push(`必填属性 ${attribute.attrName} 未填写`);
      return;
    }
    if (!values.length || !attribute.enumProp || !attribute.options.length || attribute.attrNameId === 1) return;

    const allowedById = new Map(attribute.options.map(option => [Number(option.id), option.label]));
    const allowedLabels = new Set(attribute.options.map(option => option.label));
    if (attribute.multiSelect) {
      // 平台 JSON 对多值属性使用分号合并并将 attrValueId 设为 -1，但每个文本值
      // 仍必须能在实时 options 中找到，除非该属性明确允许自定义输入。
      if (!attribute.inputProp && values.some(value => !allowedLabels.has(value))) {
        issues.push(`${attribute.attrName} 含有非平台选项`);
      }
      return;
    }

    if (Number.isSafeInteger(attrValueId) && attrValueId > 0) {
      if (!allowedById.has(attrValueId) || allowedById.get(attrValueId) !== values[0]) {
        issues.push(`${attribute.attrName} 的选项文字与官方 attrValueId 不匹配`);
      }
      return;
    }
    if (!attribute.inputProp) {
      issues.push(`${attribute.attrName} 必须提交 WorkCTL 返回的官方 attrValueId`);
    }
  });

  const schemaIds = new Set(schema.attributes.map(attribute => attribute.attrNameId));
  inputAttributes.forEach(attribute => {
    const attrNameId = Number(attribute?.attrNameId);
    if (Number.isSafeInteger(attrNameId) && attrNameId > 0 && !schemaIds.has(attrNameId)) {
      issues.push(`属性 ${publishText(attribute?.attrName || attrNameId, 120)} 不属于当前类目`);
    }
  });
  if (issues.length) throw new Error(issues.slice(0, 8).join('；'));
}

/**
 * 校验写操作请求的确认、幂等键和批量规模，并创建串行任务。
 *
 * @param {*} body - POST /api/publish/enqueue 的 JSON 请求体。
 * @returns {Promise<{jobs:object[],deduplicated:boolean}>} 新建或幂等复用的任务列表。
 * @throws {Error} 确认缺失、参数无效或商品校验失败时抛出可读错误。
 */
async function enqueuePublishJobs(body) {
  if (body?.confirmed !== true || body?.acknowledgement !== PUBLISH_ACKNOWLEDGEMENT) {
    throw new Error('真实写操作必须在确认弹窗中明确确认');
  }
  const action = body?.action;
  const scope = body?.scope;
  const idempotencyKey = publishText(body?.idempotencyKey, 120);
  const products = Array.isArray(body?.products) ? body.products : [];
  if (!['draft', 'publish'].includes(action)) throw new Error('action 必须是 draft 或 publish');
  if (!['single', 'batch'].includes(scope)) throw new Error('scope 必须是 single 或 batch');
  if (idempotencyKey.length < 16) throw new Error('缺少有效的幂等键');
  if (!products.length || products.length > MAX_PUBLISH_BATCH) throw new Error(`每次必须提交 1-${MAX_PUBLISH_BATCH} 个商品`);
  if (scope === 'single' && products.length !== 1) throw new Error('单品操作只能包含 1 个商品');

  const existingIds = publishRequests.get(idempotencyKey);
  if (existingIds) {
    return {
      jobs: existingIds.map(id => publishJobs.find(job => job.id === id)).filter(Boolean),
      deduplicated: true,
    };
  }

  // 进入写队列前先在服务端自动匹配账号级业务选项，再重新核验实时类目 Schema。
  // 浏览器从不要求用户输入平台 ID；即使前端数据被修改，也不能绕过账号选项集合、
  // 平台枚举和值与类目归属检查。
  const businessOptions = await loadPublishBusinessOptions();
  const resolvedProducts = products.map(product => applyPublishBusinessOptions(product, businessOptions));
  await Promise.all(resolvedProducts.map(product => validatePublishProductSchema(product, action)));
  const normalized = resolvedProducts.map(product => normalizePublishProduct(product, action));
  const now = new Date().toISOString();
  const operationId = `publish-operation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const jobs = normalized.map((product, index) => ({
    id: `publish-job-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    requestKey: idempotencyKey,
    localId: product.localId,
    title: product.title,
    image: product.image,
    material: product.material,
    action,
    scope,
    operationId,
    position: index + 1,
    total: normalized.length,
    status: 'queued',
    progress: 0,
    message: '已加入真实 WorkCTL 串行队列',
    attempts: 0,
    retryable: false,
    createdAt: now,
    startedAt: null,
    finishedAt: null,
    productId: null,
    taskId: null,
    requestId: null,
    canFixAndRetry: false,
    errorCode: '',
    failureFields: [],
    itemJsonPath: '',
    finalScore: null,
    lowScore: null,
    deductReasons: [],
    qualityScoreMessage: '',
  }));

  publishJobs.push(...jobs);
  if (publishJobs.length > MAX_PUBLISH_JOBS) publishJobs.splice(0, publishJobs.length - MAX_PUBLISH_JOBS);
  publishRequests.set(idempotencyKey, jobs.map(job => job.id));
  setImmediate(() => processPublishQueue());
  return { jobs, deduplicated: false };
}

async function callEndpoint(name, query) {
  const ep = ENDPOINTS[name];
  if (!ep) return { ok: false, error: `unknown endpoint: ${name}` };

  const args = buildArgs(ep, query);
  const cmdText = ['workctl', ...args].join(' ');
  const key = cmdText;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL && query.__nocache !== '1') {
    pushLog({ ts: new Date().toISOString(), label: ep.label, cmd: cmdText,
              ms: 0, cached: true, ok: hit.res.ok });
    return { ...hit.res, cached: true, command: cmdText };
  }

  const r = await runWorkctl(args);
  pushLog({ ts: new Date().toISOString(), label: ep.label, cmd: cmdText,
            ms: r.durationMs, cached: false, ok: r.ok,
            err: r.ok ? null : (r.stderr || r.parseErr || `exit ${r.exitCode}`) });

  const res = r.ok
    ? { ok: true, data: shapeEndpointData(name, r.parsed.data), meta: r.parsed.meta || null,
        durationMs: r.durationMs, warnings: r.warnings }
    : { ok: false, error: r.stderr || r.parseErr || `exit code ${r.exitCode}`,
        durationMs: r.durationMs };

  if (r.ok) cache.set(key, { at: Date.now(), res });
  return { ...res, cached: false, command: cmdText };
}

/**
 * 计算有序数组的分位数，用于将商品长尾分布转成可解释的分组门槛。
 *
 * @param {number[]} values - 待计算的有限数值。
 * @param {number} ratio - 0 到 1 之间的分位位置。
 * @returns {number} 最近秩的分位值；空数组返回 0。
 * @throws {Error} 不主动抛异常，非有限值会被过滤。
 */
function quantile(values, ratio) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return sorted[Math.floor((sorted.length - 1) * ratio)];
}

/**
 * 读取完整商品效果列表，并依照“曝光 × 点击率”生成四象限与漏斗诊断。
 *
 * 高曝光使用当前商品集合 P75，可避免长尾数据中“中位曝光只有 2”导致过多
 * 商品被判为高曝光；高点击率使用全店加权点击率，保证小样本的 1/1 点击不会
 * 把基准抬到不合理水平。
 *
 * @returns {Promise<object>} 完整商品样本、门槛、四象限计数、诊断计数和重点商品。
 * @throws {Error} 不主动抛异常；WorkCTL 失败会转成 ok=false 的标准响应。
 */
async function getProductAnalysis() {
  const baseQuery = { pageSize: '20', orderBy: 'views', orderModel: 'DESC' };
  const first = await callEndpoint('shop-product', { ...baseQuery, pageNo: '1' });
  if (!first.ok) return first;

  const total = Number(first.data?.recordCount || 0);
  const pageCount = Math.max(1, Math.ceil(total / 20));
  const remaining = [];
  const pageNumbers = Array.from({ length: pageCount - 1 }, (_, index) => index + 2);
  // 每批最多四个 WorkCTL 进程，避免瞬间并发 18 个查询拖慢同一页面的客户、广告请求。
  for (let index = 0; index < pageNumbers.length; index += 4) {
    const batch = pageNumbers.slice(index, index + 4);
    const results = await Promise.all(batch.map(pageNo =>
      callEndpoint('shop-product', { ...baseQuery, pageNo: String(pageNo) })));
    remaining.push(...results);
  }
  const rows = [first, ...remaining]
    .filter(result => result.ok)
    .flatMap(result => Array.isArray(result.data?.data) ? result.data.data : []);

  const exposureThreshold = quantile(rows.map(row => Number(row.sumProdShowNum || 0)), 0.75);
  const exposureTotal = rows.reduce((sum, row) => sum + Number(row.sumProdShowNum || 0), 0);
  const clickTotal = rows.reduce((sum, row) => sum + Number(row.sumProdClickNum || 0), 0);
  const clickRateThreshold = exposureTotal ? clickTotal / exposureTotal : 0;
  const quadrants = {
    highExposureHighCtr: [],
    highExposureLowCtr: [],
    lowExposureHighCtr: [],
    lowExposureLowCtr: [],
  };

  rows.forEach(row => {
    const exposure = Number(row.sumProdShowNum || 0);
    const clickRate = Number(row.sumProdClickRate || 0);
    const highExposure = exposure >= exposureThreshold;
    const highCtr = clickRate >= clickRateThreshold;
    const key = highExposure
      ? (highCtr ? 'highExposureHighCtr' : 'highExposureLowCtr')
      : (highCtr ? 'lowExposureHighCtr' : 'lowExposureLowCtr');
    quadrants[key].push(row);
  });

  const summarizeProduct = row => ({
    productId: row.id,
    title: row.subject || row.prodName || '',
    image: row.prodImage || '',
    level: row.prodLevel3 || '未分层',
    exposure: Number(row.sumProdShowNum || 0),
    clicks: Number(row.sumProdClickNum || 0),
    clickRate: Number(row.sumProdClickRate || 0),
    visitors: Number(row.sumProdVisitorCnt || 0),
    inquiries: Number(row.sumProdFbNum || 0),
    tmInquiries: Number(row.atmFbUv || 0),
    draftOrders: Number(row.crtOrd || 0),
  });
  const byExposure = (a, b) => Number(b.sumProdShowNum || 0) - Number(a.sumProdShowNum || 0);

  // 商品诊断接口在当前网关偶发长时间不结束。四象限仍使用完整实时商品数据；
  // 质量诊断数量读取本轮已经实跑并保存的脱敏 Demo，避免一个慢命令阻塞整页。
  let diagnosticSnapshot = {};
  try {
    const demoPath = path.join(__dirname, 'demo-data', 'workctl-demo.json');
    const demo = JSON.parse(fs.readFileSync(demoPath, 'utf8'));
    diagnosticSnapshot = demo?.pages?.product?.analysis || {};
  } catch (_) {
    diagnosticSnapshot = {};
  }
  const layerCounts = rows.reduce((acc, row) => {
    const key = row.prodLevel3 || '未分层';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return {
    ok: true,
    data: {
      population: rows.length,
      recordCount: total,
      thresholds: { exposureP75: exposureThreshold, storeWeightedCtr: clickRateThreshold },
      totals: { exposure: exposureTotal, clicks: clickTotal },
      quadrantCounts: Object.fromEntries(
        Object.entries(quadrants).map(([key, value]) => [key, value.length])
      ),
      layerCounts,
      diagnostics: {
        clickedNoInquiry: rows.filter(row => Number(row.sumProdClickNum || 0) > 0 && Number(row.sumProdFbNum || 0) === 0).length,
        inquiryNoDraft: rows.filter(row => Number(row.sumProdFbNum || 0) + Number(row.atmFbUv || 0) > 0 && Number(row.crtOrd || 0) === 0).length,
        noSearchExposure: rows.filter(row => Number(row.sumProdShowNum || 0) === 0).length,
        p4pProducts: rows.filter(row => row.isP4pProd === 'Y').length,
        lowScoreQueryRows: diagnosticSnapshot.lowScoreQueryRowsZeroToFour ?? null,
        zeroEffectRows: diagnosticSnapshot.zeroEffectDiagnosisRows ?? null,
        qualitySource: 'workctl-demo-audit',
      },
      focusProducts: {
        highExposureHighCtr: quadrants.highExposureHighCtr.slice()
          .sort((a, b) => Number(b.sumProdClickNum || 0) - Number(a.sumProdClickNum || 0))
          .slice(0, 10).map(summarizeProduct),
        highExposureLowCtr: quadrants.highExposureLowCtr.slice().sort(byExposure).slice(0, 10).map(summarizeProduct),
        lowExposureHighCtr: quadrants.lowExposureHighCtr.slice().sort((a, b) => Number(b.sumProdClickRate || 0) - Number(a.sumProdClickRate || 0)).slice(0, 8).map(summarizeProduct),
        lowExposureLowCtr: quadrants.lowExposureLowCtr.slice().sort(byExposure).slice(0, 10).map(summarizeProduct),
        clickedNoInquiry: rows.filter(row => Number(row.sumProdClickNum || 0) > 0 && Number(row.sumProdFbNum || 0) === 0)
          .sort((a, b) => Number(b.sumProdClickNum || 0) - Number(a.sumProdClickNum || 0)).slice(0, 8).map(summarizeProduct),
      },
      lowScoreSample: [],
    },
  };
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
               '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };

/**
 * 读取受大小限制的 application/json 请求体。
 *
 * 写接口拒绝普通表单 Content-Type，使第三方网页无法用一个跨站 form 直接触发
 * localhost 发品；请求体上限则避免超大素材耗尽本地服务内存。
 *
 * @param {http.IncomingMessage} req - Node.js 原始 HTTP 请求。
 * @param {number} [maxBytes=524288] - 允许读取的最大字节数。
 * @returns {Promise<object>} 解析后的 JSON 对象。
 * @throws {Error} Content-Type、大小或 JSON 语法不合法时抛出异常。
 */
function readJsonBody(req, maxBytes = 512 * 1024) {
  return new Promise((resolve, reject) => {
    if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
      reject(new Error('写接口只接受 application/json'));
      req.resume();
      return;
    }
    let size = 0;
    let rejected = false;
    const chunks = [];
    req.on('data', chunk => {
      if (rejected) return;
      size += chunk.length;
      if (size > maxBytes) {
        rejected = true;
        const limitLabel = maxBytes >= 1024 * 1024
          ? `${Math.round(maxBytes / (1024 * 1024))}MB`
          : `${Math.round(maxBytes / 1024)}KB`;
        reject(new Error(`请求体超过 ${limitLabel} 上限`));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (rejected) return;
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON 请求体必须是对象');
        resolve(parsed);
      } catch (error) {
        reject(new Error(`JSON 请求体无效：${error.message}`));
      }
    });
    req.on('error', reject);
  });
}

/**
 * 验证浏览器写请求来自当前本地服务。
 *
 * Node 集成测试和本机脚本通常不带 Origin，因此允许空 Origin；浏览器一旦携带
 * Origin，就只接受当前 127.0.0.1/localhost 端口。
 *
 * @param {http.IncomingMessage} req - Node.js 原始 HTTP 请求。
 * @returns {boolean} 是否允许进入真实写操作路由。
 * @throws {Error} Origin 不是合法 URL 时返回 false，不向外抛出。
 */
function isAllowedPublishOrigin(req) {
  const origin = String(req.headers.origin || '');
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return ['127.0.0.1', 'localhost'].includes(parsed.hostname) && Number(parsed.port || 80) === PORT;
  } catch (_) {
    return false;
  }
}

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8',
                        'Cache-Control': 'no-store',
                        'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

/**
 * 通过真实 Workctl 子进程检查当前服务是否仍连接到已认证的 Accio 会话。
 *
 * 响应只暴露布尔状态，不返回 gateway token、Workctl 绝对路径、stderr 或账号
 * 信息，因此前端可以安全地用于状态展示。Accio 重启造成 token 失效时，调用方
 * 会收到 degraded 状态，并应重新运行 start.sh 获取新的进程环境。
 *
 * @returns {Promise<object>} 可直接返回给 `/api/health` 的安全健康状态对象。
 * @throws {Error} 本函数内部通过 runWorkctl 归一化失败，正常情况下不向外抛出。
 */
async function checkRuntimeHealth() {
  const result = await runWorkctl(['health', '--format', 'json']);
  const reachable = result.parsed !== null;
  const authenticated = result.ok && result.parsed?.success === true;

  return {
    ok: authenticated,
    service: authenticated ? 'ready' : 'degraded',
    workctl: { reachable, authenticated },
    endpointCount: Object.keys(ENDPOINTS).length,
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const p = url.pathname;

  try {
    // --- API: 服务与 Workctl 运行态检查
    if (p === '/api/health') {
      const health = await checkRuntimeHealth();
      return sendJSON(res, health.ok ? 200 : 503, health);
    }

    // --- API: 当前账号实时发品类目和属性规则（只读）
    if (p === '/api/publish/categories' && req.method === 'GET') {
      try {
        const categories = await loadPublishCategories();
        const query = publishText(url.searchParams.get('q'), 120).toLowerCase();
        const requestedIds = new Set(String(url.searchParams.get('ids') || '')
          .split(',').map(Number).filter(id => Number.isSafeInteger(id) && id > 0));
        const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit')) || 40, 100));
        const matches = categories.filter(category =>
          requestedIds.has(category.id) ||
          (query && `${category.id} ${category.name} ${category.path}`.toLowerCase().includes(query))
        ).slice(0, limit);
        return sendJSON(res, 200, {
          ok: true,
          categories: matches,
          total: categories.length,
          source: 'workctl-live',
        });
      } catch (error) {
        return sendJSON(res, 502, { ok: false, error: publishText(error?.message || error, 600) });
      }
    }

    if (p === '/api/publish/category-schema' && req.method === 'GET') {
      try {
        const categoryId = Number(url.searchParams.get('categoryId'));
        const schema = await loadPublishCategorySchema(categoryId);
        return sendJSON(res, 200, { ok: true, schema });
      } catch (error) {
        return sendJSON(res, 502, { ok: false, error: publishText(error?.message || error, 600) });
      }
    }

    // --- API: 当前账号商品到类目的自动匹配上下文（只读、已脱敏）
    if (p === '/api/publish/account-context' && req.method === 'GET') {
      try {
        const context = await buildPublicPublishAccountContext(Number(url.searchParams.get('limit')) || 20);
        return sendJSON(res, 200, { ok: true, context });
      } catch (error) {
        return sendJSON(res, 502, { ok: false, error: publishText(error?.message || error, 600) });
      }
    }

    // --- API: 当前账号计价单位与物流方案（只读，页面只展示业务名称）
    if (p === '/api/publish/business-options' && req.method === 'GET') {
      try {
        const options = await loadPublishBusinessOptions();
        return sendJSON(res, 200, { ok: true, options });
      } catch (error) {
        return sendJSON(res, 502, { ok: false, error: publishText(error?.message || error, 600) });
      }
    }

    // --- API: 发品图片存储能力。只说明是否已配置，不向浏览器暴露 bucket 或 endpoint。
    if (p === '/api/publish/upload-capability' && req.method === 'GET') {
      return sendJSON(res, 200, {
        ok: true,
        configured: Boolean(PUBLISH_IMAGE_BUCKET),
        acceptedTypes: ['image/jpeg', 'image/png', 'image/webp'],
        maxBytes: MAX_PUBLISH_IMAGE_BYTES,
      });
    }

    // --- API: 用户主动选择图片后上传到发品可用的远程地址。
    if (p === '/api/publish/images' && req.method === 'POST') {
      if (!isAllowedPublishOrigin(req)) return sendJSON(res, 403, { ok: false, error: '拒绝非同源图片上传请求' });
      if (!PUBLISH_IMAGE_BUCKET) {
        return sendJSON(res, 503, { ok: false, error: '图片上传服务尚未由管理员配置' });
      }
      try {
        const body = await readJsonBody(req, 12 * 1024 * 1024);
        const image = await uploadPublishImage(body);
        return sendJSON(res, 201, { ok: true, image });
      } catch (error) {
        return sendJSON(res, 400, { ok: false, error: publishText(error?.message || error, 600) });
      }
    }

    // --- API: 从参考商品链接读取精简模板，再由前端按当前账号 Schema 回填。
    if (p === '/api/publish/reference' && req.method === 'POST') {
      if (!isAllowedPublishOrigin(req)) return sendJSON(res, 403, { ok: false, error: '拒绝非同源参考商品请求' });
      try {
        const body = await readJsonBody(req, 16 * 1024);
        const reference = await queryPublishReference(body?.reference);
        return sendJSON(res, 200, { ok: true, reference });
      } catch (error) {
        return sendJSON(res, 400, { ok: false, error: publishText(error?.message || error, 600) });
      }
    }

    // --- API: 真实产品发布队列（只允许同源 JSON 请求）
    if (p === '/api/publish/jobs' && req.method === 'GET') {
      return sendJSON(res, 200, {
        ok: true,
        running: publishWorkerRunning,
        jobs: publishJobs.slice(-100).reverse().map(publicPublishJob),
      });
    }

    if (p === '/api/publish/enqueue' && req.method === 'POST') {
      if (!isAllowedPublishOrigin(req)) return sendJSON(res, 403, { ok: false, error: '拒绝非同源写请求' });
      try {
        const body = await readJsonBody(req);
        const queued = await enqueuePublishJobs(body);
        return sendJSON(res, queued.deduplicated ? 200 : 202, {
          ok: true,
          deduplicated: queued.deduplicated,
          jobs: queued.jobs.map(publicPublishJob),
          operation: queued.jobs.length ? {
            id: queued.jobs[0].operationId || queued.jobs[0].id,
            action: queued.jobs[0].action,
            scope: queued.jobs[0].scope,
            total: queued.jobs.length,
            jobIds: queued.jobs.map(job => job.id),
          } : null,
        });
      } catch (error) {
        return sendJSON(res, 400, { ok: false, error: publishText(error?.message || error, 600) });
      }
    }

    const publishRetryMatch = p.match(/^\/api\/publish\/jobs\/([^/]+)\/retry$/);
    if (publishRetryMatch && req.method === 'POST') {
      if (!isAllowedPublishOrigin(req)) return sendJSON(res, 403, { ok: false, error: '拒绝非同源写请求' });
      try {
        const body = await readJsonBody(req);
        if (body?.confirmed !== true || body?.acknowledgement !== PUBLISH_ACKNOWLEDGEMENT) {
          throw new Error('重试真实写操作前必须再次明确确认');
        }
        const jobId = decodeURIComponent(publishRetryMatch[1]);
        const job = publishJobs.find(item => item.id === jobId);
        if (!job) return sendJSON(res, 404, { ok: false, error: '发布任务不存在或服务已重启' });
        if (job.status !== 'failed') throw new Error('只有失败任务可以重试');
        if (!job.retryable) throw new Error('WorkCTL 未确认该失败可安全重试，请先到国际站核对是否已生成商品');
        job.status = 'queued';
        job.progress = 0;
        job.message = '人工确认后重新加入队列';
        job.startedAt = null;
        job.finishedAt = null;
        job.retryable = false;
        job.canFixAndRetry = false;
        job.errorCode = '';
        job.failureFields = [];
        setImmediate(() => processPublishQueue());
        return sendJSON(res, 202, { ok: true, job: publicPublishJob(job) });
      } catch (error) {
        return sendJSON(res, 400, { ok: false, error: publishText(error?.message || error, 600) });
      }
    }

    // --- API: 端点目录
    if (p === '/api/endpoints') {
      return sendJSON(res, 200, {
        ok: true,
        endpoints: Object.entries(ENDPOINTS).map(([k, v]) => ({
          key: k, label: v.label, command: ['workctl', ...v.argv].join(' '), flags: v.flags,
        })),
      });
    }

    // --- API: 执行日志
    if (p === '/api/log') {
      return sendJSON(res, 200, { ok: true, log: cmdLog.slice(0, 60) });
    }

    // --- API: 缓存清空
    if (p === '/api/cache/clear') {
      const n = cache.size + publishCategorySchemaCache.size +
        (publishCategoryCache.categories.length ? 1 : 0) + (publishBusinessOptionsCache.value ? 1 : 0) +
        (publishAccountCatalogCache.value ? 1 : 0);
      cache.clear();
      publishCategorySchemaCache.clear();
      publishCategoryCache.at = 0;
      publishCategoryCache.categories = [];
      publishBusinessOptionsCache.at = 0;
      publishBusinessOptionsCache.value = null;
      publishAccountCatalogCache.at = 0;
      publishAccountCatalogCache.value = null;
      return sendJSON(res, 200, { ok: true, cleared: n });
    }

    // --- API: 本轮 WorkCTL 实跑后的脱敏 Demo 快照
    if (p === '/api/demo') {
      const demoPath = path.join(__dirname, 'demo-data', 'workctl-demo.json');
      const demo = JSON.parse(fs.readFileSync(demoPath, 'utf8'));
      return sendJSON(res, 200, demo);
    }

    // --- API: 商品经营组合诊断
    if (p === '/api/dashboard/product-analysis') {
      const analysis = await getProductAnalysis();
      return sendJSON(res, analysis.ok ? 200 : 502, analysis);
    }

    // --- API: 数据查询
    if (p.startsWith('/api/q/')) {
      const name = p.slice('/api/q/'.length);
      const query = Object.fromEntries(url.searchParams.entries());
      const out = await callEndpoint(name, query);
      return sendJSON(res, out.ok ? 200 : 502, out);
    }

    // --- 静态文件
    let rel = p === '/' ? '/index.html' : p;
    const file = path.join(__dirname, 'public', path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(path.join(__dirname, 'public'))) {
      res.writeHead(403); return res.end('forbidden');
    }
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
    const buf = fs.readFileSync(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
                         'Cache-Control': 'no-store' });
    res.end(buf);
  } catch (e) {
    sendJSON(res, 500, { ok: false, error: String(e && e.message || e) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[workctl-dashboard] http://${HOST}:${PORT}`);
  console.log(`[workctl-dashboard] binary: ${WORKCTL}`);
  console.log(`[workctl-dashboard] endpoints: ${Object.keys(ENDPOINTS).join(', ')}`);
});
