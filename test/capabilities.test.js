'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createCapabilities,clean}=require('../lib/capabilities');
const catalog=require('../lib/capability-catalog.json');
/** 启动隔离HTTP服务，替换平台执行器；t为测试上下文；返回请求与调用记录；启动失败抛错。 */
async function fixture(t, overrides={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cap-test-')),calls=[];
 const service=createCapabilities({stateDir:directory,pushLog:()=>{},callEndpoint:async()=>({ok:true,data:{data:[{id:123,subject:'测试商品'}]}}),runWorkctl:async args=>{
  const params=JSON.parse(await fs.readFile(args[args.indexOf('--json-file')+1],'utf8'));calls.push({command:args.slice(0,3).join(' '),params,args});
  if(overrides.result)return {ok:true,durationMs:1,parsed:{success:true,data:overrides.result}};
  return {ok:true,durationMs:1,parsed:{success:true,data:args.includes('icbu-product-3d-eligibility-query')?{eligible:false}:{businessSuccess:true,token:'secret',value:'ok'}}};
 },...overrides.dependencies});
 const server=http.createServer((req,res)=>service.handle(req,res,new URL(req.url,'http://localhost')));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});});
 return {calls,async request(route,payload,headers={}){const r=await fetch(base+'/api/capabilities/'+route,payload===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(payload)});return r.json();},async done(){for(let i=0;i<100;i++){const r=await this.request('jobs');if(r.jobs.length&&r.jobs.every(j=>!['queued','running'].includes(j.status)))return r;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('任务未完成');}};
}
/** 由明确命令取得目录ID；leaf是完整组名与命令；返回字符串；缺失抛错。 */
function id(leaf){return catalog.tools.find(t=>t.command==='icbu '+leaf).id;}
test('105项唯一能力均在现有侧栏中，敏感连接与不完整接口不直接执行',async t=>{
 const f=await fixture(t);const data=await f.request('catalog');assert.equal(data.tools.length,105);assert.equal(new Set(data.tools.map(t=>t.id)).size,105);
 for(const name of ['tm get-token','tm send-msg','product icbu-product-generate-by-material'])assert.equal((await f.request('preview',{toolId:id(name),params:{}})).ok,false);
 assert.equal(f.calls.length,0);
});
test('确认票据绑定原始修改，重复确认只执行一次，响应清除凭据',async t=>{
 const f=await fixture(t),toolId=id('storefront create-preview-cloud');
 const preview=await f.request('preview',{toolId,params:{instruction:'生成店铺预览'}});assert.equal(preview.ok,true);
 assert.equal((await f.request('run',{toolId,ticket:preview.ticket})).ok,false);
 const body={toolId,ticket:preview.ticket,confirmed:true,params:{instruction:'被篡改'}};
 const [a,b]=await Promise.all([f.request('run',body),f.request('run',body)]);assert.equal(a.job.id,b.job.id);
 const result=await f.done();assert.equal(f.calls.length,1);assert.equal(f.calls[0].params.instruction,'生成店铺预览');assert.ok(f.calls[0].args.includes('--yes'));assert.equal(JSON.stringify(result).includes('secret'),false);
});
test('内部编号只能从查询结果选择，跨源与未知字段在执行前拒绝',async t=>{
 const f=await fixture(t),toolId=id('product query-product-by-id');
 assert.equal((await f.request('preview',{toolId,params:{productId:123}})).ok,false);
 const context=await f.request('context',{});const ref=context.choices.find(c=>c.name==='productId').ref;
 const preview=await f.request('preview',{toolId,params:{productId:ref}});assert.equal(preview.ok,true);
 assert.equal((await f.request('preview',{toolId,params:{productId:ref,bogus:true}})).ok,false);
 assert.equal((await f.request('preview',{toolId,params:{productId:ref}},{Origin:'https://evil.example'})).ok,false);
 assert.equal(f.calls.length,0);
});
test('3D生成必须先通过资格检查，失败不创建模型',async t=>{
 const f=await fixture(t),toolId=id('product icbu-product-3d-generate-from-video-url');
 const p=await f.request('preview',{toolId,params:{videoUrl:'https://example.com/video.mp4'}});await f.request('run',{toolId,ticket:p.ticket,confirmed:true});
 const r=await f.done();assert.equal(r.jobs[0].status,'failed');assert.equal(f.calls.length,1);assert.match(f.calls[0].command,/eligibility/);
});
test('嵌套字符串JSON结果也不会暴露凭据',()=>assert.deepEqual(clean({data:'{"password":"secret","title":"正常"}'}),{data:{title:'正常'}}));

test('风险工作区只接受真实对象引用，详情查询分别调用固定接口',async t=>{
 const f=await fixture(t);
 assert.equal((await f.request('risk',{action:'product',ref:'123'})).ok,false);
 assert.equal((await f.request('risk',{action:'execute',command:'anything'})).ok,false);
 const products=await f.request('risk',{action:'products'});assert.equal(products.data[0].title,'测试商品');
 assert.equal((await f.request('risk',{action:'supplier',ref:products.data[0].ref})).ok,false);
 assert.equal((await f.request('risk',{action:'analyze',ref:products.data[0].ref,destination:'invalid'})).ok,false);
 assert.equal(f.calls.length,0);
 const result=await f.request('risk',{action:'product',ref:products.data[0].ref});assert.equal(result.ok,true);
 assert.equal(f.calls.length,3);assert.ok(f.calls.every(c=>c.params.productId===123));
 assert.deepEqual(f.calls.map(c=>c.command).sort(),['icbu trade list-product-page','icbu trade list-product-punish-result','icbu trade list-product-violation-result-v2'].sort());
 assert.equal(JSON.stringify(result).includes('secret'),false);
});


