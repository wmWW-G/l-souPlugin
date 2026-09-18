'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { internalTestConfig } = require('../lib/internal-test-config');
const { createAiAdvisor } = require('../lib/ai-advisor');
/** 创建本轮隔离目录，测试完成只删除该目录；返回路径，不使用任何真实密钥。 */
function folder(t) { const root=fs.mkdtempSync(path.join(os.tmpdir(),'lsou-internal-config-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root; }

test('内部配置可选、仅白名单字段，状态响应不返回任何密钥',t=>{
  const root=folder(t);assert.deepEqual(internalTestConfig(root),{});
  fs.writeFileSync(path.join(root,'internal-test-dify.json'),JSON.stringify({DIFY_ANALYSIS_API_KEY:'fake-bundled-analysis',DIFY_CHATFLOW_API_KEY:'fake-bundled-chat',other:'not-allowed'}));
  assert.equal(internalTestConfig(root).other,undefined);
  const status=createAiAdvisor({root,scope:'test',stateDir:root,log:()=>{}}).status();
  assert.equal(status.analysisConfigured,true);assert.equal(status.chatConfigured,true);
  assert.doesNotMatch(JSON.stringify(status),/fake-bundled/);
});

test('本地配置继续覆盖随包默认值，发起请求仍只使用后端Authorization',async t=>{
  const root=folder(t);fs.writeFileSync(path.join(root,'internal-test-dify.json'),JSON.stringify({DIFY_ANALYSIS_API_KEY:'fake-bundled-analysis',DIFY_CHATFLOW_API_KEY:'fake-bundled-chat'}));
  fs.writeFileSync(path.join(root,'.env.advisor'),'DIFY_ANALYSIS_API_KEY=fake-local-analysis\nDIFY_CHATFLOW_API_KEY=fake-local-chat\n');
  const calls=[];const service=createAiAdvisor({root,scope:'test',stateDir:root,log:()=>{},fetchImpl:async (url,options)=>{calls.push(options);return new Response('{}',{status:400});}});
  const {snapshot}=service.context({module:'overview',period:{startDate:'2026-09-01',endDate:'2026-09-01'},records:[{source:'shop-summary',data:{exposure:100}}]});
  await assert.rejects(service.analyze(snapshot.snapshot_id));
  assert.equal(calls.length,1);assert.equal(calls[0].headers.Authorization,'Bearer fake-local-analysis');
  assert.doesNotMatch(calls[0].body,/fake-local|fake-bundled/);
});

test('普通交付拒绝测试密钥，显式内部打包才可保留',async t=>{
  const {assertCleanRelease}=await import('../scripts/verify-release-data.mjs');const root=folder(t);
  fs.writeFileSync(path.join(root,'internal-test-dify.json'),'{}');
  await assert.rejects(assertCleanRelease(root),/普通交付禁止/);
  assert.equal(await assertCleanRelease(root,{internalTest:true}),1);
});
