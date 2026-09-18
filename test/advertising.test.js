'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const {createAdvertising,unwrap,parseTsv,reportRows,numeric}=require('../lib/advertising');
const range={startDate:'2026-08-01',endDate:'2026-08-31'};

/** 模拟真实MCP响应形状。@param {object} data 数据。@returns {object} CLI包络。@throws 无。 */
const envelope=data=>({ok:true,parsed:{success:true,result:{success:true,structuredContent:{success:true,data}}}});
/** 注入CLI替身，但保留真实参数文件、排队、解析与缓存。@param {Function} handler 替身。@returns {object} 服务。@throws 无。 */
function service(handler) {return createAdvertising({runWorkctl:async args=>{
  assert.deepEqual(args.slice(0,3),['icbu','ads','list']);
  const file=args[args.indexOf('--params-file')+1];assert.equal((await fs.stat(file)).mode&0o777,0o600);
  return handler(JSON.parse(await fs.readFile(file,'utf8')));
}});}
/** 生成报告动态入口。@param {object} p 查询。@param {number} total 行数。@returns {object} 平台报告。@throws 无。 */
function producer(p,total=0) {
  return envelope({data:[{datasource:p.filters.datasource,sessionId:'test-session',tableName:'AD_REPORT',tableMeta:{total_rows:total}}],links:[{available:true,invoke:{entityType:'report_sql',include:'data',filters:{sessionId:'test-session',tableName:'AD_REPORT',sql1:'SELECT * FROM AD_REPORT LIMIT 10'}}}]});
}

test('广告成功、内层失败、结构变化严格区分',()=>{
  assert.deepEqual(unwrap(envelope({data:[]})),{data:[]});
  assert.throws(()=>unwrap({ok:true,parsed:{success:true,result:{structuredContent:{success:false,errorMsg:'denied'}}}}),/失败/);
  assert.throws(()=>unwrap({ok:true,parsed:{success:true,data:{}}}),/格式/);
  assert.equal(numeric('0'),0);assert.equal(numeric(''),null);assert.equal(numeric(null),null);
});

test('TSV保留真实0，空表只有表头，异常日期拒绝汇总',()=>{
  assert.deepEqual(parseTsv('日期\t花费\n'),[]);
  const rows=reportRows(parseTsv('日期\t花费\t点击量\n20260801\t0\t0\n'),range);
  assert.equal(rows[0].spend,0);assert.equal(rows[0].inquiries,null);
  assert.throws(()=>reportRows([{日期:'2026-09-01',花费:'100'}],range),/不一致/);
  assert.throws(()=>reportRows([{日期:'not a date',花费:'100'}],range),/不一致/);
  assert.throws(()=>parseTsv('日期\t花费\n20260801\n'),/列数/);
});

test('动态报表producer consumer串行，缓存合并并发且不截断10条',async()=>{
  const seen=[];let active='';
  const s=service(async p=>{
    seen.push(p.entityType);
    if(p.entityType==='report'){active=p.filters.datasource;return producer(p,31);}
    assert.equal(p.filters.sql1,'SELECT * FROM AD_REPORT LIMIT 1000');
    const val=active==='company_search'?2:3;
    return envelope({data:[{success:true,tsvData:'日期\t花费\n'+Array.from({length:31},(_,i)=>`202608${String(i+1).padStart(2,'0')}\t${val}`).join('\n')}]});
  });
  const [a,b,c]=await Promise.all([s.read('report',{scope:'search',...range}),s.read('report',{scope:'whole_site',...range}),s.read('report',{scope:'search',...range})]);
  assert.equal(a.total.spend,62);assert.equal(b.total.spend,93);assert.equal(c.total.spend,62);
  assert.deepEqual(seen,['report','report_sql','report','report_sql']);
  assert.equal((await s.read('report',{scope:'search',...range})).cached,true);
});

