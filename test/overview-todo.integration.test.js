'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const vm = require('node:vm');

/** 隔离运行真实路由及磁盘存储，仅替换 Dify、Workctl 与时钟。@param {object} t 测试上下文。@returns {Promise<object>} 测试控制器。@throws 文件、启动或断言异常。 */
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lsou-todo-test-'));
  const control = path.join(dir, 'control.json');
  const calls = path.join(dir, 'calls.log');
  const preload = path.join(dir, 'mock.cjs');
  const inputs = path.join(dir, 'last-input.json');
  const workctl = path.join(dir, 'workctl.cjs');
  await fs.writeFile(workctl, `#!/usr/bin/env node
const product = {id: 'private-id', prodImage:'https://private.invalid/image', subject:'测试商品', sumProdShowNum:50, sumProdClickNum:3};
const data = process.argv.includes('data-advisor-shop-product') ? {recordCount:1,data:[product]} : [{statDate:'2026-09-07',sourceType:'SEARCH',subSourceType:'TOTAL',uv:9,abRate:0.1,secret:'never-send'}];
process.stdout.write(JSON.stringify({success:true,data}));
`);
  await fs.chmod(workctl, 0o700);
  await fs.writeFile(control, JSON.stringify({now:'2026-09-08T15:59:00Z'}));
  await fs.writeFile(preload, `
const fs = require('node:fs');
const state = () => JSON.parse(fs.readFileSync(${JSON.stringify(control)}, 'utf8'));
const NativeDate = Date;
global.Date = class extends NativeDate {
  constructor(...args) { super(...(args.length ? args : [state().now])); }
  static now() { return new NativeDate(state().now).getTime(); }
};
global.fetch = async (url, options) => {
  fs.writeFileSync(${JSON.stringify(inputs)}, JSON.parse(options.body).inputs.business_context);
  const config = state();
  fs.appendFileSync(${JSON.stringify(calls)}, 'call\\n');
  await new Promise(r => setTimeout(r, 100));
  if (JSON.parse(options.body).response_mode !== 'streaming') throw new Error('must use streaming');
  if (config.fail) return new Response('',{status:503});
  const final = {tasks:config.empty ? [] : [{title:'测试待办',priority:'normal',basis:'测试依据',steps:['检查数据'],acceptance_criteria:['核验结果']}]};
  const event = {event:'workflow_finished',data:{status:'succeeded',outputs:{result:{tasks:[]},raw_result:JSON.stringify(final)}}};
  return new Response('data: '+JSON.stringify(event)+'\\n\\n',{headers:{'content-type':'text/event-stream'}});
};
`);
  const port = 28000 + process.pid % 10000;
  let child;
  const stop = async () => {
    if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
  };
  const start = async (scope = 'test-account-a') => {
    await stop();
    child = spawn(process.execPath, ['--require', preload, path.resolve(__dirname, '../server.js')], {
      env:{...process.env, PORT:String(port), WORKCTL_BIN:workctl, DIFY_API_KEY:'test-key-only', ACCIO_ACTIVE_SPACE:scope, OVERVIEW_TODO_STATE_DIR:dir}, stdio:'ignore'
    });
    for (let n=0;n<100;n++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/api/overview-tasks`)).ok) return; } catch {}
      await new Promise(r=>setTimeout(r,30));
    }
    throw new Error('测试服务未启动');
  };
  const request = async (data, force = false) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/overview-tasks${force ? '?refresh=1' : ''}`, data === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    return {status:response.status,...await response.json()};
  };
  t.after(async () => {await stop(); await fs.rm(dir,{recursive:true,force:true});});
  await start();
  return {dir,start,request,input:async()=>JSON.parse(await fs.readFile(inputs,'utf8')),set: async value => fs.writeFile(control,JSON.stringify(value)),count:async () => (await fs.readFile(calls,'utf8').catch(()=>'' )).split('\n').filter(Boolean).length};
}

