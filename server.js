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
const crypto = require('crypto');
const { isIP } = require('node:net');
const { execFile } = require('child_process');
const { createOperations } = require('./lib/operations');
const { createAdvertising } = require('./lib/advertising');
const { createCapabilities } = require('./lib/capabilities');
const TimePolicy = require('./public/time-policy');
const { QueryCache } = require('./lib/query-cache');
const { PublishReadCache } = require('./lib/publish-read-cache');
const { MAX_PRODUCT_IMAGES, normalizePublishDetail } = require('./public/publish-product-utils');
const { createAiAdvisor } = require('./lib/ai-advisor');
const { createAwHandoff } = require('./lib/aw-handoff');

let PORT = Number(process.env.PORT || 8787);
// 桌面模式由系统分配端口，令牌仅驻内存；浏览器测试入口保持兼容。
const DESKTOP_TOKEN = process.env.LSOU_DESKTOP_TOKEN || '';
const PUBLIC_DIR = process.env.LSOU_PUBLIC_DIR || path.join(__dirname, 'public');
const HOST = '127.0.0.1';
const WORKCTL = process.env.WORKCTL_BIN || ''; // 由本地 start.sh 或桌面启动器发现，禁止回退到历史账号。

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
    flags: ['pageNo', 'pageSize', 'orderBy', 'orderModel', 'productName', 'statDate', 'statisticsType',
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
const endpointQueries = new QueryCache();
const workspaceQueries = new QueryCache();
// 四个内部工作台页面复用成功快照，直至用户主动刷新，避免来回切页时连续启动
// 多个 WorkCTL 子进程。缓存只在当前进程内存在，重启或切换账号后不会串数据。
const workspaceCache = new Map();
const cmdLog = [];      // 最近执行的命令，供前端"执行日志"面板消费
const MAX_LOG = 200;

// 产品发布是远端写操作。确认常量不会充当秘密，而是强制调用方明确进入写路径，
// 同时 application/json 与同源检查可阻止普通网页表单误触本机服务。
const PUBLISH_ACKNOWLEDGEMENT = 'I_CONFIRM_PRODUCT_WRITE';
const MAX_PUBLISH_BATCH = 50;
const MAX_PUBLISH_JOBS = 200;
const MAX_PUBLISH_IMAGE_BYTES = 8 * 1024 * 1024;
const PUBLISH_SUBMISSION_INTERVAL_MS = Math.max(0,
  Math.min(Number(process.env.PUBLISH_SUBMISSION_INTERVAL_MS ?? 1000) || 0, 10000));
const publishJobs = [];
const publishRequests = new Map();
let publishWorkerRunning = false;
let publishLastSubmissionAt = 0;

// 浏览资料长期复用本地快照；写入前仍要求类目和业务规则在 30 分钟有效期内。
const PUBLISH_SCHEMA_CACHE_TTL = 30 * 60 * 1000;

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
// 浏览器选择“参考已有商品”时只拿到随机短期令牌。真实 productId 只存在于服务端
// 映射中，并在缓存失效后清理，避免把平台内部编号变成普通用户需要理解的表单项。
const publishAccountReferenceTokens = new Map();
const publishAccountReferenceKeysByProductId = new Map();

// 历史商品图库使用独立的账号级持久缓存。首次进入产品发布页时，服务端会先读取
// `data-advisor-shop-product` 的完整商品目录，再在后台以受控并发逐件调用
// `list-information`。缓存写在用户系统缓存目录而不是项目目录，避免把某个商家的
// 商品号和图片 URL 打进插件交付包或 Git。
const PUBLISH_IMAGE_LIBRARY_VERSION = 1;
const PUBLISH_IMAGE_LIBRARY_CONCURRENCY = Math.max(
  1,
  Math.min(Number(process.env.PUBLISH_IMAGE_LIBRARY_CONCURRENCY || 4), 8)
);
const PUBLISH_IMAGE_LIBRARY_CACHE_DIRECTORY = path.resolve(
  process.env.PUBLISH_IMAGE_LIBRARY_CACHE_DIR ||
  path.join(os.homedir(), 'Library', 'Caches', 'com.lsou.workctl-dashboard')
);
// 活动 space 只参与哈希，不进入文件内容和浏览器响应。这样同一台电脑切换账号时
// 不会把甲店铺图库误用到乙店铺；测试或直接运行 server.js 时则落入隔离的 local scope。
const PUBLISH_IMAGE_LIBRARY_SCOPE = crypto.createHash('sha256')
  .update(String(process.env.ACCIO_ACTIVE_SPACE || 'local-workctl-session'))
  .digest('hex')
  .slice(0, 16);
const PUBLISH_IMAGE_LIBRARY_CACHE_FILE = path.join(
  PUBLISH_IMAGE_LIBRARY_CACHE_DIRECTORY,
  `publish-image-library-${PUBLISH_IMAGE_LIBRARY_SCOPE}.json`
);
// 只持久化已完成的回执，支持重启后继续按原商品号编辑；不存完整素材，不恢复或重放写任务。
const PUBLISH_HISTORY_FILE = process.env.ACCIO_ACTIVE_SPACE || process.env.PUBLISH_HISTORY_CACHE_DIR
  ? path.join(path.resolve(process.env.PUBLISH_HISTORY_CACHE_DIR || `${PUBLISH_IMAGE_LIBRARY_CACHE_DIRECTORY}-history`), `publish-history-${PUBLISH_IMAGE_LIBRARY_SCOPE}.json`) : null;
let publishHistoryReady = null;
let publishHistoryWriting = Promise.resolve();
// 目录、类目、规格规则、交易选项及已选参考资料统一落盘；未识别账号时只存内存。
const publishReadCache = new PublishReadCache({
  directory: path.resolve(process.env.PUBLISH_READ_CACHE_DIR || `${PUBLISH_IMAGE_LIBRARY_CACHE_DIRECTORY}-publish-data`),
  scope: String(process.env.ACCIO_ACTIVE_SPACE || (process.env.PUBLISH_READ_CACHE_DIR || process.env.PUBLISH_IMAGE_LIBRARY_CACHE_DIR ? 'isolated-local-session' : '')),
  onEvent: (label, ok) => pushLog({ ts: new Date().toISOString(), label, cmd: 'local publish cache', ms: 0, cached: true, ok }),
});
let publishSourceRefreshPromise = null;
const publishImageLibraryState = {
  initialized: false,
  loadedFromDisk: false,
  status: 'idle',
  totalProducts: 0,
  processedProducts: 0,
  refreshedProducts: 0,
  failedProducts: 0,
  startedAt: null,
  finishedAt: null,
  lastError: '',
  records: new Map(),
};
const publishImageRecordLoadPromises = new Map();
let publishImageLibraryInitializePromise = null;
let publishImageLibrarySyncPromise = null;
let publishImageLibraryPersistPromise = Promise.resolve();

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
      profileComplete: ['店铺高询盘词列表', '店铺高引流词列表', '店铺高p4p词列表'].every(key => Array.isArray(data?.[key]?.data?.wordList)),
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

function runWorkctl(args, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const started = Date.now();
    let timedOut = false;
    let settled = false;
    const child = execFile(WORKCTL, process.env.WORKCTL_ENTRY ? [process.env.WORKCTL_ENTRY, ...args] : args, {
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      // 使用独立进程组才能在超时时同时结束 JS 包装器和它启动的原生 WorkCTL，
      // 否则只结束父进程会留下长期占用网关的孤儿查询。
      detached: process.platform !== 'win32',
      env: process.env,
    }, (err, stdout, stderr) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
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
        stderr: timedOut ? `WorkCTL 查询超过 ${Math.round(timeoutMs / 1000)} 秒，已停止` : String(stderr || '').slice(0, 2000),
        warnings: i > 0 ? raw.slice(0, i).trim() : '',
      });
    });
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM');
        else if (child.pid) execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
      } catch (_) {
        child.kill('SIGTERM');
      }
      // 某些 CLI 包装器不会在子进程退出后及时触发 execFile 回调。HTTP 请求不能
      // 因此永久等待，所以在发出终止信号后直接完成标准失败结果；迟到回调会被忽略。
      setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({
          ok: false,
          exitCode: -1,
          durationMs: Date.now() - started,
          parsed: null,
          parseErr: null,
          stderr: `WorkCTL 查询超过 ${Math.round(timeoutMs / 1000)} 秒，已停止`,
          warnings: '',
        });
      }, 250);
    }, timeoutMs);
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
 * 执行一个只读 WorkCTL 命令并取出真实业务 data。
 *
 * @param {string[]} command - 不含公共输出参数的完整只读命令参数。
 * @param {string} label - 写入开发日志和错误提示的业务名称。
 * @returns {Promise<*>} 已解除 JSON 字符串包装的 WorkCTL data。
 * @throws {Error} 子进程失败、业务 success=false 或没有可解析响应时抛出。
 */
async function readWorkspaceWorkctl(command, label) {
  const result=await workspaceQueries.read(JSON.stringify(command),async()=>({ok:true,data:await readWorkspaceWorkctlLive(command,label)}));
  return result.data;
}
/** 执行未缓存的工作台只读查询；参数为命令和日志名称，返回业务数据，失败抛错。 */
async function readWorkspaceWorkctlLive(command, label) {
  const args = [...command, '--format', 'json', '--compact-output', 'off'];
  const result = await runWorkctl(args, 35000);
  const ok = result.ok && result.parsed?.success !== false;
  pushLog({
    ts: new Date().toISOString(),
    label,
    cmd: ['workctl', ...command].join(' '),
    ms: result.durationMs,
    cached: false,
    ok,
    err: ok ? null : (result.stderr || result.parseErr || 'WorkCTL 返回业务失败'),
  });
  if (!ok) throw new Error(result.stderr || result.parseErr || `${label}读取失败`);
  return parseEmbeddedWorkctlData(result.parsed?.data);
}

/**
 * 从未知包装层级中寻找第一个指定字段。
 *
 * @param {*} value - WorkCTL 的嵌套业务对象。
 * @param {string[]} keys - 按优先级匹配的字段名。
 * @param {number} [depth=0] - 当前递归深度，防止异常循环结构。
 * @returns {*} 找到的字段值；不存在时返回 undefined。
 * @throws {Error} 不主动抛出异常。
 */
