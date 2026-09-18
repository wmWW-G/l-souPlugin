'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
/** 隔离图表纯函数，避免测试调用真实平台。 */
function charts(){const context={window:{},document:{addEventListener(){}}};let source=fs.readFileSync(require.resolve('../public/advisor-workflows.js'),'utf8');source=source.replace('  window.AdvisorPages=', '  window.chartTest={chartValue,marketBars,buyerChart,market};\n  window.AdvisorPages=');vm.runInNewContext(source,context);return context.window.chartTest;}
test('图表区分缺失与零，外部标签转义，百分比轨道不改变分母',()=>{const c=charts();assert.equal(c.chartValue(null),null);assert.equal(c.chartValue(''),null);assert.equal(c.chartValue(-1),null);assert.equal(c.chartValue(0),0);const html=c.marketBars([['<img>',0.25],['缺失',null]],true);assert.ok(html.includes('width:25%'));assert.ok(html.includes('25.0%'));assert.ok(html.includes('&lt;img&gt;'));assert.ok(!html.includes('缺失'));});
test('不完整的买家身份占比不能画成完整圆环',()=>{const c=charts();c.market.identity=[{byrIdentity:'wholesale',visitorRate:'0.3'}];assert.ok(!c.buyerChart().includes('<svg'));c.market.identity.push({byrIdentity:'manufacturer',visitorRate:'0.7'});assert.ok(c.buyerChart().includes('<svg'));assert.ok(c.buyerChart().includes('批发商'));});

/** 加载纯规则函数，测试不读取店铺也不调用模型。 */
function rules(){const context={window:{},document:{addEventListener(){}}};vm.runInNewContext(fs.readFileSync(require.resolve('../public/advisor-workflows.js'),'utf8'),context);return context.window.AdvisorPlanRules;}
const period={startDate:'2026-08-01',endDate:'2026-08-31'};
test('规划取区间最新记录、保留零值并合并曝光访客方向',()=>{
 const run=rules(),r=run([{statDate:'2026-08-31',totalImpsCnt:0,totalImpsCntRivalAvg:100,uvCnt:0,uvCntRivalAvg:10},{statDate:'2026-08-01',totalImpsCnt:200,totalImpsCntRivalAvg:100}],period);
 assert.equal(r.date,'2026-08-31');assert.equal(r.items.filter(x=>x.group==='traffic').length,1);assert.equal(r.items[0].mine,0);assert.equal(r.items[0].status,'below');
});
test('规划缺少分母或对标时不推断转化和点击，时长越低越好',()=>{
 const r=rules()([{statDate:'2026-08-31',seCtr:0,seCtrRivalAvg:0.02,seImpsCnt:0,uvAbRate:0.01,uvAbRateRivalAvg:0.1,uvCnt:null,avgReplyTime30d:2,avgReplyTime30dRivalAvg:3,avgReplyTime30dRivalGood:1}],period);
 assert.equal(r.items.filter(x=>x.group==='reply').length,1);assert.equal(r.items.find(x=>x.group==='reply').status,'average');assert.equal(r.items.find(x=>x.group==='reply').rolling,true);assert.ok(r.skipped.length>=2);
});
test('规划最多三个方向，行业优秀与均值矛盾时不标优秀',()=>{
 const row={statDate:'2026-08-31',totalImpsCnt:20,totalImpsCntRivalAvg:10,totalImpsCntRivalGood:5,seImpsCnt:100,seCtr:0.01,seCtrRivalAvg:0.02,uvCnt:10,uvAbRate:0.1,uvAbRateRivalAvg:0.2,fstReplyRate30d:0.5,fstReplyRate30dRivalAvg:0.9};
 const r=rules()([row],period);assert.equal(r.items.length,3);assert.ok(r.items.every(x=>x.status==='below'));
 const only=rules()([{statDate:row.statDate,totalImpsCnt:20,totalImpsCntRivalAvg:10,totalImpsCntRivalGood:5}],period);assert.equal(only.allItems.find(x=>x.key==='totalImpsCnt').excellent,null);assert.equal(only.allItems.find(x=>x.key==='totalImpsCnt').status,'average');
 assert.equal(rules()([{statDate:'2026-09-01'}],period).items.length,0);
});
test('组合规则区分曝光与点击差距，连续观察不跨缺日',()=>{
 const row={statDate:'2026-08-31',cateId:1,seImpsCnt:100,seImpsCntRivalAvg:80,seCtr:0.01,seCtrRivalAvg:0.02};
 const run=rules(),r=run([row,{...row,statDate:'2026-08-30'},{...row,statDate:'2026-08-29'}],period);
 assert.match(r.items[0].signal,/搜索曝光已达均值/);assert.match(r.items[0].signal,/连续3个/);assert.equal(r.items[0].checks.length,3);assert.match(r.items[0].checks[2],/单日比率可能波动/);
 const gap=run([row,{...row,statDate:'2026-08-29'},{...row,statDate:'2026-08-28'}],period);assert.doesNotMatch(gap.items[0].signal,/连续3个/);
});
test('扩展规则保留全部指标、广告缺报不补零、商品仅统计返回样本',()=>{
 const row={statDate:'2026-08-31',totalImpsCnt:1,totalImpsCntRivalAvg:20,seImpsCnt:1,seImpsCntRivalAvg:20,seCtr:0.01,seCtrRivalAvg:0.1,uvCnt:1,uvAbRate:0,uvAbRateRivalAvg:0.1,goodProdCnt:1,goodProdCntRivalAvg:10};
 const r=rules()([row],period,{products:{recordCount:100,focusProducts:{lowExposureLowCtr:[{productRef:'a',exposure:10,clicks:0,visitors:0,inquiries:0,tmInquiries:0}]}},ads:{search:{rows:[]},whole_site:{rows:[{spend:10,clicks:2,inquiries:0}]}}});
 assert.equal(r.items.length,3);assert.ok(r.allItems.length>3);assert.ok(r.allItems.find(x=>x.key==='noClick').scope.includes('样本 1 件'));assert.ok(!r.allItems.some(x=>x.key==='ads-search'));assert.ok(r.allItems.some(x=>x.key==='ads-whole_site'));assert.ok(r.skipped.some(x=>x.includes('直通车效果')));
});
test('趋势使用连续14日的等长窗口，缺日时不比较',()=>{
 const rows=Array.from({length:14},(_,i)=>({statDate:new Date(Date.UTC(2026,7,31-i)).toISOString().slice(0,10),cateId:1,totalImpsCnt:i<7?5:10}));
 const result=rules()(rows,period);const trend=result.allItems.find(x=>x.key==='trend-totalImpsCnt');assert.equal(trend.mine,35);assert.deepEqual(Array.from(trend.comparison[1]),['前7日',70]);
 assert.ok(!rules()(rows.slice(1),period).allItems.some(x=>x.key.startsWith('trend-')));
});
