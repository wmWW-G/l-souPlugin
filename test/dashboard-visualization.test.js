'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const app = fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
const ops = fs.readFileSync(path.join(__dirname,'../public/operations.js'),'utf8');
const advisor = fs.readFileSync(path.join(__dirname,'../public/ai-advisor.js'),'utf8');
const advisorCtx = vm.createContext({});
/** 运行实际前端纯函数，不建立浏览器或模型连接。@param {string} name 函数名。@returns {void}。@throws 源函数缺失。 */
function loadAdvisorFunction(name){const start=advisor.indexOf('  function '+name+'(');assert.ok(start>=0);const end=advisor.indexOf('\n  /**',start);vm.runInContext(advisor.slice(start,end),advisorCtx);}
vm.runInContext('const config={chatConfigured:true};'+advisor.split('\n').find(line=>line.startsWith('  const esc='))+advisor.split('\n').find(line=>line.startsWith('  const PRIORITIES=')),advisorCtx);
for(const name of ['findingAppearance','findingRows','detailPlacement','detailList','findingDetail','renderAnswer'])loadAdvisorFunction(name);

test('建议气泡桌面优先向左，边缘与窄屏保持可见',()=>{
  const left=advisorCtx.detailPlacement({left:867,right:1330,top:600,height:68},{width:1375,height:934},580);
  assert.equal(left.side,'left');assert.equal(left.left+left.width,853);
  assert.ok(left.top>=12&&left.top+580<=922);
  const right=advisorCtx.detailPlacement({left:40,right:260,top:30,height:68},{width:1200,height:900},500);
  assert.equal(right.side,'right');assert.equal(right.left,274);
  for(const width of [320,390,680,1024,1375])for(const height of [320,640,934]){
    const viewport={width,height};const placement=advisorCtx.detailPlacement({left:width*.62,right:width-20,top:height-100,height:68},viewport,900);
    assert.ok(placement.left>=12&&placement.left+placement.width<=width-12);
    assert.ok(placement.top>=12&&placement.top+placement.maxHeight<=height-12);
    if(width<680)assert.equal(placement.side,'sheet');
  }
});

test('六页建议行使用同一气泡入口，长正文不再内联展开且动态文本转义',()=>{
  const task={id:'finding-1',title:'曝光<svg onload=alert(1)>',priority:'high',basis:'依据<&>，完整内容保留'};
  for(const module of ['overview','visitor','product','flow','market','ads']){
    const html=advisorCtx.findingRows({module},{tasks:[task]});
    assert.match(html,/data-advisor-detail="finding"/);assert.match(html,/aria-haspopup="dialog"/);
    assert.match(html,/data-finding="finding-1"/);assert.doesNotMatch(html,/<details|<svg/);
    assert.match(html,/&lt;svg/);assert.match(html,/依据&lt;&amp;&gt;/);
  }
});

