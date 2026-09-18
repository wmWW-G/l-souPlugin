'use strict';
const {QueryCache}=require('./query-cache');
/**
 * 国际站运营扩展：实时查询、已有商品优化、素材生产与任务对账。
 * 所有命令固定在本文件；浏览器不能提供 CLI 路径或任意参数。
 * 参数合同取自已核验动态 schema。平台部分写工具误标只读，所以写权限由业务定义决定。
 */
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const contracts = require('./operations-contracts.json').commands;
const TimePolicy = require('../public/time-policy');
const {createReadCompatibility}=require('../desktop/command-compat.cjs');
const ACK = 'CONFIRM_OPERATIONS_WRITE';
const READS = {
  orders: ['trade list-trade-list-mcp', '交易合同'],
  logistics: ['logistics list', '物流订单'],
  tariff: ['logistics icbu-logistics-customs-calculate-tariff-tool', '商品关税测算'],
  risk: ['trade shop-risk-diagnosis', '店铺风险诊断'],
  'product-violations': ['trade list-product-violation-result-v2', '商品违规记录'],
  'shop-violations': ['trade list-shop-violation-result-v2', '店铺违规记录'],
  'product-info': ['product list-information', '商品当前内容'],
  'product-score': ['product get-score', '商品质量诊断'],
  conversations: ['tm query-recent-conversation', '最近会话'],
  messages: ['tm list-conversation-msg', '会话消息'],
  'buyer-basic': ['tm get-buyer-basic', '买家背景'],
  'seller-basic': ['tm get-seller-basic', '店铺接待资料'],
  'product-knowledge': ['tm get-product', '商品知识'],
  'channel-trend': ['advisor data-advisor-shop-channel-trend', '渠道趋势'],
  'also-viewed': ['advisor data-advisor-to-product', '买家还看过的商品'],
  'market-detail': ['product data-advisor-industry-market-detail', '行业供需'],
  'market-trend': ['product data-advisor-industry-market-trend', '行业趋势'],
  'seller-portrait': ['product data-advisor-industry-seller-portrait', '行业卖家画像'],
  'crowd-insight': ['product data-advisor-industry-crowd-insight', '行业买家偏好'],
  stars: ['advisor icbu-starrating-cgs-pc-page-data-open', '星等级与提升建议'],
};
const WRITES = {
  'save-edit': { label: '保存已有商品优化草稿' },
  'submit-edit': { label: '提交已有商品草稿', command: 'product submit-draft' },
  'diagnosis-optimize': { label: '提交商品诊断优化', command: 'product submit-product-diagnosis-optimize-task' },
  'image-generate': { label: '生成商品图片', command: 'product product-ai-image-generate', poll: 'product product-ai-image-generate-result' },
  'image-color': { label: '商品图片换色', command: 'product product-ai-image-color-change', poll: 'product product-ai-image-generate-result' },
  'image-model': { label: '生成模特图', command: 'product product-ai-image-model-generate', poll: 'product product-ai-image-generate-result' },
  'image-translate': { label: '翻译商品图片', command: 'product product-ai-image-translate', poll: 'product product-ai-image-generate-result' },
  storyboard: { label: '生成视频分镜', command: 'product command-video-generate-storyboard' },
  video: { label: '生成商品视频', command: 'product command-video-generate', poll: 'product product-ai-video-generate-result' },
};

