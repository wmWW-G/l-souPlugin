'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const TimePolicy=require('../public/time-policy');
const code=fs.readFileSync(require.resolve('../public/consultant.js'),'utf8');
/** 用最小DOM验证新增只读请求与输出边界。@param {Function} fetchImpl 请求实现。@returns {object} 隔离环境。@throws 代码解析失败。 */
function harness(fetchImpl) {
  const elements=new Map();
  const document={getElementById(id){if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',isConnected:true});return elements.get(id);},querySelector(){return null;},addEventListener(){}};
  const context={window:{defaultTimeValue:()=> '2026-08'},document,console:{info(){},warn(){}},URLSearchParams,fetch:fetchImpl,localStorage:{getItem:()=>null},TimePolicy:{validate:(key,p)=>TimePolicy.validate(key,p,undefined,'2026-09-16')}};
  vm.runInNewContext(code,context);
  return {api:context.window.LsouConsultant,elements};
}
test('成员绩效拒绝旧周期响应覆盖新周期，保留缺失而非补零',async()=>{
  const pending=[];const h=harness(()=>new Promise(resolve=>pending.push(resolve)));
  const first=h.api.dashboard({mode:'month',startDate:'2026-07-01',endDate:'2026-07-31'});
  const second=h.api.dashboard({mode:'month',startDate:'2026-08-01',endDate:'2026-08-31'});
  pending[1]({ok:true,json:async()=>({ok:true,data:[{'2026-08':[{fullName:'新周期成员',fbPv:0}]}]})});await second;
  pending[0]({ok:true,json:async()=>({ok:true,data:[{'2026-07':[{fullName:'旧周期成员',fbPv:99}]}]})});await first;
  const html=h.elements.get('consultStaffRows').innerHTML;
  assert.match(html,/新周期成员/);assert.doesNotMatch(html,/旧周期成员/);assert.match(html,/<td>0<\/td>/);assert.match(html,/—/);
});
test('平台字符串按文本转义，自定义区间不虚构绩效合计',async()=>{
  let count=0;const h=harness(async()=>{count++;return {ok:true,json:async()=>({ok:true,data:[{'2026-08':[{fullName:'<img src=x onerror=alert(1)>'}]}]})};});
  await h.api.dashboard({mode:'month',startDate:'2026-08-01',endDate:'2026-08-31'});
  assert.match(h.elements.get('consultStaffRows').innerHTML,/&lt;img/);assert.doesNotMatch(h.elements.get('consultStaffRows').innerHTML,/<img/);
  await h.api.dashboard({mode:'range'});assert.equal(count,1);assert.match(h.elements.get('consultStaffRows').innerHTML,/不合并/);
});
test('核心品使用已有商品接口的statDate合同，不调用发布写接口',async()=>{
  const calls=[];const h=harness(async url=>{calls.push(url);return {ok:true,json:async()=>({ok:true,data:{population:0,focusProducts:{}}})};});
  h.api.render('cultivation');await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.length,1);assert.match(calls[0],/^\/api\/dashboard\/product-analysis\?/);assert.match(calls[0],/statDate=2026-08-01/);assert.match(calls[0],/statisticsType=month/);
  assert.match(h.elements.get('consultCoreRows').innerHTML,/没有返回可用商品/);
});