const snapshot = {module:'overview',metrics:[{key:'test',value:1}],period:{startDate:'2026-08-09',endDate:'2026-09-07'}};

test('待办每日持久化、手动更新、并发去重、失败保留和账号隔离', async t => {
  const f = await fixture(t);
  assert.equal((await f.request()).shouldGenerate,true);
  assert.equal(await f.count(),0, 'GET 不调用模型');
  assert.equal((await f.request({})).status,502);
  assert.equal((await f.request()).shouldGenerate,true,'无效输入不占用当日更新机会');
  const results = await Promise.all([f.request(snapshot),f.request(snapshot),f.request(snapshot,true)]);
  assert.equal(await f.count(),1,'并发手动和自动请求合并');
  assert.ok(results.every(r=>r.ok && r.result.tasks.length===1));
  const input = await f.input();
  assert.equal(input.operational_evidence.products.rows[0].subject,'测试商品');
  assert.equal(input.operational_evidence.products.rows[0].sumProdFbNum,undefined,'缺项不得补零');
  assert.equal(input.operational_evidence.products.rows[0].id,undefined,'内部ID不得入模型');
  assert.equal(input.operational_evidence.products.rows[0].prodImage,undefined);
  assert.equal(input.operational_evidence.channels.rows[0].secret,undefined);
  assert.match(input.operational_evidence.products.scope,/并非全店/);
  const first = results[0].result;
  assert.equal(first.diagnosisVersion,2);
  assert.equal(first.benchmarks.length,6);
  const files = (await fs.readdir(f.dir)).filter(name=>name.startsWith('overview-todo-'));
  assert.equal(files.length,1);
  assert.equal((await fs.stat(path.join(f.dir,files[0]))).mode & 0o777,0o600);
  await f.start();
  assert.deepEqual((await f.request()).result,first,'重启恢复');
  await f.request({...snapshot,period:{startDate:'2026-01-01',endDate:'2026-01-31'}});
  assert.equal(await f.count(),1,'切换周期不额外生成');
  assert.deepEqual((await f.request()).result.period,snapshot.period);
  await f.request(snapshot,true);
  assert.equal(await f.count(),2,'手动更新绕过当天缓存');
  await f.set({now:'2026-09-08T16:01:00Z',fail:true});
  assert.equal((await f.request()).shouldGenerate,true,'北京时间跨日，而非 UTC 跨日');
  assert.equal((await f.request(snapshot)).status,502);
  assert.deepEqual((await f.request()).result,first,'更新失败保留旧结果');
  await f.start();
  await f.request(snapshot);
  assert.equal(await f.count(),3,'失败后重启及刷新不自动重试');
  await f.set({now:'2026-09-08T16:02:00Z',empty:true});
  assert.equal((await f.request(snapshot,true)).result.tasks.length,0);
  await f.start();
  await f.request(snapshot);
  assert.equal(await f.count(),4,'零条待办也持久化并复用');
  await f.set({now:'2026-09-09T16:01:00Z'});
  await Promise.all([f.request(snapshot),f.request(snapshot)]);
  assert.equal(await f.count(),5,'次日自动更新一次');
  await f.start('test-account-b');
  assert.equal((await f.request()).result,null,'其他账号看不到保存结果');
  await f.request(snapshot);
  assert.equal(await f.count(),6);
  const scope = crypto.createHash('sha256').update('test-account-b').digest('hex').slice(0,16);
  const file = path.join(f.dir,`overview-todo-${scope}.json`);
  const saved = JSON.parse(await fs.readFile(file,'utf8'));
  await fs.writeFile(file,JSON.stringify({...saved,result:null,status:'running'}));
  await f.start('test-account-b');
  assert.match((await f.request()).notice,/中断/);
  await f.request(snapshot);
  assert.equal(await f.count(),6,'上次进程中断不自动重复计费');
});

