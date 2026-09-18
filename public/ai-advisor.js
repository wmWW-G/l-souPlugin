/* 六页AI解读与连续问答。业务数据来自已完成的页面读取；不持有Dify凭据。 */
(() => {
  'use strict';
  const MODULES={overview:'经营总览',visitor:'客户与询盘',product:'商品运营',flow:'流量分析',market:'市场洞察',ads:'关键词与广告'};
  const PRIORITIES={high:'优先处理',normal:'常规关注',low:'持续观察'};
  const QUESTIONS={overview:['这页最值得关注什么？','接下来先处理哪件事？'],visitor:['哪些客户值得优先跟进？','下一次沟通应该确认什么？'],product:['当前四象限是什么意思？','这些商品先优化哪里？'],flow:['哪些渠道值得继续看？','流量和询盘的差异说明什么？'],market:['这个类目有哪些可验证的机会？','这些行业数据应该怎么比较？'],ads:['这些词适合我的产品吗？','判断广告效果还缺什么数据？']};
  const pages=new Map(),savedViews=new Map();let active='overview',panel,config={analysisConfigured:false,chatConfigured:false},configReady=false,returnFocus;
  let detailPopover,detailSelection=null,detailFrame=0;
  /** 所有动态内容先转义。@param {*} v 值。@returns {string} 安全HTML。@throws 无。 */
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  /** 取得页面会话状态；module为六页标识，返回状态对象；未知页不创建。 */
  function page(module){if(!MODULES[module])return null;if(!pages.has(module))pages.set(module,{module,version:0,revision:0,records:new Map(),result:null,snapshot:null,cachedSnapshot:null,viewKey:'',selection:{},messages:[],session:'',busy:false,analyzing:false,dirty:true});return pages.get(module);}
  /** 稳定序列化本页业务筛选；value为JSON值；返回内存索引文本，不把指标值加入索引。 */
  function stableView(value){if(Array.isArray(value))return '['+value.map(stableView).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stableView(value[k])).join(',')+'}';return JSON.stringify(value);}
  /** 记住已生成内容及原快照供切页即时恢复；state为本页状态；返回void，无磁盘写入。 */
  function remember(state){if(state.result&&state.viewKey)savedViews.set(state.viewKey,{result:state.result,cachedSnapshot:state.cachedSnapshot});}
  /** 同步已应用的范围，先恢复会话内缓存，再从本机后端读持久缓存；返回Promise，不请求模型。 */
  function restoreView(state){
    const input=inputFor(state),key=stableView([state.module,input.period,input.cache_scope||{},input.object?.cache_ref||input.object?.ref||'']);
    if(state.viewKey===key&&state.restoring)return state.restoring;
    remember(state);if(state.viewKey!==key){state.snapshot=null;state.dirty=true;state.revision++;state.error='';}state.viewKey=key;const saved=savedViews.get(key);state.result=saved?.result||null;state.cachedSnapshot=saved?.cachedSnapshot||null;
    const version=state.version;
    state.restoring=request('cache',{module:state.module,period:input.period,cache_scope:input.cache_scope,object:input.object?{ref:input.object.ref,cache_ref:input.object.cache_ref}:undefined}).then(data=>{
      if(state.version!==version||state.viewKey!==key)return;
      if(data.result&&(!state.result||data.result.generated_at>=state.result.generated_at)){state.result=data.result;state.cachedSnapshot=data.cached_snapshot;remember(state);}
      renderCard(state);
    }).catch(()=>{/* 本地缓存暂不可读时继续保留内存内容，后续context会显示连接错误。 */});
    return state.restoring;
  }
  /** 对本地请求体做大小限制；value为业务数据，返回有界副本；不改变页面原数据。 */
  function compact(value,depth=0){if(value==null||typeof value==='number'||typeof value==='boolean')return value;if(typeof value==='string')return value.slice(0,3000);if(depth>8)return '[深层数据已截断]';if(Array.isArray(value))return value.slice(0,50).map(x=>compact(x,depth+1));if(typeof value==='object')return Object.fromEntries(Object.entries(value).slice(0,80).map(([k,v])=>[k,compact(v,depth+1)]));return null;}
  /** 固定本次只读请求所属页面和版本；source/params为来源与参数；返回跟踪令牌，不发额外查询。 */
  function beginRead(source,params={}){const state=page(active);return state?{module:active,version:state.version,source,params:compact(params)}:null;}
  /** 记录页面已读取的数据；ticket为开始令牌，payload为响应，error标记失败；过期响应不进入新范围。 */
  function finishRead(ticket,payload,error=false){if(!ticket)return;const state=page(ticket.module);if(!state||state.version!==ticket.version)return;const key=ticket.source+'|'+JSON.stringify(ticket.params);state.records.set(key,{source:ticket.source,scope:'查询参数：'+JSON.stringify(ticket.params).slice(0,320)+'；来源内独立周期以原字段为准',observed_at:new Date().toISOString(),data:compact(payload&&Object.hasOwn(payload,'data')?payload.data:payload),error:Boolean(error)});while(state.records.size>24)state.records.delete(state.records.keys().next().value);state.dirty=true;state.revision++;scheduleRefresh(state);}
  /** 数据完成后仅恢复匹配缓存，不自动付费生成；state为页面状态；返回void。 */
  function scheduleRefresh(state){clearTimeout(state.timer);state.timer=setTimeout(()=>{if(active===state.module)void refresh(state.module);},450);}
  /** 页面导航/刷新切换数据代次；module为页签，reset表示开始新读取；返回void。 */
  function navigate(module,reset=false){closeDetail(false);active=module;const state=page(module);if(!state){if(panel)panel.hidden=true;return;}remember(state);if(reset){state.version++;state.records.clear();state.snapshot=null;state.selection={};state.restoring=null;state.dirty=true;state.revision++;}void restoreView(state);mount(state);renderCard(state);if(panel&&!panel.hidden)renderPanel();scheduleRefresh(state);}
  /** 创建当前页的紧凑AI区，总览复用原诊断卡；state为页面状态；返回DOM或null。 */
  function mount(state){const parent=document.getElementById('tab-'+state.module);if(!parent)return null;let host=document.getElementById('advisor-'+state.module);if(host)return host;
    host=document.createElement(state.module==='overview'?'div':'section');host.id='advisor-'+state.module;host.className='advisor-card-content'+(state.module==='overview'?'':' card advisor-card');host.setAttribute('aria-label',MODULES[state.module]+'AI解读');
    if(state.module==='overview'){const legacy=document.getElementById('actionPanel');legacy.classList.add('advisor-enabled');legacy.prepend(host);}else parent.prepend(host);
    host.addEventListener('click',event=>{const b=event.target.closest('button');if(!b)return;if(b.dataset.advisor==='analyze')void analyze(state);if(b.dataset.advisor==='chat')open();if(b.dataset.advisorDetail)toggleDetail(state,b.dataset.advisorDetail,b.dataset.finding||'',b);});return host;}
  /** 选择建议的装饰图标与主题色，不参与诊断、优先级或动作判断。@param {object} task 建议。@param {string} module 页面。@returns {object} 固定图标/色名。@throws 无。 */
  function findingAppearance(task,module){
    const title=String(task.title||'');
    if(/回复|响应|沟通|跟进|接待|客户/.test(title))return {tone:'green',icon:'ri-customer-service-2-line'};
    if(/成交|订单|付款|报价|转化/.test(title))return {tone:'purple',icon:'ri-shopping-cart-2-line'};
    if(/商品|优爆|选品|产品|主图|标题|橱窗/.test(title))return {tone:'yellow',icon:'ri-lightbulb-line'};
    if(/流量|曝光|点击|搜索|广告|投放|关键词|访客/.test(title))return {tone:'orange',icon:'ri-rocket-2-line'};
    return {visitor:{tone:'green',icon:'ri-customer-service-2-line'},product:{tone:'yellow',icon:'ri-lightbulb-line'},market:{tone:'blue',icon:'ri-compass-3-line'},ads:{tone:'purple',icon:'ri-megaphone-line'}}[module]||{tone:'orange',icon:'ri-rocket-2-line'};
  }
  /** 渲染固定高度的彩色建议行，完整正文留在气泡。@param {object} state 当前页。@param {object} result 可信结果。@returns {string} 已转义HTML。@throws 非法结果结构。 */
  function findingRows(state,result){return result.tasks.map(task=>{
    const appearance=findingAppearance(task,state.module);
    return `<button type="button" class="advisor-finding advisor-tone-${appearance.tone}" data-advisor-detail="finding" data-finding="${esc(task.id)}" aria-label="${esc(task.title)}，${esc(PRIORITIES[task.priority])}，查看建议" aria-expanded="false" aria-controls="advisor-detail-popover" aria-haspopup="dialog">
      <span class="advisor-finding-icon" aria-hidden="true"><i class="${appearance.icon}"></i></span>
      <span class="advisor-finding-copy"><span class="advisor-finding-title"><strong>${esc(task.title)}</strong><span class="advisor-priority ${esc(task.priority)}">${esc(PRIORITIES[task.priority])}</span></span><span class="advisor-finding-note">${esc(task.basis)}</span></span>
      <span class="advisor-finding-open" aria-hidden="true">查看建议 <i class="ri-arrow-left-s-line"></i></span></button>`;
  }).join('');}
  /** 渲染紧凑摘要与建议入口；重绘时关闭旧气泡，防止详情脱离当前快照。@param {object} state 页面状态。@returns {void}。@throws DOM缺失时不渲染。 */
  function renderCard(state){const host=mount(state);if(!host)return;if(detailSelection?.module===state.module)closeDetail(false);const result=state.result,ready=state.snapshot?.facts.length||state.cachedSnapshot?.facts.length;
    host.innerHTML=`<div class="advisor-heading"><div><span class="advisor-eyebrow"><i class="ri-sparkling-line" aria-hidden="true"></i> AI 解读</span><h2>${state.module==='overview'?'经营诊断':MODULES[state.module]+'，先看重点'}${result?`<span class="advisor-count" aria-label="${result.tasks.length}条建议">${result.tasks.length}</span>`:''}</h2></div><div class="advisor-tools"><button type="button" class="text-action" data-advisor="analyze" ${state.analyzing||!config.analysisConfigured||!ready?'disabled':''}>${state.analyzing?'分析中…':result?'更新解读':'生成解读'}</button>${config.chatConfigured?`<button type="button" class="advisor-chat-button" data-advisor="chat"><i class="ri-chat-3-line" aria-hidden="true"></i> 问 AI</button>`:''}</div></div>
      ${state.error?`<p class="advisor-error" role="alert">${esc(state.error)}</p>`:''}
      ${result?`<div class="advisor-main"><button type="button" class="advisor-summary-preview" data-advisor-detail="summary" aria-label="查看完整经营解读" aria-expanded="false" aria-controls="advisor-detail-popover" aria-haspopup="dialog"><span class="advisor-summary-label">本期解读 <span>查看全文 <i class="ri-arrow-left-s-line" aria-hidden="true"></i></span></span><span class="advisor-summary">${esc(result.summary)}</span></button><div class="advisor-findings">${findingRows(state,result)||'<p class="advisor-empty">当前没有可展开的诊断。</p>'}</div></div>`:
      `<p class="advisor-empty">${!configReady?'正在连接AI顾问…':!config.analysisConfigured?'AI解读暂未启用，配置完成后即可分析当前页面。':ready?'结合当前数据，解释值得关注的变化、判断依据和下一步。':config.chatConfigured?'等待当前页面数据；你仍可以询问指标含义。':'等待当前页面数据；读取后即可生成解读。'}</p>`}
      <div class="advisor-footer"><span>${result?esc(periodLabel(result.period))+' · '+esc(new Date(result.generated_at).toLocaleString('zh-CN',{hour12:false})):ready?'当前页面已就绪，点击生成解读':'等待当前页面数据'}</span>${result?'<span class="advisor-saved"><i class="ri-checkbox-circle-fill" aria-hidden="true"></i> 已保存本期解读</span>':''}</div>`;
  }
  /** 格式化周期；period为日期/标签对象；返回中文文本，不抛异常。 */
  function periodLabel(period){return period?.startDate?`${period.startDate} 至 ${period.endDate||period.startDate}`:period?.label||'各区域独立周期';}
  /** 计算气泡位置：桌面优先靠左；空间不足换侧，窄屏贴底。@param {object} anchor 入口矩形。@param {object} viewport 可见区域。@param {number} height 气泡实测高度。@returns {object} 有界位置/尺寸/箭头。@throws 无。 */
  function detailPlacement(anchor,viewport,height=0){
    const margin=12,gap=14,start=viewport.left||0,topEdge=viewport.top||0;
    const leftSpace=anchor.left-start-margin-gap,rightSpace=start+viewport.width-anchor.right-margin-gap;
    const side=viewport.width<680?'sheet':leftSpace>=320?'left':rightSpace>=320?'right':'sheet';
    const width=Math.min(460,viewport.width-margin*2,side==='left'?leftSpace:side==='right'?rightSpace:Infinity);
    const maxHeight=Math.min(620,viewport.height-margin*2),actualHeight=Math.min(height||maxHeight,maxHeight);
    const left=side==='left'?anchor.left-gap-width:side==='right'?anchor.right+gap:start+(viewport.width-width)/2;
    const top=side==='sheet'?topEdge+viewport.height-actualHeight-margin:Math.max(topEdge+margin,Math.min(anchor.top-16,topEdge+viewport.height-actualHeight-margin));
    return {side,width,maxHeight,left,top,arrow:Math.max(25,Math.min(anchor.top+anchor.height/2-top,actualHeight-25))};
  }
  /** 为列表正文统一转义。@param {string[]} items 文本条目。@param {string} tag 内部固定ol/ul。@param {string} className 内部固定类名。@returns {string} HTML。@throws 非数组参数。 */
  function detailList(items,tag='ul',className=''){return `<${tag} class="${className}">${items.map(item=>`<li>${esc(item)}</li>`).join('')}</${tag}>`;}
  /** 展示经营发现、行动与复查；引用仅在后端校验，不提供原始数据弹窗。@param {object} state 页面。@param {object} task 建议。@returns {string} HTML。@throws 非法结构。 */
  function findingDetail(state,task){const result=state.result;return `
    <section class="advisor-detail-section advisor-key-finding"><h3><i class="ri-focus-3-line" aria-hidden="true"></i> 关键发现</h3><p>${esc(task.basis)}</p></section>
    ${task.hypotheses.length?`<section class="advisor-detail-section advisor-hypothesis"><h3><i class="ri-lightbulb-line" aria-hidden="true"></i> 可能原因 <span>待验证</span></h3>${detailList(task.hypotheses)}</section>`:''}
    <section class="advisor-detail-section advisor-plan"><h3><i class="ri-route-line" aria-hidden="true"></i> 接下来这样做 <span>${task.steps.length} 个步骤</span></h3>${detailList(task.steps,'ol','advisor-detail-steps')}</section>
    <section class="advisor-detail-section advisor-review"><h3><i class="ri-checkbox-circle-line" aria-hidden="true"></i> 做完如何复查</h3>${detailList(task.acceptance_criteria,'ul','advisor-detail-checks')}</section>
    ${task.missing_data.length?`<section class="advisor-detail-section advisor-detail-missing"><h3>还缺哪些数据</h3>${detailList(task.missing_data)}</section>`:''}
    ${task.action_ids.length||config.chatConfigured?`<div class="advisor-followups">${config.chatConfigured?task.follow_up_questions.map(q=>`<button type="button" data-advisor-question="${esc(q)}">${esc(q)}</button>`).join(''):''}${task.action_ids.map(id=>`<button type="button" class="advisor-action" data-advisor-action="${esc(id)}">${esc(result.actions.find(a=>a.id===id)?.label||'查看数据')} <i class="ri-arrow-right-up-line" aria-hidden="true"></i></button>`).join('')}</div>`:''}`;
  }
  /** 只创建一个非模态气泡，不挤压页面，也不触发新分析。@returns {HTMLElement} 气泡。@throws DOM不可写。 */
  function ensureDetail(){if(detailPopover)return detailPopover;
    detailPopover=document.createElement('aside');detailPopover.id='advisor-detail-popover';detailPopover.hidden=true;detailPopover.tabIndex=-1;detailPopover.setAttribute('role','dialog');detailPopover.setAttribute('aria-labelledby','advisor-popover-title');document.body.append(detailPopover);
    detailPopover.addEventListener('click',event=>{const button=event.target.closest('button'),state=detailSelection&&page(detailSelection.module);if(!button||!state)return;if(button.dataset.detailClose){closeDetail();return;}if(button.dataset.advisorQuestion)open(button.dataset.advisorQuestion);if(button.dataset.advisorAction)runAction(state,button.dataset.advisorAction);});
    document.addEventListener('pointerdown',event=>{if(!detailSelection||detailPopover.contains(event.target)||event.target.closest?.('[data-advisor-detail]'))return;closeDetail(false);});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.isComposing&&detailSelection){event.preventDefault();event.stopPropagation();closeDetail();}});
    // 只跟随外部滚动；气泡内部滚动不重新定位，避免阅读位置跳动。
    document.addEventListener('scroll',event=>{if(!detailPopover.contains(event.target))queueDetailPosition();},{capture:true,passive:true});
    window.addEventListener('resize',queueDetailPosition,{passive:true});
    window.visualViewport?.addEventListener('resize',queueDetailPosition,{passive:true});
    window.visualViewport?.addEventListener('scroll',queueDetailPosition,{passive:true});
    return detailPopover;
  }
  /** 切换摘要或某条建议；同一入口再次点击即关闭。@param {object} state 页面。@param {string} kind 类型。@param {string} id 建议ID。@param {HTMLElement} trigger 入口。@returns {void}。@throws 无。 */
  function toggleDetail(state,kind,id,trigger){
    if(!state.result||!['finding','summary'].includes(kind))return;
    if(detailSelection?.trigger===trigger){closeDetail();return;}
    const result=state.result,task=kind==='finding'?result.tasks.find(item=>item.id===id):null;if(kind==='finding'&&!task)return;
    closeDetail(false);const popup=ensureDetail(),appearance=task?findingAppearance(task,state.module):{tone:'orange',icon:'ri-sparkling-line'};
    const title=task?task.title:'本期经营解读';
    const content=task?findingDetail(state,task):`<p class="advisor-full-summary">${esc(result.summary)}</p>`;
    popup.className=`advisor-popover advisor-tone-${appearance.tone}`;
    popup.innerHTML=`<div class="advisor-popover-head"><span class="advisor-finding-icon" aria-hidden="true"><i class="${appearance.icon}"></i></span><div class="advisor-popover-heading"><div class="advisor-popover-meta"><span>${task?'AI 建议':esc(MODULES[state.module])}</span>${task?`<span class="advisor-priority ${esc(task.priority)}">${esc(PRIORITIES[task.priority])}</span>`:''}</div><h2 id="advisor-popover-title">${esc(title)}</h2></div><button type="button" data-detail-close="true" aria-label="关闭建议详情"><i class="ri-close-line" aria-hidden="true"></i></button></div><div class="advisor-popover-body" tabindex="0" aria-label="建议详情内容">${content}</div>`;
    detailSelection={module:state.module,snapshotId:result.snapshot_id,trigger};trigger.setAttribute('aria-expanded','true');trigger.classList.add('is-selected');popup.hidden=false;popup.style.visibility='hidden';positionDetail();popup.focus({preventScroll:true});
  }
  /** 关闭气泡并按需把键盘焦点还给入口。@param {boolean} restoreFocus 是否恢复焦点。@returns {void}。@throws 无。 */
  function closeDetail(restoreFocus=true){const trigger=detailSelection?.trigger;detailSelection=null;if(detailFrame)cancelAnimationFrame(detailFrame);detailFrame=0;if(detailPopover)detailPopover.hidden=true;if(trigger){trigger.setAttribute('aria-expanded','false');trigger.classList.remove('is-selected');if(restoreFocus&&trigger.isConnected)trigger.focus({preventScroll:true});}}
  /** 合并滚动与缩放事件，下一帧只测量一次。@returns {void}。@throws 无。 */
  function queueDetailPosition(){if(!detailSelection||detailFrame)return;detailFrame=requestAnimationFrame(()=>{detailFrame=0;positionDetail();});}
  /** 按真实入口与可视视口定位；入口消失或离屏即关闭，避免悬空详情。@returns {void}。@throws 无。 */
  function positionDetail(){if(!detailSelection||!detailPopover)return;const {trigger,module,snapshotId}=detailSelection,rect=trigger.getBoundingClientRect(),visible=window.visualViewport;
    const viewport={width:visible?.width||window.innerWidth,height:visible?.height||window.innerHeight,left:visible?.offsetLeft||0,top:visible?.offsetTop||0};
    if(!trigger.isConnected||page(module)?.result?.snapshot_id!==snapshotId||!rect.width||rect.bottom<viewport.top||rect.top>viewport.top+viewport.height){closeDetail(false);return;}
    const size=detailPlacement(rect,viewport);detailPopover.style.width=size.width+'px';detailPopover.style.maxHeight=size.maxHeight+'px';
    const placement=detailPlacement(rect,viewport,detailPopover.getBoundingClientRect().height);detailPopover.dataset.placement=placement.side;detailPopover.style.left=placement.left+'px';detailPopover.style.top=placement.top+'px';detailPopover.style.setProperty('--advisor-arrow-y',placement.arrow+'px');detailPopover.style.visibility='visible';
  }
  /** 本地同源JSON请求；path为固定路由，body为请求对象；返回解析值，错误抛用户可读说明。 */
  async function request(path,body){const response=await fetch('/api/advisor/'+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||'AI服务暂时不可用。');return data;}
  /** 收集当前显示状态和已完成读取；state为页面状态；返回快照请求体，无新业务查询。 */
  function inputFor(state){const current=window.getAdvisorPageContext?.(state.module,state.selection)||{};return {module:state.module,period:current.period||{label:document.getElementById('timeScope')?.textContent||'独立周期'},cache_scope:current.cache_scope||{},records:[...(current.records||[]),...[...state.records.values()].reverse()].slice(0,30),object:current.object,limitations:current.limitations||[]};}
  /** 优先恢复固定范围的缓存；force用于显式更新时重新整理数据；过期响应丢弃，返回状态或null。 */
  async function refresh(module,force=false){const state=page(module);if(!state)return null;await restoreView(state);if(!force&&state.result&&state.cachedSnapshot)return state;if(!force&&!state.dirty&&state.snapshot)return state;const revision=state.version,dataRevision=state.revision,serial=(state.serial||0)+1;state.serial=serial;
    try{const result=await request('context',inputFor(state));if(state.version!==revision||state.revision!==dataRevision||state.serial!==serial)return null;state.snapshot=result.snapshot;state.result=result.result;state.cachedSnapshot=result.cached_snapshot;remember(state);state.dirty=false;state.error='';renderCard(state);if(active===module&&panel&&!panel.hidden)renderScope();return state;}
    catch(error){if(state.version===revision){state.error=error.message;renderCard(state);}return null;}}
  /** 用户显式生成或更新本页分析；state为页面状态；返回Promise，不自动重试付费调用。 */
  async function analyze(state){if(state.analyzing)return;const version=state.version,requestedKey=state.viewKey;state.analyzing=true;const fresh=await refresh(state.module,true);if(!fresh?.snapshot||state.version!==version||state.viewKey!==requestedKey){state.analyzing=false;renderCard(state);return;}const snapshotId=state.snapshot.snapshot_id,key=state.viewKey,input=inputFor(state);state.error='';renderCard(state);
    try{await request('analysis',{snapshot_id:snapshotId,refresh:Boolean(state.result)});const data=await request('cache',{module:state.module,period:input.period,cache_scope:input.cache_scope,object:input.object?{ref:input.object.ref,cache_ref:input.object.cache_ref}:undefined});savedViews.set(key,{result:data.result,cachedSnapshot:data.cached_snapshot});if(state.viewKey===key){state.result=data.result;state.cachedSnapshot=data.cached_snapshot;}}
    catch(error){if(state.snapshot?.snapshot_id===snapshotId)state.error=error.message;}
    finally{state.analyzing=false;renderCard(state);}}
  /** 创建一个共用的非模态问答面板，允许继续操作左侧页面；无参数；返回DOM。 */
  function ensurePanel(){if(panel)return panel;panel=document.createElement('aside');panel.className='advisor-chat';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-label','AI运营顾问');panel.innerHTML=`<div class="advisor-chat-head"><div><span class="advisor-eyebrow"><i class="ri-sparkling-line" aria-hidden="true"></i> 来搜 AI</span><h2>一起看懂，接着往下做</h2></div><button type="button" data-chat="close" aria-label="关闭AI顾问"><i class="ri-close-line" aria-hidden="true"></i></button></div><div class="advisor-chat-scope"></div><div class="advisor-chat-scroll"><div class="advisor-chat-intro"></div><ol class="advisor-messages" aria-label="对话记录"></ol><div class="advisor-chat-notice" role="status" aria-live="polite"></div></div><form class="advisor-chat-form"><label for="advisor-question">围绕当前页面提问</label><textarea id="advisor-question" rows="3" maxlength="2000" placeholder="例如：这个指标说明了什么？接下来怎么做？"></textarea><div><button type="button" data-chat="new">新对话</button><button type="submit" class="primary">发送 <i class="ri-arrow-up-line" aria-hidden="true"></i></button></div></form>`;document.body.append(panel);
    panel.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;const state=page(active);if(button.dataset.chat==='close')close();if(button.dataset.chat==='new'&&!state.busy){state.messages=[];state.session='';renderPanel();}if(button.dataset.chat==='clear-selection'){state.selection={};state.dirty=true;state.revision++;renderScope();}if(button.dataset.question)void ask(button.dataset.question);});
    panel.querySelector('form').addEventListener('submit',event=>{event.preventDefault();void ask(panel.querySelector('textarea').value);});panel.querySelector('textarea').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();void ask(event.currentTarget.value);}});document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.isComposing&&!panel.hidden){event.preventDefault();close();}});return panel;}
  /** 打开当前页顾问，可预填具体追问；question为可选文本；返回void，不自动发送。 */
  function open(question=''){if(!page(active))return;const opener=detailSelection?.trigger||document.activeElement;closeDetail(false);const selected=window.getSelection()?.toString().trim();if(selected){const state=page(active);state.selection={label:'选中的页面内容',text:selected.slice(0,800)};state.dirty=true;state.revision++;}returnFocus=opener;ensurePanel().hidden=false;renderPanel();const textarea=panel.querySelector('textarea');if(question)textarea.value=question;textarea.focus();void refresh(active);}
  /** 关闭面板并恢复键盘焦点；无参数；返回void，后台已发起回答继续接收。 */
  function close(){if(!panel)return;panel.hidden=true;if(returnFocus?.isConnected)returnFocus.focus();}
  /** 更新始终可见的分析范围；无参数；返回void。 */
  function renderScope(){const state=page(active);if(!state||!panel)return;panel.querySelector('.advisor-chat-scope').innerHTML=`<b>${esc(MODULES[active])}</b><span>${esc(periodLabel(state.snapshot?.period||window.getAdvisorPageContext?.(active)?.period))}</span>${state.selection?.label?`<div>${esc(state.selection.label)} <button type="button" data-chat="clear-selection">改问整页</button></div>`:''}`;}
  /** 模型文本转义后显示，隐藏内部引用标记，不生成原始数据入口；text为答复；返回安全HTML。 */
  function renderAnswer(text){return esc(text).replace(/\[证据[:：]\s*[a-zA-Z0-9_-]+\]/g,'').replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>');}
  /** 重绘当前页会话，历史消息保留各自的范围与证据；无参数；返回void。 */
  function renderPanel(){const state=page(active);if(!state||!panel)return;renderScope();panel.querySelector('.advisor-chat-intro').innerHTML=state.messages.length?'':`<p>可以问指标含义、判断依据，也可以一起梳理下一步。</p><div class="advisor-prompt-chips">${(state.result?.suggested_questions||QUESTIONS[active]).map(q=>`<button type="button" data-question="${esc(q)}">${esc(q)} <i class="ri-arrow-right-up-line" aria-hidden="true"></i></button>`).join('')}</div>`;
    panel.querySelector('.advisor-messages').innerHTML=state.messages.map(message=>`<li class="advisor-message ${message.role}"><span>${message.role==='user'?'你':'AI运营顾问'}</span><div>${message.role==='user'?esc(message.text):renderAnswer(message.text,message.facts)}</div>${message.error?`<p class="advisor-error">${esc(message.error)}</p>`:''}</li>`).join('');panel.querySelector('.advisor-chat-notice').textContent=state.busy?'正在结合当前页面回答…':!config.chatConfigured?'页面问答暂未启用，配置完成后即可对话。':'';panel.querySelector('button[type=submit]').disabled=state.busy||!config.chatConfigured;panel.querySelector('[data-chat=new]').disabled=state.busy;}
  /** 发出一条显式问题并接收规范化SSE；question为自然语言；返回Promise，失败保留已收到内容供核对。 */
  async function ask(question){const state=page(active);if(!state||state.busy||!question.trim()||!config.chatConfigured)return;state.busy=true;renderPanel();const fresh=await refresh(state.module),snapshot=fresh?.cachedSnapshot||fresh?.snapshot;if(!snapshot){state.busy=false;renderPanel();return;}state.messages.push({role:'user',text:question.trim()});const answer={role:'assistant',text:'',snapshot_id:snapshot.snapshot_id};state.messages.push(answer);panel.querySelector('textarea').value='';renderPanel();
    try{const response=await fetch('/api/advisor/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({snapshot_id:snapshot.snapshot_id,question:question.trim(),selection:state.selection,session_id:state.session})});if(!response.ok){const data=await response.json();throw new Error(data.error||'问答暂时不可用。');}const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',doneEvent=false;
      while(true){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let end;while((end=buffer.indexOf('\n\n'))>=0){const raw=buffer.slice(0,end);buffer=buffer.slice(end+2);const line=raw.split('\n').find(x=>x.startsWith('data: '));if(!line)continue;const event=JSON.parse(line.slice(6));if(event.type==='meta')state.session=event.session_id;if(event.type==='answer')answer.text=event.text;if(event.type==='error')throw new Error(event.message);if(event.type==='done')doneEvent=true;if(active===state.module){renderPanel();const scroll=panel.querySelector('.advisor-chat-scroll');scroll.scrollTop=scroll.scrollHeight;}}}if(!doneEvent)throw new Error('连接已中断，已收到的答复可能不完整。');
    }catch(error){answer.error=error.message;}
    finally{state.busy=false;if(active===state.module)renderPanel();}}
  /** 只执行后端绑定的本地导航/查看动作；state与id为分析与动作引用；返回void，不执行写操作。 */
  function runAction(state,id){const action=state.result?.actions.find(x=>x.id===id);if(!action)return;closeDetail(false);if(action.type==='open_product'){
    const original=state.cachedSnapshot?.entities?.find(entity=>entity.ref===action.entity_ref),current=inputFor(state).object;
    // 仅同一账号内稳定商品标识匹配时，使用页面最新的限时编辑引用；不改历史证据。
    const ref=original?.cache_ref&&original.cache_ref===current?.cache_ref?current.ref:action.entity_ref;
    const button=[...document.querySelectorAll('[data-ops-product-ref]')].find(el=>el.dataset.opsProductRef===ref);if(button){button.click();return;}
  }window.switchTab?.(action.target_tab);document.getElementById('advisor-'+action.target_tab)?.nextElementSibling?.scrollIntoView({behavior:'smooth',block:'start'});}
  /** 同步用户选中的商品、渠道、关键词或文字；event为页面点击；返回void，不推断未选对象。 */
  function selectContext(event){const state=page(active);if(!state||event.target.closest('.advisor-chat,.advisor-card-content,.advisor-popover'))return;const product=event.target.closest('[data-ops-product-ref]');if(product){state.selection={entity_ref:product.dataset.opsProductRef,label:product.dataset.opsProductTitle||'当前商品'};state.dirty=true;state.revision++;}else{const item=event.target.closest('[data-product-focus],[data-flow-channel],[data-channel],[data-word],[data-scene-word],.kpi[data-k],[data-keyword],.keyword-compare-row,.ops-conversation-item');if(item){state.selection={label:item.textContent.trim().slice(0,180),text:item.textContent.trim().slice(0,800)};state.dirty=true;state.revision++;}}if(panel&&!panel.hidden)renderScope();}
  /** 初始化配置与共用交互；无参数；返回Promise，配置失败显示服务状态而不影响原页面。 */
  async function init(){document.addEventListener('click',selectContext);try{config=await request('config');}catch{}configReady=true;for(const state of pages.values())renderCard(state);}
  window.LsouAdvisor={enabled:true,beginRead,finishRead,navigate,refresh,open};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else void init();
})();
