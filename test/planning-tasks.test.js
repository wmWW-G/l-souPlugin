'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const crypto=require('node:crypto');const{createPlanningTasks}=require('../lib/planning-tasks');
/** 隔离测试：模拟AW结果落盘，覆盖重启、去重、跨请求、人工状态及账号隔离。 */
test('planning task persistence, result correlation and lifecycle',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'planning-test-'));const scope='test-account';const dir=path.join(root,crypto.createHash('sha256').update(scope).digest('hex').slice(0,20));let launches=0;const config={root,scope,launch:async()=>{launches++;}};let store=createPlanningTasks(config);
 try{const id=crypto.randomUUID();await store.generate({requestId:id,records:[]});await store.generate({requestId:id,records:[]});assert.equal(launches,1);
 const output=path.join(dir,id,'result.json');const task={title:'核查转化',evidence:'单日数据不足',action:'读取同周期明细',acceptance:'核对表'};
 fs.writeFileSync(output,JSON.stringify({request_id:'wrong',tasks:[task]}));assert.equal(store.list().tasks.length,0);
 fs.writeFileSync(output,JSON.stringify({request_id:id,tasks:[task]}));let t=store.list().tasks[0];assert.equal(store.list().tasks.length,1);
 store.update({op:'complete',id:t.id,revision:t.revision});assert.throws(()=>store.update({op:'edit',id:t.id,revision:t.revision,title:'旧版本'}));
 store=createPlanningTasks(config);t=store.list().tasks[0];assert.equal(t.status,'done');
 const next=crypto.randomUUID();await store.generate({requestId:next});assert.equal(store.list().tasks[0].bucket,'history');assert.equal(JSON.parse(fs.readFileSync(path.join(dir,next,'input.json'))).existing_tasks[0].status,'done');
 t=store.list().tasks[0];store.update({op:'move',id:t.id,revision:t.revision,bucket:'recent'});t=store.list().tasks[0];store.update({op:'delete',id:t.id,revision:t.revision});t=store.list().tasks[0];assert.equal(t.deleted,true);store.update({op:'restore',id:t.id,revision:t.revision});assert.equal(store.list().tasks[0].deleted,false);
 assert.equal(createPlanningTasks({...config,scope:'other'}).list().tasks.length,0);
 store.update({op:'cancel',id:next});fs.writeFileSync(path.join(dir,next,'result.json'),JSON.stringify({request_id:next,tasks:[task]}));assert.equal(store.list().tasks.length,1);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
/** 两字段任务可直接新增、编辑并持久保存；旧模型格式仍由上一用例覆盖。 */
test('two-field task editing and v2 generation',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'planning-v2-'));const scope='v2';const dir=path.join(root,crypto.createHash('sha256').update(scope).digest('hex').slice(0,20));const store=createPlanningTasks({root,scope,launch:async()=>{}});
 try{let t=store.update({op:'add',work:'核对商品点击',reason:'曝光已有但点击数据缺失'}).tasks[0];store.update({op:'edit',id:t.id,revision:t.revision,work:'核对本月商品点击',reason:'需要统一统计周期'});assert.equal(store.list().tasks[0].reason,'需要统一统计周期');const id=crypto.randomUUID();await store.generate({requestId:id});fs.writeFileSync(path.join(dir,id,'result.json'),JSON.stringify({request_id:id,tasks:[{work:'检查主图',reason:'点击率偏低，先核实展示素材'}]}));const state=store.list();assert.equal(state.tasks[1].work,'检查主图');assert.equal(state.requests[0].skillVersion,2);assert.equal(state.tasks[0].bucket,'history');}finally{fs.rmSync(root,{recursive:true,force:true});}
});
