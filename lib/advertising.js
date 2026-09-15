'use strict';
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Time = require('../public/time-policy');

/** 解包真实 CLI/MCP 成功响应；任何内层错误都不能成为空数据。@param {object} run CLI结果。@returns {object} 业务包络。@throws 查询失败或结构变化。 */
function unwrap(run) {
  if (!run.ok || !run.parsed) throw new Error('广告服务读取失败，请稍后重试');
  let x = run.parsed;
  for (let i = 0; i < 8; i++) {
    if (!x || typeof x !== 'object') break;
    if (x.success === false || x.isError === true || x.error) throw new Error('平台广告查询失败，请重试');
    if (x.structuredContent) { x = x.structuredContent; continue; }
    if (x.result) { x = x.result; continue; }
    if (Array.isArray(x.data) || Array.isArray(x.links)) return x;
    if (x.data && typeof x.data === 'object') { x = x.data; continue; }
    const text = x.content?.find(item => item.type === 'text')?.text;
    if (text) { try { x = JSON.parse(text); continue; } catch (_) { break; } }
    break;
  }
  throw new Error('广告响应格式变化，暂不能展示');
}

/** 数值缺失保留null，真实0保持0。@param {*} x 平台值。@returns {number|null}。@throws 无。 */
function numeric(x) { return x == null || String(x).trim() === '' || !Number.isFinite(Number(x)) ? null : Number(x); }

/** 解析平台TSV，兼容引号、制表符及换行；不接受残缺记录。@param {string} text TSV。@returns {object[]} 行数据。@throws 列数或引号异常。 */
function parseTsv(text) {
  const lines = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && (quoted || field === '')) {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted;
    } else if (!quoted && (c === '\t' || c === '\n')) {
      row.push(field.replace(/\r$/, '')); field = '';
      if (c === '\n') { lines.push(row); row = []; }
    } else field += c;
  }
  if (quoted) throw new Error('平台报表内容不完整');
  if (field || row.length) { row.push(field.replace(/\r$/, '')); lines.push(row); }
  const headers = lines.shift() || [];
  if (!headers.includes('花费') || !headers.includes('日期')) throw new Error('平台报表缺少花费或日期字段');
  return lines.filter(r => r.some(x => x !== '')).map(r => {
    if (r.length !== headers.length) throw new Error('平台报表列数异常');
    return Object.fromEntries(headers.map((h, i) => [h, r[i]]));
  });
}

/** 验证报表日期属于请求范围，输出中文指标，禁止跨周期补零。@param {object[]} rows 平台行。@param {object} range 查询范围。@returns {object[]} 标准行。@throws 日期无法验证。 */
function reportRows(rows, range) {
  return rows.map(row => {
    const raw = String(row['日期'] || '');
    const tokens = raw.match(/\d{4}[-/]\d{2}[-/]\d{2}|\d{8}/g) || [];
    const dates = tokens.map(t => t.includes('-') || t.includes('/') ? t.replaceAll('/', '-') : `${t.slice(0,4)}-${t.slice(4,6)}-${t.slice(6,8)}`);
    if (!dates.length || dates.some(d => { try { Time.parse(d); return d < range.startDate || d > range.endDate; } catch (_) { return true; } })) throw new Error('报表返回日期与所选范围不一致，未用于统计');
    const pick = (...keys) => numeric(keys.map(k => row[k]).find(v => v != null));
    return { date: raw, spend: pick('花费'), clicks: pick('点击量'), impressions: pick('曝光量'),
      inquiries: pick('询盘量','SEARCHMCCNT','searchMcCnt'), tm: pick('TM咨询量','SEARCHATMSESSIONCNT','searchAtmSessionCnt'),
      orders: pick('订单量','SEARCHORDERCNT','searchOrderCnt'), opportunities: pick('全站商机量','直通车总转化数'),
      l1: pick('L1+全站商机量','L1+商机量'), cpc: pick('点击成本'), opportunityCost: pick('全站商机成本','直通车转化成本') };
  });
}

