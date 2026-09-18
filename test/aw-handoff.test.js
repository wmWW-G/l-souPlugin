'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createAwHandoff}=require('../lib/aw-handoff');
/** 独立临时交接目录；测试结束删除，不接触真实账号快照。 */
function setup(t,launch){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'aw-handoff-test-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return {directory,api:createAwHandoff({scope:'test-account',directory,launch,log(){}})};}
const input=()=>({requestId:'test-handoff-123456789',index:0,period:{startDate:'2026-08-01'},data:{countries:[{name:'US',rate:0}],missing:null,apiKey:'must-not-export',nested:{authorization:'hidden',query:'full keyword'}}});
test('完整保存零值/缺项并剔除凭据；消息只引用本机文件，同一次点击只唤起一次',async t=>{
 const urls=[];let finish;const {api,directory}=setup(t,url=>{urls.push(url);return new Promise(r=>{finish=r;});});
 const first=api.send(input()),second=api.send(input());assert.equal(urls.length,1);finish();assert.deepEqual(await first,await second);
 const folder=path.join(directory,fs.readdirSync(directory)[0]),file=path.join(folder,fs.readdirSync(folder)[0]);const data=JSON.parse(fs.readFileSync(file)).data;
 assert.equal(data.countries[0].rate,0);assert.equal(data.missing,null);assert.equal(data.apiKey,undefined);assert.equal(data.nested.authorization,undefined);assert.equal(data.nested.query,'full keyword');
 const url=new URL(urls[0]);assert.equal(url.protocol,'accio:');assert.equal(url.hostname,'chat');assert.equal(url.pathname,'/new');assert.ok(url.searchParams.get('query').includes(file));assert.ok(!url.href.includes('full keyword'));assert.equal(fs.statSync(file).mode&0o777,0o600);
 await assert.rejects(api.send({...input(),index:1}),/数据已变化/);
});
test('拒绝路径注入和过大快照；启动失败不冒充成功，也不自动重发',async t=>{
 let calls=0;const {api}=setup(t,async()=>{calls++;throw new Error('launch failed');});
 await assert.rejects(api.send({...input(),requestId:'../../unsafe'}));
 await assert.rejects(api.send({...input(),data:{text:'x'.repeat(2000000)}}),/较多/);assert.equal(calls,0);
 await assert.rejects(api.send(input()),/launch failed/);await assert.rejects(api.send(input()),/launch failed/);assert.equal(calls,1);
});
test('定位按钮只发AW请求，保留当前页范围且阻止重复点击，不触发Dify',async()=>{
 const vm=require('node:vm');let finish;const calls=[];
 const button={disabled:false,textContent:''},status={textContent:''};const host={querySelector:s=>s==='[data-position-analyze]'?button:status};
 const context={crypto:{randomUUID:()=> 'frontend-test-12345678'},window:{AdvisorUI:{esc:String},AdvisorPositionExport:index=>({topicIndex:index,countries:[{country:'US'}]}),AdvisorLive:{range:()=>({startDate:'2026-08-01',endDate:'2026-08-31'})}},document:{addEventListener(){},getElementById:()=>host},fetch:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});await new Promise(resolve=>{finish=resolve;});return {ok:true,json:async()=>({ok:true,launch_requested:true})};}};
 let source=fs.readFileSync(require.resolve('../public/advisor-services.js'),'utf8').replace('window.AdvisorServices={open,attach,action,showData};',"currentPage='position';window.AdvisorServices={startPosition};");
 vm.runInNewContext(source,context);const api=context.window.AdvisorServices;
 const running=api.startPosition(0);await api.startPosition(0);assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/advisor/aw-handoff');assert.equal(calls[0].body.data.countries[0].country,'US');assert.equal(button.disabled,true);finish();await running;assert.equal(button.disabled,false);assert.match(status.textContent,/已请求打开/);
});
