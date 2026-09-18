'use strict';
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {openAW,scrub,launchErrorDetails,skillRequestMessage}=require('./aw-handoff');
const {normalizePeriod,metricDictionary}=require('./analysis-context');
/** 规范空白与Unicode宽度后对两字段做精确指纹；不忽略数字、对象、标点或理由，避免吞掉有效新任务。参数为兼容新旧格式的任务，返回hash，无主动异常。 */
function fingerprint(task){
 const normalize=value=>String(value||'').normalize('NFKC').replace(/\s+/gu,' ').trim();
 return crypto.createHash('sha256').update(JSON.stringify([normalize(task.work||[task.title,task.action].filter(Boolean).join('\n')),normalize(task.reason||task.evidence)])).digest('hex');
}
/** 账号隔离的执行任务存储。root可供测试注入，launch负责唤起AW；文件异常向调用方抛出。 */
function createPlanningTasks({scope,root=path.join(os.homedir(),'.lsou','planning-tasks'),launch=openAW}){
 const dir=path.join(root,crypto.createHash('sha256').update(String(scope)).digest('hex').slice(0,20));
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const file=path.join(dir,'tasks.json');
 let state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{version:1,latest:null,requests:[],tasks:[]};
 /** 原子写入JSON，避免退出时留下半份主数据；权限仅限本机用户。 */
 function write(target,value){const tmp=target+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2),{mode:0o600});fs.renameSync(tmp,target);}
 /** 保存主数据；请求状态与任务在同一次原子替换中提交。 */
 function save(){write(file,state);}
 /** 校验模型文本，限制字段长度，不执行模型提供的内容。 */
 function text(value,max=5000){if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error('任务字段缺失或过长');return value.trim();}
 /** 扫描本账号已登记请求的固定结果路径；不信任模型传来的路径，不重复导入。 */
 function sync(){for(const r of state.requests){if(!['pending','invalid'].includes(r.status))continue;const output=path.join(dir,r.id,'result.json');if(!fs.existsSync(output))continue;
  try{const stat=fs.lstatSync(output);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024)throw new Error('结果文件不合法');const data=JSON.parse(fs.readFileSync(output,'utf8'));
   if(data.request_id!==r.id||!Array.isArray(data.tasks)||data.tasks.length>(r.skillVersion>=2?8:50))throw new Error('请求编号或任务格式不匹配');
   const now=new Date().toISOString();const seen=new Set(state.tasks.flatMap(t=>[fingerprint(t),...(t.contentFingerprints||[])]));
   // 先校验全部行再导入；损坏行不能导致半份成功。保留旧指纹，防止人工编辑后原建议重新出现。
   const candidates=data.tasks.map(t=>{if(!t||typeof t!=='object')throw new Error('任务格式不合法');return {work:text(t.work||[t.title,t.action].filter(Boolean).join('\n')),reason:text(t.reason||t.evidence)};});
   const tasks=candidates.filter(t=>{const key=fingerprint(t);if(seen.has(key))return false;seen.add(key);return true;}).map(t=>({contentFingerprints:[fingerprint(t)],id:crypto.randomUUID(),requestId:r.id,work:text(t.work||[t.title,t.action].filter(Boolean).join('\n')),reason:text(t.reason||t.evidence),owner:null,dueDate:null,status:'pending',bucket:r.id===state.latest?'recent':'history',deleted:false,revision:1,createdAt:now,updatedAt:now,history:[{at:now,event:'Accio Work 生成'}]}));
   state.tasks.push(...tasks);r.status='imported';r.error='';r.importedAt=now;save();console.log('[planning-tasks] 结果已导入',r.id,tasks.length);
  }catch(e){if(r.status!=='invalid'||r.error!==e.message)console.warn('[planning-tasks] 结果校验失败',r.id,e.message);r.status='invalid';r.error=e.message;save();}
 }}
 /** 返回持久任务和请求摘要；刷新/重启后也会补读已完成结果。 */
 function list(){sync();return structuredClone(state);}
 /** 创建唯一请求并把既有任务及新资料交给AW；生成结果只能新增，不覆盖用户修改。 */
 async function generate(input){const period=normalizePeriod(input.period);sync();const id=input.requestId;if(!/^[0-9a-f-]{36}$/i.test(id||''))throw new Error('请求编号不合法');if(state.requests.some(r=>r.id===id))return list();
  if(state.requests.some(r=>r.status==='pending'))throw new Error('已有任务正在生成，请等待结果或先取消该请求');
  const skillPath=path.join(__dirname,'..','plugin','skills','lsou-planning-tasks','SKILL.md');
  const skill=fs.readFileSync(skillPath,'utf8');const skillHash=crypto.createHash('sha256').update(skill).digest('hex');
  const requestDir=path.join(dir,id);fs.mkdirSync(requestDir,{mode:0o700});const inputFile=path.join(requestDir,'input.json'),output=path.join(requestDir,'result.json');
  // 与报告统一保存完整技能副本；编号指向本次资料，升级不会改变在途规则。
  const frozenSkill=path.join(requestDir,'skill');fs.cpSync(path.dirname(skillPath),frozenSkill,{recursive:true});
  const requestRef=`${path.basename(dir)}/${id}`;
  write(inputFile,{schema_version:'lsou.planning-run.v1',request_id:id,request_ref:requestRef,skill:{name:'lsou-planning-tasks',version:2,sha256:skillHash},result_path:output,instruction:String(input.instruction||'根据当前经营资料提出待核查任务').slice(0,3000),period,metric_dictionary:metricDictionary,records:scrub(input.records||[]),existing_tasks:state.tasks,previous_requests:state.requests});
  const r={id,skill:'lsou-planning-tasks',skillVersion:2,skillHash,period,status:'pending',createdAt:new Date().toISOString(),instruction:String(input.instruction||'').slice(0,3000)};state.requests.push(r);state.latest=id;state.tasks.filter(t=>!t.deleted&&t.bucket==='recent').forEach(t=>{t.bucket='history';t.revision++;});save();
  const prompt = skillRequestMessage('lsou-planning-tasks',period,requestRef);
  try{await launch('accio://chat/new?'+new URLSearchParams({query:prompt,launchId:id,source:'lsou-tasks'}));console.log('[planning-tasks] 已交接',id);}catch(e){r.status='failed';r.error=e.message;save();console.error('[planning-tasks] 唤起失败',id,JSON.stringify(launchErrorDetails(e)));throw e;}return list();
 }
 /** 人工CRUD及历史互移；revision防止旧窗口覆盖新状态，删除可恢复。 */
 function update(input){sync();if(input.op==='cancel'){const r=state.requests.find(r=>r.id===input.id);if(!r)throw new Error('请求不存在');if(r.status==='imported')throw new Error('已导入的请求不能取消');r.status='cancelled';save();return list();}
  const now=new Date().toISOString();let t=state.tasks.find(t=>t.id===input.id);
  if(input.op==='add'){t={id:crypto.randomUUID(),requestId:state.latest,work:text(input.work||input.title),reason:text(input.reason||'用户手动创建'),owner:String(input.owner||'').slice(0,200)||null,dueDate:String(input.dueDate||'').slice(0,20)||null,status:'pending',bucket:'recent',deleted:false,revision:0,createdAt:now,history:[]};state.tasks.push(t);}
  else{if(!t)throw new Error('任务不存在');if(input.revision!==t.revision)throw new Error('任务已更新，请刷新后重试');
   if(input.op==='edit'){const work=text(input.work||input.title),reason=text(input.reason||t.reason||t.evidence);t.contentFingerprints=[...new Set([...(t.contentFingerprints||[]),fingerprint(t),fingerprint({work,reason})])];t.work=work;t.reason=reason;}
   else if(input.op==='complete'){t.status=t.status==='done'?'pending':'done';t.completedAt=t.status==='done'?now:null;}
   else if(input.op==='move'){if(!['recent','history'].includes(input.bucket))throw new Error('目标不合法');t.bucket=input.bucket;}
   else if(input.op==='delete')t.deleted=true;
   else if(input.op==='restore')t.deleted=false;
   else throw new Error('未知任务操作');
  }t.revision++;t.updatedAt=now;t.history.push({at:now,event:input.op});save();console.log('[planning-tasks] 更新',t.id,input.op);return list();
 }
 return {list,generate,update};
}
module.exports={createPlanningTasks};
