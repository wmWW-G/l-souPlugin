'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { internalTestConfig } = require('./internal-test-config');

const MODULES = Object.freeze({overview:'经营总览',visitor:'客户与询盘',product:'商品运营',flow:'流量分析',market:'市场洞察',ads:'关键词与广告'});
const LIMITS = Object.freeze({overview:'独立经营指标不能拼成转化漏斗；同行范围以平台返回为准。',visitor:'访客分数不是成交概率；画像、回复指标与会话各有独立周期。',product:'四象限使用本店P75曝光与加权CTR，不是平台质量等级；样本覆盖以返回数据为准。',flow:'店铺、画像、行业数据周期独立；滚动30天不得累加，排名不能按相邻行匹配。',market:'各区块类目和周期独立；指数不是实际数量，趋势缺日期时不能推断月份。',ads:'行业词指数不是搜索量；历史样本不代表当前账号，读取失败不等于0。'});
const LABELS = {'shop-summary':'经营指标与对标','shop-product':'商品效果','shop-flow':'渠道来源','shop-region':'国家表现','shop-visitor':'访客记录','shop-keyword':'店铺关键词','shop-profile':'买家画像','product-analysis':'商品四象限','report':'广告效果','finance':'广告费用','industry':'行业参考','market':'市场洞察','conversation':'客户会话'};
const BLOCKED_KEY = /(?:token|password|secret|cookie|authorization|api.?key|credential|email|phone|mobile|contact|buyer.?id|seller.?id|member.?id|account.?id|ali.?id|login.?id|conversation.?id|session.?id|request.?key|task.?id|bucket|endpoint|file.?path)/i;
const OMIT_KEY = /^(?:id|productId|prodId|offerId|image|images|img|imageUrl|prodImage|url|detailUrl|shopUrl|productUrl|link|avatar)$/i;

