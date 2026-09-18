'use strict';
const path=require('node:path');
const {promisify}=require('node:util');
const execFile=promisify(require('node:child_process').execFile);
const root=path.resolve(__dirname,'../../..');
const {resolveAccioEnvironment}=require(path.join(root,'desktop/runtime.cjs'));
const {createReadCompatibility}=require(path.join(root,'desktop/command-compat.cjs'));

/**
 * 在当前账号环境发现一个只读工具，输出脱敏元数据；command为三级命令字符串。
 * @returns {Promise<object>} 版本、替代路径、字段及状态。@throws 环境或schema不可用。
 */
async function diagnose(command) {
  // 不使用启动器固定的经营schema预检：该入口本身迁移时仍需能够发现新目录。
  const env=await resolveAccioEnvironment({verify:false});
  /** 运行只读schema命令；args为工具内部参数，timeoutMs为上限；返回归一化状态，不暴露stderr。 */
  async function runWorkctl(args,timeoutMs) {
    try {
      const {stdout}=await execFile(env.WORKCTL_BIN,env.WORKCTL_ENTRY?[env.WORKCTL_ENTRY,...args]:args,{env,windowsHide:true,timeout:timeoutMs,maxBuffer:4*1024*1024});
      return {ok:true,parsed:JSON.parse(stdout)};
    }catch{return {ok:false,parsed:null};}
  }
  const health=await runWorkctl(['health','--format','json'],10000);
  if(!health.ok||health.parsed?.success!==true)throw Object.assign(new Error('当前会话连接未就绪'),{code:'CONNECTION_UNAVAILABLE'});
  const plan=await createReadCompatibility({runWorkctl}).discover(command);
  return {ok:true,version:env.LSOU_WORKCTL_VERSION,source:env.LSOU_WORKCTL_SOURCE,
    availableCommand:plan.command,readOnly:true,requiresConfirmation:plan.schema.requires_yes===true,
    fields:(plan.schema.params||[]).map(p=>({name:p.name,type:p.type,required:p.required===true})),
    businessVerified:false,message:'已核验当前版本的只读入口；需重新读取对应页面，确认实际业务数据。'};
}
if(require.main===module)diagnose(process.argv[2]||'').then(result=>console.log(JSON.stringify(result))).catch(error=>{
  console.log(JSON.stringify({ok:false,code:error.code||'COMMAND_INCOMPATIBLE',message:error.code?'当前连接环境未就绪，请运行启动诊断。':'未找到身份与字段可核验的唯一只读入口，未执行业务操作。'}));process.exitCode=1;
});
module.exports={diagnose};
