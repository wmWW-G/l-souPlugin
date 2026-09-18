'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
/** 执行实际报告脚本，以可控网络及最小DOM验证请求边界，不调用任何模型。 */
function harness(catalog){
 const listeners={},calls=[],dialogs=[];let stored=[],version=1,period={mode:'month',startDate:'2026-08-01',endDate:'2026-08-31'},object=null,resolveReady,bar;
 const ready=new Promise(resolve=>{resolveReady=resolve;});
 const host={contains:el=>el===bar,prepend:el=>{bar=el;el.isConnected=true;}};
 /** 最小节点保留真实srcdoc和属性，供沙箱及下载断言。 */
 function element(tag){const nodes={};return {tag,isConnected:true,dataset:{},innerHTML:'',querySelector:s=>nodes[s]??=(s==='iframe'?{srcdoc:''}:{}),addEventListener(){},showModal(){dialogs.push(this);},remove(){this.isConnected=false;},close(){this.isConnected=false;}};}
 const window={AdvisorLive:{range:()=>({...period}),version:()=>version,ready:()=>ready,records:()=>Array.from({length:35},(_,i)=>({source:'source-'+i,data:{count:0}}))},AdvisorPositionContext:()=>object,AdvisorProductContext:()=>object,AdvisorPositionExport:i=>({index:i,object}),AdvisorPlanContext:()=>({note:'derived'})};
 const context={window,document:{querySelector:s=>s==='#advisorDesign .av-content'?host:null,createElement:element,getElementById:()=>null,addEventListener:(name,fn)=>{listeners[name]=fn;},body:{append(){}}},MutationObserver:class{observe(){}disconnect(){}},setInterval(){},setTimeout(){},structuredClone,Date,Blob,URL,crypto:{randomUUID:()=> 'request-'+calls.length},fetch:async(path,options)=>{const body=JSON.parse(options.body);calls.push({path,...body});if(body.op==='generate')stored.push({id:body.requestId,skill:body.skill,page:body.entry_page||catalog.find(x=>x.skill===body.skill).page,topic:'已生成主题',period:body.period,status:'pending'});const data=body.op==='read'?{id:body.id,topic:'已生成主题',period,html:'<!doctype html><h1>安全报告</h1>'}:{catalog,requests:structuredClone(stored)};return {ok:true,json:async()=>({ok:true,data})};}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../public/analysis-reports.js'),'utf8'),context);
 return {api:window.AdvisorReports,calls,dialogs,release:resolveReady,object:value=>{object=value;},version:()=>{version++;},period:value=>{period=value;},ready:()=>{stored.forEach(x=>{x.status='ready';});},bar:()=>bar,click:dataset=>listeners.click({target:{closest:()=>({dataset,hasAttribute:key=>key==='data-ar-start'&&dataset.start})}})};
}
const catalog=[{page:'position',topic_index:0,skill:'lsou-market-positioning',topic:'市场定位'},{page:'position',topic_index:4,skill:'lsou-detail-copy',topic:'详情文案'},{page:'ads',topic_index:3,skill:'lsou-ad-knowledge',topic:'广告知识'}];
/** 从真实后端获取运行时白名单；存储使用独立临时目录，读取后即删除。 */
function runtimeCatalog(){const os=require('node:os'),path=require('node:path'),{createAnalysisRuns}=require('../lib/analysis-runs');const root=fs.mkdtempSync(path.join(os.tmpdir(),'report-ui-catalog-'));try{return createAnalysisRuns({root,scope:'ui-catalog',launch:async()=>{},log(){}}).list().catalog;}finally{fs.rmSync(root,{recursive:true,force:true});}}
/** 等待attach启动的只读目录请求结算。 */
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('主题选择和历史读取不生成，明确开始才锁定完整35条资料并互斥',async()=>{
 const h=harness(catalog);h.api.attach('position');await tick();h.api.select(4,false);h.api.select(0,false);assert.equal(h.calls.filter(x=>x.op==='generate').length,0);
 const first=h.api.start('position',0);await h.api.start('position',0);assert.equal(h.calls.filter(x=>x.op==='generate').length,0);h.release();await first;
 assert.equal(h.calls.filter(x=>x.op==='generate').length,1);const body=h.calls.find(x=>x.op==='generate');assert.equal(body.records.length,35);assert.equal(body.data.index,0);assert.equal(body.records[0].data.count,0);
});
test('等待时周期、版本、主题或选定商品变化均不发送',async()=>{
 for(const change of ['version','period','theme','object']){const h=harness(catalog);h.api.attach('position');await tick();h.object({id:'user-choice'});const pending=h.api.start('position',4);if(change==='version')h.version();if(change==='period')h.period({mode:'day',startDate:'2026-09-01',endDate:'2026-09-01'});if(change==='theme')h.api.select(0,false);if(change==='object')h.object({id:'other-choice'});h.release();await pending;assert.equal(h.calls.filter(x=>x.op==='generate').length,0,change);}
});
test('广告问题和明确选择计划保留，完成报告只打开其沙箱，切主题后不覆盖',async()=>{
 const h=harness(catalog);h.api.attach('ads');await tick();h.release();await h.api.start('ads','lsou-ad-knowledge',{question:'如何核查本计划点击成本？',data:{selected_plan:{campaignId:'selected'}}});const body=h.calls.find(x=>x.op==='generate');assert.equal(body.data.question,'如何核查本计划点击成本？');assert.equal(body.data.selected_plan.campaignId,'selected');h.ready();await h.api.refresh();assert.equal(h.dialogs.length,1);assert.match(h.dialogs[0].innerHTML,/iframe sandbox=""/);assert.match(h.dialogs[0].querySelector('iframe').srcdoc,/安全报告/);
 const other=harness(catalog);other.api.attach('position');await tick();other.release();await other.api.start('position',0);other.api.select(4,false);other.ready();await other.api.refresh();assert.equal(other.dialogs.length,0);
});
test('目录中的全部主题均能明确生成，无前端主题子集拦截',async()=>{
 const all=runtimeCatalog();assert.equal(all.length,31);const h=harness(all);h.release();for(const item of all){h.api.attach(item.page);await tick();await h.api.start(item.page,item.skill,{question:'检查当前资料的缺项'});}const generated=h.calls.filter(x=>x.op==='generate');assert.equal(generated.length,31);assert.deepEqual(new Set(generated.map(x=>x.skill)),new Set(all.map(x=>x.skill)));assert.ok(generated.every(x=>x.selected_product===null));
});

/** 广告真实按钮先经过analytics事件绑定，再调用报告前端；覆盖跨页共享Skill与知识问题。 */
test('广告实际四类按钮均从ads入口生成，跨页诊断可见于广告历史',async()=>{
 const real=runtimeCatalog();
 const h=harness(real);h.api.attach('ads');await tick();h.release();
 const nodes={},buttons=[];
 const root={isConnected:true,innerHTML:'',querySelector:selector=>nodes[selector]??={innerHTML:'',querySelector:()=>({}),querySelectorAll:()=>[]},querySelectorAll:selector=>{
  if(selector==='[data-ad-analysis]'){if(!buttons.length)for(const match of root.innerHTML.matchAll(/data-ad-analysis="([^"]+)"/g))buttons.push({dataset:{adAnalysis:match[1]}});return buttons;}return [];
 }};
 const window={AdvisorPages:{},AdvisorMounts:{},AdvisorReports:h.api,AdvisorLive:{range:()=>({mode:'month',startDate:'2026-08-01',endDate:'2026-08-31'}),fetch:async()=>({ok:true,data:{rows:[],total:{}}})}};
 const context={window,document:{querySelector:()=>root},FormData:class{get(){return '这个计划应如何调整？';}},structuredClone,URLSearchParams};
 vm.runInNewContext(fs.readFileSync(require.resolve('../public/advisor-analytics.js'),'utf8'),context);await window.AdvisorMounts.ads();
 assert.equal(buttons.length,3);for(const button of buttons)await button.onclick();
 await nodes['[data-explain]'].onsubmit({preventDefault(){},submitter:{hasAttribute:key=>key==='data-knowledge-analysis'},currentTarget:{}});await tick();
 const generated=h.calls.filter(x=>x.op==='generate');assert.deepEqual(new Set(generated.map(x=>x.skill)),new Set(['lsou-ad-diagnosis','lsou-ad-strategy','lsou-ad-optimization','lsou-ad-knowledge']));assert.ok(generated.every(x=>x.entry_page==='ads'));assert.equal(generated.find(x=>x.skill==='lsou-ad-knowledge').data.question,'这个计划应如何调整？');assert.match(h.bar().innerHTML,/报告历史（4）/);
 await nodes['[data-explain]'].onsubmit({preventDefault(){},submitter:null,currentTarget:{}});const enter=h.calls.filter(x=>x.op==='generate').at(-1);assert.equal(enter.skill,'lsou-ad-knowledge');assert.equal(enter.data.question,'这个计划应如何调整？');assert.equal(enter.period.mode,'month');
});

/** 单计划真实详情表单将用户选中计划交给优化报告，分析按钮不再调用平台生成接口。 */
test('单计划详情的开始分析使用优化Skill并保存所选计划及问题',async()=>{
 const catalog=runtimeCatalog();
 const h=harness(catalog);h.api.attach('ads');await tick();h.release();const requests=[],plan={campaignId:'selected-plan-88',campaignName:'用户选定计划'},planButton={dataset:{plan:'0'}},diagnoseButton={dataset:{section:'diagnose'}};
 /** 为实际详情页保存节点及事件，不主动选择或执行任何按钮。 */
 function node(kind=''){const children={};return {isConnected:true,innerHTML:'',querySelector:selector=>children[selector]??=node(selector),querySelectorAll:selector=>selector==='[data-plan]'?[planButton]:selector==='[data-section]'?[diagnoseButton]:[],addEventListener(){},showModal(){},close(){},remove(){}};}
 const root=node(),dialog=node();root.querySelectorAll=()=>[];
 const window={AdvisorPages:{},AdvisorMounts:{},AdvisorReports:h.api,AdvisorLive:{range:()=>({mode:'month',startDate:'2026-08-01',endDate:'2026-08-31'}),fetch:async url=>{requests.push(url);return {ok:true,data:{rows:url.includes('/plans?')?[plan]:[],sections:[],total:1}};}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../public/advisor-analytics.js'),'utf8'),{window,document:{querySelector:()=>root,getElementById:()=>null,createElement:()=>dialog,body:{append(){}}},FormData:class{get(){return '核查这条计划的预算与点击';}},structuredClone,URLSearchParams});
 await window.AdvisorMounts.ads();planButton.onclick();await tick();await diagnoseButton.onclick();
 const form=dialog.querySelector('[data-body]').querySelector('[data-detail-result]').querySelector('form');
 await form.onsubmit({preventDefault(){},submitter:{hasAttribute:key=>key==='data-plan-analysis'},currentTarget:form});await tick();
 const sent=h.calls.find(x=>x.op==='generate');assert.equal(sent.skill,'lsou-ad-optimization');assert.equal(sent.entry_page,'ads');assert.equal(sent.data.selected_plan.campaignId,'selected-plan-88');assert.equal(sent.data.question,'核查这条计划的预算与点击');assert.equal(requests.filter(x=>x.includes('/plan-diagnosis?')).length,0);
 await form.onsubmit({preventDefault(){},submitter:null,currentTarget:form});const enter=h.calls.filter(x=>x.op==='generate').at(-1);assert.equal(enter.skill,'lsou-ad-optimization');assert.equal(enter.data.selected_plan.campaignId,'selected-plan-88');assert.equal(enter.data.question,'核查这条计划的预算与点击');assert.equal(enter.period.mode,'month');assert.equal(requests.filter(x=>x.includes('/plan-diagnosis?')).length,0);
});