test('前端优先显示保存结果，刷新和切换周期不等待数据或调用模型', async () => {
  const source = await fs.readFile(path.resolve(__dirname,'../public/app.js'),'utf8');
  const nodes = new Map();
  const calls = [];
  const saved = {ok:true,shouldGenerate:false,result:{tasks:[{title:'已保存任务',priority:'high',basis:'测试依据',steps:['核对来源','整理表格'],acceptance_criteria:['形成清单']}],generatedAt:'2026-09-08T00:00:00Z',period:snapshot.period}};
  saved.result.diagnosisVersion = 2;
  saved.result.benchmarks = [{label:'曝光量',display:{current:'50',average:'100',excellent:'200'},direction:'higher_better',vs_average:{state:'behind',text:'低 50.0%'},vs_excellent:{state:'behind',text:'低 75.0%'}}];
  const context = vm.createContext({
    document:{documentElement:{classList:{add(){},remove(){}}}},window:{},AbortController,console,
    $: selector => {if(!nodes.has(selector)) nodes.set(selector,{querySelector:()=>({}),scrollIntoView:()=>{},setAttribute:()=>{},showModal(){this.open=true;},close(){this.open=false;this.onclose?.();},classList:{remove(){}},focus(){}}); return nodes.get(selector);},
    dates:()=>snapshot.period,esc:String,
    fetch:async (url,options)=>{calls.push([url,options]);return {ok:true,json:async()=>saved};}
  });
  vm.runInContext(source.slice(source.indexOf('let overviewTodoRevision ='),source.indexOf('/**\n * 并行读取渠道')),context);
  vm.runInContext('overviewInsightPromise = new Promise(() => {}); renderActionItems();',context);
  await vm.runInContext('generateOverviewTodo()',context);
  await vm.runInContext('generateOverviewTodo()',context);
  assert.equal(calls.length,2);
  assert.ok(calls.every(([,options])=>!options.method));
  assert.match(nodes.get('#actionList').innerHTML,/已保存任务/);
  assert.match(nodes.get('#overviewTodoMeta').textContent,/2026-08-09 至 2026-09-07/);
  assert.equal(nodes.get('#generateOverviewTasks').textContent,'更新诊断');
  assert.match(nodes.get('#diagnosisBenchmarks').innerHTML,/行业均值/);
  assert.match(nodes.get('#diagnosisBenchmarks').innerHTML,/行业优秀/);
  assert.match(nodes.get('#diagnosisBenchmarks').innerHTML,/1项低于均值/);
  // 用户已要求默认展示优化诊断；旧断言仍期待指标对标，更新为当前交互约定。
  assert.equal(nodes.get('#actionList').hidden,false);
  assert.equal(nodes.get('#diagnosisBenchmarks').hidden,true);
  nodes.get('#diagnosisCompareView').onclick();
  assert.equal(nodes.get('#actionList').hidden,true);
  nodes.get('#diagnosisInsightsView').onclick();
  assert.equal(nodes.get('#actionList').hidden,false);
  assert.equal(nodes.get('#diagnosisBenchmarks').hidden,true);
  vm.runInContext('overviewTodoSelected = 0; renderOverviewTodoDetail();', context);
  assert.equal(nodes.get('#overviewTodoDetail').hidden,false);
  assert.equal(nodes.get('#overviewTodoDetail').open,true,'使用模态弹窗');
  assert.match(nodes.get('#overviewTodoDetail').innerHTML,/测试依据/);
  assert.match(nodes.get('#overviewTodoDetail').innerHTML,/整理表格/);
  assert.match(nodes.get('#overviewTodoDetail').innerHTML,/形成清单/);
  assert.equal(calls.length,2,'展开方案不调用生成接口');
  nodes.get('#overviewTodoDetail').oncancel({preventDefault(){}});
  assert.equal(nodes.get('#overviewTodoDetail').open,false,'Esc关闭');
  assert.equal(nodes.get('#overviewTodoDetail').hidden,true);
  // 只有用户显式更新才组装快照并发送 refresh=1。
  vm.runInContext('overviewInsightPromise = Promise.resolve(); var KPIS = []; var summaryRows = [];', context);
  await vm.runInContext('generateOverviewTodo(true)', context);
  assert.equal(calls.length,4);
  assert.equal(calls[3][0],'/api/overview-tasks?refresh=1');
  assert.equal(calls[3][1].method,'POST');
});

