'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {buildSnapshot,validateAnalysis,createAiAdvisor,consumeSSE,answerText,MODULES}=require('../lib/ai-advisor');

/** 生成明确标记的合成页面输入；module为页名，返回测试数据，不代表真实经营。 */
function input(module='product') {return {module,period:{startDate:'2026-09-01',endDate:'2026-09-09'},records:[{source:'合成测试',label:'商品效果',data:{exposure:1000,click:20,inquiry:2},observed_at:'2026-09-10T01:00:00Z',scope:'仅测试商品A'}]};}
/** 构造模型输出样本，故意附带不可信导航/状态；snapshot为可信输入，返回待校验对象。 */
function output(snapshot) {return {schema_version:'2.0',module:snapshot.module,snapshot_id:snapshot.snapshot_id,status:'ok',summary:'测试：先核对搜索需求。',tasks:[{title:'核对商品主词',priority:'normal',basis:'测试数据有曝光1000、点击20；不能直接归因于主图。',steps:['核对真实搜索词。'],acceptance_criteria:['用同范围数据复查。'],hypotheses:['词与商品相关性待确认。'],missing_data:['实际搜索词'],follow_up_questions:['下一步怎么检查？'],entity_ref:'',evidence_ids:[snapshot.facts[0].id],action_ids:['open_page'],state:'completed'}],suggested_questions:['怎么核对搜索需求？'],actions:[{id:'fake-delete',type:'delete'}]};}
/** 生成任意字节分片的UTF-8 SSE响应；events为对象数组，size为分片大小，返回Response。 */
function sse(events,size=7){const bytes=new TextEncoder().encode(events.map(e=>'data: '+JSON.stringify(e)+'\r\n\r\n').join(''));let offset=0;return new Response(new ReadableStream({pull(controller){if(offset>=bytes.length){controller.close();return;}controller.enqueue(bytes.slice(offset,offset+size));offset+=size;}}),{headers:{'content-type':'text/event-stream'}});}
/** 建立隔离服务和伪造Dify接口；t为测试上下文，fetchImpl为可控调用，返回服务/目录，结束自动清理。 */
function fixture(t,fetchImpl){const root=fs.mkdtempSync(path.join(os.tmpdir(),'lsou-advisor-test-'));fs.writeFileSync(path.join(root,'.env.advisor'),'DIFY_ANALYSIS_API_KEY=test-workflow\nDIFY_CHATFLOW_API_KEY=test-chat\n',{mode:0o600});t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {root,service:createAiAdvisor({root,scope:'account-a',stateDir:root,fetchImpl,log:()=>{}})};}

test('六页范围与账号/日期隔离，同一事实跨读取时间复用',()=>{
  for(const module of Object.keys(MODULES))assert.equal(buildSnapshot(input(module),'a').module,module);
  for(const module of ['rfq','risk','constructor'])assert.throws(()=>buildSnapshot(input(module),'a'));
  const data=input(),one=buildSnapshot(data,'a');data.records[0].observed_at='2026-09-10T02:00:00Z';
  assert.equal(buildSnapshot(data,'a').snapshot_id,one.snapshot_id);
  assert.notEqual(buildSnapshot(data,'b').snapshot_id,one.snapshot_id);
  data.period.endDate='2026-09-08';assert.notEqual(buildSnapshot(data,'a').snapshot_id,one.snapshot_id);
  data.period.endDate='2026-02-30';assert.throws(()=>buildSnapshot(data,'a'));
});