/** 生成当前账号广告只读服务。仅固定业务路由可调用CLI，浏览器不能传entity、SQL或任意链接。@param {object} deps CLI与日志依赖。@returns {object} read/clear。@throws 构造不抛错。 */
function createAdvertising({ runWorkctl, pushLog = () => {} }) {
  const cache = new Map(), pending = new Map();
  let reportQueue = Promise.resolve();
  let cacheGeneration=0;
  /** 查询实体；参数落0600临时文件，完成后删除。@param {object} params 服务端构造。@returns {Promise<object>} 包络。@throws CLI失败。 */
  async function query(params) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lsou-ads-'));
    const started = Date.now();
    console.log(`[advertising] start ${params.entityType}`);
    try {
      const file = path.join(dir, 'params.json');
      await fs.writeFile(file, JSON.stringify(params), { mode: 0o600 });
      const run = await runWorkctl(['icbu','ads','list','--params-file',file,'--format','json'], 65000);
      const data = unwrap(run);
      pushLog({ ts:new Date().toISOString(), label:'广告数据', cmd:`workctl icbu ads list · ${params.entityType}`, ok:true, ms:Date.now()-started, cached:false });
      console.log(`[advertising] complete ${params.entityType} ${Date.now()-started}ms`);
      return data;
    } catch (e) {
      console.log(`[advertising] failed ${params.entityType}`);
      pushLog({ ts:new Date().toISOString(), label:'广告数据', cmd:`workctl icbu ads list · ${params.entityType}`, ok:false, ms:Date.now()-started, err:'广告数据读取失败', cached:false });
      throw e;
    } finally { await fs.rm(dir, { recursive:true, force:true }); }
  }
  /** 合并并发请求并限制缓存数量。@param {string} key 范围键。@param {Function} work 查询。@param {number} ttl 毫秒。@param {boolean} force 强制读取。@returns {Promise<object>}。@throws 查询错误。 */
  async function memo(key, work, ttl = 300000, force = false) {
    if (pending.has(key)) return pending.get(key);
    const hit = cache.get(key);
    if (!force && hit) return { ...hit.data, cached:true };
    const generation=cacheGeneration;
    const promise = work().then(value => {
      const data = { ...value, fetchedAt:new Date().toISOString(), source:'workctl-live', cached:false };
      if (cache.size >= 80) cache.delete(cache.keys().next().value);
      if(generation===cacheGeneration)cache.set(key, { at:Date.now(), data }); return data;
    }).finally(() => {if(pending.get(key)===promise)pending.delete(key);});
    pending.set(key,promise); return promise;
  }
  /** 取得真实账户导航，不向前端暴露账户标识或写操作。@returns {Promise<object>} 内部包络。@throws 平台错误。 */
  const root = () => memo('root', () => query({entityType:'company',filters:{},include:'all'}));
  /** 沿根返回的只读入口查询。@param {string} name 名称。@param {object} filters 已校验参数。@param {object} page 可选分页。@returns {Promise<object>}。@throws 入口不可用。 */
  async function follow(name, filters = {}, page) {
    const company = await root();
    const link = company.links?.find(l => l.name === name && l.available && l.invoke);
    if (!link) throw new Error('当前账号未开放此项广告数据');
    const entities={searchCampaigns:'campaign',wholeSiteCampaigns:'campaign',campaigns:'campaign',campaignGroups:'campaign_group',accountFinance:'account_finance',query_industry:'industry_benchmark',recommend_campaign_package:'campaign_package_recommendation',diagnose:'diagnosis'};
    if(link.invoke.entityType!==entities[name]) throw new Error('广告查询入口契约变化');
    const p = { ...link.invoke, filters:{...link.invoke.filters,...filters} };
    if (page) p.page = page;
    return query(p);
  }
  /** 读取一个报表证据单元，report和SQL全局串行，避免临时表串期。@param {string} scope 产品线。@param {object} range 日期。@returns {Promise<object>} 数据/空状态。@throws 错误及范围失配。 */
  function report(scope, range) {
    const task = reportQueue.catch(() => {}).then(async () => {
      const producer = await query({ entityType:'report', include:'data', filters:{datasource:`company_${scope}`,beginDateTime:range.startDate+' 00:00:00',endDateTime:range.endDate+' 23:59:59'} });
      const meta = producer.data?.[0];
      const link = producer.links?.find(l => l.available && l.invoke?.entityType === 'report_sql');
      if (!link || meta?.datasource !== `company_${scope}`) throw new Error('平台未返回匹配的广告报表入口');
      const p = structuredClone(link.invoke);
      if (String(p.filters?.sessionId) !== String(meta.sessionId) || p.filters?.tableName !== meta.tableName || !/^SELECT \* FROM [A-Z_]+ LIMIT \d+$/i.test(p.filters?.sql1 || '')) throw new Error('平台报表查询契约变化');
      // 平台默认只取10行；按声明的LIMIT规则读取全部区间日记录，避免30天只累计10天。
      p.filters.sql1 = p.filters.sql1.replace(/LIMIT \d+$/i, 'LIMIT 1000');
      const result = await query(p), sql = result.data?.[0];
      if (sql?.success !== true || typeof sql.tsvData !== 'string') throw new Error('广告报表明细读取失败');
      const rows = reportRows(parseTsv(sql.tsvData), range);
      if (numeric(meta.tableMeta?.total_rows) > rows.length) throw new Error('广告报表未完整返回，未汇总花费');
      // 非空但有缺失值时保持unknown；只有每行金额都明确才计算总花费。
      const total = {};
      for (const key of ['spend','clicks','impressions','inquiries','tm','orders','opportunities','l1']) total[key] = rows.length && rows.every(r => r[key] != null) ? rows.reduce((sum,r) => sum+r[key],0) : null;
      return { scope, ...range, state:rows.length?'ready':'empty', rows, total, currency:'CNY' };
    });
    reportQueue = task.catch(() => {}); return task;
  }
  /** 服务端业务白名单与参数验证。@param {string} name 路由。@param {object} q 查询串。@returns {Promise<object>} 已缓存业务数据。@throws 非法参数或上游失败。 */
  async function read(name, q = {}) {
    const allowed = { plans:['kind','page','refresh'], finance:['refresh'], industry:['refresh'], recommendation:['refresh'], diagnosis:['endDate','refresh'], report:['scope','startDate','endDate','refresh'], history:['account','type','startDate','endDate','page','refresh'] };
    if (!allowed[name]) throw new Error('未知广告查询');
    if (Object.keys(q).some(k => !allowed[name].includes(k))) throw new Error('广告查询包含不支持的参数');
    const page = Number(q.page || 1);
    if (!Number.isInteger(page) || page < 1 || page > 100) throw new Error('页码无效');
    let range;
    if (['report','history'].includes(name)) range = Time.range(q.startDate,q.endDate,{days:100,latest:Time.shift(Time.today(),-1)});
    if (name === 'report' && !['search','whole_site'].includes(q.scope)) throw new Error('请选择直通车或全站推');
    const kindMap = {search:'searchCampaigns',whole_site:'wholeSiteCampaigns',ordinary:'campaigns',groups:'campaignGroups'};
    if (name==='plans' && !kindMap[q.kind]) throw new Error('计划类型无效');
    if (name==='history' && (!['search','recommend','all_domain'].includes(q.account) || !['cash_gift','coupon','compensation'].includes(q.type))) throw new Error('账户或流水类型无效');
    if(name==='diagnosis') Time.range(q.endDate,q.endDate,{latest:Time.shift(Time.today(),-1)});
    const params = {...q}; delete params.refresh;
    const key = name + JSON.stringify(params);
    return memo(key, async () => {
      if (name==='report') return report(q.scope,range);
      if (name==='plans') {
        const d = await follow(kindMap[q.kind],{}, {index:page,size:50});
        const keys = ['campaignId','campaignName','campaignTypeDesc','campaignType','subType','onlineStatus','budget','onlineProductCount','gmtCreate','gmtModify','gmtModified','optimizeTarget','campaignGroupId','campaignGroupName','campaignGroupType','effectiveStatusLabel','statusLabel','marketingPackageTypeLabel','optimizerTargetLabel'];
        const rows=(d.data||[]).map(r=>Object.fromEntries(keys.filter(k=>r[k]!=null).map(k=>[k,r[k]])));
        if(q.kind==='ordinary') {
          // 普通计划原始onlineStatus枚举与投放列表不同；按同一计划ID匹配已核验的状态，不直接套枚举。
          const sources=await Promise.allSettled(['search','whole_site'].map(kind=>read('plans',{kind,page:'1'})));
          const known=new Map(sources.filter(x=>x.status==='fulfilled').flatMap(x=>x.value.rows).map(r=>[String(r.campaignId),r]));
          for(const r of rows) {
            const match=known.get(String(r.campaignId));if(!match)continue;
            r.verifiedOnlineStatus=match.onlineStatus;
            for(const key of ['campaignTypeDesc','budget','onlineProductCount','optimizeTarget'])if(r[key]==null&&match[key]!=null)r[key]=match[key];
          }
        }
        return {kind:q.kind,rows,total:numeric(d.total),page};
      }
      if (name==='finance' || name==='history') {
        const d = await follow('accountFinance',name==='history'?{accountTypes:[q.account],historyTypes:[q.type],beginDate:range.startDate,endDate:range.endDate}:{},name==='history'?{index:page,size:20}:undefined);
        return {rows:d.data||[],metadata:d.metadata||{},...(range||{}),page};
      }
      if (name==='industry') {
        const c=(await root()).data?.[0];
        if(!c?.cateLv2Id) throw new Error('当前账号未返回主营类目');
        const d=await follow('query_industry',{categoryId:c.cateLv2Id,level:2});
        return {rows:d.data||[],category:c.cateLv2Name};
      }
      if (name==='recommendation') {
        const d=await follow('recommend_campaign_package');
        // 只输出方案信息，去掉创建链接、商品ID和写入操作，防止把建议渲染成执行。
        return {rows:(d.data||[]).flatMap(r=>(r.groups||[]).flatMap(g=>(g.recommendations||[]).map(item=>({type:item.campaignKey?.subType,eligibleProductCount:item.eligibleProductCount,decision:item.recommendAdmission?.decision,reasons:item.recommendAdmission?.reasonCodes||[],budget:item.proposal?.budgetAmount,budgetScope:item.proposal?.budgetScope,currency:item.proposal?.currency,targetCost:item.proposal?.targetCost,productCount:item.proposal?.productIds?.length,regionCount:item.proposal?.regionCodes?.length})))),status:d.data?.[0]?.status,partial:d.data?.[0]?.partial};
      }
      const d=await follow('diagnose',{endDate:q.endDate});
      return {rows:d.data||[],startDate:Time.shift(q.endDate,-6),endDate:q.endDate};
    }, ['diagnosis','recommendation'].includes(name)?86400000:300000, q.refresh==='1');
  }
  return {read,accountContext:async()=> (await root()).data?.[0],clear(){cacheGeneration++;cache.clear();pending.clear();}};
}
module.exports = {createAdvertising,unwrap,parseTsv,reportRows,numeric};
