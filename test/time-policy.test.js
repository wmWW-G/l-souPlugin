'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const T=require('../public/time-policy');
const clock='2026-09-08';
/** 固定时钟验证合同，避免测试随着当前日期漂移。@param {string} key 接口。@param {object} p 参数。@param {string[]} allowed 白名单。@returns {void}。@throws 合同错误。 */
const check=(key,p,allowed)=>T.validate(key,p,allowed,clock);
test('北京时间、闰年与跨年ISO周不依赖运行机器时区',()=>{
 assert.equal(T.today(new Date('2026-09-07T16:01:00Z')),'2026-09-08');
 assert.deepEqual(T.period('month','2024-02',clock),{startDate:'2024-02-01',endDate:'2024-02-29'});
 assert.deepEqual(T.period('week','2026-W01',clock),{startDate:'2025-12-29',endDate:'2026-01-04'});
 assert.throws(()=>T.period('week','2025-W53',clock));
 assert.throws(()=>T.parse('2026-02-29'));
 assert.throws(()=>T.period('month','2026-09','2026-09-07'));
});
test('范围限制按具体接口执行，不静默裁剪且31天自然月合法',()=>{
 check('visitor-detail',{startDate:'2026-08-01',endDate:'2026-08-31'});
 assert.throws(()=>check('visitor-detail',{startDate:'2026-08-01',endDate:'2026-09-01'}),/1 个月/);
 assert.throws(()=>check('visitor-detail',{}),/必须/);
 assert.throws(()=>check('shop-summary',{startDate:'2026-09-08'}),/同时/);
 assert.throws(()=>check('shop-summary',{startDate:'2026-09-09',endDate:'2026-09-10'}),/超出/);
 assert.throws(()=>check('shop-summary',{startDate:'2026-09-08',endDate:'2026-09-01'}),/晚于/);
 check('channel-trend',{startDate:'2026-08-01',endDate:'2026-08-30'});
 assert.throws(()=>check('channel-trend',{startDate:'2026-08-01',endDate:'2026-08-31'}),/30 天/);
 check('shop-region',{startDate:'2026-06-01',endDate:'2026-08-31'});
 assert.throws(()=>check('shop-region',{startDate:'2026-06-01',endDate:'2026-09-01'}),/3 个月/);
});
test('商品按月必须月初且近90天，按周不接受会被忽略的日期',()=>{
 check('shop-product',{statisticsType:'month',statDate:'2026-08-01'});
 check('shop-product',{statisticsType:'week'});
 assert.throws(()=>check('shop-product',{statisticsType:'week',statDate:'2026-08-01'}),/忽略/);
 assert.throws(()=>check('shop-product',{statisticsType:'month',statDate:'2026-08-02'}),/第一天/);
 assert.throws(()=>check('shop-product',{statisticsType:'month',statDate:'2026-06-01'}),/90天/);
 assert.throws(()=>check('shop-product',{statisticsType:'month'}),/指定/);
 assert.throws(()=>check('shop-product',{startDate:'2026-08-01',endDate:'2026-08-31'},['statDate','statisticsType']),/不支持/);
});
test('滚动画像、汇总与行业需求只接受各自的枚举',()=>{
 check('shop-summary',{statisticsType:'30d'});
 assert.throws(()=>check('shop-summary',{statisticsType:'month'}));
 check('customer-profile',{nd:'30d'});
 assert.throws(()=>check('customer-profile',{nd:'90d'}));
 check('industry-buyer-profile',{nd:'90d'});
 check('market-opportunities',{statCycle:'90d'});
 assert.throws(()=>check('market-opportunities',{statCycle:90}));
 assert.throws(()=>check('risk',{startDate:'2026-08-01'},[]),/不支持/);
});
test('TM离线T+2、广告紧凑日期、合同时间格式独立校验',()=>{
 check('tm-account-diagnosis',{queryDate:'2026-09-06',dateType:0});
 assert.throws(()=>check('tm-shop-diagnosis',{queryDate:'2026-09-07',dateType:0}),/两天/);
 assert.throws(()=>check('ads-company-effect',{}),/同时/);
 check('ads-company-effect',{startStatDate:'20260801',endStatDate:'20260831',granularity:'all'});
 assert.throws(()=>check('ads-product-effect',{startDate:'2026-08-01',endDate:'2026-08-31'}),/YYYYMMDD/);
 check('orders',{createDateFrom:'2026-08-01 00:00:00',createDateTo:'2026-08-31 23:59:59'});
 assert.throws(()=>check('orders',{createDateFrom:'2026-08-01',createDateTo:'2026-08-31'}),/HH:mm:ss/);
 assert.throws(()=>check('orders',{createDateFrom:'2026-08-01 24:00:00',createDateTo:'2026-08-31 23:59:59'}));
});
test('RFQ时间优先级不允许混填，过期时间允许未来，会话游标不当日期',()=>{
 assert.throws(()=>check('rfq-internal-search',{openTime:'24h',gmtOpenFrom:'2026-08-01 00:00:00',gmtOpenTo:'2026-08-31 23:59:59'}),/一种方式/);
 check('rfq-external-search',{expiredTimeStart:Date.parse('2026-09-09'),expiredTimeEnd:Date.parse('2026-10-01')});
 check('tm-recent',{limitTimeStamp:Date.parse('2030-01-01')},['limitTimeStamp']);
 assert.throws(()=>check('rfq-external-search',{postTimeStart:100,postTimeEnd:50}));
});

test('流量来源滚动窗口只能选一个快照，不能跨天或跨粒度累计',()=>{
 const result=T.latestFlow([{statDate:'2026-08-30',statisticsType:'30d',uv:100},{statDate:'2026-08-31',statisticsType:'30d',uv:120},{statDate:'2026-08-31',statisticsType:'7d',uv:40}]);
 assert.equal(result.rows.length,1);assert.equal(result.rows[0].uv,120);assert.equal(result.date,'2026-08-31');
});
