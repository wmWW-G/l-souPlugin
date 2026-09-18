'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {QueryCache}=require('../lib/query-cache');
test('复用成功快照、合并请求、强制更新，失败保留旧值',async()=>{
 const c=new QueryCache();let calls=0;
 const work=async()=>({ok:true,value:++calls});
 const [a,b]=await Promise.all([c.read('a',work),c.read('a',work)]);
 assert.equal(a.value,b.value);assert.equal(calls,1);
 await c.read('a',work);assert.equal(calls,1);
 await c.read('a',work,{force:true});assert.equal(calls,2);
 await c.read('a',async()=>({ok:false}),{force:true});
 assert.equal((await c.read('a',work)).value,2);
});
test('刷新后旧在途响应不能覆盖新结果',async()=>{
 const c=new QueryCache();let release;
 const old=c.read('a',()=>new Promise(r=>release=r));c.clear();
 await c.read('a',async()=>({ok:true,value:'new'}));
 release({ok:true,value:'old'});await old;
 assert.equal((await c.read('a',()=>assert.fail())).value,'new');
});
test('商品查询全局最多两路并发且失败后释放队列',async()=>{
 const c=new QueryCache();let running=0,maximum=0;
 await Promise.all(Array.from({length:8},(_,i)=>c.read(String(i),async()=>{
  running++;maximum=Math.max(maximum,running);
  await new Promise(r=>setTimeout(r,5));running--;
  return {ok:i!==0};
 },{limited:true})));
 assert.equal(maximum,2);assert.equal(c.active,0);
});