function findWorkspaceField(value, keys, depth = 0) {
  const parsed = parseEmbeddedWorkctlData(value);
  if (!parsed || typeof parsed !== 'object' || depth > 7) return undefined;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(parsed, key) && parsed[key] !== undefined && parsed[key] !== null) {
      return parsed[key];
    }
  }
  for (const child of Object.values(parsed)) {
    const found = findWorkspaceField(child, keys, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * 读取公司资料命令返回的受控 HTTPS JSON 文件。
 *
 * @param {*} companyInfo - `ai-minisite-get-company-info` 的真实返回。
 * @returns {Promise<{profile:*|null,error:string}>} 公司资料正文或明确错误。
 * @throws {Error} 网络异常在函数内部转成 error 字段，不向路由外抛出。
 */
async function fetchStorefrontCompanyProfile(companyInfo) {
  const rawUrl = findWorkspaceField(companyInfo, ['ossUrl', 'url']);
  if (!rawUrl) return { profile: companyInfo || null, error: '' };
  try {
    const target = new URL(String(rawUrl));
    if (target.protocol !== 'https:' || target.hostname !== 'skill.accio.com') {
      return { profile: null, error: '公司资料地址不属于允许的 Accio 域名' };
    }
    const response = await fetch(target, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return { profile: null, error: `公司资料读取失败（HTTP ${response.status}）` };
    return { profile: await response.json(), error: '' };
  } catch (error) {
    return { profile: null, error: `公司资料读取失败：${publishText(error?.message || error, 180)}` };
  }
}

/** 顶栏仅加载当前账号公司名和标识，不等待装修/云端页面；无参数，返回精简身份，失败抛错。 */
async function loadCompanyIdentity(){
  const info=await readWorkspaceWorkctl(['icbu','storefront','ai-minisite-get-company-info','--data-type','all','--language','en'],'顶部公司资料');
  const result=await fetchStorefrontCompanyProfile(info);
  if(result.error)throw new Error(result.error);
  const profile=result.profile;
  return {companyName:profile?.companyBasicInfo?.companyBasicInfo?.companyName||null,companyLogo:profile?.companyExtraInfo?.companyBasicInfoExt?.companyLogo||null};
}

/**
 * 聚合店铺装修页需要的当前账号真实资料和页面版本。
 *
 * @returns {Promise<object>} 公司号、公司资料、页面列表和云端页面读取结果。
 * @throws {Error} 公司身份或核心查询失败时抛出；单个附加项失败会记录在 errors。
 */
async function loadStorefrontWorkspace() {
  // 公司资料响应本身包含 companyId；当前活动空间的独立 get-company-id 偶发长期
  // 不返回，因此不再重复调用它，避免一条冗余查询拖死整张店铺页面。
  const companyInfo = await readWorkspaceWorkctl(
    ['icbu', 'storefront', 'ai-minisite-get-company-info', '--data-type', 'all', '--language', 'en'],
    '店铺公司资料'
  );
  const companyId = String(findWorkspaceField(companyInfo, ['companyId', 'companyID', 'id']) ?? '').trim();
  const errors = [];
  const [profileResult, pageResult, cloudResult] = await Promise.allSettled([
    fetchStorefrontCompanyProfile(companyInfo),
    readWorkspaceWorkctl(['icbu', 'storefront', 'ai-minisite-get-acciowork-page-list', '--request', JSON.stringify({ companyId })], '店铺页面版本'),
    readWorkspaceWorkctl(['icbu', 'storefront', 'get-cloud'], '店铺云端页面'),
  ]);
  if (profileResult.status === 'fulfilled' && profileResult.value.error) errors.push(profileResult.value.error);
  if (pageResult.status === 'rejected') errors.push(`页面版本：${pageResult.reason?.message || '读取失败'}`);
  if (cloudResult.status === 'rejected') errors.push(`云端页面：${cloudResult.reason?.message || '读取失败'}`);
  const pagesData = pageResult.status === 'fulfilled' ? pageResult.value : null;
  const pages = findBestWorkctlArray(pagesData, item => Boolean(item && typeof item === 'object' &&
    ('pageId' in item || 'pageType' in item || 'pageName' in item)));
  return {
    companyId,
    companyInfo,
    companyProfile: profileResult.status === 'fulfilled' ? profileResult.value.profile : null,
    pages,
    pageSummary: pagesData,
    cloud: cloudResult.status === 'fulfilled' ? cloudResult.value : null,
    errors,
  };
}

/**
 * 聚合素材工坊的当前账号商品、自有 3D 资产和公共 3D 素材库。
 *
 * @returns {Promise<object>} 真实商品明细、当前账号模型和公共模型列表。
 * @throws {Error} 三个核心只读来源均不可用时抛出。
 */
async function loadAssetsWorkspace() {
  const [catalogResult, ownResult, galleryResult] = await Promise.allSettled([
    callEndpoint('shop-product', { pageNo: '1', pageSize: '20', orderBy: 'views', orderModel: 'DESC' }),
    readWorkspaceWorkctl(['icbu', 'product', 'icbu-product-3d-model-list', '--current-page', '1', '--page-size', '20'], '自有 3D 模型'),
    readWorkspaceWorkctl(['icbu', 'product', 'icbu-product-3d-gallery-query', '--current-page', '1', '--page-size', '12'], '公共 3D 素材库'),
  ]);
  const errors = [catalogResult, ownResult, galleryResult]
    .filter(result => result.status === 'rejected')
    .map(result => result.reason?.message || '素材数据读取失败');
  if (errors.length === 3) throw new Error(errors.join('；'));
  const catalogResponse = catalogResult.status === 'fulfilled' && catalogResult.value?.ok
    ? catalogResult.value : { data: { data: [], recordCount: 0 }, durationMs: 0 };
  const catalogRows = Array.isArray(catalogResponse.data?.data) ? catalogResponse.data.data : [];
  const products = catalogRows.slice(0, 20).map(row => ({
    productId: publishAccountProductId(row),
    title: publishText(row?.subject || row?.prodName, 300),
    image: publishText(row?.prodImage, 1000),
    categoryId: Number(row?.categoryId) || null,
    categoryName: publishText(row?.cateName, 200),
    views: Number(row?.sumProdShowNum || row?.totalImpsCnt || row?.views || row?.viewCount || 0),
    clicks: Number(row?.sumProdClickNum || row?.totalClkCnt || row?.clicks || row?.clickCount || 0),
  }));
  const ownData = ownResult.status === 'fulfilled' ? ownResult.value : null;
  const galleryData = galleryResult.status === 'fulfilled' ? galleryResult.value : null;
  return {
    products,
    productTotal: Number(catalogResponse.data?.recordCount || catalogRows.length),
    ownModels: findBestWorkctlArray(ownData, item => Boolean(item && typeof item === 'object' && ('modelId' in item || 'viewerUrl' in item))),
    ownModelTotal: Number(findWorkspaceField(ownData, ['totalCount', 'total']) || 0),
    gallery: findBestWorkctlArray(galleryData, item => Boolean(item && typeof item === 'object' && ('modelId' in item || 'viewerUrl' in item))),
    galleryTotal: Number(findWorkspaceField(galleryData, ['totalCount', 'total']) || 0),
    fetchedAt: new Date().toISOString(),
    errors,
  };
}

/**
 * 聚合知识检索、公共 FAQ 和两类真实接待策略。
 *
 * @returns {Promise<object>} 知识答案、FAQ 切片与完整策略列表。
 * @throws {Error} 四个来源全部失败时抛出。
 */
async function loadKnowledgeWorkspace() {
  const query = 'MOQ payment sample customization lead time packaging shipping warranty certification';
  const results = await Promise.allSettled([
    readWorkspaceWorkctl(['icbu', 'tm', 'list-seller-knowledge', '--query', query], '商家知识'),
    readWorkspaceWorkctl(['icbu', 'cco', 'icbu-faq-knowledge-chunk', '--query', query], '公共 FAQ'),
    readWorkspaceWorkctl(['icbu', 'tm', 'list-reception-strategies', '--scene-type', 'CHAT_RECEPTION'], '辅助接待策略'),
    readWorkspaceWorkctl(['icbu', 'tm', 'list-reception-strategies', '--scene-type', 'AUTO_RECEPTION'], '自动接待策略'),
  ]);
  const errors = results.filter(result => result.status === 'rejected')
    .map(result => result.reason?.message || '知识数据读取失败');
  if (errors.length === results.length) throw new Error(errors.join('；'));
  const value = index => results[index].status === 'fulfilled' ? results[index].value : null;
  const strategyPredicate = item => Boolean(item && typeof item === 'object' &&
    ('strategyId' in item || 'topic' in item || 'content' in item));
  return {
    query,
    sellerKnowledge: value(0),
    faq: findBestWorkctlArray(value(1), item => Boolean(item && typeof item === 'object' &&
      ('title' in item || 'content' in item || 'score' in item))).map(item => ({
        ...(item?.data && typeof item.data === 'object' ? item.data : item),
        score: item?.score ?? item?.data?.score ?? null,
      })),
    chatStrategies: findBestWorkctlArray(value(2), strategyPredicate),
    autoStrategies: findBestWorkctlArray(value(3), strategyPredicate),
    errors,
  };
}

/**
 * 聚合当前账号成员与联系人，不调用已知无权限的旧 list-contact 入口。
 *
 * @returns {Promise<object>} 完整成员字段和 query-contact 返回的联系人目录。
 * @throws {Error} 成员和联系人均读取失败时抛出。
 */
async function loadAccessWorkspace() {
  // member list 在部分活动空间会长期不返回；团队绩效使用的是同一账号下已经稳定
  // 可用的经营账号目录，因此优先用它取得真实姓名和账号字段，不再阻塞首屏。
  const end = new Date();
  const start = new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000);
  const accountResult = await callEndpoint('account-summary', {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    statisticsType: 'month',
  });
  if (!accountResult.ok) throw new Error(accountResult.error || '经营账号目录读取失败');
  const accountRows = findBestWorkctlArray(accountResult.data, item => Boolean(item && typeof item === 'object' &&
    ('fullName' in item || 'accountName' in item || 'selfAliId' in item)));
  return {
    members: accountRows.filter(item => String(item?.fullName || '') !== '全部账号').map(item => ({
      ...item,
      firstName: item?.firstName || item?.fullName || item?.accountName || '',
      lastName: item?.lastName || '',
      aliId: item?.aliId || item?.selfAliId || item?.memberId || item?.accountId || '',
      admin: item?.admin ?? null,
      self: item?.self ?? null,
    })),
    memberSource: 'data-advisor-account-summary',
    contactsDeferred: true,
    errors: [],
  };
}

/**
 * 单独读取联系人，避免慢接口阻塞成员页首屏。
 *
 * @returns {Promise<object>} query-contact 的真实联系人列表和原始汇总。
 * @throws {Error} WorkCTL 查询失败时抛出，由独立路由返回。
 */
async function loadAccessContactsWorkspace() {
  const contactData = await readWorkspaceWorkctl(
    ['icbu', 'tm', 'query-contact', '--start-version', '0', '--type', '0'],
    '联系人目录'
  );
  return {
    contacts: findBestWorkctlArray(contactData, item => Boolean(item && typeof item === 'object' &&
      ('nickName' in item || 'nickname' in item || 'memberId' in item || 'avatar' in item || 'avatarUrl' in item))),
    contactSummary: contactData,
    source: 'workctl-live',
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * 按模块读取或复用当前账号的成功快照。
 *
 * @param {'storefront'|'assets'|'knowledge'|'access'} name - 工作台模块名。
 * @param {boolean} force - true 时主动重新读取缓存。
 * @returns {Promise<object>} 对应模块的真实业务数据。
 * @throws {Error} 未知模块或底层聚合查询失败时抛出。
 */
async function loadAccountWorkspace(name, force = false) {
  if(force)workspaceQueries.clear();
  const generation=workspaceQueries.generation;
  const cached = workspaceCache.get(name);
  if (!force && cached) return { ...cached.data, cached: true };
  const loaders = {
    identity: loadCompanyIdentity,
    storefront: loadStorefrontWorkspace,
    assets: loadAssetsWorkspace,
    knowledge: loadKnowledgeWorkspace,
    access: loadAccessWorkspace,
  };
  if (!loaders[name]) throw new Error(`未知工作台：${name}`);
  const data = await loaders[name]();
  const result = { ...data, source: 'workctl-live', fetchedAt: new Date().toISOString(), cached: false };
  if(generation===workspaceQueries.generation)workspaceCache.set(name, { at: Date.now(), data: result });
  return result;
}

/**
 * 通过权限为 0600 的临时 JSON 文件调用需要数组或嵌套参数的 WorkCTL 查询。
 *
 * @param {string[]} command - 不含 `workctl` 的命令路径，例如 `['icbu','product','list-attribute-options']`。
 * @param {object} payload - 需要写入 `--json-file` 的参数对象。
 * @param {string} prefix - 临时目录前缀，仅用于本机排障辨识。
 * @param {number} timeoutMs - 子进程最长运行时间，默认保留原查询时限。
 * @returns {Promise<object>} `runWorkctl()` 的标准结果。
 * @throws {Error} 临时目录或文件无法创建时抛出文件系统错误。
 */
async function runWorkctlWithJsonFile(command, payload, prefix, timeoutMs = 120000) {
  const temporaryDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
  const paramsFile = path.join(temporaryDirectory, 'params.json');
  try {
    await fs.promises.writeFile(paramsFile, JSON.stringify(payload), { mode: 0o600 });
    return await runWorkctl([
      ...command,
      '--json-file', paramsFile,
      '--format', 'json',
      '--compact-output', 'off',
    ], timeoutMs);
  } finally {
    await fs.promises.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

/**
 * 读取发布前所需的平台规则，遇到短暂连接故障时最多重试两次。
 * @param {string[]} command 固定白名单内的只读命令；发布、上传等写命令不能传入。
 * @param {object|null} payload JSON 查询参数；类目列表使用 null 和固定 locale。
 * @returns {Promise<object>} 成功的 WorkCTL 结果；不会使用旧规则假装校验成功。
 * @throws {Error} 拒绝非白名单命令；权限/业务拒绝立即报错，连接故障三次失败后报可重试错误。
 */
async function runPublishRuleRead(command, payload = null) {
  const name = command.join(' ');
  const labels = {
    'icbu product list-user-category': '读取店铺类目',
    'icbu product list-attribute': '读取类目属性',
    'icbu product list-attribute-options': '读取属性选项',
    'icbu product list-information': '读取交易选项',
  };
  const label = Object.hasOwn(labels, name) ? labels[name] : null;
  if (!label) throw new Error('发布规则重试仅支持只读查询');
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = payload === null
      ? await runWorkctl([...command, '--locale', 'zh_CN', '--format', 'json', '--compact-output', 'off'], 20000)
      : await runWorkctlWithJsonFile(command, payload, 'lsou-publish-rule-', 20000);
    const outcome = publishWorkctlOutcome(result);
    const detail = `${outcome.message} ${result.stderr || ''}`;
    // mcp_upstream_rejected 本身不代表可以重试；必须同时命中连接/超时错误，且不是权限或参数问题。
    const transient = !/unauth|forbidden|permission|access.denied|invalid.argument|权限|认证|登录|配额|余额|欠费|quota|参数错误/i.test(detail) &&
      /超时|timed?\s*out|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket hang up|连接中断|连接失败/i.test(detail);
    pushLog({ ts: new Date().toISOString(), label, cmd: `workctl ${name}`, ms: result.durationMs,
      cached: false, ok: outcome.ok, attempt, err: outcome.ok ? null : transient ? '平台连接超时或中断' : '平台拒绝规则查询' });
    console.log(`[publish-rule] ${label} attempt=${attempt} ok=${outcome.ok} transient=${transient} durationMs=${result.durationMs}`);
    if (outcome.ok) return result;
    if (transient && attempt < 3) {
      await new Promise(resolve => setTimeout(resolve, attempt * 500));
      continue;
    }
    const error = new Error(transient
      ? `${label}时平台连接超时或中断，已自动重试 2 次，请稍后再试。`
      : `${label}被平台拒绝，请检查当前账号授权和可用类目。`);
    error.code = transient ? 'PUBLISH_RULE_READ_TIMEOUT' : 'PUBLISH_RULE_READ_REJECTED';
    error.statusCode = transient ? 503 : 502;
    error.retryable = transient;
    error.ruleRead = true;
    error.stage = label;
    throw error;
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
    const result = await runPublishRuleRead(['icbu', 'product', 'list-user-category']);
    if (!result.ok || result.parsed?.success === false) {
      lastError = result.stderr || result.parseErr || '读取当前账号类目失败';
      continue;
    }
    const categories = flattenPublishCategories(result.parsed?.data);
    if (!categories.length) continue;
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
 * 读取当前登录账号可见的叶子类目，复用账号隔离的本地快照并合并并发请求。
 * @param {{maxAge?:number}} options 浏览时长期复用，写前限制有效期。
 *
 * @returns {Promise<{id:number,name:string,path:string}[]>} 当前账号的叶子类目列表。
 * @throws {Error} 底层 WorkCTL 两次都失败或返回空结构时抛出可读错误。
 */
async function loadPublishCategories(options = {}) {
  return publishReadCache.read('categories', fetchPublishCategoriesFromWorkctl, options);
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
 * @param {{maxAge?:number}} options 浏览时长期复用，写前限制有效期。
 * @returns {Promise<object>} 前端可直接渲染的动态类目 Schema。
 * @throws {Error} 类目无效、属性工具失败或未返回属性时抛出可读错误。
 */
async function loadPublishCategorySchema(categoryId, options = {}) {
  if (!Number.isSafeInteger(categoryId) || categoryId <= 0) throw new Error('categoryId 必须是正整数');
  return publishReadCache.read(`schema:${categoryId}`, () => fetchPublishCategorySchema(categoryId, options), options);
}

/** 读取新类目规则；categoryId 为叶子类目，options 控制归属列表有效期；返回 Schema，上游失败抛错。 */
async function fetchPublishCategorySchema(categoryId, options = {}) {
  if (!Number.isSafeInteger(categoryId) || categoryId <= 0) throw new Error('categoryId 必须是正整数');
  const categoriesPromise = loadPublishCategories(options);
  const attributeResultPromise = runPublishRuleRead(
    ['icbu', 'product', 'list-attribute'], { categoryId, propertyType: 'PRODUCT' }
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
    const optionResult = await runPublishRuleRead(
      ['icbu', 'product', 'list-attribute-options'], { categoryId, attrIdList }
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
 * 从当前登录账号读取完整商品目录，作为发品页自动匹配类目的依据。
 *
 * 只保存商品号、标题、缩略图、类目、计价单位与修改时间；商品号不返回浏览器。
 * 使用同一份缓存还能避免发品页同时加载类目上下文与计价单位时重复调用 WorkCTL。
 *
 * @returns {Promise<{rows:object[],durationMs:number,fetchedAt:string}>} 当前账号代表商品。
 * @throws {Error} WorkCTL 不可用或当前账号没有返回商品时抛出可读错误。
 */
async function loadPublishAccountCatalog() {
  return publishReadCache.read('catalog', async () => {
    const productResult = await callEndpoint('shop-product', {
      __nocache: '1',
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
        __nocache: '1',
        pageNo: String(pageNo),
        pageSize: '20',
        orderBy: 'views',
        orderModel: 'DESC',
      })));
      if (results.some(result => !result.ok)) throw new Error('部分店铺商品未读取成功，请重新更新店铺资料');
      remainingResults.push(...results);
    }
    const rows = [productResult, ...remainingResults]
      .filter(result => result.ok)
      .flatMap(result => Array.isArray(result.data?.data) ? result.data.data : [])
      .filter(row => Number.isSafeInteger(Number(row?.categoryId)) && Number(row.categoryId) > 0);
    if (!rows.length) throw new Error('当前店铺没有返回可用于匹配类目的商品');
    return {
      // 仅保存参考发品所需字段，经营指标、负责人等原始内容不写入这份缓存。
      rows: rows.map(row => ({
        productId: publishAccountProductId(row), categoryId: Number(row.categoryId),
        subject: publishText(row.subject || row.prodName, 128), prodImage: publishText(row.prodImage, 1000),
        cateName: publishText(row.cateName, 160), priceUnit: Number(row.priceUnit) || null,
        gmtModified: publishText(row.gmtModified || row.modifiedTime || row.crtTime, 80),
      })),
      durationMs: Number(productResult.durationMs || 0) + remainingResults
        .reduce((sum, result) => sum + Number(result.durationMs || 0), 0),
      fetchedAt: new Date().toISOString(),
    };
  });
}

/**
 * 从经营数据的一条商品记录中读取真实商品号，仅供服务端参考商品查询使用。
 *
 * @param {object} row - `data-advisor-shop-product` 返回的一条当前账号商品记录。
 * @returns {string} 通过纯数字校验的商品号；没有可用商品号时返回空字符串。
 * @throws {Error} 不主动抛出异常，未知字段会被忽略。
 */
function publishAccountProductId(row) {
  const candidates = [row?.productId, row?.prodId, row?.id, row?.itemId];
  const value = candidates.map(candidate => String(candidate ?? '').trim())
    .find(candidate => /^\d{6,30}$/.test(candidate));
  return value || '';
}

/**
 * 为一个真实商品号创建或复用浏览器不可反推出 ID 的短期参考令牌。
 *
 * @param {string} productId - 已校验的当前账号商品号。
 * @returns {string} 随机 UUID 令牌；商品号为空时返回空字符串。
 * @throws {Error} 系统随机数服务异常时 `crypto.randomUUID` 可能抛出。
 */
function publishAccountReferenceKey(productId) {
  if (!productId) return '';
  const now = Date.now();
  const existingKey = publishAccountReferenceKeysByProductId.get(productId);
  const existing = existingKey ? publishAccountReferenceTokens.get(existingKey) : null;
  if (existing) { existing.expiresAt = now + 24 * 60 * 60 * 1000; return existingKey; }
  const referenceKey = crypto.randomUUID();
  publishAccountReferenceKeysByProductId.set(productId, referenceKey);
  publishAccountReferenceTokens.set(referenceKey, {
    productId,
    expiresAt: now + 24 * 60 * 60 * 1000,
  });
  return referenceKey;
}

/**
 * 使用浏览器提交的随机令牌取回真实商品号，并拒绝过期或伪造令牌。
 *
 * @param {*} rawReferenceKey - POST 请求中的 referenceKey。
 * @returns {string} 仅在服务端使用的真实商品号。
 * @throws {Error} 令牌格式错误、已过期或不是本账号上下文生成时抛出可读错误。
 */
function resolvePublishAccountReferenceKey(rawReferenceKey) {
  const referenceKey = publishText(rawReferenceKey, 80);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(referenceKey)) {
    throw new Error('请选择一个有效的店铺已有商品');
  }
  const record = publishAccountReferenceTokens.get(referenceKey);
  if (!record || record.expiresAt <= Date.now()) {
    publishAccountReferenceTokens.delete(referenceKey);
    throw new Error('参考商品选择已过期，请刷新列表后重新选择');
  }
  return record.productId;
}

/**
 * 从 WorkCTL 图片对象中读取可直接复用的 HTTP(S) 地址。
 *
 * 不同商品组件使用 `originalImageUrl`、`newImageUrl`、`imageUrl` 或 `imgUrl`
 * 等不同字段名。这里集中兼容这些已观察到的名称，并拒绝 blob/data/local path，
 * 防止把只能在当前浏览器或当前电脑读取的地址写进发品队列。
 *
 * @param {*} value - `list-information` 返回的单条图片记录或字符串。
 * @returns {string} 可直接用于国际站发品的远程地址；无效时返回空字符串。
 * @throws {Error} 不主动抛出异常，未知结构会被忽略。
 */
function publishLibraryImageUrl(value) {
  if (typeof value === 'string') return isRemotePublishImage(value) ? value.trim() : '';
  if (!value || typeof value !== 'object') return '';
  const candidate = value.originalImageUrl ?? value.newImageUrl ?? value.imageUrl ??
    value.imgUrl ?? value.pictureUrl ?? value.url;
  return isRemotePublishImage(candidate) ? String(candidate).trim() : '';
}

/**
 * 对图片 URL 数组去空、去重，并保持平台返回的原始顺序。
 *
 * @param {*} values - 可能包含字符串或图片对象的数组。
 * @returns {string[]} 去重后的远程图片地址。
 * @throws {Error} 不主动抛出异常，非数组输入返回空数组。
 */
function normalizePublishLibraryImageUrls(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(publishLibraryImageUrl).filter(Boolean))];
}

/**
 * 从 SKU 组件的嵌套结构中递归收集规格图。
 *
 * 规格图可能位于 `salePropDataSource[].options[].imgUrl`，也可能随接口版本嵌在
 * 其他 SKU 子对象中。只有字段路径包含 image/img/picture/photo 且值为远程 URL
 * 时才会收集，避免误把商品链接、视频地址等普通 URL 当作图片。
 *
 * @param {*} value - SKU 或 trade 组件。
 * @param {string[]} [pathParts=[]] - 当前递归字段路径。
 * @param {string[]} [output=[]] - 累积的远程图片 URL。
 * @param {number} [depth=0] - 递归深度保护。
 * @returns {string[]} 保持发现顺序的规格图地址。
 * @throws {Error} 不主动抛出异常，过深或未知结构会被忽略。
 */
function collectPublishLibrarySkuImages(value, pathParts = [], output = [], depth = 0) {
  if (depth > 10 || value === null || value === undefined) return output;
  if (typeof value === 'string') {
    const pathLabel = pathParts.join('.');
    if (/image|img|picture|photo/i.test(pathLabel) && isRemotePublishImage(value)) {
      const url = value.trim();
      if (!output.includes(url)) output.push(url);
    }
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectPublishLibrarySkuImages(item, pathParts, output, depth + 1));
    return output;
  }
  if (typeof value === 'object') {
    Object.entries(value).forEach(([key, child]) => {
      collectPublishLibrarySkuImages(child, [...pathParts, key], output, depth + 1);
    });
  }
  return output;
}

/**
 * 把 `list-information` 的三个图片组件收敛为历史图库记录。
 *
 * @param {object} row - 当前账号商品目录中的原始记录。
 * @param {*} rawData - WorkCTL 返回的商品组件数据。
 * @returns {object} 可持久化的主副图、规格图和商详图记录。
 * @throws {Error} 商品号无效时抛出，避免把无法关联的记录写进缓存。
 */
function buildPublishImageLibraryRecord(row, rawData) {
  const productId = publishAccountProductId(row);
  if (!productId) throw new Error('历史商品缺少可读取图库的商品标识');
  const data = rawData && typeof rawData === 'object' ? rawData : {};
  const model = data.agentModel && typeof data.agentModel === 'object' ? data.agentModel : data;
  const primaryItems = model?.basicInfo?.images ?? data?.basicInfo?.images ?? [];
  const detailItems = model?.detail?.detailImage ?? data?.detail?.detailImage ?? [];
  const primary = normalizePublishLibraryImageUrls(
    Array.isArray(primaryItems)
      ? [...primaryItems].sort((left, right) => Number(left?.imageIndex || 0) - Number(right?.imageIndex || 0))
      : []
  );
  const detail = normalizePublishLibraryImageUrls(
    Array.isArray(detailItems)
      ? [...detailItems].sort((left, right) => Number(left?.imageIndex || 0) - Number(right?.imageIndex || 0))
      : []
  );
  const sku = collectPublishLibrarySkuImages(model?.trade ?? data?.trade ?? [])
    .filter(url => !primary.includes(url) && !detail.includes(url));
  const fallbackThumbnail = publishLibraryImageUrl(row?.prodImage);
  if (!primary.length && fallbackThumbnail) primary.push(fallbackThumbnail);
  return {
    productId,
    title: publishText(row?.subject || row?.prodName, 128) || '当前店铺商品',
    categoryId: Number(row?.categoryId) || null,
    sourceModifiedAt: publishText(row?.gmtModified || row?.modifiedTime || row?.crtTime, 80),
    primary,
    sku,
    detail,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * 校验从磁盘读取的单条图库缓存，避免损坏文件或手工修改把本地路径带回页面。
 *
 * @param {*} record - 持久缓存中的原始记录。
 * @returns {object|null} 已清洗记录；缺少有效商品号时返回 null。
 * @throws {Error} 不主动抛出异常。
 */
function sanitizePersistedPublishImageRecord(record) {
  const productId = String(record?.productId ?? '').trim();
  if (!/^\d{6,30}$/.test(productId)) return null;
  return {
    productId,
    title: publishText(record?.title, 128) || '当前店铺商品',
    categoryId: Number.isSafeInteger(Number(record?.categoryId)) ? Number(record.categoryId) : null,
    sourceModifiedAt: publishText(record?.sourceModifiedAt, 80),
    primary: normalizePublishLibraryImageUrls(record?.primary),
    sku: normalizePublishLibraryImageUrls(record?.sku),
    detail: normalizePublishLibraryImageUrls(record?.detail),
    fetchedAt: publishText(record?.fetchedAt, 80),
  };
}

/**
 * 首次使用图库时从账号隔离的系统缓存文件恢复记录。
 *
 * @returns {Promise<void>} 恢复完成后更新 `publishImageLibraryState`。
 * @throws {Error} 文件系统异常会被内部降级为空缓存，不阻塞产品发布页。
 */
async function initializePublishImageLibrary() {
  if (publishImageLibraryState.initialized) return;
  if (publishImageLibraryInitializePromise) return publishImageLibraryInitializePromise;
  publishImageLibraryInitializePromise = (async () => {
    try {
      const parsed = JSON.parse(await fs.promises.readFile(PUBLISH_IMAGE_LIBRARY_CACHE_FILE, 'utf8'));
      if (parsed?.version === PUBLISH_IMAGE_LIBRARY_VERSION && parsed?.scope === PUBLISH_IMAGE_LIBRARY_SCOPE &&
          Array.isArray(parsed?.records)) {
        parsed.records.forEach(rawRecord => {
          const record = sanitizePersistedPublishImageRecord(rawRecord);
          if (record) publishImageLibraryState.records.set(record.productId, record);
        });
        publishImageLibraryState.loadedFromDisk = publishImageLibraryState.records.size > 0;
      }
    } catch (error) {
      // ENOENT 表示首次运行；其他损坏也只丢弃图库缓存，不能影响正常发品。
      if (error?.code !== 'ENOENT') publishImageLibraryState.lastError = '历史图库缓存已损坏，将在后台重新同步';
    }
    publishImageLibraryState.initialized = true;
  })();
  try {
    await publishImageLibraryInitializePromise;
  } finally {
    publishImageLibraryInitializePromise = null;
  }
}

/**
 * 将当前完整图库缓存原子写入账号隔离的系统缓存目录。
 *
 * 多批同步可能连续触发保存，因此通过 Promise 链串行写入；临时文件和最终文件位于
 * 同一目录，rename 不会产生“半份 JSON”供下次启动读取。
 *
 * @returns {Promise<void>} 最新快照持久化完成。
 * @throws {Error} 创建目录或写文件失败时抛出，由同步任务记录但不影响已有内存缓存。
 */
function persistPublishImageLibrary() {
  publishImageLibraryPersistPromise = publishImageLibraryPersistPromise.catch(() => {}).then(async () => {
    await fs.promises.mkdir(PUBLISH_IMAGE_LIBRARY_CACHE_DIRECTORY, { recursive: true });
    const snapshot = {
      version: PUBLISH_IMAGE_LIBRARY_VERSION,
      scope: PUBLISH_IMAGE_LIBRARY_SCOPE,
      savedAt: new Date().toISOString(),
      records: [...publishImageLibraryState.records.values()],
    };
    const temporaryFile = `${PUBLISH_IMAGE_LIBRARY_CACHE_FILE}.${process.pid}.tmp`;
    await fs.promises.writeFile(temporaryFile, JSON.stringify(snapshot), { encoding: 'utf8', mode: 0o600 });
    await fs.promises.rename(temporaryFile, PUBLISH_IMAGE_LIBRARY_CACHE_FILE);
  });
  return publishImageLibraryPersistPromise;
}

/**
 * 判断某件历史商品是否必须重新读取完整图库。
 *
 * @param {object|undefined} record - 现有缓存记录。
 * @param {object} row - 最新账号商品目录记录。
 * @param {boolean} force - 是否忽略缓存强制刷新。
 * @returns {boolean} true 表示需要调用 WorkCTL。
 * @throws {Error} 不主动抛出异常。
 */
function shouldRefreshPublishImageRecord(record, row, force) {
  if (force || !record) return true;
  if (!Number.isFinite(Date.parse(record.fetchedAt || ''))) return true;
  const latestModifiedAt = publishText(row?.gmtModified || row?.modifiedTime || row?.crtTime, 80);
  return Boolean(latestModifiedAt && record.sourceModifiedAt && latestModifiedAt !== record.sourceModifiedAt);
}

/**
 * 查询一件已发布商品的完整主副图、规格图和商详图，并写入内存缓存。
 *
 * 同一商品在后台预热和用户点击时可能同时被请求；`publishImageRecordLoadPromises`
 * 会合并这两个请求，保证单件商品同一时刻最多执行一次 WorkCTL。
 *
 * @param {object} row - 当前账号商品目录记录。
 * @param {{force?:boolean}} [options={}] - force=true 时忽略已有缓存。
 * @returns {Promise<object>} 最新图库记录。
 * @throws {Error} WorkCTL 调用失败或返回结构不可用时抛出可读错误。
 */
async function loadPublishProductImageRecord(row, options = {}) {
  const productId = publishAccountProductId(row);
  if (!productId) throw new Error('历史商品缺少可读取图库的商品标识');
  await initializePublishImageLibrary();
  const existing = publishImageLibraryState.records.get(productId);
  if (!shouldRefreshPublishImageRecord(existing, row, options.force === true)) return existing;
  if (publishImageRecordLoadPromises.has(productId)) return publishImageRecordLoadPromises.get(productId);

  const task = (async () => {
    const result = await runWorkctlWithJsonFile(
      ['icbu', 'product', 'list-information'],
      {
        productId: Number(productId),
        queryType: 'trunk',
        componentList: ['images', 'detailImage', 'sku'],
      },
      'lsou-workctl-publish-image-library-'
    );
    if (!result.ok || result.parsed?.success === false) {
      throw new Error(result.stderr || result.parseErr || '历史商品图库读取失败');
    }
    const data = parseEmbeddedWorkctlData(result.parsed?.data);
    const record = buildPublishImageLibraryRecord(row, data);
    publishImageLibraryState.records.set(productId, record);
    return record;
  })();
  publishImageRecordLoadPromises.set(productId, task);
  try {
    return await task;
  } finally {
    publishImageRecordLoadPromises.delete(productId);
  }
}

/**
 * 生成浏览器可见的图库同步状态，不返回缓存路径、账号 scope 或商品号。
 *
 * @returns {object} 同步进度、可用商品数和图片总数。
 * @throws {Error} 不主动抛出异常。
 */
function publicPublishImageLibraryStatus() {
  const imageCount = [...publishImageLibraryState.records.values()].reduce((sum, record) =>
    sum + record.primary.length + record.sku.length + record.detail.length, 0);
  const total = Number(publishImageLibraryState.totalProducts || publishImageLibraryState.records.size);
  const processed = Math.min(Number(publishImageLibraryState.processedProducts || 0), total || Infinity);
  return {
    status: publishImageLibraryState.status,
    totalProducts: total,
    processedProducts: Number.isFinite(processed) ? processed : 0,
    availableProducts: publishImageLibraryState.records.size,
    refreshedProducts: publishImageLibraryState.refreshedProducts,
    failedProducts: publishImageLibraryState.failedProducts,
    imageCount,
    progress: total ? Math.round((Number.isFinite(processed) ? processed : 0) / total * 100) : 0,
    loadedFromDisk: publishImageLibraryState.loadedFromDisk,
    startedAt: publishImageLibraryState.startedAt,
    finishedAt: publishImageLibraryState.finishedAt,
    message: publishImageLibraryState.lastError || '',
  };
}

/**
 * 将单件商品图库裁剪成前端选择器需要的结构。
 *
 * @param {object} record - 服务端缓存记录。
 * @returns {object} 不含 productId 的三类图片数组与汇总信息。
 * @throws {Error} 不主动抛出异常。
 */
function publicPublishImageRecord(record) {
  const primary = normalizePublishLibraryImageUrls(record?.primary);
  const sku = normalizePublishLibraryImageUrls(record?.sku);
  const detail = normalizePublishLibraryImageUrls(record?.detail);
  return {
    primary,
    sku,
    detail,
    total: primary.length + sku.length + detail.length,
    fetchedAt: record?.fetchedAt || null,
  };
}

/**
 * 按当前账号完整商品目录预热历史图库，并在每批结束后持久化进度。
 *
 * 首次运行会读取全部商品；以后启动先立即复用磁盘缓存，只补齐新增或已修改的记录。用户主动更新时才全量重读。失败商品不会删除旧缓存，避免网关短暂异常让用户已经可用的图片消失。
 *
 * @param {{force?:boolean}} [options={}] - force=true 时强制重读全部商品。
 * @returns {Promise<object>} 最终脱敏同步状态。
 * @throws {Error} 商品目录整体不可用时抛出，由启动器转换为 failed 状态。
 */
async function synchronizePublishImageLibrary(options = {}) {
  await initializePublishImageLibrary();
  const { rows } = await loadPublishAccountCatalog();
  const uniqueRows = [...new Map(rows.map(row => [publishAccountProductId(row), row])
    .filter(([productId]) => Boolean(productId))).values()];
  const activeProductIds = new Set(uniqueRows.map(publishAccountProductId));
  const rowsToRefresh = uniqueRows.filter(row => shouldRefreshPublishImageRecord(
    publishImageLibraryState.records.get(publishAccountProductId(row)),
    row,
    options.force === true
  ));

  publishImageLibraryState.status = 'syncing';
  publishImageLibraryState.totalProducts = uniqueRows.length;
  publishImageLibraryState.processedProducts = uniqueRows.length - rowsToRefresh.length;
  publishImageLibraryState.refreshedProducts = 0;
  publishImageLibraryState.failedProducts = 0;
  publishImageLibraryState.startedAt = new Date().toISOString();
  publishImageLibraryState.finishedAt = null;
  publishImageLibraryState.lastError = '';

  for (let index = 0; index < rowsToRefresh.length; index += PUBLISH_IMAGE_LIBRARY_CONCURRENCY) {
    const batch = rowsToRefresh.slice(index, index + PUBLISH_IMAGE_LIBRARY_CONCURRENCY);
    const results = await Promise.allSettled(batch.map(row =>
      loadPublishProductImageRecord(row, { force: options.force === true })));
    results.forEach(result => {
      publishImageLibraryState.processedProducts += 1;
      if (result.status === 'fulfilled') publishImageLibraryState.refreshedProducts += 1;
      else {
        publishImageLibraryState.failedProducts += 1;
        publishImageLibraryState.lastError = '少量历史商品暂未读取成功，已有缓存仍可继续使用';
      }
    });
    await persistPublishImageLibrary();
  }

  // 商品已经从当前店铺目录移除时，同步完成后同时移除对应旧缓存，避免图库越积越多。
  [...publishImageLibraryState.records.keys()].forEach(productId => {
    if (!activeProductIds.has(productId)) publishImageLibraryState.records.delete(productId);
  });
  await persistPublishImageLibrary();
  publishImageLibraryState.status = publishImageLibraryState.failedProducts ? 'partial' : 'ready';
  publishImageLibraryState.finishedAt = new Date().toISOString();
  pushLog({
    ts: publishImageLibraryState.finishedAt,
    label: '历史商品图库缓存',
    cmd: 'workctl icbu product list-information --query-type trunk --component-list images,detailImage,sku',
    ms: Date.parse(publishImageLibraryState.finishedAt) - Date.parse(publishImageLibraryState.startedAt),
    cached: rowsToRefresh.length === 0,
    ok: publishImageLibraryState.failedProducts === 0,
  });
  return publicPublishImageLibraryStatus();
}

/**
 * 非阻塞启动一次全店图库预热；正在运行时复用同一个 Promise。
 *
 * @param {{force?:boolean}} [options={}] - 是否强制刷新全部商品。
 * @returns {Promise<object|null>} 完成时返回状态；整体失败时返回 null 并保留错误状态。
 * @throws {Error} 不向调用方抛出，防止后台任务形成未处理 Promise。
 */
function startPublishImageLibraryWarmup(options = {}) {
  if (publishImageLibrarySyncPromise) return publishImageLibrarySyncPromise;
  publishImageLibrarySyncPromise = synchronizePublishImageLibrary(options).catch(error => {
    publishImageLibraryState.status = 'failed';
    publishImageLibraryState.finishedAt = new Date().toISOString();
    publishImageLibraryState.lastError = publishText(error?.message || error, 240) || '历史图库同步失败';
    return null;
  }).finally(() => {
    publishImageLibrarySyncPromise = null;
  });
  return publishImageLibrarySyncPromise;
}

/**
 * 按服务端参考令牌读取单件商品图库；若后台尚未轮到该商品则优先即时补齐。
 *
 * @param {string} productId - 已由短期 referenceKey 解析出的内部商品号。
 * @returns {Promise<object>} 不含商品号的公开图库结构。
 * @throws {Error} 当前账号目录中不存在该商品或 WorkCTL 查询失败时抛出。
 */
async function getPublishAccountImageLibrary(productId) {
  const catalog = await loadPublishAccountCatalog();
  const row = catalog.rows.find(item => publishAccountProductId(item) === productId);
  if (!row) throw new Error('所选参考商品已不在当前店铺商品目录中');
  const record = await loadPublishProductImageRecord(row);
  // 用户点选的商品应立即进入持久缓存，不必等待后台完整批次结束。
  await persistPublishImageLibrary();
  return publicPublishImageRecord(record);
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
  await initializePublishImageLibrary();
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
    const productId = publishAccountProductId(row);
    const imageRecord = productId ? publishImageLibraryState.records.get(productId) : null;
    return {
      title: publishText(row?.subject || row?.prodName, 128) || '当前店铺商品',
      image: publishText(row?.prodImage, 1000),
      categoryId,
      categoryName,
      categoryPath: category?.path || categoryName,
      // referenceKey 是当前 Node 进程内的短期随机令牌，不包含也不展示商品号。
      // 缺少真实商品号的经营记录不会伪装成可导入项，前端会将其禁用。
      referenceKey: publishAccountReferenceKey(productId),
      imageCount: imageRecord
        ? imageRecord.primary.length + imageRecord.sku.length + imageRecord.detail.length
        : (isRemotePublishImage(row?.prodImage) ? 1 : 0),
    };
  });
  return {
    products,
    categories: categorySummary,
    defaultCategory: categorySummary[0] || null,
    source: 'current-account-products',
    fetchedAt,
    cache: publishReadCache.status('catalog'),
    imageLibrary: publicPublishImageLibraryStatus(),
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
    const results = await Promise.all(batch.map(productId => runPublishRuleRead(
      ['icbu', 'product', 'list-information'],
      {
        productId,
        queryType: 'trunk',
        componentList: ['priceUnit', 'shippingTemplate', 'logisticsProperty'],
      }
    )));
    if (results.some(result => !result.ok || result.parsed?.success === false)) {
      throw new Error('店铺交易选项未完整读取，请重新更新店铺资料');
    }
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
 * @param {{maxAge?:number}} options 浏览时长期复用，写前限制有效期。
 * @returns {Promise<object>} 当前账号可用的发品业务选项。
 * @throws {Error} 底层 WorkCTL 查询失败时透传业务错误。
 */
async function loadPublishBusinessOptions(options = {}) {
  return publishReadCache.read('business-options', fetchPublishBusinessOptionsFromWorkctl, options);
}

/**
 * 手动失效发布资料并重读目录、类目和交易选项；其他已参考的详情与规则按需更新。
 * @returns {Promise<object>} 新的账号上下文和业务选项；图库后台更新，已有编辑内容不受影响。
 * @throws {Error} 读取失败透传，保留旧磁盘快照但不把失败当作更新成功。
 */
function refreshPublishSourceData() {
  if (publishSourceRefreshPromise) return publishSourceRefreshPromise;
  publishSourceRefreshPromise = (async () => {
    await publishReadCache.invalidate();
    const [context, options] = await Promise.all([buildPublicPublishAccountContext(500), loadPublishBusinessOptions()]);
    // 等待旧图库同步收尾，再开始用户明确要求的更新，避免强制刷新被旧任务吞掉。
    const refreshImages = () => startPublishImageLibraryWarmup({ force: true });
    if (publishImageLibrarySyncPromise) publishImageLibrarySyncPromise.finally(refreshImages).catch(() => {});
    else refreshImages();
    return { context, options };
  })().finally(() => { publishSourceRefreshPromise = null; });
  return publishSourceRefreshPromise;
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
 * 将页面多选值还原为平台的逐条属性，不拼接、不截断已选内容。
 * @param {object[]} rawAttributes 页面按字段组织的属性；attrValue 可以是字符串或多选数组。
 * @param {object|null} categorySchema 服务端已校验的当前类目规则，用于匹配每一项官方值ID。
 * @returns {object[]} basicInfo.attr；同一多选属性的各项使用相同attrNameId，各自保留值和ID。
 * @throws {Error} 单选提交多值、未知固定选项或单条超过WorkCTL的50字符限制时抛字段级错误。
 */
function normalizePublishAttributes(rawAttributes, categorySchema = null) {
  const schemaById = new Map((categorySchema?.attributes || []).map(attribute => [Number(attribute.attrNameId), attribute]));
  return (Array.isArray(rawAttributes) ? rawAttributes : []).flatMap(item => {
    const attrNameId = Number(item?.attrNameId);
    const definition = schemaById.get(attrNameId);
    const attrName = publishText(definition?.attrName || item?.attrName, 120);
    if (!Number.isSafeInteger(attrNameId) || attrNameId <= 0 || !attrName) return [];
    const rawValues = Array.isArray(item?.attrValue) ? item.attrValue : [item?.attrValue];
    const values = [...new Set(rawValues.map(value => String(value ?? '').trim()).filter(Boolean))];
    if (definition && !definition.multiSelect && values.length > 1) throw new Error(`${attrName} 只允许选择一个值`);
    return values.map(attrValue => {
      const length = [...attrValue].length;
      if (length > 50) throw new Error(`${attrName} 的单条属性值有 ${length} 个字符，最多允许 50 个，请修改该属性`);
      const option = definition?.options?.find(candidate => candidate.label === attrValue);
      if (definition?.enumProp && !definition.inputProp && attrNameId !== 1 && definition.options?.length && !option) {
        throw new Error(`${attrName} 含有非平台选项，请重新选择`);
      }
      const submittedId = Number(item?.attrValueId);
      // 当前平台数据每个多选项均为独立记录；从可信Schema回填对应ID，不能让整组选项共用一个ID。
      const attrValueId = option ? Number(option.id)
        : values.length === 1 && Number.isSafeInteger(submittedId) ? submittedId : -1;
      return { attrNameId, attrName, attrValueId, attrValue, imageUrl: null };
    });
  });
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
 * @param {object|null} categorySchema - 已通过归属/枚举校验的类目规则，入队路径必须传入。
 * @returns {{material:object, localId:string, title:string, image:string}} 清洗后的素材和页面关联字段。
 * @throws {Error} 字段缺失、类型错误或正式发布校验不通过时抛出可读错误。
 */
function normalizePublishProduct(input, action, categorySchema = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('商品数据必须是对象');
  }

  const localId = publishText(input.localId, 100);
  const title = publishText(input.title, 128);
  const categoryId = Number(input.categoryId);
  const categoryName = publishText(input.categoryName, 240);
  const images = [...new Set((Array.isArray(input.images) ? input.images : [])
    .filter(isRemotePublishImage).map(value => String(value)))];
  // 超量必须让用户选择保留哪些图片，不能默默截断后仍返回提交成功。
  if (images.length > MAX_PRODUCT_IMAGES) throw new Error(`商品主图最多 ${MAX_PRODUCT_IMAGES} 张，当前 ${images.length} 张，请先移除多余图片`);
  const keywords = [...new Set((Array.isArray(input.keywords) ? input.keywords : [])
    .map(value => publishText(value, 40)).filter(Boolean).slice(0, 5))];
  const sellingPoints = (Array.isArray(input.sellingPoints) ? input.sellingPoints : [])
    .map(value => publishText(value, 200)).slice(0, 5);
  const detail = normalizePublishDetail(input.detail);
  /** @param {object[]} rows 已校验图片。@returns {object[]} 各图集分别编号的WorkCTL输入。@throws 无。 */
  const detailImages = rows => {
    const nextIndex = new Map();
    return rows.map(image => {
      const id = image.imageSetId || '';
      const imageIndex = nextIndex.get(id) || 0;
      nextIndex.set(id, imageIndex + 1);
      return { imageIndex, newImageUrl: image.url, ...(image.text ? { imageText: image.text } : {}),
        ...(id ? { imageSetId: id } : {}) };
    });
  };
  const issues = [];

  if (!localId) issues.push('缺少本地商品标识');
  if (!title) issues.push('标题不能为空');
  if (!Number.isSafeInteger(categoryId) || categoryId <= 0) issues.push('叶子类目 ID 无效');
  if (!images.length) issues.push('至少需要 1 张已经上传的远程图片；浏览器本地图片不能直接发布');

  const attributes = normalizePublishAttributes(input.attributes, categorySchema);

  const rawTrade = input.trade && typeof input.trade === 'object' ? input.trade : {};
  const saleType = ['normal', 'batch'].includes(rawTrade.saleType) ? rawTrade.saleType : '';
  const moq = publishReferenceNumber(rawTrade.moq);
  const inventory = publishReferenceNumber(rawTrade.inventory);
  const batchNum = publishReferenceNumber(rawTrade.batchNum);
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
  const sku = normalizePublishSkus(rawTrade.sku);
  if (!sku.length) issues.push('请填写商品规格，或重新读取参考商品的规格资料');
  sku.forEach((item, index) => {
    if (!item.skuAttributes.length || item.skuAttributes.some(attr => !attr.attrName || !attr.attrValue)) {
      issues.push(`第 ${index + 1} 个规格需要填写规格名称和值`);
    }
    // 单规格可沿用表单中实际填写的总库存；多规格不能把总库存复制到每条规格。
    if (item.stock === null && sku.length === 1) item.stock = publishReferenceNumber(rawTrade.inventory);
    if (item.unitPrice === null) item.unitPrice = ladderPrices[0]?.unitPrice ?? null;
    if (item.stock !== null && (!Number.isInteger(item.stock) || item.stock < 0)) issues.push(`第 ${index + 1} 个规格库存必须为非负整数`);
    if (item.unitPrice !== null && !(item.unitPrice > 0)) issues.push(`第 ${index + 1} 个规格价格必须大于 0`);
    if (action === 'publish' && (item.stock === null || item.unitPrice === null)) issues.push(`第 ${index + 1} 个规格的价格和库存尚未填写完整`);
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
    sku,
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
      detailImage: detailImages(detail.detailImage),
      companyDesc: detail.companyDesc,
      companyImage: detailImages(detail.companyImage),
      faqs: detail.faqs.map((faq, sortOrder) => ({ ...faq, sortOrder })),
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
 * 校验浏览器上传的图片正文，防止伪造 MIME 和超大图片进入 Accio 上传接口。
 *
 * @param {*} body - POST /api/publish/images 的 JSON 请求体。
 * @returns {{filename:string,contentType:string,base64:string,size:number}} 已校验的图片参数。
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
 * 读取启动器注入的当前 Accio 本机网关连接，不接受浏览器指定上传目标。
 * 地址必须是回环 HTTP，避免把当前登录凭据发送到其他服务器；返回值仅在后端使用。
 *
 * @returns {{url:URL,authorization:string}} 固定上传路由及本机网关认证头。
 * @throws {Error} 当前会话缺失或网关地址不合法时抛出可公开的中文错误。
 */
function publishImageGateway() {
  const token = String(process.env.ACCIO_GATEWAY_TOKEN || '').trim();
  try {
    const base = new URL(process.env.ACCIO_LOCAL_GATEWAY_URL || 'http://127.0.0.1:4097');
    if (!token || base.protocol !== 'http:' || base.username || base.password ||
        !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw new Error();
    return {
      url: new URL('/api/image/cdn/upload', base),
      authorization: 'Basic ' + Buffer.from(`phoenix:${token}`).toString('base64'),
    };
  } catch {
    throw Object.assign(new Error('图片上传尚未连接 Accio Work，请登录后重新打开工作台'), { statusCode: 503 });
  }
}

/**
 * 上传到 Accio 自带 CDN，再返回可直接写入发品 material 的图片地址。
 * 凭据和图片正文仅经本机网关传输，不写临时文件、日志或浏览器响应。
 * 不自动重试或切换到其他存储，失败后由用户在页面明确重试。
 *
 * @param {*} body - 浏览器图片上传请求体。
 * @returns {Promise<{url:string,filename:string,contentType:string,size:number}>} 已上传图片的公开结果。
 * @throws {Error} 图片校验、会话、网络或平台返回异常时抛出已脱敏的中文错误。
 */
async function uploadPublishImage(body) {
  const startedAt = Date.now();
  let ok = false;
  let statusCode = 400;
  console.info(`[publish-image] ${new Date().toISOString()} start`);
  try {
    const image = normalizePublishImageUpload(body);
    const gateway = publishImageGateway();
    let response;
    let payload;
    try {
      response = await fetch(gateway.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: gateway.authorization },
        body: JSON.stringify({ data_uri: `data:${image.contentType};base64,${image.base64}` }),
        redirect: 'error', // 禁止重定向，登录凭据和图片不可被转发到其他地址。
        signal: AbortSignal.timeout(90000),
      });
      payload = await response.json().catch(() => null);
    } catch (error) {
      const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      throw Object.assign(new Error(timeout
        ? '图片上传超时，请稍后重试'
        : '无法连接 Accio 图片上传服务，请确认 Accio Work 正在运行后重试'), { statusCode: timeout ? 504 : 502 });
    }
    // 使用固定错误文案；上游错误正文可能包含会话、内部路径等信息，绝不透传。
    if (!response.ok) {
      const messages = {
        400: 'Accio 未接受这张图片，请检查图片后重新上传',
        401: 'Accio 登录会话已失效，请登录后重新打开工作台',
        403: 'Accio 图片上传未获授权，请检查当前登录状态后重新打开工作台',
        404: '当前 Accio Work 版本未提供图片上传，请更新后重试',
        405: '当前 Accio Work 版本未提供图片上传，请更新后重试',
        413: 'Accio 未接受此图片的大小或分辨率，请压缩后重试',
        429: '图片上传请求较多，请稍后重试',
        503: 'Accio 图片服务尚未就绪，请稍后重试',
      };
      throw Object.assign(new Error(messages[response.status] || 'Accio 图片上传失败，请稍后重试'), {
        statusCode: [400, 413, 429].includes(response.status) ? response.status : 502,
      });
    }
    let url;
    try { url = new URL(typeof payload?.url === 'string' ? payload.url : ''); } catch { /* 下方统一拒绝异常返回。 */ }
    if (!url || url.protocol !== 'https:' || url.username || url.password ||
        !url.hostname.includes('.') || url.hostname.endsWith('.localhost') || isIP(url.hostname.replace(/^\[|\]$/g, ''))) {
      throw Object.assign(new Error('Accio 未返回可用于发品的图片地址，请重新上传'), { statusCode: 502 });
    }
    ok = true;
    statusCode = 201;
    return { url: url.href, filename: image.filename, contentType: image.contentType, size: image.size };
  } catch (error) {
    statusCode = error.statusCode || 400;
    throw error;
  } finally {
    const ms = Date.now() - startedAt;
    pushLog({ ts: new Date().toISOString(), label: '上传发品图片', cmd: 'Accio 图片上传', ms, cached: false, ok });
    // 正式 Tauri 启动器将 stdout/stderr 收入既有 desktop.log；只记录状态与耗时。
    console.info(`[publish-image] ${new Date().toISOString()} ${ok ? 'success' : 'failed'} status=${statusCode} ms=${ms}`);
  }
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
 * 把 WorkCTL 现有商品信息中的换行文本拆成去重列表。
 *
 * @param {*} value - 字符串、字符串数组或空值。
 * @param {number} limit - 最多保留多少项。
 * @param {number} maxLength - 单项最大字符数。
 * @returns {string[]} 清理后的业务文本数组。
 * @throws {Error} 不主动抛出异常。
 */
function normalizePublishReferenceTextList(value, limit, maxLength) {
  const values = Array.isArray(value) ? value : String(value ?? '').split(/[\r\n]+/);
  return [...new Set(values.map(item => publishText(item, maxLength)).filter(Boolean))].slice(0, limit);
}

/**
 * 把任意值收敛为有限数字；缺失值返回 null，避免用 0 冒充平台参数。
 *
 * @param {*} value - WorkCTL 数字候选值。
 * @returns {number|null} 有限数字或 null。
 * @throws {Error} 不主动抛出异常。
 */
function publishReferenceNumber(value) {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * 保留可编辑的规格属性、商家编码、价格与库存，剔除旧商品的 SKU ID 等内部字段。
 * 不截断规格列表，不凭空构造颜色/型号；超大或结构异常的输入显式拒绝。
 * @param {*} value - WorkCTL 或浏览器传来的 trade.sku。
 * @returns {object[]} 具有 skuAttributes 的独立规格列表，缺失数字保持 null。
 * @throws {Error} 列表或属性形态不合法、超过合理大小时抛出业务错误。
 */
function normalizePublishSkus(value) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) throw new Error('商品规格必须是列表，最多支持 100 个规格');
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || !Array.isArray(item.skuAttributes) || item.skuAttributes.length > 20) {
      throw new Error(`第 ${index + 1} 个规格的属性格式不完整，请重新读取或填写规格资料`);
    }
    for (const field of ['stock', 'unitPrice']) {
      const raw = item[field];
      if (raw !== null && raw !== undefined && String(raw).trim() &&
          (!['number', 'string'].includes(typeof raw) || !Number.isFinite(Number(raw)))) {
        throw new Error(`第 ${index + 1} 个规格的${field === 'stock' ? '库存' : '价格'}不是有效数字`);
      }
    }
    return {
      skuAttributes: item.skuAttributes.map(attr => ({
        attrNameId: Number.isSafeInteger(attr?.attrNameId) && attr.attrNameId > 0 ? attr.attrNameId : null,
        attrName: publishText(attr?.attrName, 120),
        attrValueId: Number.isSafeInteger(attr?.attrValueId) ? attr.attrValueId : null,
        attrValue: publishText(attr?.attrValue, 160),
        imageUrl: isRemotePublishImage(attr?.imageUrl) ? String(attr.imageUrl) : null,
      })),
      skuCode: publishText(item.skuCode, 120),
      stock: publishReferenceNumber(item.stock),
      unitPrice: publishReferenceNumber(item.unitPrice),
    };
  });
}

/**
 * 将 `list-information` 的正式商品数据裁剪成复制发品所需的公开参数。
 *
 * 商品号、SKU ID、负责人和不可编辑业务字段不会进入结果；属性只保留平台字段 ID、
 * 名称和值，交易和履约只保留当前页面能够校验及提交的字段。
 *
 * @param {*} rawData - WorkCTL `list-information` 返回的 data。
 * @returns {object} 不含商品号的参考商品参数。
 * @throws {Error} 数据缺少有效叶子类目时抛出。
 */
function normalizePublishReferenceMaterial(rawData) {
  const data = rawData && typeof rawData === 'object' ? rawData : {};
  const model = data.agentModel && typeof data.agentModel === 'object' ? data.agentModel : data;
  const basicInfo = model.basicInfo && typeof model.basicInfo === 'object' ? model.basicInfo : {};
  const trade = model.trade && typeof model.trade === 'object' ? model.trade : {};
  const fulfillment = model.fulfillment && typeof model.fulfillment === 'object' ? model.fulfillment : {};
  const detail = model.detail && typeof model.detail === 'object' ? model.detail : {};
  const categoryId = Number(model.categoryId ?? data.categoryId);
  if (!Number.isSafeInteger(categoryId) || categoryId <= 0) {
    throw new Error('现有商品没有返回可复制的叶子类目');
  }

  const attributes = (Array.isArray(basicInfo.attr) ? basicInfo.attr : []).map(attribute => {
    const attrNameId = Number(attribute?.attrNameId);
    const attrValueId = Number(attribute?.attrValueId);
    return {
      attrNameId,
      attrName: publishText(attribute?.attrName, 160),
      attrValueId: Number.isSafeInteger(attrValueId) ? attrValueId : null,
      attrValue: publishText(attribute?.attrValue, 240),
    };
  }).filter(attribute => Number.isSafeInteger(attribute.attrNameId) && attribute.attrNameId > 0 && attribute.attrValue);

  const ladderPrices = (Array.isArray(trade.ladderPrices) ? trade.ladderPrices : []).map(tier => ({
    minQuantity: publishReferenceNumber(tier?.minQuantity),
    unitPrice: publishReferenceNumber(tier?.unitPrice),
  })).filter(tier => Number.isInteger(tier.minQuantity) && tier.minQuantity >= 1 && tier.unitPrice > 0);
  const ladderPeriod = (Array.isArray(fulfillment.ladderPeriod) ? fulfillment.ladderPeriod : []).map(tier => ({
    quantity: publishReferenceNumber(tier?.quantity),
    period: publishReferenceNumber(tier?.period),
  })).filter(tier => Number.isInteger(tier.quantity) && tier.quantity >= 1 && Number.isInteger(tier.period) && tier.period >= 1);

  return {
    categoryId,
    title: publishText(basicInfo.productTitle, 128),
    keywords: normalizePublishReferenceTextList(basicInfo.productKeywords, 5, 40),
    attributes,
    trade: {
      saleType: ['normal', 'batch'].includes(trade.saleType) ? trade.saleType : null,
      batchNum: publishReferenceNumber(trade.batchNum),
      moq: publishReferenceNumber(trade.moq),
      inventory: publishReferenceNumber(trade.inventory),
      priceUnit: publishReferenceNumber(trade.priceUnit),
      ladderPrices,
      sku: normalizePublishSkus(trade.sku),
    },
    fulfillment: {
      ladderPeriod,
      pkgLength: publishReferenceNumber(fulfillment.pkgLength),
      pkgWidth: publishReferenceNumber(fulfillment.pkgWidth),
      pkgHeight: publishReferenceNumber(fulfillment.pkgHeight),
      pkgWeight: publishReferenceNumber(fulfillment.pkgWeight),
      logisticsProperty: Array.isArray(fulfillment.logisticsProperty)
        ? [...new Set(fulfillment.logisticsProperty.map(value => publishText(value, 120)).filter(Boolean))]
        : [],
      shippingTemplateId: publishReferenceNumber(fulfillment.shippingTemplateId),
    },
    sellingPoints: normalizePublishReferenceTextList(detail.productSellingPoint, 5, 300),
  };
}

/**
 * 只读查询当前账号一件已发布商品的可复制参数。
 *
 * @param {string} productId - 已由服务端参考令牌解析出的真实商品号。
 * @returns {Promise<object>} 已脱敏的属性、交易和履约参数。
 * @throws {Error} WorkCTL 查询失败或返回结构无效时抛出。
 */
async function queryPublishAccountProductMaterial(productId) {
  const result = await runWorkctlWithJsonFile(
    ['icbu', 'product', 'list-information'],
    {
      productId: Number(productId),
      queryType: 'trunk',
      componentList: [
        'productTitle', 'productKeywords', 'attr', 'priceUnit', 'saleType', 'ladderPrices', 'sku',
        'moq', 'inventory', 'ladderPeriod', 'pkgWeight', 'pkgMeasure', 'logisticsProperty',
        'shippingTemplate', 'productSellingPoint',
      ],
    },
    'lsou-workctl-publish-reference-material-'
  );
  if (!result.ok || result.parsed?.success === false) {
    throw new Error(result.stderr || result.parseErr || '现有商品参数读取失败');
  }
  const material = normalizePublishReferenceMaterial(parseEmbeddedWorkctlData(result.parsed?.data));
  pushLog({
    ts: new Date().toISOString(),
    label: '读取现有商品参数',
    cmd: 'workctl icbu product list-information --query-type trunk --component-list [copy-fields]',
    ms: result.durationMs,
    cached: false,
    ok: true,
  });
  return material;
}

/**
 * 从同一商品的完整详情提取规格属性名称，只访问 SKU 销售属性，不遍历描述或推荐商品。
 * @param {*} rawData - query-product-by-id 返回的 data，可包含内嵌 JSON。
 * @param {string} productId - 本次实际查询的商品号，仅用于校验来源。
 * @returns {Array<[number,string]>} 属性 ID 与平台原始名称，不携带旧 SKU/商品编号。
 * @throws {Error} 商品来源不匹配或 SKU 数据结构无效时抛出，不将查询失败缓存为空。
 */
function readPublishSkuNames(rawData, productId) {
  const data = parseEmbeddedWorkctlData(rawData);
  const product = parseEmbeddedWorkctlData(data?.productQueryResult);
  if (String(product?.productId) !== String(productId) || !Array.isArray(product.skuList)) {
    throw new Error('参考商品规格名称读取失败，请重新读取参考商品');
  }
  const names = new Map();
  const conflicting = new Set();
  for (const sku of product.skuList) {
    for (const attr of Array.isArray(sku?.salePropertyPairList) ? sku.salePropertyPairList : []) {
      const id = Number(attr?.propertyId);
      const name = publishText(localizedTitle(attr?.propertyText), 120);
      if (!Number.isSafeInteger(id) || id <= 0 || !name || /^p-\d+$/.test(name)) continue;
      // 同一属性出现互相矛盾的名称时保留原资料，不能任取最后一条覆盖。
      if (names.has(id) && names.get(id) !== name) conflicting.add(id);
      names.set(id, name);
    }
  }
  return [...names].filter(([id]) => !conflicting.has(id));
}

/**
 * 仅为占位名称补读完整商品详情；已有参考缓存也能升级，正常名称不增加查询。
 * @param {string} productId - 服务端参考令牌对应的真实商品号。
 * @param {object} material - 已裁剪的参考商品资料，原对象及缓存不被修改。
 * @returns {Promise<object>} 名称补齐的参考资料，编码、库存、价格和空值全部原样保留。
 * @throws {Error} 必要的只读查询失败时抛出，允许用户重试。
 */
async function completePublishSkuNames(productId, material) {
  const skus = material.trade?.sku || [];
  const missingName = attr => !attr.attrName || attr.attrName === `p-${attr.attrNameId}`;
  if (!skus.some(sku => sku.skuAttributes.some(missingName))) return material;
  const entries = await publishReadCache.read(`sku-names:v1:${productId}`, async () => {
    const result = await runWorkctl(['icbu', 'product', 'query-product-by-id', '--prod-id', String(productId),
      '--format', 'json', '--compact-output', 'off'], 30000);
    let ok = false;
    try {
      if (!result.ok || result.parsed?.success === false) throw new Error('参考商品规格名称读取失败，请重试');
      const names = readPublishSkuNames(result.parsed?.data, productId);
      ok = true;
      return names;
    } finally {
      pushLog({ ts: new Date().toISOString(), label: '补齐参考商品规格名称',
        cmd: 'workctl icbu product query-product-by-id --prod-id [redacted]', ms: result.durationMs, cached: false, ok });
    }
  });
  const names = new Map(entries);
  return { ...material, trade: { ...material.trade, sku: skus.map(sku => ({ ...sku,
    skuAttributes: sku.skuAttributes.map(attr => ({ ...attr,
      attrName: missingName(attr) ? names.get(Number(attr.attrNameId)) || attr.attrName : attr.attrName,
    })),
  })) } };
}

/**
 * 按需读取并缓存可发布的结构化详情；独立版本键让旧参考缓存补齐新字段而无需全店刷新。
 * @param {string} productId 经服务端解析的参考商品号。
 * @returns {Promise<object>} 商详图、图注、公司介绍/图片和问答，不包含旧页面或组件 ID。
 * @throws {Error} 上游失败、结构缺失或不可用图片会报错，不把失败缓存成空详情。
 */
async function queryPublishProductDetail(productId) {
  return publishReadCache.read(`detail:v2:${productId}`, async () => {
    const result = await runWorkctlWithJsonFile(['icbu', 'product', 'list-information'], {
      productId: Number(productId), queryType: 'trunk',
      componentList: ['detailImage', 'companyDesc', 'companyImage', 'faqs'],
    }, 'lsou-workctl-publish-detail-');
    const data = parseEmbeddedWorkctlData(result.parsed?.data);
    const source = data?.agentModel?.detail ?? data?.detail;
    if (!result.ok || result.parsed?.success === false || !source || typeof source !== 'object' || Array.isArray(source)) {
      throw new Error('参考商品详情读取失败，请重试');
    }
    // imageIndex 会在原商品不同 imageSetId 内从 0 重排；必须沿用响应顺序，不能全局按 index 排序。
    const images = key => (source[key] || []).map(item => ({
      url: item.originalImageUrl || item.newImageUrl || item.imageUrl || '', text: item.imageText || '',
      ...(item.imageSetId != null && item.imageSetId !== '' ? { imageSetId: String(item.imageSetId) } : {}),
    }));
    const detail = normalizePublishDetail({
      detailImage: images('detailImage'), companyImage: images('companyImage'),
      companyDesc: source.companyDesc || '',
      faqs: [...(source.faqs || [])].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
        .map(item => ({ question: item.question || '', answer: item.answer || '' })),
    });
    pushLog({ ts: new Date().toISOString(), label: '读取参考商品详情', cmd: 'workctl icbu product list-information --query-type trunk --component-list [detail-fields]',
      ms: result.durationMs, cached: false, ok: true });
    return detail;
  }).catch(error => {
    pushLog({ ts: new Date().toISOString(), label: '参考商品详情读取失败', cmd: 'publish detail read', ms: 0, cached: false, ok: false });
    throw error;
  });
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
  add('sku', ['sku', '规格']);
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
  // 本地 JSON 校验的具体原因在 details 中；顶层 message 只有“校验未通过”。
  const validationErrors = data?.status === 'pending_fix' && Array.isArray(data.details)
    ? data.details.map(detail => publishText(detail?.error, 240)).filter(Boolean) : [];
  const errorValue = validationErrors.length ? validationErrors.join('；')
    : findPublishResponseField(item, new Set(['error', 'errorMsg', 'message', 'next_step']));
  const errorMessage = publishText(
    typeof errorValue === 'object'
      ? errorValue?.message || errorValue?.errorMsg || errorValue?.reason || JSON.stringify(errorValue)
      : errorValue,
    600
  );
  const ok = Boolean(envelope.ok && itemSuccess !== false && productId !== null && productId !== undefined && productId !== '');
  const finalScoreValue = publishReferenceNumber(findPublishResponseField(item, new Set(['finalScore', 'qualityScore', 'score'])));
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
 * 恢复当前账号已完成的发布回执；未完成任务一律不加载，避免重启触发重复发品。
 * @returns {Promise<void>} 回执已进入历史列表；损坏文件记录错误，不触发任何平台调用。
 * @throws {Error} 文件异常内部记录，保留服务可用性。
 */
async function restorePublishHistory() {
  if (!publishHistoryReady) publishHistoryReady = (async () => {
    if (!PUBLISH_HISTORY_FILE) return;
    try {
      const saved = JSON.parse(await fs.promises.readFile(PUBLISH_HISTORY_FILE, 'utf8'));
      if (saved.version !== 1 || !Array.isArray(saved.jobs)) throw new Error('历史格式不正确');
      for (const record of saved.jobs.slice(-MAX_PUBLISH_JOBS)) {
        if (!record || typeof record.id !== 'string' || !['saved_draft', 'submitted', 'failed'].includes(record.status)) continue;
        if (publishJobs.some(job => job.id === record.id)) continue;
        const job = publicPublishJob(record);
        // 仅恢复回执，没有 material 的失败任务不能再次入队。
        job.retryable = false;
        job.canFixAndRetry = false;
        publishJobs.push(job);
      }
      pushLog({ ts: new Date().toISOString(), label: '恢复发布历史', cmd: 'local publish history', ok: true, cached: true, ms: 0 });
    } catch (error) {
      if (error.code !== 'ENOENT') pushLog({ ts: new Date().toISOString(), label: '恢复发布历史失败', cmd: 'local publish history', ok: false, err: '历史文件不可读取', ms: 0 });
    }
  })();
  await publishHistoryReady;
}

/**
 * 串行原子保存本账号终态回执；不保存商品素材、短期引用或凭据。
 * @returns {Promise<void>} 保存完成；失败记录日志并保留内存历史。
 * @throws {Error} 文件错误内部处理，不改变已经得到的平台结果。
 */
async function persistPublishHistory() {
  if (!PUBLISH_HISTORY_FILE) return;
  publishHistoryWriting = publishHistoryWriting.then(async () => {
    const temporary = `${PUBLISH_HISTORY_FILE}.${crypto.randomUUID()}.tmp`;
    try {
      const jobs = publishJobs.filter(job => ['saved_draft', 'submitted', 'failed'].includes(job.status)).slice(-MAX_PUBLISH_JOBS).map(publicPublishJob);
      await fs.promises.mkdir(path.dirname(PUBLISH_HISTORY_FILE), { recursive: true });
      await fs.promises.writeFile(temporary, JSON.stringify({ version: 1, jobs }), { mode: 0o600 });
      await fs.promises.rename(temporary, PUBLISH_HISTORY_FILE);
    } catch {
      pushLog({ ts: new Date().toISOString(), label: '保存发布历史失败', cmd: 'local publish history', ok: false, err: '历史暂存于当前进程', ms: 0 });
    } finally { await fs.promises.unlink(temporary).catch(() => {}); }
  });
  await publishHistoryWriting;
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
      await persistPublishHistory();
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
 * @returns {Promise<object>} 校验通过后返回本次使用的类目规则，供最终JSON逐项匹配官方ID。
 * @throws {Error} 类目不属于当前账号、必填缺失或枚举值不是官方选项时抛出。
 */
async function validatePublishProductSchema(product, action) {
  const categoryId = Number(product?.categoryId);
  const [schema, categories] = await Promise.all([
    loadPublishCategorySchema(categoryId, { maxAge: PUBLISH_SCHEMA_CACHE_TTL }),
    loadPublishCategories({ maxAge: PUBLISH_SCHEMA_CACHE_TTL }),
  ]);
  if (!categories.some(category => category.id === categoryId)) throw new Error('所选类目已不在当前账号可用类目中，请更新店铺资料');
  const inputAttributes = Array.isArray(product?.attributes) ? product.attributes : [];
  const submittedById = new Map(inputAttributes.map(attribute => [Number(attribute?.attrNameId), attribute]));
  const issues = [];

  schema.attributes.forEach(attribute => {
    const submitted = submittedById.get(attribute.attrNameId);
    const values = (Array.isArray(submitted?.attrValue) ? submitted.attrValue : [submitted?.attrValue])
      .map(value => String(value ?? '').trim())
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
      // 页面按数组保留多选；校验每个值后，normalizePublishAttributes逐条输出并回填官方ID。
      // 不再拼接分号，避免把多项合成一个超过平台单值长度限制的字符串。
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
  return schema;
}

/**
 * 校验写操作请求的确认、幂等键和批量规模，并创建串行任务。
 *
 * @param {*} body - POST /api/publish/enqueue 的 JSON 请求体。
 * @returns {Promise<{jobs:object[],deduplicated:boolean}>} 新建或幂等复用的任务列表。
 * @throws {Error} 确认缺失、参数无效或商品校验失败时抛出可读错误。
 */
async function enqueuePublishJobs(body) {
  await restorePublishHistory();
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
  const businessOptions = await loadPublishBusinessOptions({ maxAge: PUBLISH_SCHEMA_CACHE_TTL });
  const resolvedProducts = products.map(product => applyPublishBusinessOptions(product, businessOptions));
  const schemas = await Promise.all(resolvedProducts.map(product => validatePublishProductSchema(product, action)));
  const normalized = resolvedProducts.map((product, index) => normalizePublishProduct(product, action, schemas[index]));
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

/**
 * 读写当前账号最近成功的关键词画像；文件仅保存脱敏数据，空画像也可以保存。
 * @param {object|null} value 有值时保存，无值时读取。
 * @returns {object|null} 已保存画像；账号未知、文件损坏或写入失败返回 null。
 * @throws {Error} 不向调用方抛错，存储异常只记录状态，不记录经营正文。
 */
function keywordProfileSnapshot(value = null) {
  const scope = process.env.ACCIO_ACTIVE_SPACE;
  if (!scope) return null;
  const hash = crypto.createHash('sha256').update(scope).digest('hex').slice(0, 16);
  const file = path.join(process.env.KEYWORD_PROFILE_STATE_DIR || path.join(os.homedir(), 'Library', 'Application Support', 'com.lsou.workctl-dashboard'), `keyword-profile-${hash}.json`);
  try {
    if (value) {
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      const temporary = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
      fs.renameSync(temporary, file);
      console.log('[keyword-profile] 已保存当前账号画像快照');
      return value;
    }
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    return saved?.data?.profileComplete && Number.isFinite(Date.parse(saved.fetchedAt)) ? saved : null;
  } catch (error) {
    if (error.code !== 'ENOENT') console.log('[keyword-profile] 快照读写失败');
    return null;
  }
}

async function callEndpoint(name, query) {
  const ep = ENDPOINTS[name];
  if (!ep) return { ok: false, error: `unknown endpoint: ${name}` };

  try { TimePolicy.validate(name, query, ep.flags); }
  catch(error) {
    pushLog({ts:new Date().toISOString(),label:ep.label,cmd:name,ms:0,ok:false,err:error.message});
    return {ok:false,error:error.message,status:400};
  }
  const args = buildArgs(ep, query);
  const cmdText = ['workctl', ...args].join(' ');
  const key = cmdText;

  const hit = cache.get(key);
  if (hit && query.__nocache !== '1') {
    pushLog({ ts: new Date().toISOString(), label: ep.label, cmd: cmdText,
              ms: 0, cached: true, ok: hit.res.ok });
    return { ...hit.res, cached: true, command: cmdText };
  }

  const queryGeneration=endpointQueries.generation;
  return endpointQueries.read(key, async () => {
  const r = await runWorkctl(args, name === 'ads-shop-profile' ? 25000 : 120000);
  pushLog({ ts: new Date().toISOString(), label: ep.label, cmd: cmdText,
            ms: r.durationMs, cached: false, ok: r.ok,
            err: r.ok ? null : (r.stderr || r.parseErr || `exit ${r.exitCode}`) });

  const res = r.ok
    ? { ok: true, data: shapeEndpointData(name, r.parsed.data), meta: r.parsed.meta || null,
        durationMs: r.durationMs, warnings: r.warnings, fetchedAt: new Date().toISOString() }
    : { ok: false, error: r.stderr || r.parseErr || `exit code ${r.exitCode}`,
        durationMs: r.durationMs };

  if (name === 'ads-shop-profile') {
    if (res.ok && res.data.profileComplete) keywordProfileSnapshot(res);
    else {
      const saved = keywordProfileSnapshot();
      if (saved) return { ...saved, stale: true, cached: true, refreshError: '实时画像暂不可用，保留本账号最近快照', command: cmdText };
      return { ok: false, error: '店铺画像未返回完整数据，且暂无本账号成功快照', durationMs: r.durationMs };
    }
  }
  if (r.ok && queryGeneration===endpointQueries.generation) cache.set(key, { at: Date.now(), res });
  return { ...res, cached: false, command: cmdText };
  }, {force:query.__nocache === '1',limited:name === 'shop-product'});
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
async function getProductAnalysis(query = {}) {
  try {
    TimePolicy.validate('shop-product',query,['statDate','statisticsType']);
    if(!query.statDate || !['day','month'].includes(query.statisticsType))throw new Error('商品分析请选择自然日或自然月');
  } catch(error) {return {ok:false,error:error.message,status:400};}
  const baseQuery = { pageSize: '20', orderBy: 'views', orderModel: 'DESC',statDate:query.statDate,statisticsType:query.statisticsType };
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
    productRef: operations.registerProduct(row),
    // 分析缓存需要跨刷新识别同一商品；这个账号内摘要不能用于编辑或还原商品号。
    analysisRef: crypto.createHash('sha256').update(JSON.stringify([PUBLISH_IMAGE_LIBRARY_SCOPE,String(row.productId||row.prodId||row.id)])).digest('hex').slice(0,32),
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

  // 未取得当前账号质量诊断时保留缺项，不能读取开发账号的随包快照。
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
        lowScoreQueryRows: null,
        zeroEffectRows: null,
        qualitySource: 'unavailable',
      },
      focusProducts: {
        highExposureHighCtr: quadrants.highExposureHighCtr.slice()
          .sort((a, b) => Number(b.sumProdClickNum || 0) - Number(a.sumProdClickNum || 0))
          .map(summarizeProduct),
        highExposureLowCtr: quadrants.highExposureLowCtr.slice().sort(byExposure).map(summarizeProduct),
        lowExposureHighCtr: quadrants.lowExposureHighCtr.slice().sort((a, b) => Number(b.sumProdClickRate || 0) - Number(a.sumProdClickRate || 0)).map(summarizeProduct),
        lowExposureLowCtr: quadrants.lowExposureLowCtr.slice().sort(byExposure).map(summarizeProduct),
        clickedNoInquiry: rows.filter(row => Number(row.sumProdClickNum || 0) > 0 && Number(row.sumProdFbNum || 0) === 0)
          .sort((a, b) => Number(b.sumProdClickNum || 0) - Number(a.sumProdClickNum || 0)).map(summarizeProduct),
      },
      lowScoreSample: [],
    },
  };
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
               '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
               '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.webp': 'image/webp',
               '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };

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

// 五条业务扩展链路独立维护参数合同与任务记录，复用当前账号的 WorkCTL 进程环境。
const operations = createOperations({ runWorkctl, callEndpoint, pushLog });
const advertising = createAdvertising({ runWorkctl, pushLog });
const capabilities = createCapabilities({ accountContext:advertising.accountContext, runWorkctl, pushLog, callEndpoint, shapeRfq: shapeInternalRfq, operationSources: operations.referenceSources, loadWorkspace: name => name === 'access-contacts' ? loadAccessContactsWorkspace() : loadAccountWorkspace(name) });
/**
 * 从同一批原始记录计算六项行业对标；不让模型自行拼口径或把缺失值补零。
 * @param {object} snapshot 含 trend 的经营快照。@returns {Array<object>} 数值、展示值与对标状态。
 * @throws 无；缺失/非法/不完整序列返回 null 并注明覆盖记录数。
 */
function buildOverviewBenchmarks(snapshot) {
  const rows = Array.isArray(snapshot.trend) ? snapshot.trend : [];
  const definitions = [
    ['totalImpsCnt','曝光量','sum','number'], ['totalClkCnt','点击量','sum','number'],
    ['fbCnt','询盘数','sum','number'], ['sucOrdCnt','成交订单','sum','number'],
    ['fstReplyRate30d','首次回复率','latest','percent'], ['avgReplyTime30d','平均回复时长','latest','hours'],
  ];
  const numeric = value => value !== null && value !== undefined && String(value).trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
  return definitions.map(([key,label,aggregation,unit]) => {
    const selected = aggregation === 'latest' ? rows.slice(-1) : rows;
    const aggregate = suffix => {
      const values = selected.map(row => numeric(row[key + suffix]));
      return values.length && values.every(value => value !== null) ? values.reduce((sum,value) => sum + value,0) : null;
    };
    const current = aggregate(''), average = aggregate('RivalAvg'), excellent = aggregate('RivalGood');
    const format = value => value === null ? '未提供' : unit === 'percent' ? `${(value*100).toFixed(2)}%` : unit === 'hours' ? `${value.toFixed(2)}h` : value.toLocaleString('zh-CN',{maximumFractionDigits:2});
    const compare = reference => {
      if (current === null || reference === null) return {state:'unknown',text:'缺少可比数据'};
      const delta = current - reference;
      const state = delta === 0 ? 'equal' : (unit === 'hours' ? delta < 0 : delta > 0) ? 'better' : 'behind';
      const distance = unit === 'percent' ? `${Math.abs(delta*100).toFixed(2)}个百分点` : unit === 'hours' ? `${Math.abs(delta).toFixed(2)}h` : reference === 0 ? `${Math.abs(delta).toLocaleString('zh-CN')}` : `${(Math.abs(delta/reference)*100).toFixed(1)}%`;
      return {state,delta,text:delta === 0 ? '持平' : `${delta < 0 ? '低' : '高'} ${distance}`};
    };
    return {key,label,aggregation,unit,direction:unit === 'hours' ? 'lower_better' : 'higher_better',
      current,average,excellent,display:{current:format(current),average:format(average),excellent:format(excellent)},
      vs_average:compare(average),vs_excellent:compare(excellent),period:snapshot.period,
      coverage:{received_days:rows.length,compared_records:selected.length},source:'shop-summary；平台同行参考，具体行业/类目范围未返回'};
  });
}

/**
 * 只在确实需要生成时补充经营事实，避免刷新缓存时重复拉取数据。
 * 参考 SOP 的产品定位/定品、流量复盘和店铺诊断：保留明细字段、样本范围与缺项，
 * 不把排行样本当全店、不引入历史 Demo 诊断，也不向模型传商品内部 ID 或图片 URL。
 * @param {object} snapshot 浏览器总览快照。@returns {Promise<object>} 有来源的精简明细。
 * @throws {Error} 不向外抛出单项查询异常，缺项以 unavailable 标记。
 */
async function enrichOverviewTaskSnapshot(snapshot) {
  const period = snapshot.period || {};
  const [products, channels] = await Promise.all([
    callEndpoint('shop-product', {pageNo:'1', pageSize:'20', orderBy:'views', orderModel:'DESC'}).catch(() => null),
    callEndpoint('shop-flow', {...period, terminalType:'TOTAL'}).catch(() => null),
  ]);
  const productFields = ['subject', 'prodLevel3', 'sumProdShowNum', 'sumProdClickNum', 'sumProdClickRate', 'sumProdVisitorCnt', 'sumProdFbNum', 'atmFbUv', 'crtOrd'];
  const channelFields = ['statDate', 'statisticsType', 'sourceType', 'subSourceType', 'uv', 'abRate', 'cateTopAbRate', 'cateTopUvDetail'];
  // 白名单拣选；缺失字段不补 0，文本长度限制防止单条标题挤占输入预算。
  const pick = (row, fields) => Object.fromEntries(fields.filter(key => row?.[key] != null)
    .map(key => [key, typeof row[key] === 'string' ? row[key].slice(0, 180) : row[key]]));
  const productRows = Array.isArray(products?.data?.data) ? products.data.data : [];
  const channelRows = Array.isArray(channels?.data) ? channels.data : [];
  const result = {...snapshot, benchmark_comparisons:buildOverviewBenchmarks(snapshot), operational_evidence: {
    products: {source:'shop-product', status: products?.ok ? 'available' : 'unavailable',
      scope:'搜索曝光排序前20个商品样本，并非全店；接口默认统计周期，不与总览周期合并',
      record_count:products?.data?.recordCount ?? null, rows:productRows.slice(0,20).map(row => pick(row, productFields))},
    channels: {source:'shop-flow', status:channels?.ok ? 'available' : 'unavailable', period,
      scope:'渠道原始记录，最多120条；逐条保留statisticsType。30d是滚动30天口径，不能将相邻日期记录相加当作区间访客；访客与商机率口径独立，不据此推断曝光下降归因',
      record_count:channelRows.length, truncated:channelRows.length > 120, rows:channelRows.slice(0,120).map(row => pick(row,channelFields))},
    unavailable:['商品主图与详情内容','广告计划花费和关键词转化明细','客户询盘正文与跟进状态'],
  }};
  // Dify 的 business_context 限制 50000 字符；优先保留原始总览和商品样本。
  while (JSON.stringify(result).length > 48000 && result.operational_evidence.channels.rows.length) result.operational_evidence.channels.rows.pop();
  result.operational_evidence.channels.truncated = result.operational_evidence.channels.rows.length < channelRows.length;
  console.log(`[overview-todo] 补充事实：商品 ${result.operational_evidence.products.rows.length} 条，渠道 ${result.operational_evidence.channels.rows.length} 条`);
  return result;
}
/**
 * 调用用户配置的 Dify Workflow 并校验待办结构。
 * @param {object} snapshot 总览快照，不含凭据。
 * @returns {Promise<object>} 仅返回校验后的 tasks。
 * @throws {Error} 配置、上游执行或输出结构异常时抛出安全提示。
 */
async function generateOverviewTasks(snapshot) {
  const configPath = path.join(__dirname, '.env.dify');
  const local = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
  const key = process.env.DIFY_API_KEY || local.match(/^DIFY_API_KEY=(.+)$/m)?.[1]?.trim();
  if (!key) throw new Error('尚未配置运营诊断服务');
  if (!snapshot || snapshot.module !== 'overview' || !Array.isArray(snapshot.metrics) || !snapshot.metrics.length) throw new Error('请先加载经营总览数据');
  console.log('[overview-todo] 开始生成');
  const response = await fetch('https://api.dify.ai/v1/workflows/run', {
    method: 'POST', headers: {'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({inputs: {business_context: JSON.stringify(snapshot)}, response_mode: 'streaming', user: 'lsou-local-overview'}),
    signal: AbortSignal.timeout(360000),
  });
  if (!response.ok) throw new Error(`诊断服务请求失败（HTTP ${response.status}），请检查应用发布状态及模型配置`);
  const payload = await readOverviewWorkflowResponse(response);
  if (payload.data?.status !== 'succeeded') throw new Error('Workflow 未成功完成，请检查 Dify 运行记录');
  const result = validateOverviewTaskOutputs(payload.data.outputs);
  validateOverviewDiagnosisClaims(result.tasks);
  return result;
}

/**
 * 消费 Dify SSE，避免 blocking 请求在网关等待完整推理时触发 504。
 * 只读取 workflow_finished 的最终输出，不保存或展示模型推理与中间节点文本。
 * @param {Response} response 上游响应。@returns {Promise<object>} 与 blocking 相同的 data 对象。
 * @throws {Error} 流中断、事件异常、输出过大或缺少完成事件时抛出；不会自动重发付费请求。
 */
async function readOverviewWorkflowResponse(response) {
  if (!response.headers?.get('content-type')?.includes('text/event-stream')) return response.json();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const {value, done} = await reader.read();
      buffer += decoder.decode(value, {stream: !done});
      if (buffer.length > 2 * 1024 * 1024) throw new Error('诊断输出超过限制');
      // 先按完整事件拆分，保留跨网络分片的行和 UTF-8 字符。
      let boundary;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const block = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data || data === '[DONE]') continue;
        let event;
        try { event = JSON.parse(data); } catch { throw new Error('诊断服务返回了无效事件'); }
        if (event.event === 'error') throw new Error('Workflow 执行失败，请检查 Dify 运行记录');
        if (event.event === 'workflow_finished') return {data:event.data};
      }
      if (done) throw new Error('待办连接已中断，旧结果已保留；请先检查 Dify 运行记录');
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/**
 * 校验结构化结果；有备用最终文本时优先校验该 JSON，防止结构化提取把有效任务误判为空。
 * @param {object} outputs Workflow 的 result 与可选 raw_result。@returns {object} 过滤后的 tasks。
 * @throws {Error} JSON 或任务字段不满足契约时抛出，绝不把格式异常保存为空待办。
 */
function validateOverviewTaskOutputs(outputs) {
  let result = outputs?.result ?? outputs;
  if (typeof outputs?.raw_result === 'string' && outputs.raw_result.trim()) {
    // 老版本节点可能夹带 think 标签，只允许闭合标签之后的最终回答参与 JSON 校验。
    result = outputs.raw_result.split('</think>').pop().trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  }
  if (typeof result === 'string') { try { result = JSON.parse(result); } catch { throw new Error('诊断输出不是有效 JSON'); } }
  // 部分模型将最终对象多包在单项tasks中；仅展开明确的一层，仍逐字段校验。
  if (Array.isArray(result?.tasks) && result.tasks.length === 1 && Array.isArray(result.tasks[0]?.tasks)) result = {tasks:result.tasks[0].tasks};
  if (!Array.isArray(result?.tasks) || result.tasks.length > 5) throw new Error('诊断输出不符合约定');
  // 严格检查显示字段；拒绝异常结果，避免把格式错误当成没有待办。
  const tasks = result.tasks.map(task => {
    if (!task || !['high','normal','low'].includes(task.priority) ||
        typeof task.title !== 'string' || !task.title.trim() || task.title.length > 80 ||
        typeof task.basis !== 'string' || !task.basis.trim() || task.basis.length > 500 ||
        !Array.isArray(task.steps) || !task.steps.length || task.steps.length > 5 ||
        !Array.isArray(task.acceptance_criteria) || !task.acceptance_criteria.length || task.acceptance_criteria.length > 3 ||
        [...task.steps, ...task.acceptance_criteria].some(value => typeof value !== 'string' || !value.trim() || value.length > 200)) throw new Error('诊断字段不符合约定，请重新生成');
    return {title: task.title, priority: task.priority, basis: task.basis, steps: task.steps, acceptance_criteria: task.acceptance_criteria};
  });
  console.log(`[overview-todo] 生成完成：${tasks.length}条`);
  return {tasks};
}

/**
 * 拦截实跑发现的两类无依据推断，避免把结构合法但明显越界的诊断自动保存。
 * 这只是确定性错误校验，不声称能代替完整的业务语义审核。
 * @param {Array<object>} tasks 已通过结构校验的诊断。@returns {void}。@throws 已知越界推断时保留旧结果。
 */
function validateOverviewDiagnosisClaims(tasks) {
  const invalid = tasks.some(task => {
    const text = [task.title,task.basis,...task.steps,...task.acceptance_criteria].join('\n');
    return /(?:曝光.{0,4}点击|点击.{0,4}曝光).{0,8}(?:折算|相除|计算点击率)/.test(text)
      || /(?:即|就|即可|足以)(?:证明|证实)(?:因果|原因)/.test(text)
      || /(?:提升|上涨|回升).{0,8}(?:说明|证明).{0,15}假设成立/.test(text);
  });
  if (invalid) throw new Error('诊断包含未获数据支持的比率或因果推断，已保留原结果，请核查模型输出');
}

// 保存的是用户待办，而非五分钟查询缓存；刷新经营数据或清缓存不删除此文件。
const OVERVIEW_TODO_FILE = path.join(
  process.env.OVERVIEW_TODO_STATE_DIR || path.join(os.homedir(), 'Library', 'Application Support', 'com.lsou.workctl-dashboard'),
  `overview-todo-${PUBLISH_IMAGE_LIBRARY_SCOPE}.json`
);
let overviewTodoState;
let overviewTodoPending = null;

/** 获取北京时间自然日。@param {string|number} value 时间。@returns {string} 日期。@throws 无效时间时抛出 RangeError。 */
function overviewTodoDay(value = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(value));
}

/** 恢复当前账号待办。@returns {object} 最近结果及尝试日期。@throws 文件损坏或无法读取时停止自动生成，避免意外重复计费。 */
function readOverviewTodoState() {
  if (overviewTodoState) return overviewTodoState;
  try {
    const saved = JSON.parse(fs.readFileSync(OVERVIEW_TODO_FILE, 'utf8'));
    if (saved.version !== 1 || (saved.result && (!Array.isArray(saved.result.tasks) || !Number.isFinite(Date.parse(saved.result.generatedAt))))) throw new Error('invalid state');
    overviewTodoState = saved;
    console.log('[overview-todo] 已恢复本地待办');
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('已保存诊断无法读取，请检查本地存储后重试');
    overviewTodoState = {version: 1, result: null, lastAttemptDay: null};
  }
  return overviewTodoState;
}

/** 原子保存待办状态，不记录输入正文或凭据。@param {object} state 状态。@returns {void} 无返回值。@throws 落盘失败时抛出安全提示。 */
function saveOverviewTodoState(state) {
  try {
    fs.mkdirSync(path.dirname(OVERVIEW_TODO_FILE), {recursive: true, mode: 0o700});
    const temporary = `${OVERVIEW_TODO_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(state), {mode: 0o600});
    fs.renameSync(temporary, OVERVIEW_TODO_FILE);
    overviewTodoState = state;
  } catch {
    console.log('[overview-todo] 本地保存失败');
    throw new Error('待办保存失败，请检查本地存储权限');
  }
}

/** 读取展示信息，不调用模型。@returns {object} 结果、周期及自动更新标记。@throws 本地读取异常。 */
function overviewTodoStatus() {
  const state = readOverviewTodoState();
  const today = overviewTodoDay();
  const fresh = !!state.result && overviewTodoDay(state.result.generatedAt) === today;
  return {result: state.result, stale: !fresh, generating: !!overviewTodoPending,
    shouldGenerate: !fresh && state.lastAttemptDay !== today,
    notice: state.status === 'failed' ? '上次更新失败，点击“更新诊断”重试。'
      : state.status === 'running' && !overviewTodoPending ? '上次更新中断，点击“更新诊断”重试。' : ''};
}

/**
 * 每账号每天最多自动尝试一次，手动更新可绕过日期；并发请求复用同一 Promise。
 * 先保存尝试日期再调用模型，进程重启或生成失败都不会因刷新页面重复花费。
 * @param {object} snapshot 当前经营快照。@param {boolean} force 是否为用户手动更新。
 * @returns {Promise<object>} 已保存结果与元数据。@throws 生成或保存失败，旧结果保留。
 */
async function getOrGenerateOverviewTasks(snapshot, force = false) {
  if (overviewTodoPending) return overviewTodoPending;
  const status = overviewTodoStatus();
  if (!force && !status.shouldGenerate) return status;
  if (!snapshot || snapshot.module !== 'overview' || !Array.isArray(snapshot.metrics) || !snapshot.metrics.length) throw new Error('请先加载经营总览数据');
  saveOverviewTodoState({...readOverviewTodoState(), lastAttemptDay: overviewTodoDay(), status: 'running'});
  overviewTodoPending = (async () => {
    try {
      const enriched = await enrichOverviewTaskSnapshot(snapshot);
      const generated = await generateOverviewTasks(enriched);
      const result = {...generated, diagnosisVersion:2, benchmarks:enriched.benchmark_comparisons};
      const next = {...readOverviewTodoState(), status: 'saved', result: {...result, generatedAt: new Date().toISOString(), period: snapshot.period || null}};
      // 即使磁盘写入失败，也先留住本进程已付费取得的结果。
      overviewTodoState = next;
      saveOverviewTodoState(next);
      console.log('[overview-todo] 待办已保存');
    } catch (error) {
      saveOverviewTodoState({...readOverviewTodoState(), status: 'failed'});
      throw error;
    } finally {
      overviewTodoPending = null;
    }
    return overviewTodoStatus();
  })();
  return overviewTodoPending;
}

const aiAdvisor = createAiAdvisor({root:__dirname,scope:PUBLISH_IMAGE_LIBRARY_SCOPE});
const awHandoff = createAwHandoff({scope:PUBLISH_IMAGE_LIBRARY_SCOPE});
const planningTasks = require('./lib/planning-tasks').createPlanningTasks({scope:PUBLISH_IMAGE_LIBRARY_SCOPE});
// 所有报告共用账号隔离回传，只读引用人工任务；与平台业务写队列无关。
const analysisRuns = require('./lib/analysis-runs').createAnalysisRuns({scope:PUBLISH_IMAGE_LIBRARY_SCOPE,taskContext:()=>planningTasks.list().tasks});
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const p = url.pathname;

  try {
    // 桌面首次导航交换会话 cookie，后续请求不携带 URL 凭据，也不接受外站访问。
    if (DESKTOP_TOKEN) {
      if (req.headers.host !== `${HOST}:${PORT}`) return sendJSON(res, 403, { ok: false, error: '请求来源不匹配' });
      if (p === '/' && url.searchParams.get('desktopTicket') === DESKTOP_TOKEN) {
        res.writeHead(302, { 'Location': '/', 'Set-Cookie': `lsou_session=${DESKTOP_TOKEN}; HttpOnly; SameSite=Lax; Path=/`, 'Cache-Control': 'no-store' });
        return res.end();
      }
      const authenticated = String(req.headers.cookie || '').split(';').some(part => part.trim() === `lsou_session=${DESKTOP_TOKEN}`);
      if (!authenticated || !isAllowedPublishOrigin(req) || (p.startsWith('/api/') && req.headers['sec-fetch-site'] === 'cross-site')) return sendJSON(res, 403, { ok: false, error: '请通过来搜桌面窗口访问' });
    }
    // 六页共用AI服务。Key仅在后端读取；所有问答都绑定已经登记的当前账号快照。
    if(p.startsWith('/api/advisor/')) {
      if(!isAllowedPublishOrigin(req))return sendJSON(res,403,{ok:false,error:'请求来源不匹配'});
      if(p==='/api/advisor/config'&&req.method==='GET')return sendJSON(res,200,{ok:true,...aiAdvisor.status()});
      if(req.method!=='POST')return sendJSON(res,405,{ok:false,error:'仅支持POST'});
      if(!String(req.headers['content-type']||'').startsWith('application/json'))return sendJSON(res,415,{ok:false,error:'请使用JSON请求'});
      try {
        const input=await readJsonBody(req,2*1024*1024);
        if(p==='/api/advisor/tasks')return sendJSON(res,200,{ok:true,data:input.op==='generate'?await planningTasks.generate(input):input.op==='list'?planningTasks.list():planningTasks.update(input)});
        if(p==='/api/advisor/reports') {
          const result=input.op==='generate'?await analysisRuns.generate(input):input.op==='list'?analysisRuns.list():input.op==='read'?analysisRuns.read(input.id):input.op==='cancel'?analysisRuns.cancel(input.id):null;
          if(!result)throw new Error('未知报告操作');
          return sendJSON(res,200,{ok:true,data:result});
        }
        if(p==='/api/advisor/aw-handoff')return sendJSON(res,200,{ok:true,...await awHandoff.send(input)});
        if(p==='/api/advisor/cache')return sendJSON(res,200,{ok:true,...aiAdvisor.cached(input)});
        if(p==='/api/advisor/context')return sendJSON(res,200,{ok:true,...aiAdvisor.context(input)});
        if(p==='/api/advisor/analysis')return sendJSON(res,200,{ok:true,result:await aiAdvisor.analyze(input.snapshot_id,input.refresh===true)});
        if(p==='/api/advisor/chat') {
          aiAdvisor.getSnapshot(input.snapshot_id);
          if(!aiAdvisor.status().chatConfigured)return sendJSON(res,503,{ok:false,error:'页面问答暂未启用。'});
          res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});
          const controller=new AbortController();res.on('close',()=>controller.abort());
          const heartbeat=setInterval(()=>{if(!res.destroyed)res.write(': keepalive\n\n');},15000);
          const emit=event=>{if(!res.destroyed)res.write('data: '+JSON.stringify(event)+'\n\n');};
          try {await aiAdvisor.chat(input,emit,controller.signal);}catch(error){if(!controller.signal.aborted)emit({type:'error',message:error.message||'问答中断，请手动重试。'});}
          finally {clearInterval(heartbeat);res.end();}
          return;
        }
        return sendJSON(res,404,{ok:false,error:'未知AI接口'});
      } catch(error) {console.log('[advisor] 请求未完成');return sendJSON(res,502,{ok:false,error:error.name==='TimeoutError'?'AI处理超时，请手动重试。':error.message});}
    }
    // 主动刷新只清查询快照，不清任务、图片库或发布引用。
    if(p === '/api/cache/refresh' && req.method === 'POST'){
      if(!isAllowedPublishOrigin(req))return sendJSON(res,403,{ok:false,error:'请求来源不匹配'});
      endpointQueries.clear();workspaceQueries.clear();cache.clear();workspaceCache.clear();advertising.clear();operations.clear();capabilities.clear();
      return sendJSON(res,200,{ok:true});
    }
    if (p.startsWith('/api/capabilities/')) return capabilities.handle(req, res, url);
    // 广告业务路由只接受固定查询；不开放通用entityType、任意SQL或投放写操作。
    if (p.startsWith('/api/advertising/')) {
      if(req.method !== 'GET') return sendJSON(res,405,{ok:false,error:'广告工作台仅支持查询'});
      if(!isAllowedPublishOrigin(req)) return sendJSON(res,403,{ok:false,error:'请求来源不匹配'});
      try {
        const data = await advertising.read(p.slice('/api/advertising/'.length),Object.fromEntries(url.searchParams));
        return sendJSON(res,200,{ok:true,data});
      } catch(error) { return sendJSON(res,502,{ok:false,error:error.message}); }
    }
    if (p === '/api/overview-tasks') {
      if (!['GET', 'POST'].includes(req.method)) return sendJSON(res, 405, {ok:false,error:'仅支持GET或POST'});
      if (req.headers.origin && req.headers.origin !== `http://${HOST}:${PORT}`) return sendJSON(res, 403, {ok:false,error:'请求来源不匹配'});
      try {
        if (req.method === 'GET') return sendJSON(res, 200, {ok:true,...overviewTodoStatus()});
        const snapshot = await readJsonBody(req, 100 * 1024);
        const result = await getOrGenerateOverviewTasks(snapshot, url.searchParams.get('refresh') === '1');
        return sendJSON(res, 200, {ok:true,...result});
      } catch (error) {
        console.log('[overview-todo] 生成失败');
        return sendJSON(res, 502, {ok:false,error:error.name === 'TimeoutError' ? '生成超时，请重试' : error.message});
      }
    }
    if (p.startsWith('/api/operations/')) {
      await operations.handle(req, res, url);
      return;
    }
    // --- API: 服务与 Workctl 运行态检查
    if (p === '/api/health') {
      const health = await checkRuntimeHealth();
      return sendJSON(res, health.ok ? 200 : 503, health);
    }

    // --- API: 内部工作台当前账号实时数据（只读）
    if (p.startsWith('/api/workspaces/') && req.method === 'GET') {
      const name = p.slice('/api/workspaces/'.length);
      try {
        if (name === 'access-contacts') {
          return sendJSON(res, 200, { ok: true, data: await loadAccessContactsWorkspace() });
        }
        const data = await loadAccountWorkspace(name, url.searchParams.get('refresh') === '1');
        return sendJSON(res, 200, { ok: true, data });
      } catch (error) {
        return sendJSON(res, 502, { ok: false, error: publishText(error?.message || error, 800) });
      }
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

    // 只更新发品参考资料；不清空本地编辑中的商品或发布队列。
    if (p === '/api/publish/cache/refresh' && req.method === 'POST') {
      if (!isAllowedPublishOrigin(req)) return sendJSON(res, 403, { ok: false, error: '拒绝非同源更新请求' });
      try { return sendJSON(res, 200, { ok: true, ...await refreshPublishSourceData() }); }
      catch (error) { return sendJSON(res, 502, { ok: false, error: publishText(error?.message || error, 600) }); }
    }

    // --- API: 当前账号商品到类目的自动匹配上下文（只读、已脱敏）
    if (p === '/api/publish/account-context' && req.method === 'GET') {
      try {
        const context = await buildPublicPublishAccountContext(Number(url.searchParams.get('limit')) || 20);
        // 首屏先返回已经恢复的磁盘缓存，完整店铺图库在后台限速补齐。这样用户可以
        // 立刻开始选参考品，同时仍满足首次运行会把全店商品逐件读完并持久化。
        startPublishImageLibraryWarmup();
        return sendJSON(res, 200, { ok: true, context });
      } catch (error) {
        return sendJSON(res, 502, { ok: false, error: publishText(error?.message || error, 600) });
      }
    }

    // --- API: 全店历史图库后台同步状态（不包含账号、商品号或缓存文件路径）
    if (p === '/api/publish/image-library/status' && req.method === 'GET') {
      await initializePublishImageLibrary();
      return sendJSON(res, 200, { ok: true, library: publicPublishImageLibraryStatus() });
    }

    // --- API: 用户选择当前账号商品后，返回该商品已缓存的完整历史图片。
    if (p === '/api/publish/account-images' && req.method === 'POST') {
      if (!isAllowedPublishOrigin(req)) return sendJSON(res, 403, { ok: false, error: '拒绝非同源参考商品请求' });
      try {
        const body = await readJsonBody(req, 16 * 1024);
        const productId = resolvePublishAccountReferenceKey(body?.referenceKey);
        const images = await getPublishAccountImageLibrary(productId);
        return sendJSON(res, 200, { ok: true, images });
      } catch (error) {
        return sendJSON(res, 400, { ok: false, error: publishText(error?.message || error, 600) });
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

    // --- API: 本机上传会话是否已配置；不代表上游上传已成功，不暴露网关地址或凭据。
    if (p === '/api/publish/upload-capability' && req.method === 'GET') {
      let configured = false;
      let error = '';
      try { publishImageGateway(); configured = true; } catch (issue) { error = issue.message; }
      return sendJSON(res, 200, {
        ok: true,
        configured,
        ...(error ? { error } : {}),
        acceptedTypes: ['image/jpeg', 'image/png', 'image/webp'],
        maxBytes: MAX_PUBLISH_IMAGE_BYTES,
      });
    }

    // --- API: 用户主动选择图片后上传到发品可用的远程地址。
    if (p === '/api/publish/images' && req.method === 'POST') {
      if (!isAllowedPublishOrigin(req)) return sendJSON(res, 403, { ok: false, error: '拒绝非同源图片上传请求' });
      try {
        const body = await readJsonBody(req, 12 * 1024 * 1024);
        const image = await uploadPublishImage(body);
        return sendJSON(res, 201, { ok: true, image });
      } catch (error) {
        return sendJSON(res, error.statusCode || 400, { ok: false, error: publishText(error?.message || error, 600) });
      }
    }

    // --- API: 从参考商品链接读取精简模板，再由前端按当前账号 Schema 回填。
    if (p === '/api/publish/reference' && req.method === 'POST') {
      if (!isAllowedPublishOrigin(req)) return sendJSON(res, 403, { ok: false, error: '拒绝非同源参考商品请求' });
      try {
        const body = await readJsonBody(req, 16 * 1024);
        const [reference, detail] = await Promise.all([
          queryPublishReference(body?.reference), queryPublishProductDetail(extractReferenceProductId(body?.reference)),
        ]);
        return sendJSON(res, 200, { ok: true, reference: { ...reference, detail } });
      } catch (error) {
        return sendJSON(res, 400, { ok: false, error: publishText(error?.message || error, 600) });
      }
    }

    // --- API: 从当前账号的脱敏参考库读取模板。浏览器只提交随机令牌，不提交商品 ID。
    if (p === '/api/publish/account-reference' && req.method === 'POST') {
      if (!isAllowedPublishOrigin(req)) return sendJSON(res, 403, { ok: false, error: '拒绝非同源参考商品请求' });
      try {
        const body = await readJsonBody(req, 16 * 1024);
        const productId = resolvePublishAccountReferenceKey(body?.referenceKey);
        const [[reference, sourceMaterial], images, detail] = await Promise.all([
          publishReadCache.read(`reference:${productId}`, () => Promise.all([
            queryPublishReference(productId), queryPublishAccountProductMaterial(productId),
          ])),
          getPublishAccountImageLibrary(productId),
          queryPublishProductDetail(productId),
        ]);
        const material = await completePublishSkuNames(productId, sourceMaterial);
        return sendJSON(res, 200, {
          ok: true,
          reference: {
            ...reference,
            ...material,
            title: material.title || reference.title,
            categoryId: material.categoryId || reference.categoryId,
            texts: reference.texts,
            images,
            detail,
          },
        });
      } catch (error) {
        return sendJSON(res, 400, { ok: false, error: publishText(error?.message || error, 600) });
      }
    }

    // --- API: 真实产品发布队列（只允许同源 JSON 请求）
    if (p === '/api/publish/jobs' && req.method === 'GET') {
      await restorePublishHistory();
      return sendJSON(res, 200, {
        ok: true,
        running: publishWorkerRunning,
        jobs: publishJobs.slice(-100).reverse().map(publicPublishJob),
      });
    }

    // 历史编辑按已保存回执定位，仅只读 WorkCTL；成功后接入原商品 patch/submit 流程。
    const publishEditMatch = p.match(/^\/api\/publish\/jobs\/([\w-]+)\/edit$/);
    if (publishEditMatch && req.method === 'POST') {
      if (!isAllowedPublishOrigin(req)) return sendJSON(res, 403, { ok: false, error: '拒绝非同源请求' });
      try {
        const body = await readJsonBody(req);
        if (!body || Array.isArray(body) || Object.keys(body).length) throw new Error('通过历史记录选择商品，不接受额外商品编号');
        await restorePublishHistory();
        const job = publishJobs.find(item => item.id === publishEditMatch[1]);
        if (!job) return sendJSON(res, 404, { ok: false, error: '这条发布历史已不存在，请重新打开历史列表' });
        if (!['saved_draft', 'submitted'].includes(job.status)) throw new Error('这条任务没有成功的商品回执，请返回待发布列表修改');
        const result = await operations.readProductForEdit(job);
        return sendJSON(res, 200, { ok: true, ...result });
      } catch (error) {
        return sendJSON(res, 400, { ok: false, error: publishText(error?.message || error, 600) });
      }
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
        if (error.ruleRead) {
          pushLog({ ts: new Date().toISOString(), label: '发布前校验未完成', cmd: 'publish preflight', ms: 0,
            cached: false, ok: false, err: error.message, stage: error.stage });
          return sendJSON(res, error.statusCode, { ok: false, submitted: false, retryable: error.retryable,
            code: error.code, stage: error.stage, error: `提交前校验未完成，商品尚未提交。${error.message}已上传图片可继续使用。` });
        }
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
      await publishReadCache.initialize();
      const n = cache.size + publishReadCache.entries.size + publishImageLibraryState.records.size;
      await publishReadCache.invalidate(true);
      cache.clear();
      endpointQueries.clear();workspaceQueries.clear();
      operations.clear();capabilities.clear();
      advertising.clear();
      workspaceCache.clear();
      publishAccountReferenceTokens.clear();
      publishAccountReferenceKeysByProductId.clear();
      publishImageLibraryState.records.clear();
      publishImageLibraryState.initialized = true;
      publishImageLibraryState.loadedFromDisk = false;
      publishImageLibraryState.status = 'idle';
      publishImageLibraryState.totalProducts = 0;
      publishImageLibraryState.processedProducts = 0;
      publishImageLibraryState.refreshedProducts = 0;
      publishImageLibraryState.failedProducts = 0;
      publishImageLibraryState.startedAt = null;
      publishImageLibraryState.finishedAt = null;
      publishImageLibraryState.lastError = '';
      try {
        await fs.promises.unlink(PUBLISH_IMAGE_LIBRARY_CACHE_FILE);
      } catch (error) {
        if (error?.code !== 'ENOENT') publishImageLibraryState.lastError = '图库磁盘缓存未能删除，下次同步将覆盖';
      }
      return sendJSON(res, 200, { ok: true, cleared: n });
    }

    // 旧版演示入口永久停用；即使开发目录保留历史文件也不能通过服务读取。
    if (p === '/api/demo') return sendJSON(res, 410, { ok: false, error: '演示数据入口已停用' });

    // --- API: 商品经营组合诊断
    if (p === '/api/dashboard/product-analysis') {
      const analysis = await getProductAnalysis(Object.fromEntries(url.searchParams.entries()));
      return sendJSON(res, analysis.ok ? 200 : (analysis.status || 502), analysis);
    }

    // --- API: 数据查询
    if (p.startsWith('/api/q/')) {
      const name = p.slice('/api/q/'.length);
      const query = Object.fromEntries(url.searchParams.entries());
      const out = await callEndpoint(name, query);
      return sendJSON(res, out.ok ? 200 : (out.status || 502), out);
    }

    // --- 静态文件
    let rel = p === '/' ? '/index.html' : p;
    const file = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) {
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
  PORT = server.address().port;
  if (process.send) process.send({ type: 'lsou:ready', port: PORT });
  console.log(`[workctl-dashboard] http://${HOST}:${PORT}`);
  console.log(`[workctl-dashboard] binary: ${WORKCTL}`);
  console.log(`[workctl-dashboard] endpoints: ${Object.keys(ENDPOINTS).join(', ')}`);
  // 全店历史图库会在用户真正进入产品发布页、请求 account-context 后再同步。
  // 启动时不抢占 WorkCTL，保证账号、知识和店铺等只读页面可以优先返回。
});

// 父级启动器退出后结束服务；仅启用 IPC 子进程模式，避免影响普通开发启动。
if (process.send) process.on('disconnect', () => { server.close(); process.exit(0); });
