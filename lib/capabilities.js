'use strict';
const {QueryCache}=require('./query-cache');
/** 扩展能力适配层：固定目录、参数合同、服务端预览确认及串行任务。 */
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const catalog = require('./capability-catalog.json');
const { failure } = require('./operations');
const { supportDirectory } = require('../desktop/platform.cjs');
const {createReadCompatibility}=require('../desktop/command-compat.cjs');
const tools = new Map(catalog.tools.map(tool => [tool.id, tool]));
const hidden = /token|password|secret|authorization|credential|cookie|gateway/i;
/** 隐藏凭据及本机路径。value为任意平台结果；返回安全副本；无主动异常。 */
function clean(value) {
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); if (parsed && typeof parsed === 'object') return clean(parsed); } catch { /* 保留普通文本。 */ }
    let text = value.replace(/\/(?:Users|private\/var|tmp)\/[^\s"<>]+/g, '[本机路径]');
    for (const key of ['ACCIO_GATEWAY_TOKEN', 'LSOU_DESKTOP_TOKEN']) if (process.env[key]) text = text.split(process.env[key]).join('[凭据]');
    return text;
  }
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !hidden.test(key)).map(([key, child]) => [key, clean(child)]));
  return value;
}
/** 识别MCP错误包装及false业务结果；value为任意响应；返回错误或空串；无异常。 */
function resultFailure(value) {
  if(value===false)return '平台返回业务失败';
  if(typeof value==='string'){try{return resultFailure(JSON.parse(value));}catch{return '';}}
  if(!value || typeof value!=='object')return '';
  if(value.isError===true)return '平台工具返回错误';
  const error=failure(value);if(error)return error;
  for(const child of Object.values(value)){if(child && typeof child==='object' || typeof child==='string'){const nested=resultFailure(child);if(nested)return nested;}}
  return '';
}
/** 判断应从真实结果选择的内部标识；param为合同字段；返回布尔；无异常。 */
function isReference(param) { return /(?:Id|Ids|_id|_ids|Key|Keys|Seq)$|^id$/.test(param.name) && !param.enum || /^(priceUnit|company|selfAliId|account_id)$/.test(param.name); }
/** 检查平台声明的字段类型和枚举；params为业务对象；返回原对象；无效抛Error。 */
function validate(tool, params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('请填写业务参数');
  const allowed = new Set(tool.params.map(p => p.name));
  for (const key of Object.keys(params)) if (!allowed.has(key) || ['__proto__','constructor','prototype'].includes(key)) throw new Error('包含未声明的参数');
  for (const p of tool.params) {
    const v = params[p.name];
    if (v === undefined) { if (p.required) throw new Error(`请填写${p.description || p.name}`); continue; }
    if (p.type === 'integer' ? !Number.isSafeInteger(v) : p.type === 'number' ? typeof v !== 'number' || !Number.isFinite(v) : p.type === 'array' ? !Array.isArray(v) : p.type === 'object' ? !v || Array.isArray(v) || typeof v !== 'object' : typeof v !== p.type) throw new Error(`${p.description || p.name}格式不正确`);
    if (p.enum && !p.enum.includes(v)) throw new Error('请选择平台支持的选项');
    if (typeof v === 'string' && (!v.trim() && p.required || v.length > 100000)) throw new Error('必填内容为空或内容过长');
    if (Array.isArray(v) && v.length > 100) throw new Error('单次最多100项');
  }
  return params;
}
/** 创建能力服务。依赖为WorkCTL执行器与日志、商品查询器；返回handle；磁盘失败报告给请求。 */
function createCapabilities({ runWorkctl, pushLog, callEndpoint, loadWorkspace, operationSources = () => [], shapeRfq = value => value, accountContext = async()=>null, stateDir }) {
  const compatibility=createReadCompatibility({runWorkctl,log:message=>pushLog({ts:new Date().toISOString(),label:'工具兼容',cmd:message,ok:true,ms:0})});
  const account = crypto.createHash('sha256').update(process.env.ACCIO_ACTIVE_SPACE || process.env.WORKCTL_BIN || 'local').digest('hex').slice(0,20);
  const directory = stateDir || path.join(supportDirectory(), `capabilities-${account}`);
  const file = path.join(directory, 'jobs.json');
  const jobs = new Map(), previews = new Map(), references = new Map(), choiceKeys = new Map();
  let chain = Promise.resolve(), persistChain = Promise.resolve();
  /** 原子串行保存结果，不保存输入参数；返回Promise；磁盘错误抛出。 */
  function persist() {
    const snapshot = JSON.stringify([...jobs.values()]);
    persistChain = persistChain.catch(() => {}).then(async () => { await fs.mkdir(directory, {recursive:true,mode:0o700}); await fs.writeFile(file+'.tmp', snapshot, {mode:0o600}); await fs.rename(file+'.tmp',file); });
    return persistChain;
  }
  const ready = (async () => {
    try { for (const job of JSON.parse(await fs.readFile(file,'utf8'))) { if (['queued','running'].includes(job.status)) { job.status='unknown'; job.message='服务重启，请查询平台结果，不会自动重放'; } jobs.set(job.id,job);if(job.result)collect(job.result,job.title); } }
    catch(e) { if(e.code!=='ENOENT') throw new Error('任务记录无法读取，请检查本机日志'); }
  })();
  /** 从结果中收集可复用标识。value为原始数据；返回void；无异常。 */
  function collect(value, title = '平台结果', depth = 0) {
    if(depth>14 || !value) return;
    if(typeof value==='string') { try {collect(JSON.parse(value),title,depth+1);} catch { /* 文本没有引用。 */ } return; }
    if(Array.isArray(value)){value.forEach(v=>collect(v,title,depth+1));return;}
    if(typeof value!=='object') return;
    const label=String(value.productTitle||value.subject||value.prodName||value.title||value.name||value.nickName||value.pageName||value.strategyName||title).slice(0,100);
    for(const [key,v] of Object.entries(value)) {
      if(hidden.test(key)) continue;
      if(isReference({name:key}) && ['string','number'].includes(typeof v)) {
        const aliases = /^(productId|prodId|prod_id)$/.test(key)?['productId','prodId','prod_id']: /^(categoryId|cateId|cate_id)$/.test(key)?['categoryId','cateId','cate_id']: [key];
        for(const name of aliases) {
          const cacheKey=name+':'+String(v); if(choiceKeys.has(cacheKey)) {const existing=references.get(choiceKeys.get(cacheKey));if(existing){existing.at=Date.now();existing.record=value;}continue;}
          if(references.size>=4000) {const first=references.keys().next().value; references.delete(first); for(const [k,t] of choiceKeys)if(t===first)choiceKeys.delete(k);}
          const ref=crypto.randomUUID(); references.set(ref,{name,value:v,label:name==='priceUnit'?({1:'袋',4:'件 / 个',5:'对 / 双',20:'套',25:'单位 / 台',92:'组合装'}[v]||'平台计价单位'):label,at:Date.now(),record:value});choiceKeys.set(cacheKey,ref);
        }
      }
      if(key==='alternativeModels' && v && typeof v==='object' && !Array.isArray(v))for(const modelKey of Object.keys(v))collect({modelKey,title:label+' · '+modelKey},label,depth+1);
      collect(v,label,depth+1);
    }
  }
  /** 返回字段候选项，原始标识留在服务端；无参数；返回列表；无异常。 */
  function choices(){return [...references].filter(([,v])=>Date.now()-v.at<1800000).map(([ref,v])=>({ref,name:v.name,label:v.label}));}
  /** 将选择令牌恢复成合同字段。tool、输入对象；返回业务参数；无效引用抛错。 */
  function resolve(tool, input) {
    const params={...input};
    for(const p of tool.params) if(params[p.name]!==undefined && isReference(p)) {
      const refs=Array.isArray(params[p.name])?params[p.name]:[params[p.name]];
      const values=refs.map(ref=>{const r=references.get(ref);if(!r || Date.now()-r.at>1800000 || r.name!==p.name)throw new Error('请从最新查询结果选择业务对象');return r.value;});
      params[p.name]=p.type==='array'?values:p.type==='integer'?Number(values[0]):String(values[0]);
    }
    return validate(tool,params);
  }
  /** 执行固定命令。tool和params来自服务器合同；返回平台结果；失败抛出并标记不确定性。 */
  const readCache=new QueryCache();
  /** 缓存已验证成功的只读结果；live为写前校验，任务生成和状态读取不缓存。每次使用结果重新登记限时引用。 */
  async function invoke(tool, params, live=false) {
    const cacheable=tool.mode==='read'&&!tool.partial&&!live&&!/prohibited-rule-interpretation|^icbu trade list$|model-detail|task|status|progress|result/i.test(tool.command);
    const result=cacheable?await readCache.read(JSON.stringify([tool.command,params]),async()=>({ok:true,data:await invokeLive(tool,params)})):{data:await invokeLive(tool,params)};
    collect(result.data,tool.title);return clean(result.data);
  }
  /** 执行并校验原始结果；tool为目录合同，params为已校验参数；返回原始数据，平台失败抛错。 */
  async function invokeLive(tool, params) {
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lsou-capability-'));
    try {
      const parameterFile=path.join(dir,'params.json');await fs.writeFile(parameterFile,JSON.stringify(params),{mode:0o600});
      const args=[...tool.command.split(' '),'--json-file',parameterFile,...(tool.mode==='write'||tool.requiresYes?['--yes']:[]),'--format','json','--compact-output','off'];
      const result=await compatibility.execute({command:tool.command,params,args,timeoutMs:tool.mode==='write'?90000:35000,readOnly:tool.mode==='read'});
      const error=!result.ok?'调用未完成，请核对平台状态':result.parsed?.success!==true?'平台未返回成功':(tool.partial?'':resultFailure(result.parsed)) || (result.parsed.data===false?'平台返回业务失败':'');
      pushLog({ts:new Date().toISOString(),label:tool.title,cmd:tool.command,ok:!error,ms:result.durationMs,err:error?String(clean(error)).slice(0,300):null});
      if(error){const e=new Error(String(clean(error)));e.uncertain=!result.ok;throw e;}
      return result.parsed.data;
    } finally {await fs.rm(dir,{recursive:true,force:true});}
  }
  /** 校验3D生成前置资格，避免跳过平台强制前置；返回Promise；资格不足抛错。 */
  async function preflight(tool,params) {
    if(/icbu-product-3d-(relate-product|select-angle)$/.test(tool.command)) {
      const detailTool=catalog.tools.find(t=>t.command.endsWith('icbu-product-3d-model-detail'));
      const detail=await invoke(detailTool,{modelId:params.modelId},true);
      const find=(value,key)=>{if(!value || typeof value!=='object')return undefined;if(Object.hasOwn(value,key))return value[key];for(const child of Object.values(value)){const hit=find(child,key);if(hit!==undefined)return hit;}};
      if(String(find(detail,'status')).toLowerCase()!=='success')throw new Error('模型尚未明确生成成功，请先查看模型详情');
      if(tool.command.endsWith('select-angle')) {
        const alternatives=find(detail,'alternativeModels');
        if(!alternatives || !(Array.isArray(alternatives)?alternatives.some(x=>x.modelKey===params.modelKey||x.key===params.modelKey):Object.hasOwn(alternatives,params.modelKey)))throw new Error('请选择平台返回的有效机位');
      } else {
        const product=[...references.values()].find(r=>r.name==='productId' && String(r.value)===String(params.productId))?.record;
        const expected={title:product?.productTitle||product?.subject||product?.prodName,coverUrl:product?.coverUrl||product?.prodImage||product?.imageUrl,productUrl:product?.productUrl||product?.detailUrl||product?.url};
        if(Object.entries(expected).some(([key,value])=>!value||params[key]!==value))throw new Error('商品标题、主图和链接必须与查询结果一致，请先读取完整商品详情');
      }
    }
    if(tool.command.endsWith('icbu-product-3d-generate-from-video-url')) {
      const check=catalog.tools.find(t=>t.command.endsWith('icbu-product-3d-eligibility-query'));
      const result=await invoke(check,{},true);
      if(!JSON.stringify(result).includes('"eligible":true')) throw new Error('当前账号未明确通过3D生成资格检查');
      const url=new URL(params.videoUrl);if(url.protocol!=='https:' || !url.pathname.toLowerCase().endsWith('.mp4'))throw new Error('请选择符合平台要求的HTTPS MP4视频');
    }
  }
  /** 限制同源请求和JSON大小；req为HTTP请求；返回对象；不合法抛错。 */
  async function body(req) {
    if(!String(req.headers['content-type']).startsWith('application/json'))throw new Error('仅接受JSON');
    let size=0;const parts=[];for await(const part of req){size+=part.length;if(size>512000)throw new Error('内容过大');parts.push(part);}
    return JSON.parse(Buffer.concat(parts).toString());
  }
  const riskRefs = new Map();
  /** 保存风险页面的对象引用；value为真实查询对象，返回短期令牌；无主动异常。 */
  function riskRef(kind,value) { if(riskRefs.size>500)riskRefs.delete(riskRefs.keys().next().value);const ref=crypto.randomUUID();riskRefs.set(ref,{kind,value,at:Date.now()});return ref; }
  /** 读取类型匹配的引用；无效或过期时抛错，防止用户输入内部编号。 */
  function riskObject(ref,kind) {const r=riskRefs.get(ref);if(!r||r.kind!==kind||Date.now()-r.at>1800000)throw new Error('所选对象已过期，请重新查询');return r.value;}
  /** 执行风险页固定业务步骤；input为页面操作，返回业务结果；平台错误向调用者报告。 */
  async function riskWorkspace(input) {
    const run=async(command,params={})=>invoke({...catalog.tools.find(t=>t.command===command),command,title:'风险合规 · '+input.action,mode:'read'},params);
    if(input.action==='violations') {
      const data=await run('icbu trade list-shop-violation-result',{limit:50});
      return {...data,violationList:(data.violationList||[]).map(row=>({...row,productRef:riskRef('product',{id:Number(row.productId),title:row.productTitle})}))};
    }
    if(input.action==='products') {
      const result=await callEndpoint('shop-product',{pageNo:'1',pageSize:'100',productName:String(input.query||'').slice(0,100)});
      if(!result.ok)throw new Error('商品目录查询失败');
      return (result.data?.data||[]).map(row=>({title:row.prodName||row.subject,category:row.cateName,ref:riskRef('product',{id:Number(row.id||row.productId),title:row.prodName||row.subject,categoryId:row.categoryId})}));
    }
    if(input.action==='product') {
      const p=riskObject(input.ref,'product');
      // 两个接口独立报告结果，任一失败不抹掉另一项已经取得的数据。
      const results=await Promise.allSettled([run('icbu trade list-product-page',{productId:p.id}),run('icbu trade list-product-punish-result',{productId:p.id,limit:20}),run('icbu trade list-product-violation-result-v2',{productId:p.id,limit:20,language:'zh_CN'})]);
      return Object.fromEntries(['information','punishment','guidance'].map((key,i)=>[key,results[i].status==='fulfilled'?{data:results[i].value}:{error:results[i].reason.message}]));
    }
    if(input.action==='brands') {
      const p=riskObject(input.ref,'product');if(!p.categoryId)throw new Error('请从商品选择列表选择带类目的商品');
      return run('icbu product list-risk-brand-name',{catIdList:[Number(p.categoryId)]});
    }
    if(input.action==='analyze') {
      const p=riskObject(input.ref,'product');if(!/^[A-Z]{2}$/.test(input.destination||''))throw new Error('请选择目的国');
      const info=await run('icbu trade list-product-page',{productId:p.id});
      const productInfo=[info.title||p.title,...(info.properties||[]).map(x=>`${x.propertyText?.anyValue||''}: ${x.valueText?.anyValue||''}`)].join('\n');
      const key=await run('icbu trade prohibited-rule-interpretation',{destination:input.destination,productInfo});
      if(typeof key!=='string'||!key.trim())throw new Error('平台未返回可用分析任务');
      return {ref:riskRef('analysis',key),message:'分析已提交，请查询结果'};
    }
    if(input.action==='rules')return run('icbu trade list',{uniqueKey:riskObject(input.ref,'analysis')});
    if(input.action==='suppliers') {
      const name=String(input.name||'').trim();if(!name||name.length>300)throw new Error('请输入完整公司名称或店铺网址');
      const data=await run('icbu trade supplier-verification-recall',{supplier_name:name,top_k:10,candidates_only:true});
      return (data.result?.payload?.candidates||data.payload?.candidates||[]).map(c=>({...c,ref:riskRef('supplier',c.company_id)}));
    }
    if(input.action==='supplier')return run('icbu trade supplier-verification-detail',{comp_id_list:[String(riskObject(input.ref,'supplier'))]});
    throw new Error('未知风险页面操作');
  }

  /** 广告辅助资料的固定业务查询；input包含action及选中商品引用；返回白名单字段；平台或参数错误抛出。 */
  async function adsWorkspace(input) {
    const run=(leaf,params={})=>invoke({command:'icbu ads '+leaf,title:'广告辅助资料 · '+input.action,mode:'read',requiresYes:true},params);
    if(input.action==='categories') {
      const rows=await run('list-customer-goods-cate-summary');
      if(!Array.isArray(rows))throw new Error('行业目录格式变化');
      return {items:rows.map(r=>({level1:r.cateLv1Desc,level2:r.cateLv2Desc,level3:r.cateLv3Desc}))};
    }
    if(input.action==='main') {
      const company=await accountContext();const id=Number(company?.companyId);
      if(!Number.isSafeInteger(id)||id<=0)throw new Error('当前账号公司资料暂不可用');
      const category=await run('search-main-catelv2-id',{custId:id});
      if(!Number.isSafeInteger(Number(category)))throw new Error('主营类目格式变化');
      const name=String(category)===String(company.cateLv2Id)?company.cateLv2Name:null;
      return {name:name||null,matched:Boolean(name)};
    }
    if(input.action==='products') {
      const context=await callEndpoint('shop-product',{pageNo:'1',pageSize:'20',productName:String(input.query||'').slice(0,100)});
      if(!context.ok)throw new Error('商品目录读取失败');
      return {items:(context.data?.data||[]).map(r=>({title:r.prodName||r.subject,image:r.prodImage,category:r.cateName,ref:riskRef('ads-product',{id:String(r.id),title:r.prodName||r.subject})}))};
    }
    if(input.action==='product') {
      const product=riskObject(input.ref,'ads-product');
      const rows=await run('list-goods-goods-id-list',{goodsIdList:[product.id]});
      if(!Array.isArray(rows))throw new Error('广告商品资料格式变化');
      return {selectedTitle:product.title,items:rows.map(r=>({title:r.title??null})),scope:'仅展示广告接口实际返回的标题，不代表已投放或投放效果'};
    }
    if(input.action==='behaviors') {
      const rows=await run('get-behaviors-semantic-for');
      if(!Array.isArray(rows))throw new Error('行为数据格式变化');
      // 当前实测为空，未核验结构的记录不直接泄露账号或个人信息。
      return {count:rows.length,state:rows.length?'unsupported':'empty'};
    }
    throw new Error('未知广告资料操作');
  }

  /** 流量页行业选品查询；input含固定动作和界面筛选；返回白名单业务字段；非法参数或平台错误抛出。 */
  async function flowWorkspace(input) {
    if(input.action==='categories') {
      const result=await callEndpoint('shop-product',{pageNo:'1',pageSize:'100',productName:''});
      if(!result.ok)throw new Error('店铺类目读取失败，请重试');
      const categories=new Map();
      for(const row of result.data?.data||[])if(Number.isSafeInteger(Number(row.categoryId))&&Number(row.categoryId)>0&&row.cateName)categories.set(Number(row.categoryId),row.cateName);
      return {categories:[...categories].map(([id,label])=>({label,ref:riskRef('flow-category',id)}))};
    }
    if(!['products','suppliers'].includes(input.action))throw new Error('未知行业查询');
    if(!['1d','7d','30d'].includes(input.period)||!['ab_cnt','prepay_ord_cnt','rec_ord_amt','uv_detail'].includes(input.sort))throw new Error('请选择有效周期和排序');
    const params={statisticsType:input.period,orderBy:input.sort,order:'desc'};
    // 店铺网址查询对应供应商全店，不能叠加商品类目而悄悄改变查询口径。
    if(input.action==='suppliers'&&input.shopUrl) {
      let url;try{url=new URL(input.shopUrl);}catch{throw new Error('请输入完整的阿里巴巴店铺网址');}
      const match=url.hostname.match(/^([a-z0-9-]+)\.(?:m\.)?en\.alibaba\.com$/i);
      if(!match||!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error('请输入有效的阿里巴巴店铺网址');
      params.domainId=match[1];
    } else params.cateId=riskObject(input.category,'flow-category');
    const tool=catalog.tools.find(t=>t.command==='icbu product data-advisor-'+(input.action==='products'?'product':'supplier')+'-selection');
    const data=await invoke({...tool,requiresYes:true},validate(tool,params));
    const rows=Array.isArray(data)?data:Array.isArray(data?.data)?data.data:data?.data===null?[]:null;
    if(!rows)throw new Error('平台返回了暂不支持的数据格式，请重试');
    const fields=input.action==='products'?['prodName','prodImage','detailUrl','price','minOrdQty','rating','commentCnt','cateName','supplierCnName','shopUrl','statDate']:['compCnName','compBizTypeDesc','compReviewCnt','compScore','mainProdSlr','minisiteUrl','starLevel'];
    return {fetchedAt:new Date().toISOString(),scope:params.domainId?'supplier':'category',items:rows.map(row=>({
      ...Object.fromEntries(fields.map(key=>[key,row[key]??null])),
      // 平台返回的是Index序列，保持指数口径，不累加为真实订单/询盘/GMV。
      trends:Object.fromEntries(['abCntIndex','prepayOrdCntIndex','recOrdAmtIndex','uvDetailIndex'].map(key=>[key,(Array.isArray(row[key])?row[key]:[]).filter(p=>/^\d{8}$/.test(p.ds)&&p.tagValue!==null&&p.tagValue!==''&&Number.isFinite(Number(p.tagValue))).map(p=>({date:p.ds,value:Number(p.tagValue)})).sort((a,b)=>a.date.localeCompare(b.date))]))
    }))};
  }

  /** 查询RFQ页面勾选的真实对象。input含固定action、列表ID和搜索词；返回逐条结果；无效选择抛错。 */
  async function rfqWorkspace(input) {
    const actions={opportunities:'rfq-detail-search-batch',quote:'rfq-quote-detail',quotes:'rfq-quote-detail-batch'};
    const command=actions[input.action];if(!command)throw new Error('未知RFQ操作');
    const max=input.action==='opportunities'?20:input.action==='quote'?1:10;
    if(!Array.isArray(input.ids)||!input.ids.length||input.ids.length>max||input.ids.some(id=>typeof id!=='string'||!id||id.length>300))throw new Error(`请选择1至${max}条记录`);
    const ids=[...new Set(input.ids)],isRfq=input.action==='opportunities';
    if (isRfq && !String(input.keyword || '').trim()) throw new Error('请先输入产品关键词并搜索商机');
    const context=await callEndpoint(isRfq?'rfq-internal-search':'rfq-quote-history',isRfq?{pageNum:'1',pageSize:'10',searchText:String(input.keyword||'').slice(0,150)}:{pageSize:'20',currentPage:'1'});
    if(!context.ok)throw new Error('当前列表无法核对，请重新搜索后再试');
    const records=ids.map(id=>context.data?.items?.find(row=>String(row.id)===id));
    if(records.some(r=>!r))throw new Error('所选记录不在当前平台列表中，请刷新列表');
    if(!isRfq&&ids.some(id=>!/^\d+$/.test(id)||!Number.isSafeInteger(Number(id))))throw new Error('平台报价记录缺少有效标识');
    const params=isRfq?{encRfqIds:ids,language:'en'}:input.action==='quote'?{quoteId:Number(ids[0])}:{quoteIds:ids.map(Number)};
    const data=await invoke({command:'icbu rfq '+command,title:isRfq?'RFQ采购需求对比':'RFQ报价详情',mode:'read',requiresYes:true,partial:true},params);
    /** 只保留报价业务字段，买家联系方式、账号和消息正文不进入浏览器。 */
    const quote=value=>Object.fromEntries(['productTitle','quantity','unitPrice','currency','paymentMethod','port','shippingTerms','quotationTime','validPeriod'].map(k=>[k,value?.[k]??null]));
    const success=data?.successMap,failed=data?.failedMap;
    return {fetchedAt:new Date().toISOString(),items:records.map((record,i)=>{
      const id=ids[i];let value=input.action==='quote'?data:success?.[id];
      if(!value&&isRfq){const rows=Array.isArray(data)?data:data?.items||data?.list||[];value=rows.find(row=>String(row.rfqId)===id);}
      if(failed?.[id]!==undefined)return {title:record.title,status:'failed',error:String(failed[id]).split(id).join('所选记录')};
      if(!value)return {title:record.title,status:'unavailable',error:'平台没有返回这条记录的详情，请稍后重试'};
      const problem=resultFailure(value);if(problem)return {title:record.title,status:'failed',error:String(problem)};
      return {title:record.title,status:'succeeded',detail:isRfq?shapeRfq(value):quote(value)};
    })};
  }

  /** 路由处理：目录、对象选择、预览确认、执行和任务读取；错误就地转换；返回Promise。 */
  async function handle(req,res,url) {
    const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
    try {
      await ready;
      if(!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host||'') || req.headers['sec-fetch-site']==='cross-site' || req.headers.origin && req.headers.origin!==`http://${req.headers.host}`)return send(403,{ok:false,error:'请求来源不匹配'});
      const route=url.pathname.slice('/api/capabilities/'.length);
      if(req.headers['x-refresh-data']==='1')readCache.clear();
      if(req.method==='POST' && route==='ads')return send(200,{ok:true,data:await adsWorkspace(await body(req))});
      if(req.method==='POST' && route==='flow')return send(200,{ok:true,data:await flowWorkspace(await body(req))});
      if(req.method==='POST' && route==='rfq')return send(200,{ok:true,data:await rfqWorkspace(await body(req))});
      if(req.method==='POST' && route==='risk')return send(200,{ok:true,data:await riskWorkspace(await body(req))});
      if(req.method==='GET' && route==='catalog')return send(200,{ok:true,...catalog,tools:catalog.tools.map(t=>({...t,params:t.params.map(p=>({...p,reference:isReference(p)}))}))});
      if(req.method==='GET' && route==='jobs'){collect(operationSources(),'已有优化任务');return send(200,{ok:true,jobs:[...jobs.values()].reverse(),choices:choices()});}
      if(req.method==='POST' && route==='context') {
        const input=await body(req);
        const workspace={models:'assets',strategies:'knowledge',pages:'storefront',contacts:'access-contacts'}[input.kind];
        if(workspace && loadWorkspace){collect(await loadWorkspace(workspace),'当前账号资料');return send(200,{ok:true,choices:choices()});}
        if(input.kind==='tasks'){collect(operationSources(),'已有优化任务');return send(200,{ok:true,choices:choices()});}
        const result=await callEndpoint('shop-product',{pageNo:'1',pageSize:'100',productName:String(input.query||'').slice(0,100)});
        if(!result.ok)throw new Error('商品目录读取失败');
        const rows=Array.isArray(result.data?.data)?result.data.data:[];
        for(const row of rows)collect({...row,productId:row.productId||row.prodId||row.id},'店铺商品');
        collect(result.data,'店铺商品');return send(200,{ok:true,choices:choices()});
      }
      if(req.method!=='POST' || !['preview','run'].includes(route))return send(404,{ok:false,error:'能力接口不存在'});
      const input=await body(req),tool=tools.get(input.toolId);
      if(!tool)throw new Error('未知能力');
      if(!['read','write'].includes(tool.mode))throw new Error(tool.mode==='internal'?'此能力由后台连接流程使用，不向页面返回凭据':tool.mode==='restricted'?'该工具仅允许在平台专属发品Skill内部调用':'平台接口合同尚不完整，暂不能执行');
      if(route==='preview') {
        const params=resolve(tool,input.params||{});
        for(const [key,value]of previews)if(Date.now()-value.at>300000)previews.delete(key);
        if(previews.size>=100)throw new Error('待确认操作过多');
        const ticket=crypto.randomUUID();previews.set(ticket,{toolId:tool.id,params,at:Date.now()});
        return send(200,{ok:true,ticket,title:tool.title,mode:tool.mode,summary:clean(Object.fromEntries(tool.params.filter(p=>params[p.name]!==undefined).map(p=>[p.description||p.name,isReference(p)?(Array.isArray(params[p.name])?params[p.name]:[params[p.name]]).map(value=>[...references.values()].find(r=>r.name===p.name && String(r.value)===String(value))?.label||'所选业务对象'):params[p.name]])))});
      }
      const preview=previews.get(input.ticket);
      if(!preview || preview.toolId!==tool.id || Date.now()-preview.at>300000)throw new Error('操作预览已过期，请重新核对');
      if(tool.mode==='write' && input.confirmed!==true)throw new Error('请核对本次操作并确认');
      if(preview.jobId)return send(200,{ok:true,job:jobs.get(preview.jobId)});
      const active=[...jobs.values()].filter(j=>['queued','running'].includes(j.status));if(active.length>=20)throw new Error('任务较多，请等待完成');
      const id=crypto.randomUUID(),job={id,toolId:tool.id,title:tool.title,page:tool.page,mode:tool.mode,status:'queued',createdAt:new Date().toISOString(),message:'等待执行'};
      jobs.set(id,job);preview.jobId=id;
      while(jobs.size>200){const old=[...jobs.values()].find(j=>!['queued','running'].includes(j.status));if(!old)break;jobs.delete(old.id);}
      await persist();
      chain=chain.catch(()=>{}).then(async()=>{
        try{job.status='running';job.message='正在调用平台';await persist();await preflight(tool,preview.params);job.result=await invoke(tool,preview.params);job.status=tool.mode==='write'?'submitted':'succeeded';job.message=tool.mode==='write'?'平台已接收，请通过对应结果查询核对最终状态':'查询完成';}
        catch(e){job.status=e.uncertain?'unknown':'failed';job.message=String(clean(e.message)).slice(0,900);}
        finally{job.finishedAt=new Date().toISOString();delete preview.params;await persist();}
      });
      return send(202,{ok:true,job});
    }catch(e){return send(400,{ok:false,error:String(clean(e.message)).slice(0,900)});}
  }
  return {handle,clear:()=>readCache.clear()};
}
module.exports={createCapabilities,validate,clean,isReference};