/** 解开字符串 JSON 包装。@param {*} value 原始值。@returns {*} 业务值。@throws 无。 */
function unpack(value) {
  for (let i = 0; i < 5 && typeof value === 'string'; i++) {
    try { value = JSON.parse(value); } catch { break; }
  }
  return value;
}
/** 检索真实字段，不推算账号或任务编号。@param {*} value 数据。@param {string[]} names 字段。@returns {*} 命中值。@throws 无。 */
function field(value, names, depth = 0) {
  value = unpack(value);
  if (!value || typeof value !== 'object' || depth > 10) return undefined;
  for (const name of names) if (value[name] !== undefined && value[name] !== null) return value[name];
  for (const child of Object.values(value)) { const found = field(child, names, depth + 1); if (found !== undefined) return found; }
}
/** 提取记录数组，保留上游其他数据供完整查看。@param {*} value 数据。@param {string[]} names 记录标识。@returns {object[]} 记录。@throws 无。 */
function records(value, names, depth = 0) {
  value = unpack(value);
  if (!value || typeof value !== 'object' || depth > 10) return [];
  if (Array.isArray(value) && value.some(row => row && names.some(name => row[name] !== undefined))) return value;
  for (const child of Object.values(value)) { const found = records(child, names, depth + 1); if (found.length) return found; }
  return [];
}
/** 清除凭据与本机路径，业务文本仍完整保留。@param {*} value 值。@returns {*} 安全副本。@throws 无。 */
function clean(value) {
  value = unpack(value);
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([k]) => !/token|password|secret|authorization|jsonPath|filePath|work_dir|gateway/i.test(k))
    .map(([k, v]) => [k, clean(v)]));
  if (typeof value === 'string') {
    let text = value.replace(/\/(?:Users|tmp|private\/var)\/[^\s"<>]+/g, '[本机路径]');
    for (const key of ['ACCIO_GATEWAY_TOKEN']) if (process.env[key]) text = text.split(process.env[key]).join('[凭据]');
    return text;
  }
  return value;
}
/** 识别嵌套业务失败，避免 CLI 成功掩盖业务拒绝。@param {*} value 响应。@returns {string} 失败原因或空串。@throws 无。 */
function failure(value, depth = 0) {
  value = unpack(value);
  if (!value || typeof value !== 'object' || depth > 10) return '';
  if (['success', 'isSuccess', 'businessSuccess', 'ok', 'processResult'].some(k => value[k] === false) ||
      value.errorDTO || (value.errCode !== undefined && !['0', '200', 'SUCCESS', ''].includes(String(value.errCode))) ||
      (typeof value.status === 'number' && value.status < 0) ||
      ['FAILED', 'FAIL', 'ERROR', 'CANCELLED'].includes(String(value.status || value.taskStatus).toUpperCase())) {
    return String(field(value, ['errorMsg', 'errMsg', 'message', 'errorMessage']) || '平台返回业务失败');
  }
  for (const v of Object.values(value)) { const error = failure(v, depth + 1); if (error) return error; }
  return '';
}
/** 递归校验白名单合同，不执行类型猜测。@param {*} value 参数。@param {object} schema 合同。@param {string} at 字段路径。@returns {void}。@throws {Error} 不合法输入。 */
function validate(value, schema, at = '参数') {
  if (schema.type === 'object') {
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(`${at}必须是对象`);
    const properties = schema.properties || {};
    for (const k of Object.keys(value)) {
      if (!Object.hasOwn(properties, k)) throw new Error(`${at}不支持字段 ${k}`);
      validate(value[k], properties[k], `${at}.${k}`);
    }
    for (const k of schema.required || []) if (value[k] === undefined || value[k] === '') throw new Error(`${at}.${k}不能为空`);
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length > 100) throw new Error(`${at}必须是最多100项的列表`);
    value.forEach((item, i) => validate(item, schema.items || {}, `${at}[${i}]`));
  } else if (schema.type === 'integer') {
    if (!Number.isSafeInteger(value)) throw new Error(`${at}必须是安全整数`);
  } else if (schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${at}必须是数字`);
  } else if (schema.type === 'string') {
    if (typeof value !== 'string' || value.length > 60000 || value.length < (schema.minLength || 0)) throw new Error(`${at}文本格式不正确`);
  } else if (schema.type === 'boolean' && typeof value !== 'boolean') throw new Error(`${at}必须是布尔值`);
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${at}不在可选范围内`);
}
/** 校验公网 HTTPS 素材地址。@param {string} value 地址。@returns {string} 地址。@throws {Error} 本机或非 HTTPS 地址。 */
function mediaUrl(value) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.') ||
      /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname) ||
      /^\[/.test(u.hostname) || /\.(local|localhost|internal)$/.test(u.hostname)) throw new Error('素材必须是公网 HTTPS 图片地址');
  return u.href;
}
/** 找出生成结果媒体，不把原始输入图当成输出。@param {*} data 结果。@returns {string[]} 生成地址。@throws 无。 */
function outputUrls(data) {
  const urls = new Set();
  const visit = (v, key = '', depth = 0) => {
    v = unpack(v);
    if (depth > 12 || /input|original|source|modelImage/i.test(key)) return;
    if (typeof v === 'string' && /^https:\/\//.test(v) && /url|image|video|result|output/i.test(key)) {
      try { urls.add(mediaUrl(v)); } catch { /* 不显示非公网产物地址。 */ }
    } else if (Array.isArray(v)) v.forEach(x => visit(x, key, depth + 1));
    else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => visit(x, k, depth + 1));
  };
  visit(data);
  return [...urls];
}
/** 创建账号隔离的运营服务。@param {object} deps 进程、旧查询及日志函数。@returns {{handle:Function}} HTTP处理器。@throws 无，磁盘错误在请求时返回。 */
function createOperations({ runWorkctl, callEndpoint, pushLog }) {
  const compatibility=createReadCompatibility({runWorkctl,log:message=>pushLog({ts:new Date().toISOString(),label:'工具兼容',cmd:message,ok:true,ms:0})});
  const readCache=new QueryCache();
  let messageSnapshotAt=Date.now();
  const clearReads=()=>{messageSnapshotAt=Date.now();readCache.clear();};
  const identity = process.env.ACCIO_ACTIVE_SPACE || process.env.WORKCTL_BIN || 'unconfigured';
  const accountHash = crypto.createHash('sha256').update(identity).digest('hex').slice(0, 20);
  const directory = path.join(process.env.OPERATIONS_STATE_DIR || path.join(os.homedir(), 'Library/Caches/com.lsou.workctl-dashboard'), `operations-${accountHash}`);
  const stateFile = path.join(directory, 'jobs.json');
  const jobs = new Map(), productRefs = new Map(), conversationRefs = new Map();
  const payloads = new Map(), polling = new Map();
  let worker = false, diskChain = Promise.resolve(), ready;

  /** 保存任务摘要；素材只驻内存。@returns {Promise<void>} 落盘结束。@throws 文件系统错误。 */
  function persist() {
    diskChain = diskChain.catch(() => {}).then(async () => {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = `${stateFile}.tmp`;
      await fs.writeFile(temporary, JSON.stringify([...jobs.values()]), { mode: 0o600 });
      await fs.rename(temporary, stateFile);
    });
    return diskChain;
  }
  /** 只写无参数的运行日志。@param {string} event 状态。@param {object} job 摘要。@returns {Promise<void>}。@throws 磁盘错误。 */
  async function log(event, job = {}) {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.appendFile(path.join(directory, 'operations.log'), `${JSON.stringify({ at: new Date().toISOString(), event, id: job.id, action: job.action, status: job.status })}\n`, { mode: 0o600 });
  }
  /** 恢复任务凭据；未知写入不自动重放。@returns {Promise<void>}。@throws 损坏文件或磁盘错误。 */
  async function restore() {
    try {
      const saved = JSON.parse(await fs.readFile(stateFile, 'utf8'));
      for (const job of saved) {
        if (job.status === 'queued') { job.status = 'interrupted'; job.message = '服务重启，尚未执行；请重新确认'; }
        if (job.status === 'running') { job.status = 'unknown'; job.message = '服务在执行期间重启，请先核对平台结果'; }
        jobs.set(job.id, job);
      }
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  ready = restore();
  // 立即注册拒绝处理，实际请求仍会收到原始错误，避免启动时的未处理拒绝。
  ready.catch(() => {});

  /** 使用私有参数文件执行固定工具。@param {string} command 相对icbu路径。@param {object} params 参数。@param {boolean} write 是否用户确认的写操作。@returns {Promise<*>} 业务数据。@throws 执行/业务错误。 */
  async function invoke(command, params = {}, write = false) {
    const contract = contracts[`icbu ${command}`];
    if (!contract) throw new Error('工具尚未核验');
    validate(params, contract.schema);
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lsou-operations-'));
    try {
      const file = path.join(tmp, 'params.json');
      await fs.writeFile(file, JSON.stringify(params), { mode: 0o600 });
      const args=['icbu', ...command.split(' '), '--json-file', file,...(write || contract.requiresYes ? ['--yes'] : []), '--format', 'json', '--compact-output', 'off'];
      const result = await compatibility.execute({command:'icbu '+command,params,args,timeoutMs:write?90000:35000,readOnly:!write&&Object.values(READS).some(([name])=>name===command)});
      const businessError = result.parsed ? (result.parsed.success !== true ? '平台未明确返回成功' :
        unpack(result.parsed.data) === false ? '平台返回业务失败' : failure(result.parsed)) : '';
      const error = !result.ok ? result.stderr || result.parseErr || '工具连接失败' : businessError;
      pushLog({ ts: new Date().toISOString(), label: command, cmd: `workctl icbu ${command} [业务参数已隐藏]`, ms: result.durationMs, cached: false, ok: !error, err: error ? String(clean(error)).slice(0, 300) : null });
      if (error) {
        const e = new Error(String(clean(error)).slice(0, 900));
        // 超时、连接中断没有确切的未执行证据，必须先对账，不能自动再次写入。
        e.uncertain = !result.ok && !result.parsed;
        e.businessFailure = Boolean(businessError);
        throw e;
      }
      return clean(unpack(result.parsed?.data));
    } finally { await fs.rm(tmp, { recursive: true, force: true }); }
  }
  /** 获取当前会话内选中的实体。@param {Map} map 索引。@param {string} key 令牌。@returns {object} 实体。@throws 过期或伪造引用。 */
  function resolve(map, key) {
    const row = map.get(key);
    if (!row || Date.now() - row.at > 30 * 60000) throw new Error('选择已过期，请重新搜索并选择');
    return row;
  }
  /** 发放限时随机实体引用。@param {Map} map 索引。@param {object} data 实体。@returns {string} 令牌。@throws 无。 */
  function register(map, data) {
    for (const [k, v] of map) if (Date.now() - v.at > 30 * 60000) map.delete(k);
    if (map.size > 3000) map.delete(map.keys().next().value);
    const key = crypto.randomUUID(); map.set(key, { ...data, at: Date.now() }); return key;
  }
  /** 搜索当前店铺商品，内部编号由服务端保管。@param {object} params 搜索分页。@returns {Promise<object>} 商品目录。@throws 查询失败。 */
  async function products(params) {
    const page = Number(params.page || 1);
    if (!Number.isInteger(page) || page < 1 || page > 500) throw new Error('页码无效');
    const result = await callEndpoint('shop-product', { pageNo: String(page), pageSize: '20', productName: String(params.query || '').slice(0, 120), orderBy: 'views', orderModel: 'DESC' });
    if (!result.ok) throw new Error(result.error || '商品读取失败');
    const rows = records(result.data, ['subject', 'prodName', 'productId', 'prodId']);
    return { items: rows.flatMap(row => {
      const id = Number(row.productId || row.prodId || row.id);
      if (!Number.isSafeInteger(id) || id <= 0) return [];
      const title = String(row.subject || row.prodName || '未命名商品');
      return [{ ref: register(productRefs, { id, categoryId: Number(row.categoryId), title }), title, image: row.prodImage || '', category: row.cateName || '', exposure: row.sumProdShowNum ?? null, clicks: row.sumProdClickNum ?? null }];
    }), total: result.data?.recordCount ?? null, page };
  }
  /** 构造查询所需真实关联键。@param {string} action 查询名称。@param {object} source 参数。@returns {Promise<object>} 业务结果。@throws 非法引用或工具错误。 */
  async function read(action, source = {}) {
    if (action === 'products') {TimePolicy.validate(action,source,['query','page']);return products(source);}
    if (!Object.hasOwn(READS, action)) throw new Error('未知查询');
    const params = { ...source };
    TimePolicy.validate(action,params,Object.keys(contracts['icbu '+READS[action][0]]?.schema?.properties || {}));
    const productRef = params.productRef; delete params.productRef;
    const conversationRef = params.conversationRef; delete params.conversationRef;
    const productActions = ['tariff', 'product-info', 'product-score', 'product-knowledge', 'market-detail', 'market-trend', 'seller-portrait'];
    if (productActions.includes(action) || productRef) {
      const product = resolve(productRefs, productRef);
      // 任何来自浏览器的内部编号都会被拒绝；类别取自真实店铺商品。
      if (['productId', 'prod_id', 'cateId'].some(k => Object.hasOwn(params, k))) throw new Error('请通过商品选择器选择');
      if (['market-detail', 'market-trend', 'seller-portrait'].includes(action)) {
        if (!Number.isSafeInteger(product.categoryId) || product.categoryId <= 0) throw new Error('该商品未返回行业类目');
        params.cateId = product.categoryId;
      } else if (action === 'product-knowledge') params.prod_id = String(product.id);
      else params.productId = product.id;
    }
    if (['messages', 'buyer-basic'].includes(action)) {
      const conversation = resolve(conversationRefs, conversationRef);
      if (['conversationId', 'selfAliId', 'contactAliId'].some(k => Object.hasOwn(params, k))) throw new Error('请通过会话列表选择客户');
      if (action === 'messages') {
        params.conversationId = conversation.id;
        if (!conversation.sellerId) throw new Error('平台未返回会话所属卖家，无法安全读取消息');
        params.selfAliId = conversation.sellerId;
        params.limitTimeStamp ??= messageSnapshotAt; params.domain = 'icbu'; params.count = 30; params.forward = false;
      } else {
        if (!conversation.buyerId) throw new Error('平台未返回该会话买家编号');
        params.contactAliId = conversation.buyerId;
      }
    }
    if (action === 'product-info') {
      params.queryType ||= 'trunk';
      params.componentList = ['productTitle', 'productKeywords', 'images', 'productSellingPoint', 'detailImage', 'companyDesc', 'faqs', 'attr', 'priceUnit', 'saleType', 'ladderPrices', 'moq', 'inventory', 'ladderPeriod', 'pkgWeight', 'pkgMeasure', 'logisticsProperty', 'shippingTemplate'];
    }
    if (action === 'tariff') Object.assign(params, { productSource: 'ICBU', source: 'ACCIO_WORK' });
    if (action === 'channel-trend') {
      const days = (Date.parse(params.endDate) - Date.parse(params.startDate)) / 86400000;
      if (!Number.isFinite(days) || days < 0 || days > 29) throw new Error('渠道趋势请选择不超过30天的日期范围');
    }
    for (const key of ['limit', 'pageSize', 'count']) if (params[key] !== undefined && (params[key] < 1 || params[key] > 100)) throw new Error('每页数量应为1至100');
    for (const key of ['start', 'currentPage']) if (params[key] !== undefined && (!Number.isInteger(params[key]) || params[key] < (key === 'start' ? 0 : 1))) throw new Error('分页参数无效');
    const result = await readCache.read(JSON.stringify([READS[action][0],params]),async()=>({ok:true,data:await invoke(READS[action][0],params)}));
    const data = result.data;
    if (action === 'conversations') {
      const items = records(data, ['conversationId']);
      return { items: items.map(row => ({
        ref: register(conversationRefs, { id: row.conversationId,
          sellerId: Number(row.sellerAliId || row.selfAliId) || null,
          buyerId: Number(row.buyerAliId || row.contactAliId || row.buyer?.aliId) || null }),
        name: row.buyerName || row.contactName || row.nickName || row.buyer?.name || '会话客户',
        country: row.contactCountry || row.country || row.countryCode || row.buyer?.country || '',
        time: row.conversationModifyTime || row.lastMessageTime || row.lastMsgTime || row.modifyTime || row.timestamp || '',
        unread: row.unreadMessageCount ?? row.unreadCount ?? null,
        summary: row.latestMessage?.content || row.lastMessage || row.lastMsg || row.messageSummary || '',
      })), cursor: field(data, ['nextCursor', 'cursor', 'nextTimeStamp', 'limitTimeStamp']) ?? null };
    }
    if(action==='orders' && params.createDateFrom && params.createDateTo && Array.isArray(data?.tradeList)) {
      const checked=TimePolicy.filterContracts(data.tradeList,params);
      if(checked.check.outside || checked.check.unknown)console.log('[time-policy] 合同日期核验',JSON.stringify(checked.check));
      return {data:{...data,tradeList:checked.rows,dateCheck:checked.check}};
    }
    return { data, cursor: field(data, ['hasMore']) === false ? null :
      field(data, ['nextCursor', 'cursor', 'nextTimeStamp', 'nextPointTimeStamp']) ?? null };
  }

  /** 校验用户确认的写请求并组装固定调用链。@param {object} body 请求。@returns {object} 参数与摘要。@throws 验证失败。 */
  function prepare(body) {
    if (!Object.hasOwn(WRITES, body.action)) throw new Error('未知操作');
    const spec = WRITES[body.action];
    const params = { ...(body.params || {}) };
    let title = spec.label, productId = null, steps = [];
    if (['save-edit', 'submit-edit', 'diagnosis-optimize'].includes(body.action)) {
      const product = resolve(productRefs, body.productRef); productId = product.id; title = product.title;
      if (Object.hasOwn(params, 'productId')) throw new Error('不能直接传入商品编号');
      if (body.action === 'save-edit') {
        const basic = params.basic || {}, detail = params.detail || {};
        if (Object.keys(params).some(k => !['basic', 'detail'].includes(k))) throw new Error('不支持的编辑区域');
        // 此流程只编辑标题、关键词、主副图、卖点、公司介绍和FAQ；不暗中改变价格库存。
        if (Object.keys(basic).some(k => !['productTitle', 'productKeywords', 'images'].includes(k)) ||
            Object.keys(detail).some(k => !['productSellingPoint', 'companyDesc', 'faqs', 'detailImage'].includes(k))) throw new Error('不支持的编辑字段');
        for (const [values, cmd] of [[basic, 'product product-edit-draft-basic-info'], [detail, 'product product-edit-draft-detail']]) {
          if (!Object.keys(values).length) continue;
          if (Object.values(values).some(v => v === '' || (Array.isArray(v) && !v.length))) throw new Error('请填写有效修改内容，空白不会覆盖原商品');
          for (const image of [...(values.images || []), ...(values.detailImage || [])]) {
            if (image.operationType !== 'REPLACE' && image.operationType !== 'ADD') throw new Error('此工作台仅支持新增或替换图片');
            mediaUrl(image.newImageUrl);
            if (image.operationType === 'REPLACE') mediaUrl(image.originalImageUrl);
            if (image.operationType === 'ADD' && (!Number.isInteger(image.imageIndex) || image.imageIndex < 0)) throw new Error('新图片位置无效');
          }
          for (const faq of values.faqs || []) if (faq.operationType !== 'ADD' || !faq.question || !faq.answer) throw new Error('FAQ需同时填写问题和答案');
          steps.push({ command: cmd, params: { ...values, productId } });
        }
        if (!steps.length) throw new Error('至少填写一项修改');
      } else if (body.action === 'submit-edit') {
        if (Object.keys(params).some(k => k !== 'savedJobId')) throw new Error('提交参数无效');
        const saved = jobs.get(params.savedJobId);
        if (!saved || saved.action !== 'save-edit' || saved.status !== 'succeeded' || saved.productId !== productId) throw new Error('请先成功保存本商品的优化草稿');
        const latestSave = [...jobs.values()].filter(j => j.productId === productId && j.action === 'save-edit').at(-1);
        if (latestSave?.id !== saved.id) throw new Error('该草稿已被后续修改替代，请核对最新保存结果');
        steps = [{ command: spec.command, params: { productId } }];
      } else {
        if (Object.keys(params).length) throw new Error('诊断建议由平台读取，不能注入自定义策略');
        steps = [{ command: spec.command, params: { productId } }];
      }
    } else {
      for (const k of ['imageUrl', 'modelImageUrl']) if (params[k]) mediaUrl(params[k]);
      for (const u of params.inputImgUrls || []) mediaUrl(u);
      if (body.action === 'image-generate' && !['imageGenerate', 'imageExtraction', 'imageHighDefinition', 'imageDetails', 'commandGeneratePic', 'marketingSellPoint'].includes(params.abilityCode)) throw new Error('图片能力无效');
      if (body.action === 'image-color' && !/^#[\da-f]{6}$/i.test(params.hexColor)) throw new Error('请选择有效色卡');
      if (body.action === 'video') {
        if (!['16:9', '9:16', '1:1'].includes(params.ratio) || !params.storyboardList?.length) throw new Error('请选择比例并填写分镜');
        for (const shot of params.storyboardList) if (!shot.storyboard?.trim() || !Number.isFinite(Number(shot.seconds)) || Number(shot.seconds) <= 0 || Number(shot.seconds) > 30) throw new Error('每个分镜需有描述和1至30秒时长');
      }
      steps = [{ command: spec.command, params }];
    }
    for (const step of steps) validate(step.params, contracts[`icbu ${step.command}`].schema);
    return { steps, title, productId };
  }
  /** 只公开任务业务字段。@param {object} job 内部任务。@returns {object} 安全摘要。@throws 无。 */
  function publicJob(job) {
    const { key, fingerprint, productId, requestKey, ...visible } = job;
    return { ...visible, canPoll: Boolean(requestKey && WRITES[job.action]?.poll && ['submitted', 'processing', 'unknown'].includes(job.status)) };
  }
  /** 先占用幂等键再异步执行，关闭并发重复提交窗口。@param {object} body 确认请求。@returns {Promise<object>} 任务。@throws 确认、参数、存储错误。 */
  async function enqueue(body) {
    if (body.confirmed !== true || body.acknowledgement !== ACK) throw new Error('请先确认本次操作及影响');
    if (typeof body.idempotencyKey !== 'string' || !/^[\w-]{16,100}$/.test(body.idempotencyKey)) throw new Error('请求标识无效');
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify([body.action, body.productRef, body.params])).digest('hex');
    const existing = [...jobs.values()].find(job => job.key === body.idempotencyKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new Error('相同请求标识不能用于不同内容');
      return publicJob(existing);
    }
    if (jobs.size >= 1000) throw new Error('任务记录已达上限，请由管理员归档后继续');
    const plan = prepare(body);
    // 同一商品的保存/提交互斥，避免另一草稿覆盖尚未提交的优化内容。
    if (plan.productId && [...jobs.values()].some(j => j.productId === plan.productId && ['queued', 'running', 'unknown'].includes(j.status))) throw new Error('该商品仍有执行中或待核对任务');
    const job = { id: crypto.randomUUID(), key: body.idempotencyKey, fingerprint,
      action: body.action, label: WRITES[body.action].label, title: plan.title, productId: plan.productId,
      status: 'queued', message: '等待执行', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      completedSteps: 0, totalSteps: plan.steps.length, result: null, requestKey: null, urls: [] };
    jobs.set(job.id, job); payloads.set(job.id, plan.steps);
    try { await persist(); } catch (e) { jobs.delete(job.id); payloads.delete(job.id); throw e; }
    setImmediate(() => drain().catch(() => {}));
    return publicJob(job);
  }
  /** 串行执行确认任务，部分成功和未知结果均明确记录。@returns {Promise<void>}。@throws 存储错误。 */
  async function drain() {
    if (worker) return;
    worker = true;
    try {
      for (const job of jobs.values()) {
        if (job.status !== 'queued' || !payloads.has(job.id)) continue;
        try {
          job.status = 'running'; job.message = '正在执行'; await persist(); await log('start', job);
          const results = [];
          for (const step of payloads.get(job.id)) {
            results.push(await invoke(step.command, step.params, true));
            job.completedSteps++; job.result = results; await persist();
          }
          const result = results.length === 1 ? results[0] : results;
          job.result = result;
          job.urls = outputUrls(result);
          job.requestKey = field(result, ['requestKey', 'taskId', 'taskKey']) || null;
          if (WRITES[job.action].poll) {
            job.status = job.urls.length ? 'succeeded' : job.requestKey ? 'submitted' : 'unknown';
            job.message = job.urls.length ? '素材已生成' : job.requestKey ? '任务已提交，正在等待生成结果' : '平台未返回可查询凭据，请核对任务结果';
          } else if (job.action === 'submit-edit' || job.action === 'diagnosis-optimize') {
            job.status = 'submitted'; job.message = '已提交平台处理，请核对平台审核或优化结果';
          } else if (job.action === 'storyboard' && !Array.isArray(field(result, ['storyboardList']))) {
            job.status = 'unknown'; job.message = '平台未返回分镜内容，请核对结果后再创建视频';
          } else { job.status = 'succeeded'; job.message = job.action === 'save-edit' ? '优化草稿已保存，确认后可提交' : '分镜已生成，可检查并编辑后生成视频'; }
        } catch (error) {
          job.status = error.uncertain ? 'unknown' : 'failed';
          job.message = `${job.completedSteps ? `已完成${job.completedSteps}步；` : ''}${error.message}`;
        } finally {
          payloads.delete(job.id); job.updatedAt = new Date().toISOString(); await persist(); await log('finish', job);
        }
      }
    } finally { worker = false; }
  }
  /** 查询已提交素材任务；永远不重新创建生成任务。@param {string} id 任务。@returns {Promise<object>} 当前状态。@throws 查询失败。 */
  async function poll(id) {
    const job = jobs.get(id);
    if (!job) throw new Error('任务不存在');
    if (!publicJob(job).canPoll || (job.lastPollAt && Date.now() - job.lastPollAt < 10000)) return publicJob(job);
    if (polling.has(id)) return polling.get(id);
    const promise = (async () => {
      job.lastPollAt = Date.now();
      try {
        const result = await invoke(WRITES[job.action].poll, { requestKey: String(job.requestKey) });
        const status = String(field(result, ['taskStatus', 'status', 'state']) || '').toUpperCase();
        job.result = result; job.urls = outputUrls(result);
        if (job.urls.length || ['SUCCESS', 'SUCCEEDED', 'COMPLETED', 'FINISHED'].includes(status)) {
          job.status = 'succeeded'; job.message = job.urls.length ? '素材已生成' : '平台报告完成，但未返回素材地址';
        } else { job.status = 'processing'; job.message = '平台仍在处理，稍后继续查询'; }
        delete job.pollError;
      } catch (error) {
        // 查询超时不代表生成失败；仅明确终态失败才关闭轮询。
        job.pollError = error.message;
        if (error.businessFailure) { job.status = 'failed'; job.message = error.message; }
      }
      job.updatedAt = new Date().toISOString(); await persist(); return publicJob(job);
    })();
    polling.set(id, promise);
    try { return await promise; } finally { polling.delete(id); }
  }
  /** 读取有上限的同源JSON请求。@param {object} req HTTP请求。@returns {Promise<object>} 请求体。@throws 越界、跨站、格式错误。 */
  async function body(req) {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new Error('仅接受JSON请求');
    if (req.headers['sec-fetch-site'] === 'cross-site') throw new Error('拒绝跨站请求');
    if (req.headers.origin) {
      const origin = new URL(req.headers.origin);
      if (!['127.0.0.1', 'localhost'].includes(origin.hostname) || origin.host !== req.headers.host || origin.protocol !== 'http:') throw new Error('拒绝非同源请求');
    }
    let size = 0; const chunks = [];
    for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) throw new Error('请求内容过大'); chunks.push(chunk); }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('请求格式错误');
    return value;
  }
  /** 处理固定运营路由。@param {object} req 请求。@param {object} res 响应。@param {URL} url URL。@returns {Promise<void>}。@throws 错误转换为JSON响应。 */
  async function handle(req, res, url) {
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
    try {
      await ready;
      if (url.pathname === '/api/operations/jobs' && req.method === 'GET') return send(200, { ok: true, jobs: [...jobs.values()].reverse().map(publicJob) });
      if (url.pathname === '/api/operations/read' && req.method === 'POST') {
        const input = await body(req); if(input.refresh===true)clearReads(); const data = await read(input.action, input.params);
        return send(200, { ok: true, ...data, source: 'workctl-live', fetchedAt: new Date().toISOString() });
      }
      if (url.pathname === '/api/operations/jobs' && req.method === 'POST') return send(202, { ok: true, job: await enqueue(await body(req)) });
      const match = url.pathname.match(/^\/api\/operations\/jobs\/([\w-]+)\/poll$/);
      if (match && req.method === 'POST') { await body(req); return send(200, { ok: true, job: await poll(match[1]) }); }
      send(404, { ok: false, error: '运营接口不存在' });
    } catch (error) { send(400, { ok: false, error: String(clean(error.message)).slice(0, 900) }); }
  }
  /** 将服务端已查询的商品注册为限时编辑引用，避免按同名商品猜测目标。
   * @param {object} row 平台商品原始记录。@returns {string|null} 引用或不可编辑标记。@throws 无。
   */
  function registerProduct(row) {
    const id = Number(row.productId || row.prodId || row.id);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    return register(productRefs, {id, categoryId: Number(row.categoryId), title: String(row.subject || row.prodName || '未命名商品')});
  }
  /**
   * 按服务端历史回执读取原商品，成功后才发放编辑引用；不通过同名搜索猜目标。
   * @param {object} row 已完成发布任务，productId 必须来自平台回执。
   * @returns {Promise<object>} 可编辑商品引用和最新草稿优先资料，供现有编辑流程复用。
   * @throws {Error} 编号无效、WorkCTL失败或没有可编辑资料时抛出，不回退到本地素材。
   */
  async function readProductForEdit(row) {
    const productId = Number(row.productId);
    if (!Number.isSafeInteger(productId) || productId <= 0) throw new Error('历史记录未返回可读取的商品编号');
    const raw = await invoke('product list-information', { productId, queryType: 'draftFirst',
      componentList: ['productTitle', 'productKeywords', 'images', 'productSellingPoint', 'detailImage', 'companyDesc', 'faqs', 'attr', 'priceUnit', 'saleType', 'ladderPrices', 'moq', 'inventory', 'ladderPeriod', 'pkgWeight', 'pkgMeasure', 'logisticsProperty', 'shippingTemplate'] });
    const data = raw?.agentModel || raw;
    // WorkCTL可能 success=true 但 data="Record does not exist."，不能据此打开空白可保存表单。
    if (!data || typeof data !== 'object' || Array.isArray(data) || !data.basicInfo || typeof data.basicInfo !== 'object' || Array.isArray(data.basicInfo) || !Object.keys(data.basicInfo).length) {
      if (typeof raw === 'string' && /record does not exist/i.test(raw)) {
        throw new Error('WorkCTL 未能读取这件商品：记录不存在（Record does not exist.）。请确认商品仍存在且属于当前账号后重试');
      }
      throw new Error('WorkCTL 未返回可编辑的商品资料，请稍后重试');
    }
    const title = String(data.basicInfo.productTitle || row.title || '未命名商品');
    const ref = registerProduct({ productId, categoryId: data.categoryId, subject: title });
    return { product: { ref, title }, data };
  }
  /** 仅向本机业务适配层提供任务关联，不向浏览器暴露真实商品号或查询凭据。
   * 无参数；返回任务引用列表；无主动异常。
   */
  function referenceSources() { return [...jobs.values()].map(j => ({productId:j.productId,requestKey:j.requestKey,title:j.title})); }
  return { handle, registerProduct, readProductForEdit, referenceSources, clear:clearReads };
}
module.exports = { createOperations, validate, failure, outputUrls };
