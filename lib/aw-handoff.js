'use strict';
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {execFile}=require('node:child_process');
const topics=['市场与客群定位','公司定位','产品定位','店铺装修文案','详情页装修文案'];
const positionSkills=['lsou-market-positioning','lsou-company-positioning','lsou-product-positioning','lsou-store-copy','lsou-product-detail-copy'];
/**
 * 生成按钮短消息。skillName 为已登记技能，period 为已校验的日/周/月范围，
 * requestRef 为“账号隔离段/请求编号”；返回普通英文指令与必要参数，不使用美元符号召唤。
 * 调用方先校验周期与请求编号；本函数不读写文件、不执行命令，无主动异常。
 */
function skillRequestMessage(skillName, period, requestRef) {
 return `Use ${skillName} skill; period=${period.mode}; dates=${period.startDate}..${period.endDate}; request=${requestRef}`;
}
/** 生成定位分析请求。index为内部主题序号，file为本次快照绝对路径；返回纯文本，不执行模型。 */
function prompt(index,file){return `Use ${positionSkills[index]} skill; input=${JSON.stringify(file)}`;}
/** 复制业务JSON并删除凭据字段；value为JSON值，返回新值；循环对象由调用方JSON校验拒绝。 */
function scrub(value){if(Array.isArray(value))return value.map(scrub);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!/(token|password|secret|authorization|cookie|api.?key)/i.test(k)).map(([k,v])=>[k,scrub(v)]));return value;}
// 脚本固定不插入URL；URL仅通过子进程环境传递，避免引号、&、%或中文被解释为命令。
// Start-Process走Windows注册协议；不等待Accio退出，也不把系统受理当作对话已创建。
const windowsOpenScript = `$ErrorActionPreference = 'Stop'
try {
  Start-Process -FilePath $env:LSOU_ACCIO_OPEN_URI -ErrorAction Stop | Out-Null
  exit 0
} catch {
  $failure = @{ stage = 'shell_execute'; hresult = $_.Exception.HResult }
  $exception = $_.Exception
  while ($null -ne $exception) {
    if ($exception -is [System.ComponentModel.Win32Exception]) {
      $failure.nativeErrorCode = $exception.NativeErrorCode
      break
    }
    $exception = $exception.InnerException
  }
  [Console]::Error.WriteLine(($failure | ConvertTo-Json -Compress))
  exit 1
}`;

/** 保留数值或固定系统错误码；value为未知错误字段，返回安全值或null，不抛异常。 */
function errorCode(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return typeof value === 'string' && /^(?:-?\d+|[A-Z][A-Z0-9_]{0,47})$/.test(value) ? value : null;
}

/** 生成可记录的唤起错误；error为异常、stderr为子进程输出，只返回白名单诊断，不保留URL、路径或原始错误正文。 */
function launchErrorDetails(error, stderr = '') {
  const prior = error?.launchDiagnostic;
  const result = {
    code: errorCode(prior?.code ?? error?.code), errno: errorCode(prior?.errno ?? error?.errno),
    signal: errorCode(prior?.signal ?? error?.signal), killed: Boolean(prior?.killed ?? error?.killed),
    stderrPresent: Boolean(prior?.stderrPresent || stderr)
  };
  let structured = prior;
  if (!structured && stderr) { try { structured = JSON.parse(String(stderr).trim()); } catch { /* 非结构化正文可能含凭据或整条链接，不写日志。 */ } }
  if (structured?.stage === 'shell_execute') {
    result.stage = 'shell_execute';
    result.hresult = errorCode(structured.hresult);
    result.nativeErrorCode = errorCode(structured.nativeErrorCode);
  }
  return result;
}

/** 唤起本模块生成的Accio新对话链接；options仅供平台/进程测试注入。返回Promise，协议非法或系统启动失败时拒绝。 */
function openAW(url, { platform = process.platform, run = execFile, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch { reject(new Error('分析会话链接格式不正确。')); return; }
    if (parsed.protocol !== 'accio:' || parsed.hostname !== 'chat' || parsed.pathname !== '/new' || parsed.username || parsed.password) {
      reject(new Error('分析会话链接格式不正确。')); return;
    }
    const windows = platform === 'win32';
    const command = windows
      ? path.win32.join(env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      : platform === 'darwin' ? 'open' : 'xdg-open';
    const args = windows ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', windowsOpenScript] : [url];
    const options = { timeout: 15000, windowsHide: true, ...(windows ? { env: { ...env, LSOU_ACCIO_OPEN_URI: url } } : {}) };
    /** 将系统失败转为通俗提示，并附脱敏诊断；不传播包含完整命令行的原始异常。 */
    function finished(error, _stdout, stderr) {
      if (!error) { resolve(); return; }
      const failure = new Error('未能打开 Accio Work，请确认已安装且可正常打开；仍失败请查看启动诊断。');
      failure.launchDiagnostic = launchErrorDetails(error, stderr);
      reject(failure);
    }
    try { run(command, args, options, finished); } catch (error) { finished(error); }
  });
}
/** 创建当前账号交接服务。scope为账号隔离值；目录和launch可注入测试；返回send方法，无自动分析。 */
function createAwHandoff({scope,directory=path.join(os.homedir(),'.lsou','analysis-handoffs'),launch=openAW,log=console.log}){
 const root=path.join(directory,crypto.createHash('sha256').update(String(scope)).digest('hex').slice(0,20));
 const pending=new Map();
 /** 保存指定定位页快照并唤起AW一次。input含requestId/index/data/period；返回启动受理结果，校验/写盘/启动错误抛出。 */
 async function send(input){
  const {requestId,index,data,period}=input||{};
  if(!/^[a-zA-Z0-9-]{16,80}$/.test(requestId||'')||!Number.isInteger(index)||!topics[index]||!data||typeof data!=='object'||Array.isArray(data))throw new Error('分析资料格式不正确，请重新打开当前定位页。');
  const encoded=JSON.stringify({index,data,period});if(Buffer.byteLength(encoded)>1900000)throw new Error('当前资料较多，无法完整打包；请缩小所选范围后重试。');
  const fingerprint=crypto.createHash('sha256').update(encoded).digest('hex');
  if(pending.has(requestId)){const previous=pending.get(requestId);if(previous.fingerprint!==fingerprint)throw new Error('本次请求的数据已变化，请重新点击分析。');return previous.promise;}
  const promise=(async()=>{
   fs.mkdirSync(root,{recursive:true,mode:0o700});
   const file=path.join(root,requestId+'.json');
   const snapshot={schema_version:'lsou.aw-handoff.v1',snapshot_id:requestId,topic:topics[index],captured_at:new Date().toISOString(),selected_period:period,data:scrub(data)};
   fs.writeFileSync(file,JSON.stringify(snapshot,null,2),{flag:'wx',mode:0o600});
   const query=prompt(index,file);const url='accio://chat/new?'+new URLSearchParams({query,launchId:requestId,source:'lsou-position'});
   log('[aw-handoff] 定位数据快照已保存，开始唤起 Accio Work');
   try{await launch(url);}catch(error){log('[aw-handoff] 唤起失败，数据快照保留',requestId,JSON.stringify(launchErrorDetails(error)));throw error;}
   log('[aw-handoff] 操作系统已接受唤起请求；分析完成状态由 Accio Work 展示');
   return {snapshot_id:requestId,launch_requested:true};
  })();
  pending.set(requestId,{fingerprint,promise});if(pending.size>100)pending.delete(pending.keys().next().value);
  return promise;
 }
 return {send};
}
module.exports={createAwHandoff,prompt,skillRequestMessage,scrub,openAW,launchErrorDetails};