/** 从真实服务提取纯输出处理函数，测试分片、异常和严格校验，无外部请求。 */
test('Dify 流式分片、最终文本恢复、异常保留与零任务语义', async () => {
  const source = await fs.readFile(path.resolve(__dirname,'../server.js'),'utf8');
  const context = vm.createContext({TextDecoder, console:{log(){}}});
  vm.runInContext(source.slice(source.indexOf('async function readOverviewWorkflowResponse('),source.indexOf('// 保存的是用户待办')),context);
  const valid = {tasks:[{title:'核查曝光',priority:'high',basis:'曝光下降，原因待确认',steps:['核对日期'],acceptance_criteria:['形成记录']}]};
  const output = {result:{tasks:[]},raw_result:'<think>内部内容</think>\n```json\n'+JSON.stringify(valid)+'\n```'};
  const wire = ': ping\r\n\r\ndata: '+JSON.stringify({event:'text_chunk',data:{text:'中间信息'}})+'\r\n\r\ndata: '+JSON.stringify({event:'workflow_finished',data:{status:'succeeded',outputs:output}})+'\r\n\r\n';
  const bytes = new TextEncoder().encode(wire);
  let index=0;
  const response = new Response(new ReadableStream({pull(controller){
    if(index>=bytes.length) return controller.close();
    controller.enqueue(bytes.slice(index,index+=7));
  }}),{headers:{'content-type':'text/event-stream'}});
  const result=await context.readOverviewWorkflowResponse(response);
  assert.deepEqual(JSON.parse(JSON.stringify(context.validateOverviewTaskOutputs(result.data.outputs))),valid,'空结构化结果应从最终 JSON 恢复');
  assert.equal(context.validateOverviewTaskOutputs({result:{tasks:[]},raw_result:'{"tasks":[]}'}).tasks.length,0,'真实空结果仍可缓存');
  assert.throws(()=>context.validateOverviewTaskOutputs({result:{tasks:[]},raw_result:'broken'}),/有效 JSON/);
  assert.throws(()=>context.validateOverviewTaskOutputs({raw_result:JSON.stringify({tasks:[{...valid.tasks[0],steps:['x'.repeat(201)]}]})}),/字段/);
  await assert.rejects(context.readOverviewWorkflowResponse(new Response('data: {"event":"workflow_started"}\n\n',{headers:{'content-type':'text/event-stream'}})),/中断/);
  await assert.rejects(context.readOverviewWorkflowResponse(new Response('data: {"event":"error"}\n\n',{headers:{'content-type':'text/event-stream'}})),/执行失败/);
  await assert.rejects(context.readOverviewWorkflowResponse(new Response('data: invalid\n\n',{headers:{'content-type':'text/event-stream'}})),/无效事件/);
});

