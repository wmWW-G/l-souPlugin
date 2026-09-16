/* 运营顾问页面编排。复用既有业务工作区；只管理本浏览器的规划，不提交任何平台写操作。 */
(() => {
  'use strict';
  const groups = {
    overview: [['overview','经营数据'],['staff','业务员表现']],
    plan: [['plan','运营规划']],
    position: [['position','定位工作台'],['market','市场与选品'],['storefront','公司与店铺资料']],
    foundation: [['foundation','建设流程'],['product-publish','产品发布'],['assets','素材工坊']],
    ads: [['ads','广告策略与诊断'],['flow','流量与搜索词']],
    cultivation: [['cultivation','核心品跟进']],
    product: [['product','产品诊断'],['overview','店铺诊断'],['ads','广告诊断'],['risk','风险合规']],
    visitor: [['visitor','客户与询盘'],['rfq','RFQ报价跟进']]
  };
  const parents = {staff:'overview',market:'position',storefront:'position',assets:'foundation',flow:'ads',rfq:'visitor'};
  const titles = {plan:'运营规划',position:'营销定位',foundation:'运营基建',cultivation:'优爆品提升'};
  const services = {
    position: [
      ['市场与客群定位','比较目标国家、需求与客户类型，确定优先市场。','market','查看市场依据',['目标国家与优先级','买家类型与采购需求','供应能力与需求匹配']],
      ['公司定位','把真实的工厂、定制、品控与交付能力转化为定位。','storefront','查看公司资料',['优势与证据对应关系','待补充的认证与素材','公司差异化定位']],
      ['产品定位','结合需求、利润与供应能力确定产品组合。','market','查看选品参考',['主攻子类目','引流、利润与形象产品','选品风险与待核实项']],
      ['店铺装修文案','根据已确认的定位组织首页、公司页与导航内容。','storefront','进入店铺装修',['首页定位语与内容结构','公司能力与证据','素材补充清单']],
      ['详情页装修文案','围绕具体产品整理卖点、参数、场景与信任资料。','product-publish','进入产品详情编辑',['产品事实与核心卖点','场景、认证与交付说明','详情图片与常见问答']]
    ],
    foundation: [
      ['一键选品','读取现有市场洞察，比较候选产品与需求信号。','market','查看选品数据',['需求与供应能力','候选产品与经营角色','风险与资料缺项']],
      ['一键整理关键词','结合进店词、行业需求与商品事实整理词库。','ads','进入关键词工作区',['核心词、长尾词与场景词','关键词与商品匹配','使用范围与审核意见']],
      ['批量标题','在原有产品发布工作台中批量生成并校对标题。','product-publish','进入批量标题',['已勾选的待发布商品','标题与关键词校对','完整商品资料与审核']],
      ['批量发品','保留全部原版商品编辑与真实发布流程。','product-publish','进入产品发布',['参考商品与从零创建','图片图集、SKU、商详与问答','批量草稿、逐条发布与历史回执']]
    ]
  };
  const storageKey = 'lsou:consultant:local-planning:v1';
  let state = {goal:'',stage:'老店整改',tasks:[],notes:{}}, initialized=false;
  let coreRows=[], coreMonth='', coreVersion=0;
  /** 转义用户输入。@param {*} value 任意值。@returns {string} 安全HTML。@throws 无。 */
  const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  /** 解析工作区所属模块。@param {string} tab 既有路由。@returns {string} 主模块ID。@throws 无。 */
  function owner(tab) { return parents[tab] || tab; }
  /** 生成已注册业务入口按钮。@param {string} tab 路由。@param {string} text 文案。@param {boolean} primary 主按钮。@returns {string} HTML。@throws 无。 */
  function link(tab,text,primary=false) { return `<button type="button" data-consult-route="${escape(tab)}" class="${primary?'primary':'ghost'}">${escape(text)} <i class="ri-arrow-right-line" aria-hidden="true"></i></button>`; }
  /** 本地规划落盘并反馈，不记录业务正文到日志。@returns {boolean} 是否写入成功。@throws 存储异常在此捕获。 */
  function save() {
    try { localStorage.setItem(storageKey,JSON.stringify(state)); console.info('[consultant] local plan saved'); return true; }
    catch { window.toast?.('浏览器存储不可用，本次修改仅在当前页面保留',true); return false; }
  }
  /** 输出本地任务工作区。@param {string} page 模块。@returns {string} HTML。@throws 无。 */
  function tasks(page) {
    const rows=state.tasks.filter(t=>t.page===page);
    return `<section class="card consult-tasks"><div class="card-hd"><div><h2>${page==='cultivation'?'核心品跟进记录':'执行清单'}</h2><p class="hint">保存在当前浏览器 · 手动记录，不代表平台操作已执行</p></div><button data-consult-export="${page}" ${rows.length?'':'disabled'}>导出清单</button></div>
      <form data-consult-task="${page}" class="consult-task-form"><label>${page==='cultivation'?'商品与具体动作':'工作事项'}<input name="title" required maxlength="160" placeholder="填写对象与具体动作"></label><label>负责人<input name="person" required maxlength="40" placeholder="负责人"></label><label>完成日期<input name="due" type="date" required></label><button class="primary" type="submit">加入清单</button></form>
      <div class="tablewrap"><table><thead><tr><th>工作事项</th><th>负责人</th><th>完成日期</th><th>状态</th><th>完成条件 / 结果凭证</th><th>操作</th></tr></thead><tbody>${rows.map(t=>`<tr><td>${escape(t.title)}</td><td>${escape(t.person)}</td><td>${escape(t.due)}</td><td><select data-consult-status="${escape(t.id)}" aria-label="${escape(t.title)}的状态">${['待确认','进行中','待复盘','已复盘'].map(s=>`<option ${t.status===s?'selected':''}>${s}</option>`).join('')}</select></td><td><input data-consult-evidence="${escape(t.id)}" value="${escape(t.evidence)}" maxlength="500" aria-label="${escape(t.title)}的完成条件或凭证" placeholder="记录链接、结果或验收条件"></td><td><button data-consult-remove="${escape(t.id)}" aria-label="删除${escape(t.title)}">删除</button></td></tr>`).join('')||'<tr><td colspan="6"><div class="empty">还没有安排任务。先确认依据，再记录动作、负责人和完成条件。</div></td></tr>'}</tbody></table></div></section>`;
  }
  /** 生成规划页，所有业务状态由用户填写。@returns {string} HTML。@throws 无。 */
  function planning() {
    return `<div class="consult-heading"><div><p class="consult-eyebrow">从目标到执行</p><h2>先确定方向，再安排本周工作</h2><p>新店先建设，老店先诊断；把判断变成有负责人、有完成条件的行动。</p></div></div>
      <form id="consultGoal" class="consult-goal"><label>经营目标<input name="goal" maxlength="200" placeholder="例如：提高目标市场的有效询盘" value="${escape(state.goal)}"></label><label>店铺阶段<select name="stage">${['新店建设','老店整改'].map(s=>`<option ${state.stage===s?'selected':''}>${s}</option>`).join('')}</select></label><button type="submit">保存目标</button><span role="status" id="consultGoalStatus">仅保存到当前浏览器</span></form>
      <div class="consult-route-grid">${[
        ['新店运营规划 SOP','建立基本盘，再用流量验证产品',['启动会','营销定位','装修与词库','产品发布','流量获取','核心品培育'],'position','开始营销定位'],
        ['老店运营诊断规划 SOP','从现有经营结果出发，确定整改优先级',['店铺诊断','问题排序','整改动作','明确负责人','执行跟进','效果复盘'],'product','开始店铺诊断']
      ].map(([title,desc,steps,route,action])=>`<article class="card consult-route"><h3>${title}</h3><p>${desc}</p><ol>${steps.map(x=>`<li>${x}</li>`).join('')}</ol>${link(route,action,true)}</article>`).join('')}</div>
      <div class="consult-campaigns">${['3月新贸节作战计划','9月采购节作战计划'].map(name=>`<details class="card"><summary><i class="ri-calendar-event-line" aria-hidden="true"></i><strong>${name}</strong><span>活动条件待核实</span></summary><div><p>核实报名条件、预算与产能、主推品、团队分工和复盘时间。</p><label>活动安排<textarea data-consult-note="${name}" rows="3" placeholder="填写已核实的安排；不预设预算或活动截止日期">${escape(state.notes[name])}</textarea></label><button data-consult-save-note="${name}">保存安排</button></div></details>`).join('')}</div>${tasks('plan')}${next('position','营销定位')}`;
  }
  /** 展示真实经营快照中的健康指标。@param {object} row 最新日记录。@returns {void}。@throws 无。 */
  function health(row={}) {
    const box=document.getElementById('consultHealth');if(!box)return;
    const values=[['有效商品',row.validProdCnt,'件'],['优爆品',row.goodProdCnt,'件'],['首次回复率',row.fstReplyRate30d==null?null:Number(row.fstReplyRate30d)*100,'%'],['平均回复时长',row.avgReplyTime30d,'小时']];
    box.innerHTML=values.map(([label,value,unit])=>`<div><span>${label}</span><strong>${value==null?'—':escape(Number(value).toLocaleString('zh-CN',{maximumFractionDigits:2}))}<small>${unit}</small></strong></div>`).join('')+`<p>${escape(row.statDate||'未返回日期')} · 回复指标为近30天滚动值</p>`;
  }
  let dashboardVersion=0;
  /** 读取同周期成员绩效，只展示单一平台报告周期，不跨币种加总。@param {object} range 查询周期。@returns {Promise<void>}。@throws 网络异常显示为空态。 */
  async function dashboard(range) {
    const version=++dashboardVersion,box=document.getElementById('consultStaffRows'),scope=document.getElementById('consultStaffScope');if(!box)return;
    if(range.mode==='range'){box.innerHTML='<div class="empty">自定义区间不合并成员报表，请选择日、周或月查看。</div>';return;}
    box.innerHTML='<div class="empty">正在读取成员绩效…</div>';
    try {
      const response=await fetch('/api/q/account-summary?'+new URLSearchParams({startDate:range.startDate,endDate:range.endDate,statisticsType:range.mode}));const result=await response.json();if(!response.ok||!result.ok)throw new Error('成员绩效暂未读取成功');if(version!==dashboardVersion)return;
      const reports=(Array.isArray(result.data)?result.data:[]).flatMap(block=>Object.entries(block||{})).filter(([,rows])=>Array.isArray(rows)).sort(([a],[b])=>String(b).localeCompare(String(a)));const [period,rows]=reports[0]||['',[]];
      const members=rows.filter(row=>row.fullName!=='全部账号').slice(0,5);
      const metric=(row,key)=>row[key]==null?'—':escape(row[key]);
      scope.textContent=period?'平台报告日期：'+period:'平台未返回报告日期';
      box.innerHTML=members.length?`<table><thead><tr><th>业务员</th><th>询盘数</th><th>TM访客</th><th>已付款单</th></tr></thead><tbody>${members.map(row=>`<tr><td>${escape(row.fullName||'未命名成员')}</td><td>${metric(row,'fbPv')}</td><td>${metric(row,'uvFbAtm')}</td><td>${metric(row,'prepayMordCnt')}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">当前报告没有成员数据</div>';
    } catch(error){if(version===dashboardVersion)box.innerHTML=`<div class="empty">${escape(error.message)}，可在完整绩效页重试。</div>`;}
  }
  /** 核心品数据容器，默认沿用商品分析的最近完整月份。@returns {string} HTML。@throws 无。 */
  function coreWorkspace() {
    coreMonth ||= window.defaultTimeValue('month');
    return `<section class="card consult-core"><div class="card-hd"><div><h2>核心品候选与资源跟进</h2><p class="hint">按真实询盘排序 · 候选不等于平台优爆品判定</p></div><label>商品统计月份 <input type="month" id="consultCoreMonth" value="${escape(coreMonth)}" aria-label="核心品统计月份"></label></div><div id="consultCoreRows" class="tablewrap"><div class="empty">正在读取当前账号商品…</div></div></section>`;
  }
  /** 读取既有只读商品分析，丢弃旧月份响应。@returns {Promise<void>}。@throws 失败显示在当前数据区域，不造示例。 */
  async function loadCore() {
    const version=++coreVersion,month=coreMonth, box=document.getElementById('consultCoreRows');if(!box)return;
    box.innerHTML='<div class="empty">正在读取当前账号商品…</div>';
    try {
      TimePolicy.validate('shop-product', {statDate:month+'-01',statisticsType:'month'});
      const response=await fetch('/api/dashboard/product-analysis?'+new URLSearchParams({statDate:month+'-01',statisticsType:'month'}));
      const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'商品数据暂时不可用');
      if(version!==coreVersion||!box.isConnected)return;
      const unique=new Map();Object.values(result.data?.focusProducts||{}).flat().forEach(row=>unique.set(row.analysisRef||row.productRef,row));
      coreRows=[...unique.values()].sort((a,b)=>(b.inquiries||0)-(a.inquiries||0)).slice(0,12);
      box.innerHTML=coreRows.length?`<table><thead><tr><th>商品</th><th>平台分层原值</th><th>曝光</th><th>点击</th><th>询盘</th><th>TM</th><th>下一步</th></tr></thead><tbody>${coreRows.map((row,i)=>`<tr><td><span class="consult-product-name">${escape(row.title||'未命名商品')}</span></td><td>${escape(row.level||'未返回')}</td><td>${escape(row.exposure)}</td><td>${escape(row.clicks)}</td><td>${escape(row.inquiries)}</td><td>${escape(row.tmInquiries)}</td><td><button data-consult-follow="${i}">安排跟进</button></td></tr>`).join('')}</tbody></table><p class="consult-core-scope">${escape(month)}自然月 · 已读取 ${escape(result.data.population)} 件商品 · 显示前12项候选</p>`:'<div class="empty">此月份没有返回可用商品，请更换月份。</div>';
      console.info('[consultant] core products loaded',coreRows.length);
    } catch(error) {if(version===coreVersion&&box.isConnected)box.innerHTML=`<div class="empty">${escape(error.message)}<button data-consult-retry-core>重新读取</button></div>`;console.warn('[consultant] core products unavailable');}
  }
  /** 生成模块的下一步。@param {string} tab 路由。@param {string} label 标签。@returns {string} HTML。@throws 无。 */
  function next(tab,label) { return `<footer class="consult-next"><div><i class="ri-arrow-right-circle-line" aria-hidden="true"></i><b>下一步：${label}</b></div>${link(tab,'前往'+label)}</footer>`; }
  /** 生成定位/基建工作台，选中项保留在DOM。@param {string} page 模块。@param {number} selected 服务索引。@returns {string} HTML。@throws 无。 */
  function servicePage(page,selected=0) {
    const list=services[page], item=list[selected];
    return `<div class="consult-heading"><div><p class="consult-eyebrow">${page==='position'?'明确经营方向':'把定位变成商品资产'}</p><h2>${page==='position'?'确定卖给谁，凭什么被选择':'选品、词库、标题、发布'}</h2><p>${page==='position'?'用市场依据与公司事实支撑定位，再落实到店铺与详情表达。':'已有商品编辑与发布功能完整保留，按实际资料逐项确认。'}</p></div></div>
      <div class="consult-service-layout"><nav class="consult-service-list" aria-label="${titles[page]}服务">${list.map((x,i)=>`<button class="${selected===i?'selected':''}" data-consult-service="${page}:${i}" aria-pressed="${selected===i}"><span>${String(i+1).padStart(2,'0')}</span><div><b>${x[0]}</b><small>${x[1]}</small></div><i class="ri-arrow-right-s-line" aria-hidden="true"></i></button>`).join('')}</nav><article class="card consult-service-detail"><p class="consult-eyebrow">${String(selected+1).padStart(2,'0')} / ${titles[page]}</p><h3>${item[0]}</h3><p>${item[1]}</p><h4>资料与成果确认表</h4><div class="tablewrap"><table class="consult-evidence-table"><thead><tr><th>确认项目</th><th>现有依据 / 业务结论</th><th>状态</th></tr></thead><tbody>${item[4].map((x,i)=>`<tr><td>${x}</td><td><input data-consult-note="${item[0]}:field:${i}" value="${escape(state.notes[item[0]+':field:'+i])}" aria-label="${x}的依据" placeholder="填写可核实的资料或结论"></td><td><select data-consult-note="${item[0]}:status:${i}" aria-label="${x}的状态">${['待补充','待确认','已确认'].map(v=>`<option ${state.notes[item[0]+':status:'+i]===v?'selected':''}>${v}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div>
      <div class="consult-data-note"><i class="ri-information-line" aria-hidden="true"></i><p>先查看当前资料，再记录已确认的结论与待补项。</p></div>${link(item[2],item[3],true)}<label class="consult-notes-label">确认记录<textarea rows="2" data-consult-note="${item[0]}" placeholder="记录已确认的结论、资料缺项与下一步">${escape(state.notes[item[0]])}</textarea></label><button data-consult-save-note="${item[0]}">保存记录</button><span class="consult-save-status" role="status"></span></article></div>
      ${page==='foundation'?`<section class="consult-publish-highlight"><i class="ri-upload-cloud-2-line" aria-hidden="true"></i><div><h3>产品发布 · 完整工作台</h3><p>从零创建 / 参考商品 / 图片文件夹 · 图集与SKU · 商详与问答 · 批量标题 · 草稿与发布 · 历史回执</p></div>${link('product-publish','打开产品发布',true)}</section>`:''}${tasks(page)}${next(page==='position'?'foundation':'ads',page==='position'?'运营基建':'运营推广')}`;
  }
  /** 核心品跟进页不自造平台分层。@returns {string} HTML。@throws 无。 */
  function cultivation() {
    return `<div class="consult-heading"><div><p class="consult-eyebrow">以商品为对象持续跟进</p><h2>把资源放在值得培养的商品上</h2><p>先查看商品表现，再记录资源安排与复盘依据。</p></div>${link('product','查看商品表现',true)}</div>${coreWorkspace()}<div class="consult-route-grid"><article class="card consult-route"><i class="ri-star-line consult-large-icon" aria-hidden="true"></i><h3>优爆品提升</h3><p>从真实商品效果与内容质量诊断识别候选，结合样本和经营目标决定是否重点投入。</p><ul><li>商品表现与诊断依据</li><li>橱窗、认证、推广与活动资料</li><li>运营与业务共同跟进</li></ul>${link('product','查看候选商品')}</article><article class="card consult-route"><i class="ri-line-chart-line consult-large-icon" aria-hidden="true"></i><h3>单品历史与复盘</h3><p>保持统计口径一致，记录动作前后的数据变化；完成动作与经营改善分别跟踪。</p><ul><li>选择商品与观察周期</li><li>查看曝光、点击、询盘表现</li><li>判断继续投入或调整方向</li></ul>${link('product','进入商品分析')}</article></div><div class="consult-data-note"><i class="ri-information-line" aria-hidden="true"></i><p>平台分层以真实返回口径为准。“48H成为优品”等原型标签不作为自动判定或效果承诺。</p></div>${tasks('cultivation')}${next('product','数据分析与优化')}`;
  }
  /** 首次加载或局部操作后绘制页面。@param {string} page 模块ID。@param {number} selected 服务索引。@returns {void}。@throws 无。 */
  function render(page,selected=0) {
    const host=document.getElementById('tab-'+page); if(!host || !titles[page])return;
    host.innerHTML=page==='plan'?planning():page==='cultivation'?cultivation():servicePage(page,selected);
    if(page==='cultivation')void loadCore();
  }
  /** 切页时渲染二级导航，不移动或重建发布编辑器。@param {string} tab 页面ID。@returns {void}。@throws 无。 */
  function navigate(tab) {
    const nav=document.getElementById('consultModuleNav'), group=owner(tab), entries=groups[group]||[];
    if(nav){ nav.hidden=entries.length<2||tab==='product-publish'; nav.innerHTML=entries.map(([id,label])=>`<button data-consult-route="${id}" class="${id===tab?'selected':''}" aria-current="${id===tab?'page':'false'}">${label}</button>`).join(''); }
    document.querySelector('.app-layout')?.classList.toggle('consult-planning-mode',Boolean(titles[tab]));
  }
  /** 导出本地任务JSON，避免CSV公式注入。@param {string} page 模块。@returns {void}。@throws 浏览器下载异常正常上抛。 */
  function exportTasks(page) {
    const blob=new Blob([JSON.stringify({module:titles[page],scope:'当前浏览器手动规划，非平台执行回执',tasks:state.tasks.filter(t=>t.page===page)},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=titles[page]+'-执行清单.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  /** 初始化一次事件委托和本地规划。@returns {void}。@throws 坏缓存/存储失败安全降级。 */
  function initialize() {
    if(initialized)return;initialized=true;
    try { const stored=JSON.parse(localStorage.getItem(storageKey)||'null');if(stored&&Array.isArray(stored.tasks))state={...state,...stored,notes:stored.notes||{}}; } catch { console.warn('[consultant] local plan unavailable'); }
    document.getElementById('consultUtilities')?.addEventListener('change',e=>{if(e.target.value)window.switchTab(e.target.value);e.target.value='';});
    document.addEventListener('click',e=>{
      const b=e.target.closest('button');if(!b)return;
      if(b.hasAttribute('data-consult-retry-core')){void loadCore();return;}
      if(b.dataset.consultFollow!==undefined){const row=coreRows[Number(b.dataset.consultFollow)],input=document.querySelector('[data-consult-task="cultivation"] [name="title"]');if(row&&input){input.value=('跟进：'+row.title).slice(0,160);input.focus();input.scrollIntoView({block:'center',behavior:'smooth'});}return;}
      if(b.dataset.consultRoute){window.switchTab(b.dataset.consultRoute);return;}
      if(b.dataset.consultService){const [page,index]=b.dataset.consultService.split(':');render(page,Number(index));return;}
      if(b.dataset.consultSaveNote){const key=b.dataset.consultSaveNote;const input=[...document.querySelectorAll('[data-consult-note]')].find(x=>x.dataset.consultNote===key);state.notes[key]=input?.value||'';if(save())window.toast?.('记录已保存到当前浏览器');return;}
      if(b.dataset.consultRemove){const task=state.tasks.find(t=>t.id===b.dataset.consultRemove);if(task){state.tasks=state.tasks.filter(t=>t!==task);save();render(task.page);}return;}
      if(b.dataset.consultExport)exportTasks(b.dataset.consultExport);
    });
    document.addEventListener('input',e=>{if(e.target.dataset.consultNote)state.notes[e.target.dataset.consultNote]=e.target.value;});
    document.addEventListener('change',e=>{
      if(e.target.dataset.consultNote)state.notes[e.target.dataset.consultNote]=e.target.value;
      if(e.target.id==='consultCoreMonth'){coreMonth=e.target.value;void loadCore();return;}
      const id=e.target.dataset.consultStatus||e.target.dataset.consultEvidence;if(!id)return;
      const task=state.tasks.find(t=>t.id===id);if(!task)return;
      if(e.target.dataset.consultStatus)task.status=e.target.value;else task.evidence=e.target.value;save();
    });
    document.addEventListener('submit',e=>{
      if(e.target.id==='consultGoal'){e.preventDefault();const f=new FormData(e.target);state.goal=String(f.get('goal')).trim();state.stage=String(f.get('stage'));document.getElementById('consultGoalStatus').textContent=save()?'已保存到当前浏览器':'当前页面已保留';}
      if(e.target.dataset.consultTask){e.preventDefault();const f=new FormData(e.target),page=e.target.dataset.consultTask;const title=String(f.get('title')).trim(),person=String(f.get('person')).trim();if(!title||!person)return;state.tasks.push({id:crypto.randomUUID(),page,title,person,due:String(f.get('due')),status:'待确认',evidence:''});save();render(page);}
    });
    console.info('[consultant] workspace initialized; publishing preserved');
  }
  window.LsouConsultant={owner,navigate,render,initialize,health,dashboard};
})();
