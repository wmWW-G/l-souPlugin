'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createAwHandoff,openAW,launchErrorDetails}=require('../lib/aw-handoff');
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
test('定位主题只选资料，明确点击分析交由持久报告入口，不触发旧Dify',async()=>{
 const vm=require('node:vm'),calls=[],listeners={};
 const context={window:{AdvisorReports:{attach:page=>calls.push(['attach',page]),select:(...args)=>calls.push(['select',...args]),start:(...args)=>calls.push(['start',...args])}},document:{addEventListener:(type,handler)=>{listeners[type]=handler;}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../public/advisor-services.js'),'utf8'),context);
 context.window.AdvisorServices.attach('position');context.window.AdvisorServices.open('position',4);assert.equal(calls.filter(x=>x[0]==='start').length,0);
 listeners.click({target:{closest:()=>({hasAttribute:key=>key==='data-position-analyze',dataset:{positionAnalyze:'4'}})}});
 assert.deepEqual(calls.at(-1),['start','position',4]);
});

test('Windows用系统协议打开完整长链接，中文和特殊字符不插入PowerShell命令',async()=>{
 const url='accio://chat/new?'+new URLSearchParams({query:'中文路径 C:\\Users\\测试用户\\Accio Work\\input.json；\'" & % $() `\n'.repeat(80),launchId:'windows-protocol-regression',source:'lsou-analysis'});
 const env={SystemRoot:'D:\\Windows',PRESERVED:'yes'};let invocation;
 await openAW(url,{platform:'win32',env,run:(command,args,options,done)=>{invocation={command,args,options};done(null,'','');}});
 assert.ok(url.length>4765);
 assert.equal(invocation.command,'D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
 assert.match(invocation.args.at(-1),/Start-Process -FilePath \$env:LSOU_ACCIO_OPEN_URI/);
 assert.ok(!invocation.args.some(arg=>arg.includes(url)));
 assert.equal(invocation.options.env.LSOU_ACCIO_OPEN_URI,url);
 assert.equal(invocation.options.env.PRESERVED,'yes');assert.equal(env.LSOU_ACCIO_OPEN_URI,undefined);
 assert.equal(invocation.options.shell,undefined);assert.ok(!invocation.args.includes('-ExecutionPolicy'));
});

test('Mac和Linux保持原协议打开方式，不改变参数或增加重试',async()=>{
 for(const [platform,command] of [['darwin','open'],['linux','xdg-open']]){
  const calls=[];const url='accio://chat/new?query=test';
  await openAW(url,{platform,run:(...args)=>{calls.push(args);args[3](null);}});
  assert.equal(calls.length,1);assert.equal(calls[0][0],command);assert.deepEqual(calls[0][1],[url]);assert.equal(calls[0][2].env,undefined);
 }
});

test('唤起失败保留系统错误码和超时字段，仅记录白名单诊断',async()=>{
 const raw=new Error('sensitive URL accio://chat/new?query=private');Object.assign(raw,{code:1,errno:-5,killed:false,signal:null});
 let calls=0,caught;
 try{await openAW('accio://chat/new?query=test',{platform:'win32',run:(_command,_args,_options,done)=>{calls++;done(raw,'',JSON.stringify({stage:'shell_execute',hresult:-2147467259,nativeErrorCode:1155,message:'apiKey=secret C:\\Users\\private'}));}});}catch(error){caught=error;}
 assert.equal(calls,1);assert.match(caught.message,/未能打开 Accio Work/);
 assert.deepEqual(launchErrorDetails(caught),{code:1,errno:-5,signal:null,killed:false,stderrPresent:true,stage:'shell_execute',hresult:-2147467259,nativeErrorCode:1155});
 assert.doesNotMatch(JSON.stringify(caught),/secret|private|accio:\/\//);
 const timeout=launchErrorDetails({code:'ETIMEDOUT',signal:'SIGTERM',killed:true},'secret URL and path');
 assert.equal(timeout.code,'ETIMEDOUT');assert.equal(timeout.killed,true);assert.equal(timeout.stderrPresent,true);assert.doesNotMatch(JSON.stringify(timeout),/secret|URL|path/);
});

test('非法协议不启动进程，同步启动错误也保留脱敏诊断',async()=>{
 let calls=0;const run=()=>{calls++;const e=new Error('private path');e.code='ENOENT';throw e;};
 await assert.rejects(openAW('https://example.com',{platform:'win32',run}),/链接格式/);assert.equal(calls,0);
 await assert.rejects(openAW('accio://chat/new?query=test',{platform:'win32',run}),e=>e.launchDiagnostic.code==='ENOENT'&&!e.message.includes('private'));assert.equal(calls,1);
});