test('过滤凭据和联系方式，失败及只有筛选时不伪装为业务事实',()=>{
  const data=input();data.records[0].data={token:'PRIVATE_TOKEN',email:'PRIVATE_EMAIL',buyerId:'PRIVATE_ID',nested:{password:'PRIVATE_PASSWORD'},exposure:0,click:null};
  data.records.push({source:'广告',error:true,data:{spend:0}});
  const snapshot=buildSnapshot(data,'a'),serialized=JSON.stringify(snapshot);
  assert.doesNotMatch(serialized,/PRIVATE_/);assert.equal(snapshot.data_status,'partial');assert.match(serialized,/exposure\\":0/);
  data.records=[{source:'筛选',contextOnly:true,data:{country:'US'}},{source:'广告',error:true}];
  assert.equal(buildSnapshot(data,'a').facts.length,0);assert.equal(buildSnapshot(data,'a').data_status,'error');
});

test('大数据快照有界，并优先保留当前选中商品',()=>{
  const data=input();data.records=Array.from({length:30},(_,i)=>({source:'测试'+i,data:Array.from({length:50},(_,j)=>({title:'商品'+j,text:'描述'.repeat(950)}))}));
  data.object={ref:'product-current',label:'选中商品',data:{title:'当前款式',click:12}};
  const snapshot=buildSnapshot(data,'a');assert.ok(JSON.stringify(snapshot).length<40500);assert.ok(snapshot.facts.length<=80);assert.equal(snapshot.facts[0].entity_ref,'product-current');assert.equal(snapshot.data_status,'partial');
});

test('分析绑定原始证据与安全入口，拒绝错范围和伪造引用',()=>{
  const snapshot=buildSnapshot(input(),'a'),raw=output(snapshot),result=validateAnalysis(raw,snapshot);
  assert.equal(result.tasks[0].state,'suggested');assert.equal(result.actions[0].type,'navigate');assert.equal(result.evidence[0].text,snapshot.facts[0].text);
  assert.throws(()=>validateAnalysis({...raw,snapshot_id:'wrong'},snapshot));
  raw.tasks[0].evidence_ids=['fake'];assert.throws(()=>validateAnalysis(raw,snapshot));
  assert.throws(()=>validateAnalysis({raw_result:'not-json'},snapshot));
  assert.equal(validateAnalysis({...output(snapshot),tasks:[]},snapshot).tasks.length,0);
});

test('Workflow正常与数据不足结束字段分别解析，未执行分支的null可忽略',()=>{
  const snapshot=buildSnapshot(input(),'a'),normal=output(snapshot);
  for(const envelope of [{result:normal},{raw_result:JSON.stringify(normal)},
    {result:normal,raw_result:JSON.stringify(normal),error_result:null,error_raw_result:''}]) {
    assert.equal(validateAnalysis(envelope,snapshot).status,'ok');
  }
  const emptySnapshot=buildSnapshot({...input(),records:[]},'a');
  const empty={schema_version:'2.0',module:emptySnapshot.module,snapshot_id:emptySnapshot.snapshot_id,
    status:'needs_data',summary:'测试：当前数据不足。',tasks:[],suggested_questions:['继续判断还缺什么数据？']};
  for(const envelope of [{error_result:empty},{error_raw_result:JSON.stringify(empty)},
    {result:null,raw_result:null,error_result:empty,error_raw_result:JSON.stringify(empty)}]) {
    const result=validateAnalysis(envelope,emptySnapshot);
    assert.equal(result.status,'needs_data');assert.deepEqual(result.tasks,[]);assert.deepEqual(result.evidence,[]);
  }
});

test('冲突结束分支、损坏JSON和伪装成正常诊断的错误分支会被拒绝',()=>{
  const snapshot=buildSnapshot(input(),'a'),normal=output(snapshot);
  assert.throws(()=>validateAnalysis({result:normal,error_result:normal},snapshot),/同时返回/);
  assert.throws(()=>validateAnalysis({result:normal,raw_result:JSON.stringify({...normal,summary:'不同结果'})},snapshot),/不一致/);
  assert.throws(()=>validateAnalysis({error_raw_result:'not-json'},snapshot),/有效JSON/);
  assert.throws(()=>validateAnalysis({error_raw_result:normal},snapshot),/文本字段类型/);
  assert.throws(()=>validateAnalysis({error_result:normal},snapshot),/不匹配的状态/);
});

test('action_ids按Schema保留空列表或可信引用，不自动生成模型未选择的入口',()=>{
  const snapshot=buildSnapshot(input(),'a'),raw=output(snapshot);
  raw.tasks[0].action_ids=[];assert.deepEqual(validateAnalysis(raw,snapshot).actions,[]);
  for(const ids of [['fake-delete'],['open_page','open_page']]) {
    raw.tasks[0].action_ids=ids;assert.throws(()=>validateAnalysis(raw,snapshot),/入口/);
  }
  raw.tasks[0].action_ids=['open_page'];const result=validateAnalysis(raw,snapshot);
  assert.deepEqual(result.tasks[0].action_ids,['open_page']);assert.equal(result.actions[0].target_tab,'product');
});

test('后端字段边界与公开Output Schema一致，防止后续只改一处',()=>{
  const schema=require('../dify-chatflows/overview-todo.output-schema.json');
  const fields=schema.properties.tasks.items.properties,snapshot=buildSnapshot(input(),'a');
  for(const name of ['title','basis']) {
    const raw=output(snapshot);raw.tasks[0][name]='字'.repeat(fields[name].maxLength);
    assert.doesNotThrow(()=>validateAnalysis(raw,snapshot));raw.tasks[0][name]+='字';
    assert.throws(()=>validateAnalysis(raw,snapshot),/文本/);
  }
  for(const name of ['steps','acceptance_criteria','hypotheses','missing_data','follow_up_questions']) {
    const raw=output(snapshot),field=fields[name];raw.tasks[0][name]=Array(field.maxItems).fill('字'.repeat(field.items.maxLength));
    assert.doesNotThrow(()=>validateAnalysis(raw,snapshot));raw.tasks[0][name].push('超出约定');
    assert.throws(()=>validateAnalysis(raw,snapshot),/列表/);
    raw.tasks[0][name]=Array(field.minItems).fill('有效文本');assert.doesNotThrow(()=>validateAnalysis(raw,snapshot));
  }
  const raw=output(snapshot);raw.summary='字'.repeat(schema.properties.summary.maxLength);
  assert.doesNotThrow(()=>validateAnalysis(raw,snapshot));raw.summary+='字';assert.throws(()=>validateAnalysis(raw,snapshot),/文本/);
});

test('现有Workflow Key可复用，专用分析Key优先，Chatflow保持独立配置',async t=>{
  const credentials=[];
  const {root,service}=fixture(t,async(url,options)=>{
    credentials.push(options.headers.Authorization);
    const snapshot=JSON.parse(JSON.parse(options.body).inputs.business_context);
    return sse([{event:'workflow_finished',data:{status:'succeeded',outputs:{result:output(snapshot)}}}]);
  });
  fs.unlinkSync(path.join(root,'.env.advisor'));
  fs.writeFileSync(path.join(root,'.env.dify'),'DIFY_API_KEY=test-existing-workflow\n',{mode:0o600});
  assert.equal(service.status().analysisConfigured,true);assert.equal(service.status().chatConfigured,false);
  const {snapshot}=service.context(input());await service.analyze(snapshot.snapshot_id);
  fs.writeFileSync(path.join(root,'.env.advisor'),'DIFY_ANALYSIS_API_KEY=test-specific-workflow\n',{mode:0o600});
  await service.analyze(snapshot.snapshot_id,true);
  assert.deepEqual(credentials,['Bearer test-existing-workflow','Bearer test-specific-workflow']);
  assert.equal(service.status().chatConfigured,false);
});

test('真实SSE结束格式可承接数据不足分支，执行失败不伪装成缺数据',async t=>{
  let failed=false;
  const {service}=fixture(t,async(url,options)=>{
    const snapshot=JSON.parse(JSON.parse(options.body).inputs.business_context);
    const result={schema_version:'2.0',module:snapshot.module,snapshot_id:snapshot.snapshot_id,
      status:'needs_data',summary:'测试：当前数据不足。',tasks:[],suggested_questions:['这页应该怎么看？']};
    return sse([{event:'workflow_finished',data:{status:failed?'failed':'succeeded',
      outputs:failed?{}:{error_result:result,error_raw_result:JSON.stringify(result)}}}]);
  });
  const {snapshot}=service.context({...input(),records:[]});
  const result=await service.analyze(snapshot.snapshot_id);assert.equal(result.status,'needs_data');
  failed=true;await assert.rejects(service.analyze(snapshot.snapshot_id,true),/未成功/);
  assert.equal(service.context({...input(),records:[]}).result.status,'needs_data');
});

test('流式解析跨UTF-8与CRLF边界，不显示思考文本',async()=>{
  const events=[];await consumeSSE(sse([{event:'message',answer:'中文分片'}],1).body,e=>events.push(e));assert.equal(events[0].answer,'中文分片');
  assert.equal(answerText('<think>不可显示</think>正文'),'正文');assert.equal(answerText('<thi'),'');assert.equal(answerText('<think>思考中'),'');
});

test('分析并发去重、跨重启缓存和失败保留，私有文件权限正确',async t=>{
  let calls=0,fail=false;
  const {root,service}=fixture(t,async(url,options)=>{calls++;if(fail)return new Response('',{status:503});const snapshot=JSON.parse(JSON.parse(options.body).inputs.business_context);await new Promise(resolve=>setTimeout(resolve,10));return sse([{event:'workflow_finished',data:{status:'succeeded',outputs:{raw_result:JSON.stringify(output(snapshot))}}}]);});
  const {snapshot}=service.context(input());const [first,second]=await Promise.all([service.analyze(snapshot.snapshot_id),service.analyze(snapshot.snapshot_id)]);assert.equal(calls,1);assert.deepEqual(first,second);
  fail=true;await assert.rejects(service.analyze(snapshot.snapshot_id,true));assert.deepEqual(service.context(input()).result,first);
  const file=fs.readdirSync(root).find(x=>x.startsWith('advisor-'));assert.equal(fs.statSync(path.join(root,file)).mode&0o777,0o600);
  const restored=createAiAdvisor({root,scope:'account-a',stateDir:root,fetchImpl:()=>{throw Error('不应调用');},log:()=>{}});assert.deepEqual(restored.context(input()).result,first);
});

test('多轮会话始终携带本轮快照，忽略中间节点并拒绝跨页复用',async t=>{
  const sent=[];const {service}=fixture(t,async(url,options)=>{sent.push(JSON.parse(options.body));return sse([{event:'node_finished',data:{outputs:{text:'中间思考'}}},{event:'message',answer:'<think>思考</think>测试答复',conversation_id:'remote-conversation'},{event:'message_end',conversation_id:'remote-conversation'}]);});
  const first=service.context(input()).snapshot,events=[];await service.chat({snapshot_id:first.snapshot_id,question:'这个指标是什么意思？'},e=>events.push(e));
  const session=events.find(e=>e.type==='meta').session_id;assert.equal(events.find(e=>e.type==='answer').text,'测试答复');assert.equal(events.at(-1).type,'done');
  const next=input();next.records[0].data.click=30;const second=service.context(next).snapshot;
  await service.chat({snapshot_id:second.snapshot_id,question:'那这次呢？',session_id:session},()=>{});
  assert.equal(sent[1].conversation_id,'remote-conversation');assert.equal(JSON.parse(sent[1].query).business_context.snapshot_id,second.snapshot_id);assert.notEqual(second.snapshot_id,first.snapshot_id);
  const market=service.context(input('market')).snapshot;await assert.rejects(service.chat({snapshot_id:market.snapshot_id,question:'继续',session_id:session},()=>{}));assert.equal(sent.length,2);
});

test('问答断流不标记完成，保留已收到的正文',async t=>{
  const {service}=fixture(t,async()=>sse([{event:'message',answer:'已收到一部分'}]));const {snapshot}=service.context(input());const events=[];
  await assert.rejects(service.chat({snapshot_id:snapshot.snapshot_id,question:'解释'},e=>events.push(e)),/中断/);assert.ok(events.some(e=>e.type==='answer'));assert.ok(!events.some(e=>e.type==='done'));
});

test('月缓存跨日周和数据变化复用，重启后无需重新读取业务数据',async t=>{
  let calls=0;
  const {root,service}=fixture(t,async(url,options)=>{calls++;const snapshot=JSON.parse(JSON.parse(options.body).inputs.business_context);return sse([{event:'workflow_finished',data:{status:'succeeded',outputs:{result:output(snapshot)}}}]);});
  const month={...input('overview'),period:{startDate:'2026-08-01',endDate:'2026-08-31',grain:'month'}};
  const first=service.context(month),saved=await service.analyze(first.snapshot.snapshot_id);
  for(const grain of ['day','week'])assert.equal(service.cached({...month,period:{startDate:'2026-08-01',endDate:grain==='day'?'2026-08-01':'2026-08-07',grain}}).result,null);
  const changed=structuredClone(month);changed.records[0].data.click=999;
  const now=service.context(changed);assert.notEqual(now.snapshot.snapshot_id,saved.snapshot_id);assert.deepEqual(now.result,saved);
  assert.equal(now.cached_snapshot.snapshot_id,saved.snapshot_id);assert.notDeepEqual(now.cached_snapshot.facts,now.snapshot.facts);
  assert.deepEqual(await service.analyze(now.snapshot.snapshot_id),saved);assert.equal(calls,1);
  const notReady=service.context({...month,records:[]}).snapshot;
  await assert.rejects(service.analyze(notReady.snapshot_id,true),/尚未就绪/);assert.equal(calls,1);assert.deepEqual(service.cached(month).result,saved);
  const restored=createAiAdvisor({root,scope:'account-a',stateDir:root,fetchImpl:()=>{throw Error('缓存不应付费生成');},log:()=>{}});
  assert.deepEqual(restored.cached({...month,records:[]}).result,saved);
  assert.equal(restored.getSnapshot(saved.snapshot_id).snapshot_id,saved.snapshot_id);
  for(const variant of [{...month,module:'visitor'},{...month,period:{...month.period,grain:'range'}},{...month,cache_scope:{country:'US'}}])assert.equal(restored.cached(variant).result,null);
  const other=createAiAdvisor({root,scope:'account-b',stateDir:root,log:()=>{}});assert.equal(other.cached(month).result,null);
  const updated=await service.analyze(now.snapshot.snapshot_id,true);assert.equal(calls,2);assert.equal(updated.snapshot_id,now.snapshot.snapshot_id);
});

test('同一范围的不同快照并发生成只调用一次，超过30份仍保留首月',async t=>{
  let calls=0;
  const {root,service}=fixture(t,async(url,options)=>{calls++;const snapshot=JSON.parse(JSON.parse(options.body).inputs.business_context);await new Promise(resolve=>setImmediate(resolve));return sse([{event:'workflow_finished',data:{status:'succeeded',outputs:{result:output(snapshot)}}}]);});
  const one=input(),two=structuredClone(one);two.records[0].data.click=999;
  const a=service.context(one).snapshot,b=service.context(two).snapshot;
  const results=await Promise.all([service.analyze(a.snapshot_id),service.analyze(b.snapshot_id)]);
  assert.deepEqual(results[0],results[1]);assert.equal(calls,1);
  for(let n=0;n<35;n++){const next=service.context({...one,cache_scope:{page:n}}).snapshot;await service.analyze(next.snapshot_id);}
  const restarted=createAiAdvisor({root,scope:'account-a',stateDir:root,log:()=>{}});
  assert.deepEqual(restarted.cached(one).result,results[0]);
});

test('旧总览缓存按原周期迁移，引用数据保留且不串到带筛选的范围',async t=>{
  const {root,service}=fixture(t,async(url,options)=>{const snapshot=JSON.parse(JSON.parse(options.body).inputs.business_context);return sse([{event:'workflow_finished',data:{status:'succeeded',outputs:{result:output(snapshot)}}}]);});
  const month={...input('overview'),period:{startDate:'2026-08-01',endDate:'2026-08-31'}};
  const old=await service.analyze(service.context(month).snapshot.snapshot_id);
  const file=path.join(root,fs.readdirSync(root).find(name=>name.startsWith('advisor-')));fs.writeFileSync(file,JSON.stringify({version:2,results:[old]}));
  const restored=createAiAdvisor({root,scope:'account-a',stateDir:root,log:()=>{}});
  assert.equal(restored.cached({...month,cache_scope:{country:'US'}}).result,null);
  const cached=restored.cached({...month,period:{...month.period,grain:'month'},records:[]});
  assert.deepEqual(cached.result,old);assert.deepEqual(cached.cached_snapshot.facts,old.evidence);
  assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).version,3);
});

test('同一商品的限时编辑引用变化不丢缓存，不同商品仍隔离',async t=>{
  const {service}=fixture(t,async(url,options)=>{const snapshot=JSON.parse(JSON.parse(options.body).inputs.business_context);return sse([{event:'workflow_finished',data:{status:'succeeded',outputs:{result:output(snapshot)}}}]);});
  const data={...input(),object:{ref:'temporary-edit-one',cache_ref:'a'.repeat(32),label:'合成商品',data:{clicks:20}}};
  const first=service.context(data),saved=await service.analyze(first.snapshot.snapshot_id);
  data.object.ref='temporary-edit-two';
  const changed=service.context(data);assert.deepEqual(changed.result,saved);
  assert.equal(changed.cached_snapshot.entities[0].ref,'temporary-edit-one');assert.equal(changed.snapshot.entities[0].ref,'temporary-edit-two');
  data.object.cache_ref='b'.repeat(32);assert.equal(service.cached(data).result,null);
});