test('建议气泡保留业务内容和追问，但不展示原始证据入口',()=>{
  const task={id:'finding-1',title:'诊断',priority:'high',basis:'事实<引用>',hypotheses:['原因待验证'],steps:['先核对报表'],acceptance_criteria:['同口径复查'],missing_data:['缺失报价资料'],evidence_ids:['fact-1'],follow_up_questions:['应该怎么检查？'],action_ids:['open_page']};
  const state={result:{evidence:[{id:'fact-1',label:'原始数据'}],actions:[{id:'open_page',label:'查看经营总览'}]}};
  const html=advisorCtx.findingDetail(state,task);
  for(const text of ['事实&lt;引用&gt;','原因待验证','先核对报表','同口径复查','缺失报价资料','应该怎么检查？','查看经营总览'])assert.ok(html.includes(text));
  assert.doesNotMatch(html,/data-advisor-fact|原始数据|数据依据|<pre/);assert.match(html,/data-advisor-action="open_page"/);
  vm.runInContext('config.chatConfigured=false',advisorCtx);
  assert.doesNotMatch(advisorCtx.findingDetail(state,task),/data-advisor-question/);
  vm.runInContext('config.chatConfigured=true',advisorCtx);
});
test('聊天正文不再暴露证据标记或JSON按钮，仍转义模型HTML',()=>{
  const html=advisorCtx.renderAnswer('**关键发现** [证据:f_123] <script>bad</script>');
  assert.match(html,/<strong>关键发现<\/strong>/);assert.match(html,/&lt;script&gt;/);
  assert.doesNotMatch(html,/\[证据|<button|<script>/);
});

test('前端切回月份同步显示缓存，迟到的其他周期响应不会覆盖它',async()=>{
  let period={startDate:'2026-08-01',endDate:'2026-08-31',grain:'month'},releaseDay;
  const saved={snapshot_id:'saved-month',summary:'已经保存的8月解读',generated_at:'2026-09-10T00:00:00Z'};
  const requests=[];
  const context=vm.createContext({window:{getAdvisorPageContext:()=>({period,cache_scope:{},records:[]})},request:async(route,body)=>{
    requests.push(route);assert.equal(route,'cache');
    if(body.period.grain==='day')return new Promise(resolve=>{releaseDay=resolve;});
    return {result:saved,cached_snapshot:{snapshot_id:'saved-month',facts:[{id:'fact'}]}};
  },renderCard:()=>{}});
  vm.runInContext('const pages=new Map(),savedViews=new Map(),MODULES={overview:"经营总览"};',context);
  for(const name of ['page','stableView','remember','inputFor','restoreView']){
    const start=advisor.indexOf('  function '+name+'(');vm.runInContext(advisor.slice(start,advisor.indexOf('\n  /**',start)),context);
  }
  const state=context.page('overview');await context.restoreView(state);assert.equal(state.result.summary,saved.summary);
  period={startDate:'2026-08-03',endDate:'2026-08-03',grain:'day'};state.version++;state.restoring=null;
  const late=context.restoreView(state);assert.equal(state.result,null);
  period={startDate:'2026-08-01',endDate:'2026-08-31',grain:'month'};state.version++;state.restoring=null;
  const current=context.restoreView(state);assert.equal(state.result.summary,saved.summary); // 不等网络，即时恢复。
  await current;releaseDay({result:{snapshot_id:'day',summary:'日解读'},cached_snapshot:{snapshot_id:'day'}});await late;
  assert.equal(state.result.snapshot_id,'saved-month');assert.deepEqual(requests,['cache','cache','cache']);
});
test('显式生成的准备期间切换周期，不会误为新周期发起付费请求',async()=>{
  let finish,calls=0;
  const context=vm.createContext({refresh:()=>new Promise(resolve=>{finish=resolve;}),request:()=>{calls++;throw Error('不应调用模型');},renderCard:()=>{}});
  const start=advisor.indexOf('  async function analyze(');vm.runInContext(advisor.slice(start,advisor.indexOf('\n  /**',start)),context);
  const state={module:'overview',version:1,viewKey:'month',analyzing:false};
  const running=context.analyze(state);state.version++;state.viewKey='day';state.snapshot={snapshot_id:'day'};finish(state);await running;
  assert.equal(calls,0);assert.equal(state.analyzing,false);
});
const ctx = vm.createContext({});
vm.runInContext(app.slice(app.indexOf('function staffMetric('),app.indexOf('/** 三类绩效同屏展示')),ctx);
const recordStart = ops.indexOf('  function riskRecords(data)');
vm.runInContext(ops.slice(recordStart,ops.indexOf('  /** 直接展示商品',recordStart)),ctx);
test('员工指标兼容两种回复时长字段，保留缺项和真实零值',()=>{
  assert.equal(ctx.staffMetric({replyAvgTime:'2.94'},'avgReplyTime'),2.94);
  assert.equal(ctx.staffMetric({avgReplyTime:'3.74',replyAvgTime:'2.94'},'avgReplyTime'),3.74);
  assert.equal(ctx.staffMetric({clicks:0},'clicks'),0);
  assert.equal(ctx.staffMetric({clicks:''},'clicks'),null);
  assert.equal(ctx.staffMetric({},'clicks'),null);
});
test('风险计数不能生成商品记录；同一违规明细不重复显示',()=>{
  assert.equal(ctx.riskRecords({totalRiskProdCnt:1,highFreqComplaintProdCnt:1}).length,0);
  const row={violationId:1,productId:22,productTitle:'Actual product',violationType:'countryRestrictedSale'};
  const records=ctx.riskRecords({latestViolation:row,violationList:[row,{...row,violationId:2}]});
  assert.equal(records.length,2);
  assert.equal(records[0].productId,22);
  assert.equal(records[0].violationType,'countryRestrictedSale');
});

const orderLabelStart=ops.indexOf('  function orderLabel(');
vm.runInContext(ops.slice(orderLabelStart,ops.indexOf('  /** 格式化平台日期',orderLabelStart)),ctx);
const distributionStart=ops.indexOf('  function orderDistribution(');
vm.runInContext(ops.slice(distributionStart,ops.indexOf('  /** 绘制本页环形图',distributionStart)),ctx);
test('订单分布只计返回行，并保留未知与缺失状态',()=>{
  const rows=[{status:{status:'unpay'}},{status:'unpay'},{status:'trade_success'},{status:null},{status:'NEW_STATE'}];
  const result=ctx.orderDistribution(rows,row=>row.status);
  assert.deepEqual(JSON.parse(JSON.stringify(result)),[['待付款',2],['交易成功',1],['状态未返回',1],['NEW_STATE',1]]);
  assert.equal(result.reduce((sum,item)=>sum+item[1],0),rows.length);
  assert.equal(ctx.orderDistribution([],row=>row.status).length,0);
});
test('合同金额保留币种与真实零值，缺失金额不伪装成零',()=>{
  assert.equal(ctx.orderMoney({amount:0,currency:{currencyCode:'USD'}}),'0 USD');
  assert.equal(ctx.orderMoney({amount:166.5,currency:{currencyCode:'USD'}}),'166.5 USD');
  assert.equal(ctx.orderMoney({amount:null,currency:'CNY'}),'未返回');
  assert.equal(ctx.orderMoney({amount:'',currency:'CNY'}),'未返回');
  assert.equal(ctx.orderMoney({amount:10}),'10 币种未返回');
});

const rankingStart=app.indexOf('function rankedOverviewProducts(');
vm.runInContext(app.slice(rankingStart,app.indexOf('/** 分页读取商品样本',rankingStart)),ctx);
test('商品榜从完整集合选前五，保留零值，排除缺项且不改原数组',()=>{
  const rows=[{id:1,clicks:0},{id:2,clicks:null},{id:3,clicks:''},{id:4,clicks:2},{id:5,clicks:8},{id:6,clicks:7},{id:7,clicks:6},{id:8,clicks:100}];
  const before=JSON.stringify(rows);
  assert.deepEqual(Array.from(ctx.rankedOverviewProducts(rows,'clicks'),r=>r.id),[8,5,6,7,4]);
  assert.equal(JSON.stringify(rows),before);
  assert.equal(ctx.rankedOverviewProducts([{id:1,clicks:0}],'clicks').length,1);
  assert.equal(ctx.rankedOverviewProducts([{id:1,clicks:0}],'clicks',true).length,0);
  assert.equal(ctx.rankedOverviewProducts([{id:1,clicks:null}],'clicks').length,0);
});

const periodStart=app.indexOf('function overviewProductPeriod(');
vm.runInContext(app.slice(periodStart,app.indexOf('/** 从完整商品集合',periodStart)),ctx);
test('商品榜明确传递自然月日期和周期，不接受空月份回退成单日',()=>{
  const result=ctx.overviewProductPeriod('2026-08');
  assert.equal(result.statDate,'2026-08-01');
  assert.equal(result.statisticsType,'month');
  assert.throws(()=>ctx.overviewProductPeriod(''));
  assert.throws(()=>ctx.overviewProductPeriod('2026-13'));
  assert.throws(()=>ctx.overviewProductPeriod('2026-08-09'));
});

const channelStart=app.indexOf('function overviewChannelRanking(');
vm.runInContext(app.slice(channelStart,app.indexOf('/** 渲染同一区间',channelStart)),ctx);
test('总览渠道榜只累计所选范围的日数据，排除滚动30天与TOTAL',()=>{
 const rows=ctx.overviewChannelRanking([{'2026-08-01':[{channelType:'搜索',statisticsType:'day',detailUv:10,fbUv:2},{channelType:'TOTAL',detailUv:100},{channelType:'搜索',statisticsType:'30d',detailUv:999}]},{'2026-08-02':[{channelType:'搜索',statisticsType:'day',detailUv:20,fbUv:1}]},{'2026-09-01':[{channelType:'搜索',detailUv:500}]}],{startDate:'2026-08-01',endDate:'2026-08-31'});
 assert.equal(rows.length,1);assert.equal(rows[0].value,30);assert.equal(rows[0].inquiries,3);
});

const flowContext = vm.createContext({});
for (const name of ['flowChartNumber','flowSourceRows']) {
  const start=app.indexOf('function '+name+'(');
  vm.runInContext(app.slice(start,app.indexOf('\n/**',start)),flowContext);
}
test('来源图保留缺项、合法比例和真实零值，不把空值或非法数值画成零',()=>{
  for(const value of [null,undefined,'',' ',false,true,'not a number',-1,Infinity])assert.equal(flowContext.flowChartNumber(value),null);
  assert.equal(flowContext.flowChartNumber('0'),0);
  assert.equal(flowContext.flowChartNumber('0.0609',1),0.0609);
  assert.equal(flowContext.flowChartNumber(1,1),1);
  assert.equal(flowContext.flowChartNumber(1.01,1),null);
});
test('来源大类保留平台总值，具体入口独立下钻，重叠访客不相加',()=>{
  const snapshot=[
    {sourceType:'TOTAL',subSourceType:'TOTAL',uv:1200},
    {sourceType:'自增',subSourceType:'TOTAL',uv:706,abRate:'0.0609',cateTopAbRate:'0.1242'},
    {sourceType:'自增',subSourceType:'其他',uv:319,abRate:'0.0878'},
    {sourceType:'自增',subSourceType:'店内',uv:119},
    {sourceType:'自增',subSourceType:'直接访问',uv:184},
    {sourceType:'自增',subSourceType:'站外',uv:167,abRate:0},
    {sourceType:'搜索',subSourceType:'TOTAL',uv:609,abRate:'0.0427',cateTopAbRate:'0.0976'},
    {sourceType:'搜索',subSourceType:'搜索',uv:609},
  ];
  const original=JSON.stringify(snapshot),groups=flowContext.flowSourceRows(snapshot);
  assert.equal(groups.length,2);assert.equal(groups[0].uv,706);assert.equal(groups[0].rate,0.0609);assert.equal(groups[0].topRate,0.1242);
  assert.deepEqual(Array.from(groups[0].entries),['其他','店内','直接访问','站外']);
  const entries=flowContext.flowSourceRows(snapshot,'自增');
  assert.equal(entries.length,4);assert.equal(entries.reduce((sum,row)=>sum+row.uv,0),789);
  assert.equal(entries.find(row=>row.name==='站外').rate,0);assert.equal(entries.find(row=>row.name==='店内').rate,null);
  assert.equal(JSON.stringify(snapshot),original);
});
test('重复来源不累计，冲突字段显示缺项且保留没有冲突的参考值',()=>{
  const record={sourceType:'搜索',subSourceType:'TOTAL',uv:609,abRate:'0.0427',cateTopAbRate:'0.0976'};
  const identical=flowContext.flowSourceRows([record,{...record}]);
  assert.equal(identical.length,1);assert.equal(identical[0].uv,609);
  const conflict=flowContext.flowSourceRows([record,{...record,uv:610,abRate:'0.08'}]);
  assert.equal(conflict[0].uv,null);assert.equal(conflict[0].rate,null);assert.equal(conflict[0].topRate,0.0976);
});
