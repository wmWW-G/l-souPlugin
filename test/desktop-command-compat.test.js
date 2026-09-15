'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createReadCompatibility}=require('../desktop/command-compat.cjs');
const original='icbu other icbu-starrating-cgs-pc-page-data-open',current='icbu advisor icbu-starrating-cgs-pc-page-data-open';
/** 合成当前目录schema，不关联真实账号；patch覆盖某一兼容条件；返回可控只读合同。 */
function schema(patch={}){return {success:true,command:current,cliName:current.split(' ').at(-1),mutating:false,requires_yes:true,inputSchema:{type:'object',properties:{locale:{type:'string'}}},local_flags:[{name:'params-file'},{name:'compact-output'}],params:[{name:'locale',agent_flag:'--locale'}],...patch};}
/** 构造解析失败，明确没有业务执行；返回执行器响应。 */
function missing(){return {ok:false,parsed:{success:false,error:{reason:'unknown_command'}}};}
/** 建立兼容层及合成调用记录；options改变schema或最终业务错误；不运行真实命令。 */
function fixture({metadata=schema(),business={ok:true,parsed:{success:true,data:{finalStar:{displayLevelStar:2}}}},matches}={}){
  const calls=[];
  const service=createReadCompatibility({runWorkctl:async args=>{
    calls.push(args);
    if(args[0]==='schema'){
      if(args.includes('--search'))return {ok:true,parsed:{success:true,matches:matches||[{command:current,mutating:false}]}};
      return args[2]==='other'?missing():{ok:true,parsed:metadata};
    }
    return args[1]==='other'?missing():business;
  }});
  const request={command:original,params:{locale:'zh_CN'},args:[...original.split(' '),'--json-file','/private/test/params.json','--yes','--format','json','--compact-output','off'],readOnly:true};
  return {service,calls,request};
}
test('解析失败后发现迁移命令，适配旧文件参数，后续直接使用已核验入口',async()=>{
  const f=fixture();assert.equal((await f.service.execute(f.request)).parsed.data.finalStar.displayLevelStar,2);
  assert.equal(f.calls.filter(a=>a[0]==='icbu').length,2);assert.ok(f.calls.at(-1).includes('--params-file'));assert.ok(f.calls.at(-1).includes('--yes'));
  const before=f.calls.length;await f.service.execute(f.request);assert.equal(f.calls.length,before+1);assert.equal(f.calls.at(-1)[1],'advisor');
});
test('合同字段变化、歧义或工具变成写入时，均不执行替代命令',async()=>{
  for(const options of [{metadata:schema({mutating:true})},{metadata:schema({inputSchema:{type:'object',properties:{locale:{type:'integer'}}}})},{matches:[{command:current,mutating:false},{command:current.replace('advisor','product'),mutating:false}]}]){
    const f=fixture(options);assert.equal((await f.service.execute(f.request)).ok,false);assert.equal(f.calls.filter(a=>a[0]==='icbu').length,1);
  }
});
test('写入、认证拒绝、超时与业务失败不会自动发现或重放',async()=>{
  const write=fixture();await write.service.execute({...write.request,readOnly:false});assert.equal(write.calls.length,1);
  for(const response of [{ok:false,parsed:{success:false,error:{reason:'unauthorized'}}},{ok:false,stderr:'WorkCTL 查询超时'},{ok:true,parsed:{success:false,error:{reason:'rpc_error'}}}]){
    let calls=0;const service=createReadCompatibility({runWorkctl:async()=>{calls++;return response;}});await service.execute(fixture().request);assert.equal(calls,1);
  }
});
test('适配后的业务失败保留原结果，只尝试一个替代入口',async()=>{
  const f=fixture({business:{ok:true,parsed:{success:false,error:{reason:'mcp_upstream_rejected'}}}});
  const result=await f.service.execute(f.request);assert.equal(result.parsed.error.reason,'mcp_upstream_rejected');assert.equal(f.calls.filter(a=>a[0]==='icbu').length,2);
});