test('RFQ批量保留逐条失败，报价仅返回业务字段，超限和非列表对象不调用平台',async t=>{
 const f=await fixture(t,{dependencies:{callEndpoint:async()=>({ok:true,data:{items:[{id:'11',title:'报价A'},{id:'12',title:'报价B'}]}})},result:{successMap:{'11':{productTitle:'商品A',unitPrice:'19.85',buyerEmail:'private@example.com',message:'private content'}},failedMap:{'12':'NOT_FOUND: 暂无报价'}}});
 assert.equal((await f.request('rfq',{action:'quotes',ids:Array(11).fill('11')})).ok,false);
 assert.equal((await f.request('rfq',{action:'quote',ids:['999']})).ok,false);assert.equal(f.calls.length,0);
 const r=await f.request('rfq',{action:'quotes',ids:['11','12']});assert.equal(r.ok,true);assert.equal(r.data.items[0].status,'succeeded');assert.equal(r.data.items[1].status,'failed');assert.equal(r.data.items[0].detail.currency,null);
 assert.deepEqual(f.calls[0].params,{quoteIds:[11,12]});assert.ok(f.calls[0].args.includes('--yes'));assert.equal(JSON.stringify(r).includes('private'),false);
});

test('行业选品校验类目引用、网址与周期，指数不累加，供应商使用独立店铺口径',async t=>{
 const f=await fixture(t,{dependencies:{callEndpoint:async()=>({ok:true,data:{data:[{categoryId:123,cateName:'测试类目'}]}})},result:[{prodName:'样本',price:'2~4',adminMbrId:'private-account',abCntIndex:[{ds:'20260907',tagValue:'0'},{ds:'20260906',tagValue:'2'}]}]});
 const base={action:'products',period:'30d',sort:'ab_cnt'};
 assert.equal((await f.request('flow',{...base,category:'123'})).ok,false);
 const context=await f.request('flow',{action:'categories'}),ref=context.data.categories[0].ref;
 assert.equal((await f.request('flow',{...base,category:ref,period:'90d'})).ok,false);
 assert.equal((await f.request('flow',{...base,action:'suppliers',shopUrl:'https://evil.example'})).ok,false);assert.equal(f.calls.length,0);
 const result=await f.request('flow',{...base,category:ref});assert.equal(result.ok,true);assert.equal(result.data.items[0].trends.abCntIndex[1].value,0);assert.equal(JSON.stringify(result).includes('private-account'),false);assert.equal(f.calls[0].params.cateId,123);
 const supplier=await f.request('flow',{...base,action:'suppliers',category:ref,shopUrl:'https://example.en.alibaba.com'});assert.equal(supplier.data.scope,'supplier');assert.equal(f.calls[1].params.domainId,'example');assert.equal(f.calls[1].params.cateId,undefined);
});
test('供应商平台成功但空数据明确返回空列表',async t=>{
 const f=await fixture(t,{result:{success:true,data:null}});const r=await f.request('flow',{action:'suppliers',shopUrl:'https://example.en.alibaba.com',period:'30d',sort:'ab_cnt'});assert.equal(r.ok,true);assert.deepEqual(r.data.items,[]);
});

test('广告资料使用当前账号和真实商品引用，不接受任意预订或内部编号',async t=>{
 const f=await fixture(t,{dependencies:{accountContext:async()=>({companyId:123,cateLv2Id:456,cateLv2Name:'智能电子'}),callEndpoint:async()=>({ok:true,data:{data:[{id:789,prodName:'本店商品'}]}})},result:456});
 const main=await f.request('ads',{action:'main'});assert.equal(main.data.name,'智能电子');assert.deepEqual(f.calls[0].params,{custId:123});
 assert.equal((await f.request('ads',{action:'reserve',productId:1,resourceList:[]})).ok,false);
 assert.equal((await f.request('ads',{action:'product',ref:'789'})).ok,false);assert.equal(f.calls.length,1);
 const context=await f.request('ads',{action:'products'});assert.equal(context.data.items[0].title,'本店商品');assert.ok(context.data.items[0].ref);
});
test('广告商品资料只返回实际标题，行为未知结构不暴露明细',async t=>{
 const f=await fixture(t,{dependencies:{callEndpoint:async()=>({ok:true,data:{data:[{id:789,prodName:'本店商品'}]}})},result:[{title:'平台标题',email:'private@example.com'}]});
 const c=await f.request('ads',{action:'products'});const d=await f.request('ads',{action:'product',ref:c.data.items[0].ref});assert.equal(d.data.items[0].title,'平台标题');assert.equal(JSON.stringify(d).includes('private'),false);assert.deepEqual(f.calls[0].params,{goodsIdList:['789']});
 const behaviors=await f.request('ads',{action:'behaviors'});assert.equal(behaviors.data.state,'unsupported');assert.equal(JSON.stringify(behaviors).includes('private'),false);
});

 test('辅助只读查询缓存复用，主动刷新覆盖缓存',async t=>{
   const f=await fixture(t,{result:[]});
   const [a,b]=await Promise.all([f.request('ads',{action:'behaviors'}),f.request('ads',{action:'behaviors'})]);
   assert.equal(a.ok,true);assert.equal(b.ok,true);assert.equal(f.calls.length,1);
   await f.request('ads',{action:'behaviors'});assert.equal(f.calls.length,1);
   await f.request('ads',{action:'behaviors'},{'X-Refresh-Data':'1'});assert.equal(f.calls.length,2);
   await f.request('ads',{action:'behaviors'});assert.equal(f.calls.length,2);
 });