test('空报表不是零消费，缺金额也不补零',async()=>{
  const s=service(p=>p.entityType==='report'?producer(p):envelope({data:[{success:true,tsvData:'日期\t花费\n'}]}));
  const d=await s.read('report',{scope:'search',...range});assert.equal(d.state,'empty');assert.equal(d.total.spend,null);
  const s2=service(p=>p.entityType==='report'?producer(p):envelope({data:[{success:true,tsvData:'日期\t花费\n20260801\t\n'}]}));
  assert.equal((await s2.read('report',{scope:'search',...range})).total.spend,null);
});

test('失败报表不缓存，队列后续仍可查询',async()=>{
  let fail=true;
  const s=service(p=>{if(p.entityType==='report')return producer(p);if(fail){fail=false;return {ok:false};}return envelope({data:[{success:true,tsvData:'日期\t花费\n20260801\t0\n'}]});});
  await assert.rejects(s.read('report',{scope:'search',...range}));
  assert.equal((await s.read('report',{scope:'search',...range})).total.spend,0);
});

test('禁止任意entity、SQL、未来日期、超100天及非法分页',async()=>{
  let calls=0;const s=service(()=>{calls++;throw Error('不应调用');});
  for(const [name,p] of [['mutate',{}],['plans',{kind:'search',entityType:'mutate'}],['report',{scope:'search',...range,sql1:'DROP TABLE X'}],['report',{scope:'evil',...range}],['report',{scope:'search',startDate:'2026-01-01',endDate:'2026-08-31'}],['report',{scope:'search',startDate:'2999-01-01',endDate:'2999-01-01'}],['plans',{kind:'search',page:'1.5'}],['history',{account:'all',type:'coupon',...range}]])await assert.rejects(s.read(name,p));
  assert.equal(calls,0);
});

test('财务只跟随真实入口，保留来源EMPTY与分类流水分页',async()=>{
  const s=service(p=>{
    if(p.entityType==='company')return envelope({data:[],links:[{name:'accountFinance',available:true,invoke:{entityType:'account_finance',include:'data',filters:{accountTypes:['search'],historyTypes:[]}}}]});
    assert.deepEqual(p.filters.historyTypes,['coupon']);assert.equal(p.page.index,2);
    return envelope({data:[{accountType:'search',coupon:{data:[],total:0,hasMore:false}}],total:1,metadata:{sourceStatuses:{'search.coupon':'EMPTY'}}});
  });
  const d=await s.read('history',{account:'search',type:'coupon',page:'2',...range});
  assert.equal(d.metadata.sourceStatuses['search.coupon'],'EMPTY');assert.equal(d.rows[0].coupon.total,0);
});

test('推荐数据不包含创建入口、商品内部ID或写操作',async()=>{
  const s=service(p=>p.entityType==='company'?envelope({data:[],links:[{name:'recommend_campaign_package',available:true,invoke:{entityType:'campaign_package_recommendation',include:'data',filters:{}}}]}):envelope({data:[{status:'OK',groups:[{recommendations:[{campaignKey:{subType:'whole_store_product'},proposal:{productIds:[123],budgetAmount:200},handoff:{path:'https://example.com/create'},recommendAdmission:{decision:'RECOMMEND'}}]}]}]}));
  const d=await s.read('recommendation');assert.equal(d.rows[0].productCount,1);assert.doesNotMatch(JSON.stringify(d),/productIds|handoff|example.com|operations/);
});

test('普通计划按真实计划ID补齐预算与状态，不套用原始0枚举',async()=>{
  const s=service(p=>{
    if(p.entityType==='company')return envelope({data:[],links:[['campaigns',{campaignScope:'NON_51'}],['searchCampaigns',{summaryTypes:'search'}],['wholeSiteCampaigns',{summaryTypes:'wholeSite'}]].map(([name,filters])=>({name,available:true,invoke:{entityType:'campaign',include:'data',filters}}))});
    if(p.filters.campaignScope)return envelope({data:[{campaignId:1,onlineStatus:0},{campaignId:2,onlineStatus:9}],total:2});
    return envelope({data:p.filters.summaryTypes==='search'?[{campaignId:'1',onlineStatus:'-2',budget:'200',onlineProductCount:'47'}]:[],total:p.filters.summaryTypes==='search'?1:0});
  });
  const d=await s.read('plans',{kind:'ordinary',page:'1'});
  assert.equal(d.rows[0].onlineStatus,0);assert.equal(d.rows[0].verifiedOnlineStatus,'-2');assert.equal(d.rows[0].budget,'200');
  assert.equal(d.rows[1].verifiedOnlineStatus,undefined);assert.equal(d.rows[1].budget,undefined);
});

