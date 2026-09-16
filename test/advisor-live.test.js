
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const policy=require('../public/time-policy');
/** 建立隔离浏览器环境，只测试读取/日期/缺失值边界。fetchImpl为网络替身，返回API，无主动异常。 */
function harness(fetchImpl){
 const context={window:{TimePolicy:{...policy,today:()=> '2026-09-16'}},document:{addEventListener(){},querySelector(){return null;}},fetch:fetchImpl,AbortSignal,console,Map};
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