/** 稳定序列化，用于同一业务内容跨刷新复用。@param {*} value JSON值。@returns {string}。@throws 非JSON循环值。 */
function stable(value) {
  if (Array.isArray(value)) return '['+value.map(stable).join(',')+']';
  if (value && typeof value === 'object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
/** 生成不可反推的内容引用。@param {*} value 可序列化值。@returns {string}。@throws 非法对象。 */
function digest(value) { return crypto.createHash('sha256').update(stable(value)).digest('hex').slice(0,24); }
/**
 * 为已应用的业务范围建立稳定索引；读取时间、指标值和图表高亮不参与索引。
 * @param {object} input 页面、周期、业务筛选及可选商品。@param {string} scope 服务端账号/空间。
 * @returns {string} 私有范围键。@throws 非法JSON范围。
 */
function analysisKey(input,scope) {
  const p=input.period||{},start=p.startDate||'',end=p.endDate||'';
  // 兼容旧客户端没有grain的自然月记录；自定义区间与自然月仍可显式区分。
  const inferred=start&&end?(start===end?'day':start.endsWith('-01')&&new Date(Date.parse(end)+86400000).toISOString().slice(8,10)==='01'&&start.slice(0,7)===end.slice(0,7)?'month':'range'):'snapshot';
  return 'a_'+digest([scope,input.module,{start,end,grain:p.grain||inferred,label:start?'':p.label||''},sanitize(input.cache_scope||{}),input.object?.cache_ref||input.object?.ref||'']);
}
/** 对来源对象做有界字段过滤，避免把凭据、联系方式和大图片发送给模型。@param {*} value 数据。@param {number} depth 深度。@returns {*} 安全摘要。@throws 无。 */
function sanitize(value, depth=0) {
  if (value == null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value)?value:null;
  if (typeof value === 'string') return value.replace(/<[^>]*>/g,' ').replace(/https?:\/\/\S+/g,'[链接省略]').slice(0,1200);
  if (depth>=7) return '[嵌套数据已截断]';
  if (Array.isArray(value)) return value.slice(0,30).map(item=>sanitize(item,depth+1));
  if (typeof value !== 'object') return null;
  return Object.fromEntries(Object.entries(value).filter(([key])=>!BLOCKED_KEY.test(key)&&!OMIT_KEY.test(key)).slice(0,60).map(([key,item])=>[key,sanitize(item,depth+1)]));
}
/** 判断摘要是否会裁剪来源；value为原值，depth为当前深度；返回布尔值，不改变来源。 */
function needsTrimming(value,depth=0) {
  if(typeof value==='string')return value.length>1200;
  if(!value||typeof value!=='object')return false;
  if(depth>=7)return true;
  if(Array.isArray(value))return value.length>30||value.some(x=>needsTrimming(x,depth+1));
  const entries=Object.entries(value).filter(([key])=>!BLOCKED_KEY.test(key)&&!OMIT_KEY.test(key));
  return entries.length>60||entries.some(([,v])=>needsTrimming(v,depth+1));
}
/** 将大来源分成有界、可引用事实；objects数组保留逐项范围。@param {*} value 安全值。@param {string} label 路径。@param {Array} out 输出列表。@returns {Array}。@throws 无。 */
function splitFacts(value,label,out=[]) {
  if (out.length>=65) return out;
  const text=typeof value==='string'?value:JSON.stringify(value);
  if (!text || text==='null'||text==='{}'||text==='[]') return out;
  if(text.length<=1900) {out.push({label:label.slice(0,160),text});return out;}
  if(value && typeof value==='object') {
    const entries=Array.isArray(value)?value.map((v,i)=>[String(i+1),v]):Object.entries(value);
    for(const [key,item] of entries) {if(out.length>=65)break;splitFacts(item,`${label} · ${key}`,out);}
  } else out.push({label:label.slice(0,160),text:text.slice(0,1850)+'（长文本已截断）'});
  return out;
}
/** 从当前页面构建六页统一快照；账号scope由服务端注入，不信任浏览器提供的范围ID。@param {object} input 页面记录。@param {string} scope 活动账号隔离值。@returns {object}。@throws 非法模块/数据范围。 */
function buildSnapshot(input,scope) {
  if(!input || !Object.hasOwn(MODULES,input.module))throw new Error('此页面尚未开放AI解读。');
  const module=input.module,period={};
  for(const key of ['startDate','endDate','label','grain'])if(input.period?.[key]!=null)period[key]=String(input.period[key]).slice(0,180);
  for(const key of ['startDate','endDate'])if(period[key]&&(!/^\d{4}-\d{2}-\d{2}$/.test(period[key])||!Number.isFinite(Date.parse(period[key]))||new Date(period[key]).toISOString().slice(0,10)!==period[key]))throw new Error('统计日期格式不正确。');
  if(period.startDate&&period.endDate&&period.startDate>period.endDate)throw new Error('统计起止日期颠倒。');
  const records=input.records;
  if(!Array.isArray(records)||records.length>35)throw new Error('页面数据范围不正确，请刷新后重试。');
  const facts=[],entities=[],limitations=[LIMITS[module]],now=new Date().toISOString();
  let failed=0,truncated=false,budget=0;
  for(const record of records) {
    if(!record||typeof record.source!=='string')continue;
    const source=record.source.slice(0,200),label=String(record.label||LABELS[source.split('/').pop()]||source).slice(0,150);
    if(record.error) {failed++;limitations.push(`${label}读取失败，不能当作零值。`);continue;}
    const scopeNote=String(record.scope||'按此来源返回的实际统计口径；独立快照不与所选日期混算').slice(0,400);
    const observed=typeof record.observed_at==='string'&&Number.isFinite(Date.parse(record.observed_at))?new Date(record.observed_at).toISOString():now;
    if(record.contextOnly){limitations.push(`${label}：${JSON.stringify(sanitize(record.data)).slice(0,420)}`);continue;}
    if(needsTrimming(record.data))truncated=true;
    const safe=sanitize(record.data);
    const parts=splitFacts(safe,label);
    if(JSON.stringify(safe).length>22000||parts.length>=65)truncated=true;
    for(const part of parts) {
      if(facts.length>=70||budget+part.text.length>26000){truncated=true;break;}
      facts.push({id:'f_'+digest([source,part.label,part.text]),label:part.label,text:part.text,source,observed_at:observed,scope:scopeNote,entity_ref:''});
      budget+=part.text.length;
    }
  }
  // 当前选中商品的结构化资料来自页面已有读取结果，保留短期业务引用供“查看商品”使用。
  const object=input.object;
  if(object && module==='product' && typeof object.ref==='string' && object.ref.length<=120 && typeof object.label==='string') {
    entities.push({ref:object.ref,label:object.label.slice(0,180),type:'product',...(typeof object.cache_ref==='string'&&/^[a-f0-9]{32}$/.test(object.cache_ref)?{cache_ref:object.cache_ref}:{})});
    for(const part of splitFacts(sanitize(object.data),object.label).slice(0,8)) {
      if(budget+part.text.length>29000){truncated=true;break;}
      facts.push({id:'p_'+digest([object.ref,part.label,part.text]),label:part.label,text:part.text,source:'当前选中商品的工作台记录',observed_at:now,scope:'仅此商品；效果与商品资料周期独立',entity_ref:object.ref});budget+=part.text.length;
    }
  }
  for(const note of (Array.isArray(input.limitations)?input.limitations:[]).slice(0,12))limitations.push(String(note).slice(0,450));
  if(truncated)limitations.push('模型收到的是当前页面的有界数据样本，部分长列表已截断，不能代表未包含的记录。');
  const unique=[...new Map(facts.map(fact=>[fact.id,fact])).values()].sort((a,b)=>Number(Boolean(b.entity_ref))-Number(Boolean(a.entity_ref))).slice(0,80);
  const data_status=!unique.length?(failed?'error':'empty'):failed||truncated?'partial':'ready';
  const snapshot={schema_version:'2.0',module,as_of:now,period:Object.keys(period).length?period:{label:'各区域独立统计范围'},source:'当前账号工作台已读取数据',data_status,facts:unique,entities,limitations:[...new Set(limitations)].slice(0,30)};
  while(JSON.stringify(snapshot).length>40000&&snapshot.facts.length>1){snapshot.facts.pop();snapshot.data_status='partial';if(!snapshot.limitations.some(x=>x.startsWith('输入体积')))snapshot.limitations.push('输入体积超限，已缩减样本；结论仅覆盖保留的证据。');}
  // 读取时间不参与内容版本；同一账号、周期、事实和限制才允许复用旧分析。
  snapshot.snapshot_id='s_'+digest([analysisKey(input,scope),module,snapshot.period,snapshot.data_status,snapshot.facts.map(({observed_at,...fact})=>fact),entities,snapshot.limitations]);
  return snapshot;
}
/**
 * 读取 Workflow 两个结束分支的结果，避免把数据不足误报为旧版应用。
 * @param {object} output Dify outputs，或测试/内部校验使用的直接结果对象。
 * @returns {object} 已解析的业务结果；公开字段名称不进入后续展示逻辑。
 * @throws {Error} 两分支同时返回、JSON损坏、对象与文本不一致或错误分支状态不符。
 */
function readAnalysisOutput(output) {
  if(!output||typeof output!=='object'||Array.isArray(output))throw new Error('分析没有返回有效结果，已有结果会保留。');
  // Dify可省略未执行分支，或保留null/空字符串；这些都不表示该分支有结果。
  const present=value=>value!==undefined&&value!==null&&value!=='';
  const normal=present(output.result)||present(output.raw_result);
  const insufficient=present(output.error_result)||present(output.error_raw_result);
  if(normal&&insufficient)throw new Error('分析同时返回了正常和数据不足结果，请检查Workflow结束节点。');
  const objectValue=insufficient?output.error_result:normal?output.result:output;
  const rawValue=insufficient?output.error_raw_result:normal?output.raw_result:undefined;
  /** 解析对象或最终JSON文本；value为单个输出；返回对象，格式错误抛统一业务说明。 */
  function parse(value) {
    let result=value;
    if(typeof value==='string') {
      try {result=JSON.parse(answerText(value).trim().replace(/^```(?:json)?\s*|\s*```$/g,''));}
      catch {throw new Error('分析没有返回有效JSON，已有结果会保留。');}
    }
    if(!result||typeof result!=='object'||Array.isArray(result))throw new Error('分析没有返回有效结果，已有结果会保留。');
    return result;
  }
  if(present(rawValue)&&typeof rawValue!=='string')throw new Error('分析的JSON文本字段类型不正确。');
  const result=parse(present(rawValue)?rawValue:objectValue);
  // 两种格式来自同一个结束节点，内容必须一致；不能静默覆盖另一份冲突结果。
  if(present(rawValue)&&present(objectValue)&&stable(parse(objectValue))!==stable(result))throw new Error('分析对象与JSON文本不一致，已有结果会保留。');
  if(insufficient&&result.status!=='needs_data')throw new Error('数据不足分支返回了不匹配的状态。');
  return result;
}
/**
 * 按可信页面快照重建允许的入口，与 Workflow prepare 节点使用相同引用规则。
 * @param {object} snapshot 当前页面快照，包含module及entities。
 * @returns {Array<object>} 仅打开本页或查看当前商品的入口，不包含业务写操作。
 * @throws {Error} 输入并非已校验快照时由调用方的范围校验报告。
 */
function analysisActions(snapshot) {
  const actions=[{id:'open_page',type:'navigate',label:'查看'+MODULES[snapshot.module],target_tab:snapshot.module,entity_ref:''}];
  if(snapshot.module==='product')for(const entity of snapshot.entities)if(entity.type==='product') {
    const ref=crypto.createHash('sha256').update(entity.ref).digest('hex').slice(0,12);
    actions.push({id:'open_'+ref,type:'open_product',label:'查看商品资料',target_tab:'product',entity_ref:entity.ref});
  }
  return actions;
}
/** 严格校验展示结果并重新绑定证据；不信任模型返回的状态、来源或导航。@param {object} output Dify输出。@param {object} snapshot 本轮快照。@returns {object}。@throws 格式/范围/证据错误。 */
function validateAnalysis(output,snapshot) {
  const result=readAnalysisOutput(output);
  if(result?.schema_version!=='2.0')throw new Error('分析应用仍是旧版本，请导入并发布新版六页Workflow。');
  if(result.module!==snapshot.module||result.snapshot_id!==snapshot.snapshot_id)throw new Error('分析的数据范围与当前页面不一致。');
  if(!['ok','partial','needs_data'].includes(result.status)||!Array.isArray(result.tasks)||result.tasks.length>5)throw new Error('分析返回的状态或列表不符合约定。');
  /** 校验有界显示文本。@param {*} v 值。@param {number} n 上限。@returns {string}。@throws 类型/长度错误。 */
  const text=(v,n)=>{if(typeof v!=='string'||!v.trim()||v.length>n)throw new Error('分析文本不符合展示约定。');return v.trim();};
  /** 校验短文本列表。@param {*} v 数组。@param {number} n 最多数量。@param {number} size 单项长度。@param {number} min 最少数量。@returns {Array}。@throws 格式错误。 */
  const list=(v,n,size,min=0)=>{if(!Array.isArray(v)||v.length<min||v.length>n)throw new Error('分析列表不符合约定。');return v.map(x=>text(x,size));};
  const facts=new Map(snapshot.facts.map(x=>[x.id,x])),entities=new Set(snapshot.entities.map(x=>x.ref)),evidenceIds=new Set();
  const allowedActions=analysisActions(snapshot),actionsById=new Map(allowedActions.map(action=>[action.id,action])),usedActions=new Set();
  const tasks=result.tasks.map((task,index)=>{
    if(!task||!['high','normal','low'].includes(task.priority))throw new Error('诊断优先级无效。');
    const ids=list(task.evidence_ids,8,100,1),ref=task.entity_ref||'';
    if(new Set(ids).size!==ids.length||ids.some(id=>!facts.has(id)||ref&&facts.get(id).entity_ref&&!Object.is(facts.get(id).entity_ref,ref))||ref&&!entities.has(ref))throw new Error('诊断引用了不存在或不匹配的证据。');
    ids.forEach(id=>evidenceIds.add(id));
    const actionIds=list(task.action_ids,3,100);
    if(new Set(actionIds).size!==actionIds.length||actionIds.some(id=>!actionsById.has(id)||actionsById.get(id).entity_ref&&actionsById.get(id).entity_ref!==ref))throw new Error('诊断入口不存在或未绑定当前对象。');
    actionIds.forEach(id=>usedActions.add(id));
    return {id:'i_'+digest([snapshot.snapshot_id,index,task.title]),title:text(task.title,80),priority:task.priority,basis:text(task.basis,500),steps:list(task.steps,5,200,1),acceptance_criteria:list(task.acceptance_criteria,3,200,1),hypotheses:list(task.hypotheses,3,200),missing_data:list(task.missing_data,4,200),follow_up_questions:list(task.follow_up_questions,3,100,1),entity_ref:ref,evidence_ids:ids,action_ids:actionIds,state:'suggested'};
  });
  if(result.status==='needs_data'&&tasks.length)throw new Error('数据不足状态不能包含确定性诊断。');
  return {schema_version:'2.0',module:snapshot.module,snapshot_id:snapshot.snapshot_id,as_of:snapshot.as_of,period:snapshot.period,status:result.status,summary:text(result.summary,400),tasks,evidence:snapshot.facts.filter(x=>evidenceIds.has(x.id)),actions:allowedActions.filter(action=>usedActions.has(action.id)),suggested_questions:list(result.suggested_questions,3,100,1),limitations:snapshot.limitations,generated_at:new Date().toISOString()};
}
/** 避免展示模型思考标签；text为累计最终答复，返回可展示文本；不处理或输出reasoning字段。 */
function answerText(text) {return text.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi,'').replace(/<\/?(?:t(?:h(?:i(?:n(?:k)?)?)?)?)?$/i,'').replace(/<\/?think>/gi,'').trimStart();}
/** 消费SSE并限制缓冲；body为ReadableStream，onEvent为回调；返回Promise，非法事件/断流由调用方处理。 */
async function consumeSSE(body,onEvent) {
  const reader=body.getReader(),decoder=new TextDecoder();let buffer='';
  try {
    while(true){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true}).replace(/\r/g,'');if(buffer.length>2*1024*1024)throw new Error('AI响应过大，请缩小范围。');let end;
      while((end=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);const data=frame.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(!data||data==='[DONE]')continue;await onEvent(JSON.parse(data));}
    }
    if(buffer.trim())throw new Error('AI响应未完整结束，请手动重试。');
  } catch(error) {await reader.cancel().catch(()=>{});throw error;} finally {reader.releaseLock();}
}

