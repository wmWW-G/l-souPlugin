'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const crypto=require('node:crypto');const{createPlanningTasks}=require('../lib/planning-tasks');
/** 隔离测试：模拟AW结果落盘，覆盖重启、去重、跨请求、人工状态及账号隔离。 */
test('planning task persistence, result correlation and lifecycle',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'planning-test-'));const scope='test-account';const dir=path.join(root,crypto.createHash('sha256').update(scope).digest('hex').slice(0,20));let launches=0;const config={root,scope,launch:async()=>{launches++;}};let store=createPlanningTasks(config);
 try{const id=crypto.randomUUID();await store.generate({period:{mode:'day',startDate:'2026-09-01',endDate:'2026-09-01'},requestId:id,records:[]});await store.generate({period:{mode:'day',startDate:'2026-09-01',endDate:'2026-09-01'},requestId:id,records:[]});assert.equal(launches,1);
 const output=path.join(dir,id,'result.json');const task={title:'核查转化',evidence:'单日数据不足',action:'读取同周期明细',acceptance:'核对表'};
 fs.writeFileSync(output,JSON.stringify({request_id:'wrong',tasks:[task]}));assert.equal(store.list().tasks.length,0);
 fs.writeFileSync(output,JSON.stringify({request_id:id,tasks:[task]}));let t=store.list().tasks[0];assert.equal(store.list().tasks.length,1);
 store.update({op:'complete',id:t.id,revision:t.revision});assert.throws(()=>store.update({op:'edit',id:t.id,revision:t.revision,title:'旧版本'}));
 store=createPlanningTasks(config);t=store.list().tasks[0];assert.equal(t.status,'done');
 const next=crypto.randomUUID();await store.generate({period:{mode:'day',startDate:'2026-09-01',endDate:'2026-09-01'},requestId:next});assert.equal(store.list().tasks[0].bucket,'history');assert.equal(JSON.parse(fs.readFileSync(path.join(dir,next,'input.json'))).existing_tasks[0].status,'done');
 t=store.list().tasks[0];store.update({op:'move',id:t.id,revision:t.revision,bucket:'recent'});t=store.list().tasks[0];store.update({op:'delete',id:t.id,revision:t.revision});t=store.list().tasks[0];assert.equal(t.deleted,true);store.update({op:'restore',id:t.id,revision:t.revision});assert.equal(store.list().tasks[0].deleted,false);
 assert.equal(createPlanningTasks({...config,scope:'other'}).list().tasks.length,0);
 store.update({op:'cancel',id:next});fs.writeFileSync(path.join(dir,next,'result.json'),JSON.stringify({request_id:next,tasks:[task]}));assert.equal(store.list().tasks.length,1);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
/** 两字段任务可直接新增、编辑并持久保存；旧模型格式仍由上一用例覆盖。 */
test('two-field task editing and v2 generation',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'planning-v2-'));const scope='v2';const dir=path.join(root,crypto.createHash('sha256').update(scope).digest('hex').slice(0,20));const store=createPlanningTasks({root,scope,launch:async()=>{}});
 try{let t=store.update({op:'add',work:'核对商品点击',reason:'曝光已有但点击数据缺失'}).tasks[0];store.update({op:'edit',id:t.id,revision:t.revision,work:'核对本月商品点击',reason:'需要统一统计周期'});assert.equal(store.list().tasks[0].reason,'需要统一统计周期');const id=crypto.randomUUID();await store.generate({period:{mode:'day',startDate:'2026-09-01',endDate:'2026-09-01'},requestId:id});fs.writeFileSync(path.join(dir,id,'result.json'),JSON.stringify({request_id:id,tasks:[{work:'检查主图',reason:'点击率偏低，先核实展示素材'}]}));const state=store.list();assert.equal(state.tasks[1].work,'检查主图');assert.equal(state.requests[0].skillVersion,2);assert.equal(state.tasks[0].bucket,'history');}finally{fs.rmSync(root,{recursive:true,force:true});}
});

/** 新请求必须提供真实完整日历周期，拒绝时不得留下请求或唤起AW。 */
test('generation validates complete day/week/month before persistence',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'planning-period-'));let launches=0;
 const store=createPlanningTasks({root,scope:'period',launch:async()=>{launches++;}});
 try{
  for(const period of [undefined,{}, {mode:'year'}, {mode:'day',startDate:'2026-02-30',endDate:'2026-02-30'}, {mode:'day',startDate:'2026-09-02',endDate:'2026-09-01'}, {mode:'day',startDate:'2026-09-01',endDate:'2026-09-02'}, {mode:'week',startDate:'2026-09-08',endDate:'2026-09-14'}, {mode:'month',startDate:'2026-08-01',endDate:'2026-08-30'}])await assert.rejects(store.generate({requestId:crypto.randomUUID(),period}));
  assert.equal(launches,0);assert.equal(store.list().requests.length,0);
  for(const period of [{mode:'day',startDate:'2026-09-01',endDate:'2026-09-01'},{mode:'week',startDate:'2026-09-07',endDate:'2026-09-13'},{mode:'month',startDate:'2026-08-01',endDate:'2026-08-31'}]){
   const id=crypto.randomUUID();await store.generate({requestId:id,period});assert.deepEqual(store.list().requests.at(-1).period,period);store.update({op:'cancel',id});
  }
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

/** 精确内容去重保留人工生命周期；相似动作但对象/理由不同必须保留。 */
test('normalized content deduplication retains edited/deleted history and distinct new evidence',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'planning-dedup-')),scope='dedup';
 const dir=path.join(root,crypto.createHash('sha256').update(scope).digest('hex').slice(0,20));
 const config={root,scope,launch:async()=>{}};let store=createPlanningTasks(config);
 const period={mode:'day',startDate:'2026-09-01',endDate:'2026-09-01'};
 const original={work:'核查 P001 点击',reason:'缺少 同期明细'};
 /** 在隔离请求目录模拟AW原子回传；tasks为模型任务，返回导入状态。 */
 async function deliver(tasks){const id=crypto.randomUUID();await store.generate({requestId:id,period});fs.writeFileSync(path.join(dir,id,'result.json'),JSON.stringify({request_id:id,tasks}));return store.list();}
 try{
  let state=await deliver([original,{work:' 核查  P001 点击 ',reason:'缺少\n同期明细'}]);assert.equal(state.tasks.length,1);
  let t=state.tasks[0];store.update({op:'edit',id:t.id,revision:t.revision,work:'人工修改的执行要求',reason:'人工补充'});
  t=store.list().tasks[0];store.update({op:'complete',id:t.id,revision:t.revision});t=store.list().tasks[0];store.update({op:'delete',id:t.id,revision:t.revision});
  store=createPlanningTasks(config);
  state=await deliver([original,{work:'核查 P002 点击',reason:original.reason},{work:original.work,reason:'新周期数据需要复核'}]);
  assert.equal(state.tasks.length,3);assert.equal(state.tasks[0].work,'人工修改的执行要求');assert.equal(state.tasks[0].status,'done');assert.equal(state.tasks[0].deleted,true);
  const input=JSON.parse(fs.readFileSync(path.join(dir,state.latest,'input.json'),'utf8'));
  assert.equal(input.metric_dictionary.pv.meaning,'搜索热度指数');assert.equal(input.metric_dictionary.shopUv.meaning,'该搜索词带来的本店访客数');
  const before=state.tasks.length;state=await deliver(Array.from({length:9},(_,i)=>({work:'新任务'+i,reason:'核查'})));
  assert.equal(state.requests.at(-1).status,'invalid');assert.equal(state.tasks.length,before);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
