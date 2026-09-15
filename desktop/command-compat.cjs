'use strict';

/**
 * 只读命令兼容层。只在CLI明确拒绝解析（尚未发出业务请求）时发现同名工具；
 * 账号、可执行程序与网关始终由外部的当前 Accio 运行环境提供。
 */

/** 将注册路径转为参数数组；command为icbu三级命令；非法路径抛错，绝不交给shell。 */
function commandParts(command) {
  const parts=String(command).replace(/^workctl\s+/,'').trim().split(/\s+/);
  if(parts.length!==3||parts[0]!=='icbu'||parts.some(part=>! /^[a-z0-9-]+$/.test(part)))throw new Error('仅支持已注册的国际站三级命令。');
  return parts;
}
/** 判断CLI是否明确在执行前拒绝了命令；result为执行器响应；返回布尔，不把认证/网络失败当迁移。 */
function discoveryFailure(result) {
  const reason=result.parsed?.error?.reason;
  if(reason)return ['unknown_flag','unknown_command','command_not_found','missing_endpoint','unknown_parameter'].includes(reason);
  return !result.ok&&/(?:CLI 命令解析失败|unknown (?:flag|command):|requested subcommand .+ is not registered)/i.test(result.stderr||'');
}
/** 按实时合同确认输入类型及必填字段；value和schema为业务值与schema；不支持的合同返回false。 */
function fits(value,schema) {
  if(!schema||!schema.type)return false;
  if(schema.enum&&!schema.enum.includes(value))return false;
  if(schema.type==='object')return value!==null&&typeof value==='object'&&!Array.isArray(value)&&
    (schema.required||[]).every(k=>value[k]!==undefined)&&Object.keys(value).every(k=>Object.hasOwn(schema.properties||{},k)&&fits(value[k],schema.properties[k]));
  if(schema.type==='array')return Array.isArray(value)&&value.every(v=>fits(v,schema.items));
  if(schema.type==='integer')return Number.isSafeInteger(value);
  if(schema.type==='number')return typeof value==='number'&&Number.isFinite(value);
  return ['string','boolean'].includes(schema.type)&&typeof value===schema.type;
}
/**
 * 创建会话内兼容服务。runWorkctl接收参数数组，log只记录命令名与固定状态。
 * @param {object} options 当前账号执行器和可选日志函数。@returns {object} discover/execute。
 * @throws {Error} discover无兼容工具时抛固定说明；execute保留原失败供业务层处理。
 */
function createReadCompatibility({runWorkctl,log=()=>{}}) {
  const plans=new Map(),discovering=new Map();
  /** 核对实时工具身份；schema为动态元数据，original为原命令；返回布尔，无副作用。 */
  function equivalent(schema,original) {
    try {
      const wanted=commandParts(original),actual=commandParts(schema.command);
      return schema.success===true&&schema.mutating===false&&actual[2]===wanted[2]&&
        (schema.rpcName===wanted[2]||schema.cliName===wanted[2])&&schema.inputSchema?.type==='object';
    }catch{return false;}
  }
  /** 获取一个命令的完整schema，支持顶层或data包装；参数为固定路径；失败返回null。 */
  async function schemaFor(command) {
    const result=await runWorkctl(['schema',...commandParts(command),'--detail','full','--format','json'],12000);
    if(!result.ok||result.parsed?.success!==true)return null;
    return result.parsed.inputSchema?result.parsed:{...result.parsed.data,success:true};
  }
  /** 根据动态目录发现同名且只读的等价工具；command为后端白名单路径；不执行任何业务请求。 */
  async function discover(command) {
    command=commandParts(command).join(' ');
    if(discovering.has(command))return discovering.get(command);
    const job=(async()=>{
      let schema=await schemaFor(command);
      if(!equivalent(schema,command)) {
        const leaf=commandParts(command)[2],result=await runWorkctl(['schema','--search',leaf,'--format','json'],12000);
        const matches=result.parsed?.matches||result.parsed?.data?.matches||[];
        const candidates=matches.filter(item=>{try{return item.mutating===false&&commandParts(item.command)[2]===leaf;}catch{return false;}});
        // 不按模糊名字、分数或数组顺序猜测工具；歧义留给诊断说明。
        if(!result.ok||result.parsed?.success!==true||candidates.length!==1)throw new Error('当前版本未发现唯一的兼容只读命令。');
        schema=await schemaFor(candidates[0].command);
      }
      if(!equivalent(schema,command))throw new Error('当前工具身份或读写属性变化，未自动替换。');
      const plan={command:commandParts(schema.command).join(' '),schema};
      plans.set(command,plan);return plan;
    })();
    discovering.set(command,job);try{return await job;}finally{discovering.delete(command);}
  }
  /** 将已校验参数适配到实时声明的文件旗标或业务旗标；返回argv；合同变化时抛错，不执行。 */
  function adapted(plan,params,args) {
    if(!fits(params,plan.schema.inputSchema))throw new Error('当前版本的字段合同已变化，未自动重放。');
    const argv=commandParts(plan.command),flags=new Set((plan.schema.local_flags||[]).map(f=>f.name));
    const fileFlag=['--json-file','--params-file'].find(flag=>args.includes(flag));
    const targetFlag=flags.has('json-file')?'--json-file':flags.has('params-file')?'--params-file':null;
    if(fileFlag&&targetFlag)argv.push(targetFlag,args[args.indexOf(fileFlag)+1]);
    else for(const [key,value] of Object.entries(params)) {
      const flag=plan.schema.params?.find(param=>param.name===key)?.agent_flag;
      if(!/^--[a-z][a-z0-9-]*$/.test(flag||''))throw new Error('当前版本未声明可兼容的参数入口。');
      if(typeof value==='boolean')argv.push(flag+'='+String(value));
      else argv.push(flag,typeof value==='object'?JSON.stringify(value):String(value));
    }
    if(plan.schema.requires_yes===true)argv.push('--yes');
    argv.push('--format','json');if(flags.has('compact-output'))argv.push('--compact-output','off');
    return argv;
  }
  /**
   * 执行后端已授权的只读命令；options含command、params、args、timeoutMs、readOnly。
   * 返回执行器原始结果；最多一次经过合同核验的替代调用，写命令/认证/超时不重放。
   */
  async function execute({command,params,args,timeoutMs=35000,readOnly=false}) {
    if(!readOnly)return runWorkctl(args,timeoutMs);
    let argv=args;
    if(plans.has(command))try{argv=adapted(plans.get(command),params,args);}catch{plans.delete(command);}
    const first=await runWorkctl(argv,timeoutMs);if(!discoveryFailure(first))return first;
    plans.delete(command);
    try {
      const plan=await discover(command),next=adapted(plan,params,args);
      if(JSON.stringify(next)===JSON.stringify(argv))return first;
      log(`[workctl-compat] 已核验只读入口 ${command} -> ${plan.command}`);
      return await runWorkctl(next,timeoutMs);
    }catch{log(`[workctl-compat] 未找到兼容入口 ${command}`);return first;}
  }
  return {discover,execute};
}

module.exports={createReadCompatibility,discoveryFailure};
