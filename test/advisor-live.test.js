
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const policy=require('../public/time-policy');
/** 建立隔离浏览器环境，只测试读取/日期/缺失值边界。fetchImpl为网络替身，返回API，无主动异常。 */
function harness(fetchImpl){
 const context={window:{TimePolicy:{...policy,today:()=> '2026-09-16'}},document:{addEventListener(){},querySelector(){return null;}},fetch:fetchImpl,AbortSignal,console,Map,structuredClone};
 vm.runInNewContext(fs.readFileSync(require.resolve('../public/advisor-design.js'),'utf8'),context);
 return context.window.AdvisorLive;
}
test('新版默认完整月，不把缺失数值变成零',()=>{
 const api=harness();const range=api.range();
 assert.equal(range.startDate,'2026-08-01');assert.equal(range.endDate,'2026-08-31');assert.equal(range.mode,'month');
 assert.equal(api.format(null),'—');assert.equal(api.format(undefined),'—');assert.equal(api.format(''),'—');assert.equal(api.format(0),'0');
 range.startDate='1990-01-01';assert.equal(api.range().startDate,'2026-08-01');
});
test('同一路径并发读取合并，失败可重试且不回退示例',async()=>{
 let resolve,calls=0;
 const api=harness(()=>{calls++;return new Promise(r=>resolve=r);});
 const first=api.fetch('/api/q/shop-summary');const second=api.fetch('/api/q/shop-summary');
 assert.equal(calls,1);resolve({ok:false,json:async()=>({ok:false,error:'读取失败'})});
 const results=await Promise.allSettled([first,second]);assert.ok(results.every(r=>r.status==='rejected'));
 const retry=api.fetch('/api/q/shop-summary');assert.equal(calls,2);resolve({ok:true,json:async()=>({ok:true,data:[]})});
 assert.equal((await retry).data.length,0);
});
test('共享数据读取拒绝写接口与外部地址',async()=>{
 let calls=0;const api=harness(()=>{calls++;});
 await assert.rejects(api.fetch('/api/publish/jobs'));
 await assert.rejects(api.fetch('https://example.com/api/q/shop-summary'));
 assert.equal(calls,0);
});
test('服务快照仅收录成功的真实读取，并保留各接口参数口径',async()=>{
 const api=harness(async path=>({ok:!path.includes('failed'),json:async()=>path.includes('failed')?{ok:false,error:'failed'}:{ok:true,data:{count:7}}}));
 await api.fetch('/api/q/shop-product?statisticsType=month');
 await assert.rejects(api.fetch('/api/q/failed'));
 const records=api.records();assert.equal(records.length,1);assert.equal(records[0].source,'/api/q/shop-product');assert.equal(records[0].scope,'statisticsType=month');assert.equal(records[0].data.count,7);
});
test('自动分析等待正在读取的店铺资料，读取失败不会阻塞已成功资料',async()=>{
 const resolvers=[];const api=harness(()=>new Promise(resolve=>resolvers.push(resolve)));
 const reads=[api.fetch('/api/q/shop-summary'),api.fetch('/api/q/shop-product')];
 const results=Promise.allSettled(reads);let ready=false;
 const waiting=api.ready().then(()=>{ready=true;});await Promise.resolve();assert.equal(ready,false);
 resolvers[0]({ok:true,json:async()=>({ok:true,data:{count:9}})});
 resolvers[1]({ok:false,json:async()=>({ok:false,error:'暂不可用'})});
 await results;await waiting;assert.equal(ready,true);assert.equal(api.records().length,1);
});
