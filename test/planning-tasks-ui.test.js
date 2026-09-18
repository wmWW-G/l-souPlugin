'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../public/planning-tasks.js'),'utf8');
/** 用可控资料promise执行真实事件处理器；不模拟网络数据已就绪，便于复现切周期竞争。 */
function harness(){
 let click,release,version=1,period={mode:'day',startDate:'2026-09-01',endDate:'2026-09-01'},records=[];
 const calls=[],root={isConnected:true};const ready=new Promise(resolve=>{release=resolve;});
 const context={window:{AdvisorLive:{range:()=>({...period}),version:()=>version,ready:()=>ready,records:()=>records}},document:{addEventListener:(name,fn)=>{click=fn;},querySelectorAll:()=>[],body:{}},MutationObserver:class{observe(){}},setInterval(){},crypto:{randomUUID:()=> 'test-id'},structuredClone,fetch:async(url,options)=>{calls.push(JSON.parse(options.body));return {ok:true,json:async()=>({ok:true,data:{tasks:[],requests:[]}})};}};
 vm.runInNewContext(source,context);
 return {calls,root,release,load:value=>{records=value;},change:()=>{version++;period={mode:'month',startDate:'2026-08-01',endDate:'2026-08-31'};},samePeriodReload:()=>{version++;},click:()=>click({target:{closest:()=>({dataset:{pt:'generate'},closest:()=>root})}}),rawClick:target=>click({target})};
}
/** 点击时没有资料也必须等待，完成后读取该周期刚加载的完整记录。 */
test('task generation waits for live records before sending frozen snapshot',async()=>{
 const h=harness(),pending=h.click();assert.equal(h.calls.length,0);
 h.load([{source:'shop-summary',data:{click:0}}]);h.release();await pending;
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].period.mode,'day');assert.equal(h.calls[0].records[0].data.click,0);
});
/** 日期变化、同日期页面刷新及离开页面均拒绝提交迟到快照。 */
test('task generation rejects changed period/page while awaiting data',async()=>{
 for(const action of ['change','samePeriodReload','detach']){
  const h=harness(),pending=h.click();if(action==='detach')h.root.isConnected=false;else h[action]();h.release();await pending;assert.equal(h.calls.length,0,action);
 }
});
/** 保存按钮和文本框不能向上命中任务卡根节点，否则浏览器submit之前表单就会被销毁。 */
test('form clicks are excluded from task/tab delegation',async()=>{
 const h=harness();let selector;
 await h.rawClick({closest:value=>{selector=value;return null;}});
 assert.equal(selector,'button[data-pt],button[data-pt-tab]');assert.equal(h.calls.length,0);
 assert.doesNotMatch(source,/el\.dataset\.ptTab\s*=/);
});