/** 创建按活动账号隔离的AI服务；options传入根目录、账号范围及可测试的fetch/logger。@returns {object} 路由与上下文方法。@throws 初始化文件系统异常。 */
function createAiAdvisor({root,scope,fetchImpl=fetch,log=console.log,stateDir=process.env.ADVISOR_STATE_DIR||path.join(os.homedir(),'Library','Application Support','com.lsou.workctl-dashboard')}) {
  const snapshots=new Map(),analyses=new Map(),pending=new Map(),sessions=new Map(),ranges=new Map(),snapshotKeys=new Map(),legacy=new Map();
  const filename=path.join(stateDir,'advisor-'+digest(scope)+'.json');
  try{
    const saved=JSON.parse(fs.readFileSync(filename,'utf8'));
    if([2,3].includes(saved.version))for(const item of saved.results||[])if(item?.snapshot_id){legacy.set(item.snapshot_id,item);analyses.set(item.snapshot_id,item);}
    if(saved.version===3)for(const entry of saved.entries||[])if(entry.key&&entry.snapshot?.snapshot_id===entry.result?.snapshot_id&&Object.hasOwn(MODULES,entry.result?.module)){
      // 磁盘恢复仍核验结构和引用，不将损坏的缓存送入界面。
      try{const result={...validateAnalysis(entry.result,entry.snapshot),generated_at:entry.result.generated_at};ranges.set(entry.key,{...entry,result});analyses.set(result.snapshot_id,result);}catch{log('[advisor] 跳过损坏的分析缓存');}
    }
  }catch(error){if(error.code!=='ENOENT')log('[advisor] 缓存无法恢复，将重新读取');}
  /** 保存每个业务范围及其已脱敏分析快照；不保存凭据、原始业务响应或会话；磁盘错误抛出。 */
  function persist(){fs.mkdirSync(stateDir,{recursive:true,mode:0o700});const temp=filename+'.tmp';fs.writeFileSync(temp,JSON.stringify({version:3,entries:[...ranges.values()],results:[...legacy.values()]}),{mode:0o600});fs.renameSync(temp,filename);}
  /** 登记当前快照并约束临时内存；已保存范围另有持久索引，不会因临时快照淘汰丢失；返回void。 */
  function register(snapshot,key){snapshots.set(snapshot.snapshot_id,snapshot);snapshotKeys.set(snapshot.snapshot_id,key);while(snapshots.size>80){const first=snapshots.keys().next().value;snapshots.delete(first);snapshotKeys.delete(first);}}
  /** 从旧版总览恢复引用数据；旧版未保存完整快照，明确只包含已引用的内容；无副作用。 */
  function legacySnapshot(result){return {schema_version:'2.0',module:result.module,snapshot_id:result.snapshot_id,as_of:result.as_of,period:result.period,source:'已保存解读的引用数据',data_status:'partial',facts:result.evidence||[],entities:[],limitations:[...(result.limitations||[]),'此历史解读只保留当时引用的数据。']};}
  /** 读取范围缓存，可迁移旧总览（该页仅有日期业务筛选）；其他旧页只允许精确快照迁移；返回条目或null。 */
  function findSaved(input,snapshot){
    const key=analysisKey(input,scope);if(ranges.has(key))return ranges.get(key);
    const candidates=[...legacy.values()].reverse();
    const priorPeriod=snapshot?Object.fromEntries(Object.entries(snapshot.period).filter(([key])=>key!=='grain')):null;
    const priorId=snapshot?'s_'+digest([scope,snapshot.module,priorPeriod,snapshot.data_status,snapshot.facts.map(({observed_at,...fact})=>fact),snapshot.entities,snapshot.limitations]):null;
    const old=candidates.find(result=>result.snapshot_id===snapshot?.snapshot_id||result.snapshot_id===priorId)||
      (input.module==='overview'&&!Object.keys(input.cache_scope||{}).length&&!input.object?.ref&&candidates.find(result=>result.module==='overview'&&analysisKey({module:result.module,period:result.period},scope)===key));
    if(!old)return null;
    const original=old.snapshot_id===snapshot?.snapshot_id?snapshot:old.snapshot_id===priorId?{...snapshot,snapshot_id:old.snapshot_id,period:old.period}:legacySnapshot(old);
    try{validateAnalysis(old,original);}catch{return null;}
    const entry={key,snapshot:original,result:old};ranges.set(key,entry);legacy.delete(old.snapshot_id);persist();return entry;
  }
  /** 在业务接口完成前恢复本地分析；input只需页面/已应用范围；返回结果与原分析快照，不调用Dify。 */
  function cached(input){buildSnapshot({...input,records:[]},scope);const key=analysisKey(input,scope),entry=findSaved(input);if(entry)register(entry.snapshot,key);return {cache_key:key,result:entry?.result||null,cached_snapshot:entry?.snapshot||null};}
  /** 读取进程/本地配置，不向浏览器返回Key。@returns {object} 后端配置。@throws 非ENOENT文件读取错误。 */
  function config(){const bundled=internalTestConfig(root);let values={};for(const file of [path.join(root,'.env.dify'),path.join(root,'.env.advisor')])try{for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z_]+)=(.*)$/);if(m)values[m[1]]=m[2].trim();}}catch(e){if(e.code!=='ENOENT')throw e;}values={...values,...process.env};const base=String(values.DIFY_API_BASE_URL||bundled.DIFY_API_BASE_URL||'https://api.dify.ai/v1').replace(/\/$/,'');
    // 用户已确认复用原Workflow应用；专用分析Key优先，旧Key只补给Workflow，绝不套给Chatflow。
    return {base,analysis:values.DIFY_ANALYSIS_API_KEY||values.DIFY_API_KEY||bundled.DIFY_ANALYSIS_API_KEY||'',chat:values.DIFY_CHATFLOW_API_KEY||bundled.DIFY_CHATFLOW_API_KEY||''};}
  /** 注册快照并限制内存占用；input为页面数据，返回快照和匹配的已存结果；非法输入抛错。 */
  function context(input){const snapshot=buildSnapshot(input,scope),key=analysisKey(input,scope);register(snapshot,key);const entry=findSaved(input,snapshot);return {snapshot,cache_key:key,result:entry?.result||null,cached_snapshot:entry?.snapshot||null};}
  /** 取当前进程已登记范围；id为快照ID，返回对象，不存在则抛错。 */
  function getSnapshot(id){const item=snapshots.get(id)||[...ranges.values()].find(entry=>entry.snapshot.snapshot_id===id)?.snapshot;if(!item)throw new Error('页面数据已失效，请重新读取当前页面。');return item;}
  /** 发起一次分析，复用缓存和正在运行请求；id为快照，refresh仅由显式更新触发；返回Promise或抛错。 */
  async function analyze(id,refresh=false){const snapshot=getSnapshot(id),key=snapshotKeys.get(id)||[...ranges.values()].find(entry=>entry.snapshot.snapshot_id===id)?.key,settings=config();if(!refresh&&ranges.has(key))return ranges.get(key).result;if(pending.has(key))return pending.get(key);if(refresh&&!snapshot.facts.length&&ranges.has(key)&&ranges.get(key).result.status!=='needs_data')throw new Error('当前数据尚未就绪，已保存的解读会保留。');if(!settings.analysis)throw new Error('尚未配置六页分析Workflow。');
    // 带知识库的真实运行曾耗时362秒；为检索和生成保留10分钟上限，避免360秒提前截断成功结果。超时仍交给用户手动重试。
    const run=(async()=>{log(`[advisor] 分析开始 module=${snapshot.module}`);const response=await fetchImpl(settings.base+'/workflows/run',{method:'POST',headers:{Authorization:'Bearer '+settings.analysis,'Content-Type':'application/json'},body:JSON.stringify({inputs:{business_context:JSON.stringify(snapshot)},response_mode:'streaming',user:'lsou-'+digest(scope)}),signal:AbortSignal.timeout(600000)});if(!response.ok)throw new Error(`分析服务请求失败（HTTP ${response.status}）。`);let output;
      if(response.headers.get('content-type')?.includes('text/event-stream'))await consumeSSE(response.body,event=>{if(event.event==='error')throw new Error('分析服务执行失败，请检查Dify运行记录。');if(event.event==='workflow_finished'){if(event.data?.status!=='succeeded')throw new Error('Workflow执行未成功。');output=event.data.outputs;}});else{const value=await response.json();if(value.data?.status!=='succeeded')throw new Error('Workflow执行未成功。');output=value.data.outputs;}
      if(!output)throw new Error('分析响应中断，已有结果会保留。');const result=validateAnalysis(output,snapshot);analyses.set(id,result);ranges.set(key,{key,snapshot,result});persist();log(`[advisor] 分析完成并保存 module=${snapshot.module} findings=${result.tasks.length}`);return result;
    })();pending.set(key,run);try{return await run;}catch(error){log(`[advisor] 分析失败 module=${snapshot.module}`);throw error;}finally{pending.delete(key);}}
  /** 执行连续问答并发出安全事件；input含快照/问题/会话引用，emit为输出回调；返回Promise，异常不自动重试。 */
  async function chat(input,emit,signal){const snapshot=getSnapshot(input.snapshot_id),settings=config();if(!settings.chat)throw new Error('尚未配置页面问答Chatflow。');if(typeof input.question!=='string'||!input.question.trim()||input.question.length>2000)throw new Error('请输入2000字以内的问题。');let session;
    if(input.session_id){session=sessions.get(input.session_id);if(!session||session.module!==snapshot.module)throw new Error('对话范围已失效，请开始新对话。');}else{session={id:crypto.randomUUID(),module:snapshot.module,conversation:'',busy:false};sessions.set(session.id,session);if(sessions.size>60){const first=[...sessions.values()].find(x=>!x.busy&&x!==session);if(first)sessions.delete(first.id);}}
    if(session.busy)throw new Error('上一条问题仍在回答，请稍后继续。');session.busy=true;emit({type:'meta',session_id:session.id,snapshot_id:snapshot.snapshot_id});
    const analysis=analyses.get(snapshot.snapshot_id);
    const current={...snapshot,selection:sanitize(input.selection||{}),analysis_result:analysis?{schema_version:analysis.schema_version,module:analysis.module,snapshot_id:analysis.snapshot_id,summary:analysis.summary,tasks:analysis.tasks}:null};
    // 单轮独立上下文信封避免Dify会话首轮inputs固定；前端仍只展示用户原问题。
    const query=JSON.stringify({lsou_turn:'2.0',question:input.question.trim(),business_context:current});let raw='',ended=false;
    try{log(`[advisor] 问答开始 module=${snapshot.module}`);const response=await fetchImpl(settings.base+'/chat-messages',{method:'POST',headers:{Authorization:'Bearer '+settings.chat,'Content-Type':'application/json'},body:JSON.stringify({inputs:{business_context:JSON.stringify(snapshot)},query,conversation_id:session.conversation||'',response_mode:'streaming',user:'lsou-'+digest(scope),auto_generate_name:false}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(360000)]):AbortSignal.timeout(360000)});if(!response.ok)throw new Error(`问答服务请求失败（HTTP ${response.status}）。`);
      await consumeSSE(response.body,event=>{if(event.conversation_id)session.conversation=event.conversation_id;if(event.event==='error')throw new Error('问答服务执行失败，请稍后手动重试。');if(event.event==='message'||event.event==='message_replace'){raw=event.event==='message_replace'?String(event.answer||''):raw+String(event.answer||'');if(raw.length>40000)throw new Error('答复过长，请缩小问题范围。');emit({type:'answer',text:answerText(raw)});}if(event.event==='message_end')ended=true;});
      if(!ended)throw new Error('答复连接中断，已收到的内容仅供参考；可手动重试。');emit({type:'done',session_id:session.id,snapshot_id:snapshot.snapshot_id});log(`[advisor] 问答完成 module=${snapshot.module}`);
    }finally{session.busy=false;}}
  return {context,cached,analyze,chat,status:()=>{const c=config();return {analysisConfigured:Boolean(c.analysis),chatConfigured:Boolean(c.chat),modules:MODULES};},getSnapshot};
}

module.exports={createAiAdvisor,buildSnapshot,validateAnalysis,consumeSSE,answerText,MODULES};