test('计划详情只跟随同计划只读入口，分页保留，写元数据不下发',async()=>{
 const s=service(p=>{
  if(p.entityType==='campaign')return envelope({data:[{campaignId:12,campaignName:'test'}],operations:[{name:'delete'}],links:[{name:'keywords',available:true,invoke:{entityType:'campaign_keyword',filters:{campaignId:12}}}]});
  assert.equal(p.entityType,'campaign_keyword');assert.equal(p.page.index,2);assert.equal(p.filters.keyword,'watch');
  return envelope({data:[{keyword:'watch',operations:[{name:'delete'}],invoke:{action:'delete'}}],total:35});
 });
 const d=await s.read('detail',{id:'12',section:'summary'});assert.equal(d.sections.find(x=>x.key==='keywords').available,true);assert.doesNotMatch(JSON.stringify(d),/delete|invoke/);
 const k=await s.read('detail',{id:'12',section:'keywords',keyword:'watch',page:'2'});assert.equal(k.total,35);assert.doesNotMatch(JSON.stringify(k),/delete|invoke/);
 const absent=await s.read('detail',{id:'12',section:'products'});assert.equal(absent.unavailable,true);
 await assert.rejects(s.read('detail',{id:'12',section:'delete'}));await assert.rejects(s.read('detail',{id:'x'}));
});
test('错误计划归属或实体被拒绝，不能沿返回链接越过白名单',async()=>{
 for(const invoke of [{entityType:'campaign_keyword',filters:{campaignId:99}},{entityType:'mutate',filters:{campaignId:12}}]){
 const s=service(()=>envelope({data:[],links:[{name:'keywords',available:true,invoke}]}));
 await assert.rejects(s.read('detail',{id:'12',section:'keywords'}),/归属|契约/);
 }
});
test('计划报表使用独立临时表与平台计划数据源，不误用账户报告',async()=>{
 const s=service(p=>{
 if(p.entityType==='campaign')return envelope({data:[],links:[{name:'report',available:true,invoke:{entityType:'report',filters:{campaignId:12,datasource:'campaign_search'}}}]});
 if(p.entityType==='report'){assert.equal(p.filters.campaignId,12);assert.equal(p.filters.datasource,'campaign_search');assert.match(p.filters.tempTableName,/^LSOU_AD_[A-F0-9]+$/);return producer(p);}
 return envelope({data:[{success:true,tsvData:'日期\t花费\n'}]});
 });
 assert.equal((await s.read('report',{id:'12',scope:'search',...range})).state,'empty');
});

test('广告知识问答仅允许真实只读入口及非空短问题',async()=>{
 let calls=0;const s=service(p=>{calls++;if(p.entityType==='company')return envelope({data:[],links:[{name:'explain',available:true,invoke:{entityType:'campaign_explanation',filters:{}}}]});assert.equal(p.entityType,'campaign_explanation');assert.equal(p.filters.query,'投放口径');return envelope({data:[{answer:'平台答复'}]});});
 await assert.rejects(s.read('explanation',{question:''}));await assert.rejects(s.read('explanation',{question:'x'.repeat(501)}));assert.equal(calls,0);
 assert.equal((await s.read('explanation',{question:' 投放口径 '})).rows[0].answer,'平台答复');
 await assert.rejects(s.read('detail',{id:'999999999999999999'}));
});
