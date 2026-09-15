'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const pure = source.slice(source.indexOf('function normalizeCompareKeyword('), source.indexOf('/** 只读读取一个关键词来源'));
const context = vm.createContext({});
vm.runInContext(pure, context);
const build = (...args) => JSON.parse(JSON.stringify(context.buildKeywordComparison(...args)));
const resource = (keyword, channel, extra = {}) => ({'关键词': keyword, '关键词渠道': channel, ...extra});
const scene = {countryId: 'all', sceneNameCn: '智能手表', top3HotKw: 'watch|reloj inteligente', needsIndex: 1359};

test('关键词同词归一化，但保持PC/APP和单复数独立', () => {
  const rows = build({highInquiryWords:[{keyword:' Smart   Watch ',channel:'PC'}]}, [resource('smart watch','APP'),resource('smart watch','PC'),resource('smart watches','PC')], []);
  assert.equal(rows.length,3);
  assert.equal(rows.find(r=>r.channel==='APP').signals.length,0);
  assert.deepEqual(rows.find(r=>r.keyword==='smart watch'&&r.channel==='PC').signals,['高询盘']);
  assert.equal(rows.find(r=>r.keyword==='smart watches').signals.length,0);
});

test('未知渠道只做词级匹配，地域场景不重复计数、不借用场景指数', () => {
  const rows=build({highTrafficWords:[{keyword:'watch',channel:'未知'}]},[resource('watch','APP',{'全站搜索曝光指数':0,'关键词标签列表':'行业热词'})],[scene,{...scene,countryId:'os'}]);
  const watch=rows.find(r=>r.keyword==='watch');
  assert.equal(watch.overlap,true);
  assert.equal(watch.wordMatch,true);
  assert.equal(watch.exposure,0);
  assert.deepEqual(watch.scenes,['智能手表']);
  const spanish=rows.find(r=>r.keyword==='reloj inteligente');
  assert.equal(spanish.exposure,null);
  assert.equal(spanish.opportunity,true);
});

test('热词必须有平台标签或场景依据，优势词不把P4P消耗当业绩', () => {
  const rows=build({highP4pWords:[{keyword:'expensive'}],highInquiryWords:[{keyword:'niche'}]},[resource('popular','PC',{'全站搜索曝光指数':1000}),resource('hot','APP',{'关键词标签列表':'高引流词，行业热词'})],[]);
  assert.equal(rows.find(r=>r.keyword==='popular').hot,false);
  assert.equal(rows.find(r=>r.keyword==='hot').opportunity,true);
  assert.equal(rows.find(r=>r.keyword==='expensive').advantage,false);
  assert.equal(rows.find(r=>r.keyword==='niche').advantage,true);
});

test('筛选与搜索正确，缺失指数排在真实零值后且不解析小于1%为零', () => {
  const rows=build({},[resource('a','PC',{'全站搜索曝光指数':null}),resource('b','PC',{'全站搜索曝光指数':0,'全站搜索点击率':'<1%'}),resource('c','APP',{'全站搜索曝光指数':999,'关键词标签列表':'行业热词'})],[]);
  const filtered=context.filterKeywordComparison(rows,{filter:'all',search:'',sort:'exposure'});
  assert.deepEqual(Array.from(filtered,r=>r.keyword),['c','b','a']);
  assert.equal(rows.find(r=>r.keyword==='b').ctr,'<1%');
  assert.equal(context.filterKeywordComparison(rows,{filter:'opportunity',search:' C ',sort:'click'}).length,1);
  assert.equal(context.keywordIndex(''),null);
  assert.equal(context.keywordIndex(1001),null);
});

test('店铺画像快照按账号隔离、可保存真实空结果，损坏快照不冒充数据', t => {
  const os = require('node:os');
  const crypto = require('node:crypto');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsou-keyword-test-'));
  t.after(() => fs.rmSync(dir, { recursive:true, force:true }));
  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const start = server.indexOf('function keywordProfileSnapshot(');
  const env = { ACCIO_ACTIVE_SPACE:'account-a', KEYWORD_PROFILE_STATE_DIR:dir };
  const ctx = vm.createContext({fs,os,path,crypto,process:{env,pid:process.pid},console:{log(){}}});
  vm.runInContext(server.slice(start, server.indexOf('async function callEndpoint(',start)),ctx);
  const snapshot = {ok:true,fetchedAt:'2026-09-08T05:00:00Z',data:{profileComplete:true,highInquiryWords:[],highTrafficWords:[],highP4pWords:[]}};
  ctx.keywordProfileSnapshot(snapshot);
  assert.equal(ctx.keywordProfileSnapshot().data.highInquiryWords.length,0);
  const filename = fs.readdirSync(dir)[0];
  assert.equal(fs.statSync(path.join(dir,filename)).mode & 0o777,0o600);
  env.ACCIO_ACTIVE_SPACE='account-b';
  assert.equal(ctx.keywordProfileSnapshot(),null);
  env.ACCIO_ACTIVE_SPACE='account-a';
  fs.writeFileSync(path.join(dir,filename),'invalid');
  assert.equal(ctx.keywordProfileSnapshot(),null);
  delete env.ACCIO_ACTIVE_SPACE;
  assert.equal(ctx.keywordProfileSnapshot(snapshot),null);
});

// 双端图的聚合需保持渠道指数独立，同时以词的并集计算重合，避免重复或漏计。
test('双端图按词去重，未知渠道不移植指数，跨端标签不重复计数', () => {
  const rows = build({highInquiryWords:[{keyword:'watch',channel:'PC'}],highP4pWords:[{keyword:'niche',channel:'未知'}]}, [resource('watch','APP',{'关键词标签列表':'行业热词','全站搜索点击指数':900}),resource('watch','PC',{'全站搜索点击指数':0}),resource('only-app','APP',{'关键词标签列表':'行业热词','全站搜索点击指数':50}),resource('not-hot','PC',{'全站搜索点击指数':1000})], []);
  const groups = context.groupKeywordVisualRows(rows);
  assert.equal(groups.length,3);
  const watch = groups.find(word=>word.keyword==='watch');
  assert.equal(watch.overlap,true);
  assert.equal(watch.channels.APP.click,900);
  assert.equal(watch.channels.PC.click,0);
  assert.equal(groups.find(word=>word.keyword==='only-app').channels.PC,undefined);
  assert.equal(groups.find(word=>word.keyword==='niche').advantage,false);
  assert.equal(Object.keys(groups.find(word=>word.keyword==='niche').channels).length,0);
  assert.equal(groups.filter(word=>word.opportunity).length,1);
});

test('店铺正向信号仅依据引流和询盘，不把P4P或缺项当作效果', () => {
  assert.equal(context.keywordShopEvidence(['高P4P']).positive,false);
  assert.equal(context.keywordShopEvidence(['高P4P']).paid,true);
  assert.equal(context.keywordShopEvidence([]).traffic,false);
  assert.equal(context.keywordShopEvidence(['高引流']).positive,true);
  assert.equal(context.keywordShopEvidence(['高引流']).inquiry,false);
  const evidence = context.keywordShopEvidence(['高引流','高询盘']);
  assert.equal(evidence.traffic,true);
  assert.equal(evidence.inquiry,true);
  assert.equal('click' in evidence,false);
  assert.equal('exposure' in evidence,false);
});