/** 对标计算必须保留方向、零值与缺失语义，避免把没有数据的指标诊断为落后。 */
test('六项对标覆盖均值/优秀、反向指标、百分点与缺失日期', async () => {
  const source = await fs.readFile(path.resolve(__dirname,'../server.js'),'utf8');
  const start = source.indexOf('function buildOverviewBenchmarks(');
  const end = source.indexOf('/**', start);
  const build = vm.runInNewContext(source.slice(start,end)+'\nbuildOverviewBenchmarks');
  const rows = [{totalImpsCnt:50,totalImpsCntRivalAvg:100,totalImpsCntRivalGood:200,
    fstReplyRate30d:0.98,fstReplyRate30dRivalAvg:0.9,fstReplyRate30dRivalGood:0.99,
    avgReplyTime30d:3,avgReplyTime30dRivalAvg:4,avgReplyTime30dRivalGood:2,
    sucOrdCnt:0,sucOrdCntRivalAvg:0,sucOrdCntRivalGood:2}];
  const result = build({trend:rows});
  assert.equal(result.length,6);
  assert.equal(result[0].vs_average.text,'低 50.0%');
  assert.equal(result[0].vs_excellent.text,'低 75.0%');
  assert.equal(result[4].vs_average.text,'高 8.00个百分点');
  assert.equal(result[4].vs_excellent.state,'behind');
  assert.equal(result[5].vs_average.state,'better');
  assert.equal(result[5].vs_excellent.state,'behind');
  assert.equal(result[1].current,null);
  assert.equal(result[1].vs_average.state,'unknown');
  assert.equal(result[3].vs_average.state,'equal');
  assert.equal(build({trend:[...rows,{totalImpsCnt:10}]})[0].average,null,'同行缺一天不可用不完整合计比较');
  assert.equal(build({trend:[...rows,{fstReplyRate30d:null}]})[4].current,null,'最新快照缺失不得沿用之前的值');
});

/** 重放真实首稿的越界判断，确保后续不会仅因JSON合法就保存错误诊断。 */
test('诊断拒绝未授权折算点击率与因果证明，允许明确的证据边界', async () => {
  const source=await fs.readFile(path.resolve(__dirname,'../server.js'),'utf8');
  const start=source.indexOf('function validateOverviewDiagnosisClaims(');
  const validate=vm.runInNewContext(source.slice(start,source.indexOf('// 保存的是用户待办',start))+'\nvalidateOverviewDiagnosisClaims');
  const task={title:'点击量不足',basis:'曝光与点击折算点击率',steps:[],acceptance_criteria:[]};
  assert.throws(()=>validate([task]),/比率或因果/);
  assert.throws(()=>validate([{...task,basis:'曝光回到原水平即证明因果'}]),/因果/);
  assert.throws(()=>validate([{...task,basis:'点击率提升说明主图假设成立'}]),/因果/);
  assert.doesNotThrow(()=>validate([{...task,basis:'曝光回升只能支持假设，不能单凭前后变化证明因果'}]));
});

/** 十二项顶部指标保持快照/累计/缺失语义，不把扩展展示发送成新的诊断输入。 */
test('顶部指标区分零值、缺失、最新商品快照与每日访客累计', async () => {
  const source = await fs.readFile(path.resolve(__dirname, '../public/app.js'), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('const KPIS = ['), source.indexOf('let curKpi =')), context);
  const start = source.indexOf('function overviewMetricValue(');
  vm.runInContext('let summaryRows = [];\n' + source.slice(start, source.indexOf('/**', start)), context);
  vm.runInContext('summaryRows = [{uvCnt:4,validProdCnt:10,sucOrdCnt:0},{uvCnt:5,validProdCnt:12,sucOrdCnt:0}]', context);
  const value = key => vm.runInContext(`overviewMetricValue(OVERVIEW_KPIS.find(m => m.k === '${key}'))`, context);
  assert.equal(value('validProdCnt'), 12, '商品数不跨天累加');
  assert.equal(value('uvCnt'), 9, '每日人数累加而非周期去重');
  assert.equal(value('sucOrdCnt'), 0, '真实零订单应显示0');
  assert.equal(value('goodProdCnt'), null, '字段未返回不得显示0');
  vm.runInContext('summaryRows[1].uvCnt = null; summaryRows[1].validProdCnt = ""', context);
  assert.equal(value('uvCnt'), null, '部分缺失不显示不完整合计');
  assert.equal(value('validProdCnt'), null, '最新快照缺失不回填旧值');
  assert.equal(vm.runInContext('OVERVIEW_KPIS.length', context), 12);
  assert.equal(vm.runInContext('KPIS.length', context), 6, '诊断输入保持原有六项');
});
