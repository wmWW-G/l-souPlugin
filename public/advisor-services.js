/* 业务卡片入口、内嵌报告与连续问答；复用同源顾问接口，不执行平台写操作。 */
(() => {
  'use strict';
  const catalog={
    plan:['新店运营规划','老店运营诊断规划','3月新贸节作战计划','9月采购节作战计划'],
    position:['市场与客群定位','公司定位','产品定位','店铺装修文案','详情页装修文案'],
    foundation:['一键选品','整理关键词','批量标题','批量发品规划'],
    ads:['广告策略','广告诊断优化','品广诊断优化'],
    cultivation:['优爆品提升','核心品跟进','单品历史数据'],
    product:['店铺诊断','产品诊断','广告诊断','品广诊断'],
    visitor:['优质RFQ信息采集','RFQ报价跟进表','询盘明细分析','客户列表分析','询盘登记','客户背调','询盘分析与回复']
  };
  const modules={plan:'overview',position:'market',foundation:'product',ads:'ads',cultivation:'product',product:'product',visitor:'visitor'};
  // SOP方法只作为分析任务背景，放在limitations中，不伪装为已核验的经营事实。
  const methods={
    plan:'参考SOP运营规划与店铺诊断：先确认店铺阶段和目标，结合店铺星等级、商品、橱窗、转化和商机质量识别缺项，再输出建设或整改顺序、建议分工和复查条件。大促资格和日期需另行核实。',
    position:'参考SOP市场定位、产品定位和店铺定位装修：需要类目、国家需求、产品组合及公司能力证据；比较国家和产品机会，提炼客群痛点与有依据的优势，输出定位或文案草稿及待补素材。',
    foundation:'参考SOP选品、关键词库和高质量发品：需要产品事实、搜索词、类目与属性；核对需求匹配、去重归类和品牌词风险，输出选品依据、词库或标题草稿及发品核对清单。不能声称已发布。',
    ads:'参考SOP付费广告与品广场景流量：需要计划、产品、地域、关键词和询盘质量报表；比较花费、点击和商机，输出分层投放或优化建议及验证条件。不得编造预算、ROI或已调价结果。',
    cultivation:'参考SOP优爆品打造与核心产品数据跟踪：需要平台商品层级、质量、商机、成交、资源位及连续历史；识别可验证的提升条件，输出逐品动作和复查表。不得套用未核实阈值或承诺限时升品。',
    product:'参考SOP店铺诊断与产品优化：需要同周期店铺、商品及广告数据，沿曝光、点击、询盘和成交定位待验证问题；输出证据、可能原因、优化步骤和复查条件。缺失品牌广告报表须说明。',
    visitor:'参考SOP询盘质量跟进与RFQ营销：需要产品、国家、客户等级、询盘原文和跟进记录；基于实际需求做分类，输出登记或回复草稿及待确认问题。访客不等于询盘客户；客户背调需外部可信证据，当前不足时只列待核实项。'
  };
  // 沿用原型的业务维度；同时作为Workflow输出标题约定和前端固定卡片标题。
  const layouts={
    plan:[['店铺目标','建设路径','执行分工','复盘安排'],['店铺诊断','整改重点','执行分工','复盘安排'],['活动准备','商品备战','预算与产能','执行与复盘'],['活动准备','商品备战','预算与产能','执行与复盘']],
    position:[['目标市场分析','客群画像','痛点分析','决策链'],['公司实力','定制优势','品质保障','服务能力'],['产品分组','选品方向','核心产品','资料准备'],['首屏定位','主推产品','实力展示','服务承诺'],['产品卖点','应用场景','定制与品质','采购问答']],
    foundation:[['选品信号','候选产品','风险核对','选品清单'],['搜索主词','长尾与场景词','品牌与无关词','词库整理'],['标题结构','标题草稿','卖点表达','合规核对'],['发品范围','资料完整度','发布安排','审核核对']],
    ads:[['商品阶段','推广方式','预算依据','复查指标'],['计划表现','产品表现','国家与关键词','询盘质量'],['创意与产品','关键词匹配','流量表现','优化动作']],
    cultivation:[['商品层级','提升条件','优化动作','复查指标'],['核心商品','当前表现','跟进动作','执行核对'],['历史表现','变化信号','原因待核实','复查安排']],
    product:[['经营表现','主要问题','优化动作','复查指标'],['曝光表现','点击表现','商机表现','优化动作'],['计划表现','产品表现','词与国家','优化动作'],['创意与产品','关键词匹配','流量表现','优化动作']],
    visitor:[['采购需求','产品匹配','买家信号','跟进准备'],['报价记录','需求核对','跟进重点','待补资料'],['询盘概况','需求匹配','质量判断','跟进建议'],['客户分布','买家等级','行为信号','跟进重点'],['客户资料','询盘内容','产品需求','跟进记录'],['企业信息','业务匹配','可信证据','待核实项'],['需求理解','回复要点','回复草稿','发送前核对']]
  };
  /** 返回主题的固定板块；输入为会话对象，返回四个标题，不抛异常。 */
  function sections(state){return layouts[state.page]?.[catalog[state.page].indexOf(state.topic)]||['当前表现','数据依据','建议动作','复查安排'];}
  /** 将原型结构映射到既有Workflow tasks契约；只约束输出，不补造业务事实。 */
  function presentationRule(state){return `本主题必须按固定界面板块输出：${sections(state).join('、')}。继续使用schema_version 2.0和原tasks结构：有证据支持的板块对应一个task，title必须与上述标题完全一致，按上述顺序排列；不得改成泛化问题标题。每个basis用一句话且不超过70字，steps最多2条且每条不超过55字，hypotheses、acceptance_criteria各最多2条且每条不超过55字，summary不超过100字。引用真实evidence_ids，不得为了填满板块伪造数据；缺少依据的板块不输出task，把缺项放入有依据task的missing_data；完全缺数据时返回needs_data及空tasks。客群类型、痛点及采购决策链不能从国家占比推断；公司实力、认证与服务承诺必须有事实依据。建议或草稿不能标为已执行。`;}
  const states=new Map();let selected=null,drawer=null;
  const esc=value=>window.AdvisorUI.esc(value);
  /** 同源顾问请求；body为可选JSON，返回响应对象，失败抛出可读错误。 */
  async function request(path,body){const response=await fetch('/api/advisor/'+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||'顾问服务暂不可用');return data;}
  let currentPage='',observer=null;
  /** 业务卡片标题映射到既有分析主题；不添加独立服务栏。 */
  const placements={
    plan:[['新店运营规划 SOP',[0]],['老店运营诊断规划 SOP',[1]],['3月新贸节作战计划',[2]],['9月采购节作战计划',[3]]],
    ads:[['当前投放计划',[0]],['广告诊断与执行',[1,2]]],
    cultivation:[['核心商品跟进',[0]],['跟进动作清单',[1]],['单品历史趋势',[2]]],
    product:[['产品核心链路数据',[0]],['诊断依据',[1]],['诊断执行清单',[2,3]]],
    visitor:[['RFQ 采购需求',[0,1]],['买家等级分布',[2,3]],['访客与询盘行为',[4,5,6]]]
  };
  /** 生成业务卡片内按钮，page/index取内部目录，返回安全HTML。 */
  function action(page,index){return `<button type="button" class="av-inline-trigger" data-service-page="${page}" data-service-index="${index}">${esc(catalog[page][index])} <span aria-hidden="true">→</span></button>`;}
  /** 创建右侧嵌入式结果区域；返回容器或null，不打开弹窗。 */
  function ensureDrawer(){
    const host=currentPage==='position'?document.getElementById('wfPositionAI'):document.getElementById('avWorkflowPanel');
    if(!host)return null;
    if(drawer?.isConnected&&host.contains(drawer))return drawer;
    if(currentPage==='position')host.replaceChildren();
    drawer=document.createElement('section');drawer.className='av-inline-result';
    drawer.innerHTML=`<header><div><small>运营顾问 · 分析结果</small><h2 data-service-title>选择一项业务开始分析</h2></div></header><div class="av-service-body"><div class="av-service-empty"><i class="ri-file-chart-line"></i><h3>从左侧选择业务</h3><p>结合店铺数据生成分析，结果会显示在这里。</p></div></div>`;
    host.prepend(drawer);return drawer;
  }
  /** 将分析入口挂到对应卡片；异步数据重绘后补回，已存在的入口不重复插入。 */
  function decorate(){
    const content=document.querySelector('#advisorDesign .av-content');if(!content)return;
    for(const [label,indexes] of (currentPage==='position'?placements[currentPage]:[])||[]){
      const heading=[...content.querySelectorAll('h3,strong,.wf-campaign-head strong,.av-visitor-tabs button')].find(el=>el.textContent.trim().startsWith(label));
      const card=heading?.closest('section,.wf-sop,.av-visitor-shell');
      if(!card||card.querySelector(`[data-inline-group="${indexes.join('-')}"]`))continue;
      const group=document.createElement('div');group.className='av-context-actions';group.dataset.inlineGroup=indexes.join('-');group.innerHTML=indexes.map(index=>action(currentPage,index)).join('');
      const header=heading.closest('.av-dash-heading,.aa-heading,.wf-campaign-head');
      if(header)header.after(group);else card.prepend(group);
    }
    // 将原有任务和历史入口保留在定位卡片内部，避免固定高度后不可达。
    if(currentPage==='position'){
      const extra=content.querySelector('.wf-content>.av-grid'),host=document.getElementById('wfPositionBody');
      if(extra&&host){const details=document.createElement('details');details.className='av-workflow-evidence';details.innerHTML='<summary>执行记录与历史</summary>';details.append(extra);host.append(details);}
    }
    if(currentPage==='position'&&selected&&!drawer?.isConnected){ensureDrawer();render();}
  }
  /** 页面导航后挂载固定结果栏；page为业务页名，返回void，取消旧页面显示归属。 */
  function attach(page){
    observer?.disconnect();currentPage=page;selected=null;drawer=null;
    const root=document.getElementById('advisorDesign');if(!root||!catalog[page])return;
    root.dataset.workflowPage=page;
    // Workflow/Chatflow 占位已撤下，页面仅保留数据和明确的 AW 交接入口。
    decorate();observer=new MutationObserver(decorate);observer.observe(root.querySelector('.av-content'),{childList:true,subtree:true});
  }
  /** 创建主题独立会话，仅准备真实资料和读取历史结果，不自动调用分析；结果仅写入当前主题。 */
  async function open(page,index){
    const topic=catalog[page]?.[index];if(!topic||page!==currentPage)return;
    const chosenProduct=page==='position'&&index===4?window.AdvisorPositionContext?.():null;
    const period=window.AdvisorLive.range(),key=JSON.stringify([page,topic,period,chosenProduct]);let state=states.get(key);
    if(!state){state={page,topic,period,key,messages:[],session:'',busy:false,loading:false};states.set(key,state);}
    selected=state;ensureDrawer();render();if(state.busy||state.loading)return state;
    state.loading=true;state.error='';render();
    try{
      await window.AdvisorLive.ready();if(selected!==state||currentPage!==page)return;
      const records=window.AdvisorLive.records();if(page==='plan'&&window.AdvisorPlanContext?.())records.push({source:'本地浅层对标规则（派生结果，非原因诊断）',scope:'最新经营日与独立近30天接待口径',data:window.AdvisorPlanContext()});if(chosenProduct)records.push({source:'用户选择的详情页参考商品',scope:'当前选择',data:chosenProduct});state.records=records;const input={module:topic==='店铺诊断'?'overview':topic.includes('广告诊断')||topic.includes('品广')?'ads':modules[page],period:{startDate:period.startDate,endDate:period.endDate,grain:period.mode},cache_scope:{advisor_page:page,service:topic,selected_product:chosenProduct?.detailUrl||'',presentation:'prototype-cards-v1'},records,limitations:[`用户选择服务：${topic}。${methods[page]}`,presentationRule(state),'仅根据所附记录分析，不补造缺失数据；不同来源统计周期分别解释。SOP数值和平台规则未经核实不作为通用阈值。输出建议与实际执行分开。']};
      const [config,data]=await Promise.all([request('config'),request('context',input)]);state.config=config;
      if(state.snapshot&&state.snapshot.snapshot_id!==data.snapshot.snapshot_id){state.messages=[];state.session='';}
      state.snapshot=data.snapshot;state.result=data.result;state.error='';
    }catch(error){state.error=error.message;}finally{state.loading=false;if(selected===state)render();}
    // 打开业务项仅准备资料或读取已有报告；付费分析只能由用户点击开始按钮触发。
    return state;
  }
  /** 定位菜单切换回原始资料，清除结果区归属，不调用分析接口。 */
  function showData(){selected=null;drawer=null;}
  /** 用户显式交接当前定位数据给AW；不调用Dify，重复点击互斥，错误就地显示。返回Promise<void>。 */
  let positionHandoffBusy=false;
  async function startPosition(index){
    if(positionHandoffBusy||currentPage!=='position')return;
    const host=document.getElementById('wfPositionHandoff'),button=host?.querySelector('[data-position-analyze]'),status=host?.querySelector('[data-aw-status]');
    positionHandoffBusy=true;if(button){button.disabled=true;button.textContent='正在打包资料…';}
    try{
      const data=window.AdvisorPositionExport(index),period=window.AdvisorLive.range();
      if(status)status.textContent='正在保存当前资料并唤起 Accio Work…';
      await request('aw-handoff',{requestId:crypto.randomUUID(),index,period,data});
      if(status)status.textContent='已请求打开 Accio Work，请在新对话中查看分析；若未弹出，请确认已安装并登录。';
    }catch(error){if(status)status.textContent=error.message||'未能发起分析，请重试。';}
    finally{positionHandoffBusy=false;if(button){button.disabled=false;button.textContent='交给 Accio Work 分析';}}
  }
  /** 市场卡片直接引用平台国家占比；state为会话，返回已转义的短表格。 */
  function marketFacts(state){
    if(state.page!=='position'||state.topic!=='市场与客群定位')return '';
    const record=(state.records||[]).find(r=>r.source==='/api/q/customer-profile'&&r.scope.includes('dimensionType=country'));
    const rows=(Array.isArray(record?.data)?record.data:[]).flatMap(group=>Array.isArray(group.country)?group.country:[]).slice(0,3);
    const names={US:'美国',IN:'印度',CI:'科特迪瓦',GB:'英国',DE:'德国',BR:'巴西',VE:'委内瑞拉'};
    return rows.length?`<div class="av-result-facts"><span>近30天店铺访客来源</span>${rows.map(r=>`<div><b>${esc(names[r.country]||r.country)}</b><strong>${r.visitorRate!=null&&Number.isFinite(Number(r.visitorRate))?(Number(r.visitorRate)*100).toFixed(1)+'%':'—'}</strong></div>`).join('')}</div>`:'';
  }
  /** 每个主题保持四个固定结果卡；没有依据的维度保持缺项，全文只在展开时显示。 */
  function report(state){
    const result=state.result,tasks=result?.tasks||[],labels=sections(state);
    const unmatched=tasks.filter(task=>!labels.includes(task.title));
    const hints={客群画像:'需补充买家类型、采购规模或询盘记录',痛点分析:'需补充询盘原文及客户关注问题',决策链:'需补充采购角色与审批流程'};
    return `<div class="av-result-grid">${labels.map((label,index)=>{
      const task=tasks.find(t=>t.title===label),facts=index===0?marketFacts(state):'';
      return `<section class="av-result-card"><header><span class="av-result-number">0${index+1}</span><h3>${esc(label)}</h3><small>${task?'分析建议':state.busy?'分析中':state.loading?'准备资料':result?'待补资料':'待开始'}</small></header>${facts}${task?`<p class="av-result-basis">${esc(task.basis)}</p><ul class="av-result-points">${(task.steps||[]).slice(0,2).map(point=>`<li>${esc(point)}</li>`).join('')}</ul><details class="av-result-more"><summary>依据与复查</summary>${(task.hypotheses||[]).length?`<h4>待验证判断</h4><ul>${task.hypotheses.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}<h4>复查标准</h4><ul>${(task.acceptance_criteria||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul>${task.missing_data?.length?`<h4>待补资料</h4><ul>${task.missing_data.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}</details>`:`<div class="av-result-pending"><i class="ri-${state.busy||state.loading?'loader-4':'file-search'}-line"></i><p>${state.busy?'正在结合店铺资料分析…':state.loading?'正在准备店铺资料…':result?esc(hints[label]||'资料确认后生成本板块内容'):'点击上方“开始分析”后生成'}</p></div>`}</section>`;
    }).join('')}</div>${result?`<details class="av-result-overall"><summary>整体判断${unmatched.length?'与补充分析':''}</summary><p>${esc(result.summary)}</p>${unmatched.map(t=>`<h4>${esc(t.title)}</h4><p>${esc(t.basis)}</p>`).join('')}</details>`:''}`;
  }
  /** 重绘选中会话，异步请求状态独立保存，不串入其他主题。 */
  function render(){const s=selected;if(!s||!drawer?.isConnected||s.page!==currentPage)return;drawer.querySelector('[data-service-title]').textContent=s.topic;const body=drawer.querySelector('.av-service-body');body.innerHTML=`${s.error?`<p class="av-service-error" role="alert">${esc(s.error)}</p>`:''}${s.loading?'<p role="status">正在准备当前页面资料…</p>':''}<div class="av-service-actions"><button class="av-btn" data-service-generate ${s.busy||s.loading||!s.snapshot?.facts.length||!s.config?.analysisConfigured?'disabled':''}>${s.busy&&!s.chatting?'正在分析…':s.result?'重新分析（消耗积分）':'开始分析（消耗积分）'}</button><button class="av-btn secondary" data-service-download ${s.result?'':'disabled'}>下载报告</button></div><p class="av-credit-notice">${s.result?'当前展示已生成的报告；重新分析会消耗账号积分。':'点击开始分析后将消耗账号积分；切换业务项不会自动开始分析。'}具体扣费以服务实际结算为准。</p>${s.config&&!s.config.analysisConfigured?'<p>分析服务暂未启用。</p>':''}${!s.loading&&s.snapshot&&!s.snapshot.facts.length?'<p class="av-service-error">当前没有可用业务数据，请刷新店铺数据后重新选择业务。</p>':''}${report(s)}${s.result?`<section class="av-followup"><h3>继续讨论</h3><p class="av-followup-hint">已带入上方分析结果，直接提问即可。</p><div class="av-service-questions">${['需要补充哪些资料？','下一步先做什么？','如何判断执行效果？'].map(q=>`<button type="button" data-service-question="${q}">${q}</button>`).join('')}</div><div class="av-service-messages" aria-live="polite">${s.messages.map(m=>`<div class="av-service-message ${m.role}"><b>${m.role==='user'?'你':'运营顾问'}</b><p>${esc(m.text)}</p></div>`).join('')}</div><form class="av-service-chat-form"><label for="serviceQuestion">围绕${esc(s.topic)}继续提问</label><textarea id="serviceQuestion" maxlength="2000" rows="3" placeholder="补充你的目标、产品或客户情况…">${esc(s.draft||'')}</textarea>${s.config&&!s.config.chatConfigured?'<p class="av-service-error">对话服务尚未启用，暂时无法发送。你可以先使用分析报告。</p>':''}<p class="av-credit-notice">发送问题将消耗账号积分，具体扣费以服务实际结算为准。</p><button class="av-btn" type="submit" ${s.busy||s.loading||!s.config?.chatConfigured?'disabled':''}>${s.chatting?'正在回答…':'发送（消耗积分）'}</button></form></section>`:''}`;}
  /** 显式生成一次分析，失败保留已有报告，返回Promise，无平台写操作。 */
  async function generate(s=selected){if(!s?.snapshot||s.busy||s.loading||!s.config?.analysisConfigured||!s.snapshot.facts.length)return;s.busy=true;s.error='';render();try{const data=await request('analysis',{snapshot_id:s.snapshot.snapshot_id,refresh:Boolean(s.result)});s.result=data.result;s.messages=[];s.session='';}catch(error){s.error=error.message;}finally{s.busy=false;if(selected===s)render();}}
  /** 发送真实问答并读取SSE；question为用户输入，失败不生成模拟回答。 */
  async function ask(question){const s=selected;if(!s?.snapshot||!s.result||s.busy||!s.config?.chatConfigured||!question.trim())return;s.busy=true;s.chatting=true;s.error='';s.draft='';s.messages.push({role:'user',text:question.trim()});const answer={role:'assistant',text:''};s.messages.push(answer);render();try{const response=await fetch('/api/advisor/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({snapshot_id:s.result.snapshot_id||s.snapshot.snapshot_id,question:question.trim(),selection:{label:s.topic},session_id:s.session})});if(!response.ok){const data=await response.json();throw new Error(data.error||'对话服务暂不可用');}const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',ended=false;while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let end;while((end=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);const line=frame.split('\n').find(x=>x.startsWith('data: '));if(!line)continue;const event=JSON.parse(line.slice(6));if(event.type==='meta')s.session=event.session_id;if(event.type==='answer')answer.text=event.text;if(event.type==='error')throw new Error(event.message);if(event.type==='done')ended=true;if(selected===s)render();}}if(!ended)throw new Error('连接中断，已收到的答复可能不完整。');}catch(error){s.error=error.message;}finally{s.busy=false;s.chatting=false;if(selected===s)render();}}
  /** 下载真实返回的报告为Markdown；没有报告则不下载，无远端写入。 */
  function download(){const s=selected;if(!s?.result)return;const r=s.result,text=`# ${s.topic}\n\n${r.summary}\n\n`+(r.tasks||[]).map(t=>`## ${t.title}\n\n${t.basis}\n\n`+(t.steps||[]).map((x,i)=>`${i+1}. ${x}`).join('\n')+'\n\n复查：\n'+(t.acceptance_criteria||[]).map(x=>'- '+x).join('\n')).join('\n\n');const url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=s.topic+'.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  document.addEventListener('click',event=>{const b=event.target.closest('button');if(!b)return;if(b.hasAttribute('data-position-analyze')){void startPosition(Number(b.dataset.positionAnalyze));return;}if(b.dataset.servicePage){if(document.getElementById('avWorkflowPanel'))void open(b.dataset.servicePage,Number(b.dataset.serviceIndex));return;}if(!drawer?.contains(b))return;if(!selected)return;if(b.hasAttribute('data-service-generate'))void generate(selected);if(b.hasAttribute('data-service-download'))download();if(b.dataset.serviceQuestion){selected.draft=b.dataset.serviceQuestion;render();drawer.querySelector('textarea')?.focus();}});
  document.addEventListener('input',event=>{if(event.target.id==='serviceQuestion'&&selected)selected.draft=event.target.value;});
  document.addEventListener('submit',event=>{if(event.target.matches('.av-service-chat-form')){event.preventDefault();void ask(selected.draft||'');}});
  window.AdvisorServices={open,attach,action,showData};
})();
