/* 关键词页广告经营区。只读取服务端业务接口；不持有账户凭据，不提交投放操作。 */
(() => {
  'use strict';
  /** 切换页面业务视图，保留各区已加载数据与输入；view为keywords或advertising；返回void；无主动异常。 */
  function selectAdsView(view) {
    if(!['keywords','advertising'].includes(view))return;
    $('#adsKeywordView').hidden=view!=='keywords';
    $('#adsAdvertisingView').hidden=view!=='advertising';
    $$('[data-ads-view]').forEach(button=>{const active=button.dataset.adsView===view;button.classList.toggle('is-active',active);button.setAttribute('aria-pressed',String(active));});
  }
  $$('[data-ads-view]').forEach(button=>{button.onclick=()=>selectAdsView(button.dataset.adsView);});
  const state = { generation:0, range:null, reports:{}, plans:{}, kind:'search',page:1, search:'',sort:'date',metric:'spend',finance:null,industry:null,diagnosis:null,recommendation:null,historyPage:1,historyGeneration:0 };
  const labels = {search:'直通车',whole_site:'全站推',ordinary:'普通计划',groups:'省心版计划组',recommend:'推荐推广',all_domain:'全站推'};
  const fields = [['spend','花费'],['impressions','曝光'],['clicks','点击'],['opportunities','商机'],['inquiries','询盘'],['orders','订单']];
  /** 真实数值格式化，缺失显示横线。@param {*} value 值。@param {boolean} money 金额。@returns {string} 安全文字。@throws 无。 */
  function value(value, money = false) { return value == null || value === '' || !Number.isFinite(Number(value)) ? '—' : (money?'¥':'')+Number(value).toLocaleString('zh-CN',{maximumFractionDigits:2,minimumFractionDigits:money?2:0}); }
  /** 构造可读空/错误状态。@param {object} data 状态。@param {string} empty 空文案。@returns {string} HTML。@throws 无。 */
  function status(data, empty='平台暂未返回记录') { return `<div class="ad-empty${data?.error?' is-error':''}"><i class="${data?.error?'ri-cloud-off-line':'ri-bar-chart-box-line'}" aria-hidden="true"></i><b>${data?.error?'读取未完成':data?'暂无记录':'正在读取'}</b><span>${esc(data?.error || (data?empty:'正在读取当前账号数据…'))}</span></div>`; }
  /** 请求固定只读路由，把网络错误保留为错误状态。@param {string} name 路由。@param {object} params 参数。@returns {Promise<object>} 数据或error。@throws 不向外抛错。 */
  async function request(name, params={}) {
    const advisorRead=window.LsouAdvisor?.beginRead('/api/advertising/'+name,params);
    try { const r=await fetch('/api/advertising/'+name+'?'+new URLSearchParams(params));const j=await r.json();window.LsouAdvisor?.finishRead(advisorRead,j,!r.ok||!j.ok);if(!r.ok||!j.ok)throw new Error(j.error||'读取失败');return j.data; }
    catch(e) {window.LsouAdvisor?.finishRead(advisorRead,null,true);return {error:e.message}; }
  }
  /** 显示受限日期的双产品线数据，各来源独立完成；旧周期响应不得覆盖新选择。@param {boolean} force 是否更新。@returns {Promise<void>}。@throws 无。 */
  async function load(force=false) {
    const generation=++state.generation;
    state.range=dates('ads');state.reports={};state.diagnosis=null;
    $('#adReportRange').textContent=`${state.range.startDate} — ${state.range.endDate} · 直通车与全站推独立统计`;
    $('#adRefresh').disabled=true;renderReports();renderDiagnosis();
    const fresh=force?{refresh:'1'}:{};
    const tasks=['search','whole_site'].map(async scope=> {const d=await request('report',{scope,...state.range,...fresh});if(generation===state.generation){state.reports[scope]=d;renderReports();}});
    tasks.push(loadPlans(force));
    for(const name of ['finance','industry'])tasks.push(request(name,fresh).then(d=>{if(generation===state.generation){state[name]=d;name==='finance'?renderFinance():renderIndustry();}}));
    // 平台诊断和方案一天内复用；普通刷新不强制重新生成，用户可单独手动更新。
    tasks.push(request('diagnosis',{endDate:state.range.endDate}).then(d=>{if(generation===state.generation){state.diagnosis=d;renderDiagnosis();}}));
    tasks.push(request('recommendation').then(d=>{if(generation===state.generation){state.recommendation=d;renderRecommendations();}}));
    renderFinance();renderIndustry();renderRecommendations();
    await Promise.allSettled(tasks);
    if(generation===state.generation)$('#adRefresh').disabled=false;
  }
  /** 双栏指标与同单位条形图；缺失数据不画成0高度柱。@returns {void}。@throws DOM缺失。 */
  function renderReports() {
    $('#adReportPanels').innerHTML=['search','whole_site'].map(scope=>{
      const d=state.reports[scope];
      return `<article class="ad-effect-panel ${scope}"><header><h3><i class="${scope==='search'?'ri-cursor-line':'ri-global-line'}"></i>${labels[scope]}</h3><span class="ad-state">${d?.error?'读取失败':d?.state==='empty'?'未返回记录':d?'已读取':'读取中'}</span></header><div class="ad-effect-metrics">${fields.map(([key,label])=>`<div><span>${label}</span><b>${value(d?.total?.[key],key==='spend')}</b></div>`).join('')}</div><p>${esc(d?.error|| (d?.state==='empty'?'接口已返回，但本周期没有效果记录；花费不能按 0 处理。':d?'花费与效果来自所选周期广告报表':'正在读取广告报表…'))}</p>${d?.state==='ready'?`<button class="ad-link" data-report-detail="${scope}">查看效果明细 <i class="ri-arrow-right-s-line"></i></button>`:''}</article>`;
    }).join('');
    const key=state.metric,label=fields.find(x=>x[0]===key)[1];
    const entries=['search','whole_site'].map(s=>({label:labels[s],v:state.reports[s]?.total?.[key],scope:s}));
    const max=Math.max(1,...entries.map(x=>x.v||0));
    $('#adReportChart').innerHTML=entries.some(x=>x.v!=null)?`<h3>${label}对比</h3>${entries.map(x=>`<div class="ad-hbar"><span>${x.label}</span><div><i class="${x.scope}" style="width:${x.v==null?0:100*x.v/max}%"></i></div><b>${value(x.v,key==='spend')}</b></div>`).join('')}`:'<div class="ad-chart-placeholder"><i class="ri-bar-chart-horizontal-line"></i><span>有真实效果数据后显示对比图；当前不绘制零值图表</span></div>';
    $$('[data-report-detail]').forEach(b=>b.onclick=()=>{
      const d=state.reports[b.dataset.reportDetail];openDialog(labels[b.dataset.reportDetail]+' · 效果明细',`<p class="ad-caption">${d.startDate} — ${d.endDate}</p><div class="ad-table-wrap"><table><thead><tr><th>日期</th>${fields.map(f=>`<th>${f[1]}</th>`).join('')}</tr></thead><tbody>${d.rows.map(row=>`<tr><td>${esc(row.date)}</td>${fields.map(([k])=>`<td>${value(row[k],k==='spend')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
    });
  }
  /** 获取当前计划分页，使用请求标识避免切页串数据。@param {boolean} force 更新。@returns {Promise<void>}。@throws 无。 */
  async function loadPlans(force=false) {
    const kind=state.kind,page=state.page,key=`${kind}:${page}`;
    renderPlans();
    const d=await request('plans',{kind,page,...(force?{refresh:'1'}:{})});state.plans[key]=d;
    if(kind===state.kind&&page===state.page)renderPlans();
  }
  /** 只按已核验端点的状态枚举翻译；普通计划原接口枚举不同，不混用。@param {object} r 计划。@param {string} kind 类型。@returns {string} 状态。@throws 无。 */
  function planStatus(r,kind=state.kind) {
    if(kind==='groups')return r.effectiveStatusLabel||r.statusLabel||'未返回状态';
    const code=kind==='ordinary'?r.verifiedOnlineStatus:r.onlineStatus;
    return ({'1':'投放中','0':'预算耗尽或账户冻结','-1':'待投放','-2':'已暂停','-3':'已结束'})[String(code)]||'未提供状态说明';
  }
  /** 计划状态分布、可排序明细与分页；预算始终标明为设置值。@returns {void}。@throws DOM缺失。 */
  function renderPlans() {
    const d=state.plans[`${state.kind}:${state.page}`],groups=state.kind==='groups';
    const rows=(d?.rows||[]).filter(r=>String(r.campaignName||r.campaignGroupName||'').toLowerCase().includes(state.search.toLowerCase()));
    rows.sort((a,b)=> state.sort==='budget'?Number(b.budget||0)-Number(a.budget||0):state.sort==='products'?Number(b.onlineProductCount||0)-Number(a.onlineProductCount||0):new Date(b.gmtCreate||0)-new Date(a.gmtCreate||0));
    $('#adPlanCount').textContent=d&&!d.error?`共 ${d.total??'—'} 项 · 当前第 ${state.page} 页`:'';
    $$('#adPlanTypes button').forEach(b=>{b.classList.toggle('on',b.dataset.kind===state.kind);b.setAttribute('aria-pressed',String(b.dataset.kind===state.kind));});
    const count={};(d?.rows||[]).forEach(r=>{const k=planStatus(r);count[k]=(count[k]||0)+1;});
    $('#adPlanSummary').innerHTML=d&&!d.error?`<span>本页状态</span><div class="ad-state-strip">${Object.entries(count).map(([k,n],i)=>`<i title="${esc(k)} ${n} 项" style="flex:${n};background:${['#ec965e','#aab1bf','#7b8c9c','#c6cbd3'][i%4]}"></i>`).join('')}</div>${Object.entries(count).map(([k,n])=>`<span>${esc(k)} <b>${n}</b></span>`).join('')}`:'';
    $('#adPlanTable').innerHTML=!d||d.error?status(d):!rows.length?status(d,state.search?'本页没有匹配的计划':'当前类型没有计划'):`<table><thead><tr><th>计划名称</th><th>类型</th><th>状态</th><th>${groups?'方案':'预算设置'}</th><th>${groups?'创建日期':'推广商品'}</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr><td><button class="ad-plan-name" data-plan="${esc(r.campaignId||r.campaignGroupId)}">${esc(r.campaignName||r.campaignGroupName)}</button></td><td>${esc(r.campaignTypeDesc|| (groups?'省心版':`类型 ${r.campaignType??'—'}`))}</td><td><span class="ad-status-pill">${esc(planStatus(r))}</span></td><td>${groups?esc(r.marketingPackageTypeLabel||'—'):value(r.budget,true)}</td><td>${groups?esc(new Date(r.gmtCreate).toLocaleDateString('zh-CN')):value(r.onlineProductCount)}</td><td><button class="ad-link" data-plan="${esc(r.campaignId||r.campaignGroupId)}">详情</button></td></tr>`).join('')}</tbody></table>`;
    const pages=Math.max(1,Math.ceil((d?.total||0)/50));
    $('#adPlanPagination').innerHTML=`<span>计划与计划组是不同视角，数量不相加；预算设置不是实际花费。</span><button id="adPlanPrev" ${state.page<=1?'disabled':''}>上一页</button><span>${state.page} / ${pages}</span><button id="adPlanNext" ${state.page>=pages?'disabled':''}>下一页</button>`;
    $('#adPlanPrev').onclick=()=>{state.page--;loadPlans();};$('#adPlanNext').onclick=()=>{state.page++;loadPlans();};
    $$('[data-plan]').forEach(b=>b.onclick=()=>{
      const r=d.rows.find(r=>String(r.campaignId||r.campaignGroupId)===b.dataset.plan);
      openDialog(r.campaignName||r.campaignGroupName,`<div class="ad-detail-grid">${[['计划状态',planStatus(r)],['计划类型',r.campaignTypeDesc||r.campaignGroupType||r.campaignType],['预算设置',value(r.budget,true)],['推广商品数',value(r.onlineProductCount)],['创建时间',typeof r.gmtCreate==='number'?new Date(r.gmtCreate).toLocaleString('zh-CN'):r.gmtCreate],['最近更新',typeof r.gmtModified==='number'?new Date(r.gmtModified).toLocaleString('zh-CN'):r.gmtModify],['推广目标',r.optimizerTargetLabel||({max_feedback:'获取更多商机',whole_site_fb:'全站商机',click:'点击',feedback:'商机'})[r.optimizeTarget]||'未提供目标说明'],['方案',r.marketingPackageTypeLabel||({whole_store:'整店推广',whole_store_product:'全店商品推广',whole_store_hot_product:'优品助推',ai_whole_site:'AI智投',NEW_PROD:'新品成长'})[r.subType]||'未提供方案说明']].map(([k,v])=>`<div><span>${k}</span><b>${esc(v??'未返回')}</b></div>`).join('')}</div><p class="ad-footnote">当前计划资料；实际曝光、点击和花费以效果报表为准。</p>`);
    });
  }
  /** 展示账户余额来源状态，不把EMPTY/FAILED/null合计成0。@returns {void}。@throws DOM缺失。 */
  function renderFinance() {
    const d=state.finance;
    $('#adFinanceContent').innerHTML=!d||d.error?status(d):`<div class="ad-finance-list">${['search','recommend','all_domain'].map(kind=>{
      const r=d.rows?.find(x=>x.accountType===kind),s=d.metadata?.sourceStatuses?.[kind+'.balance'],b=s==='SUCCESS'?r?.balance:null;
      const cash=Number(b?.cashBalance||0),gift=Number(b?.giftBalance||0),total=cash+gift;
      return `<article><header><span>${labels[kind]}</span><strong>${value(b?.totalBalance,true)}</strong></header>${b?`<div class="ad-funds-track"><i style="width:${total?cash/total*100:0}%"></i></div><div class="ad-fund-facts"><span>现金 <b>${value(b.cashBalance,true)}</b></span><span>红包 <b>${value(b.giftBalance,true)}</b></span><span>今日花费 <b>${value(b.realDayCost,true)}</b></span></div>`:`<p class="ad-caption">${s==='EMPTY'?'该账户余额未返回':s==='FAILED'?'该账户读取失败':'该账户数据未完整返回'}</p>`}</article>`;
    }).join('')}</div>`;
  }
  /** 平台诊断以7天窗口独立展示，不把诊断摘要补为报表值。@returns {void}。@throws DOM缺失。 */
  function renderDiagnosis() {
    const d=state.diagnosis;
    $('#adDiagnosisContent').innerHTML=!d?'<div class="ad-empty"><i class="ri-pulse-line"></i><b>查看近 7 天投放诊断</b><span>以所选结束日为准；主动读取后复用结果，避免反复调用。</span></div>':d.error?status(d):`<p class="ad-caption">${esc(d.startDate)} — ${esc(d.endDate)} · 平台诊断</p>${(d.rows||[]).map(r=>{const x=r.result||r;return `<p class="ad-diagnosis-summary">${esc(x.overviewSummary||'未返回诊断摘要')}</p><ul class="ad-diagnosis-list">${(x.diagnosisConclusions||[]).map(t=>`<li>${esc(t)}</li>`).join('')}</ul><div class="ad-diagnosis-bottom">问题计划 <b>${x.problemCampaigns?.length??'—'}</b><span>${x.problemCampaigns?.length?'平台返回了需查看的计划':'未定位具体问题计划'}</span></div>${x.problemCampaigns?.length?`<ul>${x.problemCampaigns.map(p=>`<li>${esc(p.campaignName||p.name||'计划')}：${esc(p.reason||p.diagnosis||'请查看平台诊断')}</li>`).join('')}</ul>`:''}`;}).join('')}`;
  }
  /** 行业百分比用横条表达，所有比率独立显示且不求和。@returns {void}。@throws DOM缺失。 */
  function renderIndustry() {
    const d=state.industry,r=d?.rows?.[0];$('#adIndustryCategory').textContent=d?.category||'';
    $('#adIndustryContent').innerHTML=!r?status(d):`<div class="ad-industry-summary"><strong>${value(r.validCustomerCount)}</strong><span>行业样本商家</span><div><b>${esc(r.budgetUpRange||'—')}</b><span>平台预算提升区间</span></div></div>${[['addProductPct','增加商品'],['newPlanPct','新增计划'],['budgetUpPct','提高预算'],['bidUpPct','提高出价'],['geoPct','拓展地域'],['premiumPct','启用溢价']].map(([k,label])=>`<div class="ad-hbar"><span>${label}</span><div><i style="width:${Math.min(100,Math.max(0,Number(r[k]||0)*100))}%"></i></div><b>${r[k]==null?'—':value(Number(r[k])*100)+'%'}</b></div>`).join('')}<div class="ad-industry-footer"><span>流量增幅 <b>${r.flowUp==null?'—':value(r.flowUp*100)+'%'}</b></span><span>商机增幅 <b>${r.leadUp==null?'—':value(r.leadUp*100)+'%'}</b></span></div>`;
  }
  /** 推荐方案显示适用商品数和建议值；不生成创建按钮。@returns {void}。@throws DOM缺失。 */
  function renderRecommendations() {
    const d=state.recommendation;
    const names={whole_store_hot_product:'优品助推',whole_store_product:'全店商品推广',trading_product:'成交商品推广',whole_store_new_product:'新品推广'};
    const reasons={CUSTOMER_NO_RECENT_ADVERTISING_SPEND:'近期广告消耗条件未满足',NEW_PRODUCT_COUNT_BELOW_20:'符合条件的新品少于20件',HOT_PRODUCT_OPPORTUNITY:'店铺存在优品推广机会',POTENTIAL_PRODUCT_THRESHOLD_MET:'潜力商品条件满足'};
    $('#adRecommendationContent').innerHTML=!d?'<div class="ad-empty"><i class="ri-lightbulb-line"></i><b>查看平台推荐</b><span>按当前店铺商品与广告条件读取方案，预算仅供参考。</span></div>':d.error?status(d):!d.rows?.length?status(d):d.rows.map(r=>`<article class="ad-recommendation ${r.decision==='RECOMMEND'?'recommended':''}"><header><h3>${esc(names[r.type]||r.type||'推广方案')}</h3><span class="ad-state">${r.decision==='RECOMMEND'?'平台推荐':'暂不推荐'}</span></header><div><span>适用商品 <b>${value(r.eligibleProductCount)}</b></span><span>建议${r.budgetScope==='DAILY'?'日':''}预算 <b>${r.decision==='RECOMMEND'?value(r.budget,true):'—'}</b></span><span>目标成本 <b>${r.decision==='RECOMMEND'?value(r.targetCost,true):'—'}</b></span></div><p>${esc((r.reasons||[]).map(x=>reasons[x]||x).join(' · '))}</p></article>`).join('');
  }
  /** 打开原生弹窗，支持Esc、背景关闭并恢复焦点。@param {string} title 标题。@param {string} html 已转义HTML。@returns {void}。@throws DOM缺失。 */
  function openDialog(title,html) {$('#adDialogTitle').textContent=title;$('#adDialogBody').innerHTML=html;const d=$('#adDetailDialog');if(!d.open)d.showModal();}
  /** 资金流水只在用户打开时读取；账户、类型与日期均显式传递。@returns {void}。@throws 无。 */
  function openHistory() {
    state.historyPage=1;
    openDialog('广告资金流水',`<div class="ad-history-controls"><label>账户<select id="adHistoryAccount"><option value="search">直通车</option><option value="recommend">推荐推广</option><option value="all_domain">全站推</option></select></label><label>明细类型<select id="adHistoryType"><option value="cash_gift">现金与红包</option><option value="coupon">卡券</option><option value="compensation">赔付</option></select></label><button id="adHistoryQuery">查询</button></div><p class="ad-caption">${state.range.startDate} — ${state.range.endDate} · 使用顶部所选日期</p><div id="adHistoryResult"></div>`);
    $('#adHistoryQuery').onclick=()=>{state.historyPage=1;loadHistory();};loadHistory();
  }
  /** 展示分类流水自己的总数/分页与独立失败，不拿账户分组总数当流水条数。@returns {Promise<void>}。@throws 无。 */
  async function loadHistory() {
    const g=++state.historyGeneration,account=$('#adHistoryAccount').value,type=$('#adHistoryType').value;
    $('#adHistoryResult').innerHTML=status(null);
    const d=await request('history',{account,type,...state.range,page:state.historyPage});
    if(g!==state.historyGeneration||!$('#adHistoryResult'))return;
    const source=d.metadata?.sourceStatuses?.[account+'.'+type],pack=d.rows?.find(r=>r.accountType===account)?.[type];
    if(d.error||source==='FAILED'||!pack){$('#adHistoryResult').innerHTML=status({error:d.error||'此类资金明细未完整返回'});return;}
    const names={gmtCreate:'发生时间',createTime:'发生时间',date:'日期',amount:'金额',balance:'余额',income:'收入',expense:'支出',type:'类型',status:'状态',description:'说明',remark:'备注',name:'名称',couponName:'卡券名称',expireTime:'到期时间',cost:'消耗',tradeType:'交易类型'};
    const rows=pack.data||[],keys=Object.keys(rows[0]||{}).filter(k=>names[k]);
    $('#adHistoryResult').innerHTML=(rows.length&&keys.length?`<div class="ad-table-wrap"><table><thead><tr>${keys.map(k=>`<th>${names[k]}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${keys.map(k=>`<td>${esc(r[k]??'—')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:status(d,rows.length?'平台返回了新格式明细，暂不能展示；未计为0条':'该周期没有此类资金流水'))+`<div class="ad-pagination"><span>共 ${value(pack.total)} 条 · 第 ${state.historyPage} 页</span><button id="adHistoryPrev" ${state.historyPage<=1?'disabled':''}>上一页</button><button id="adHistoryNext" ${pack.hasMore?'':'disabled'}>下一页</button></div>`;
    $('#adHistoryPrev').onclick=()=>{state.historyPage--;loadHistory();};$('#adHistoryNext').onclick=()=>{state.historyPage++;loadHistory();};
  }
  // 页面事件只作用于广告分区，旧关键词对照及其数据来源保持独立。
  const oldLoader=LOADERS.ads;LOADERS.ads=()=>{oldLoader();return load();};
  $('#adRefresh').onclick=()=>load(true);$('#adChartMetric').onchange=e=>{state.metric=e.target.value;renderReports();};
  $$('#adPlanTypes button').forEach(b=>b.onclick=()=>{state.kind=b.dataset.kind;state.page=1;state.search='';$('#adPlanSearch').value='';loadPlans();});
  $('#adPlanSearch').oninput=e=>{state.search=e.target.value;renderPlans();};$('#adPlanSort').onchange=e=>{state.sort=e.target.value;renderPlans();};
  $('#adHistoryOpen').onclick=openHistory;$('#adDialogClose').onclick=()=>$('#adDetailDialog').close();
  $('#adDetailDialog').onclick=e=>{if(e.target===$('#adDetailDialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}};
  $('#adDiagnosisRefresh').textContent='更新诊断';$('#adRecommendRefresh').textContent='更新方案';
  $('#adDiagnosisRefresh').onclick=async e=>{const generation=state.generation;e.target.disabled=true;$('#adDiagnosisContent').innerHTML=status(null);const d=await request('diagnosis',{endDate:state.range.endDate,refresh:'1'});if(generation===state.generation){state.diagnosis=d;renderDiagnosis();}e.target.disabled=false;};
  $('#adRecommendRefresh').onclick=async e=>{e.target.disabled=true;$('#adRecommendationContent').innerHTML=status(null);state.recommendation=await request('recommendation',{refresh:'1'});renderRecommendations();e.target.disabled=false;};

  let overviewGeneration=0,overviewSpend=null;
  const originalRenderKpis=renderKpis;
  /** 给经营总览补上相同来源的花费状态；只有两个报表都有金额时才加总。@returns {void}。@throws DOM缺失。 */
  renderKpis=function() {
    originalRenderKpis();const card=$('#kpis [data-k="adSpend"]');if(!card)return;
    const rows=overviewSpend;const ready=rows?.every(x=>!x.error&&x.total?.spend!=null);
    const failed=rows?.some(x=>x.error);
    card.querySelector('.v').textContent=ready?value(rows.reduce((sum,x)=>sum+x.total.spend,0),true):rows?(failed?'读取失败':'暂无记录'):'读取中';
    card.querySelector('.c').textContent=ready?'直通车 + 全站推':rows?(failed?'广告报表暂不可用':'该周期未返回完整花费'):'正在查询广告报表';
    card.querySelector('.kpi-scope').textContent='所选周期 · 点击查看广告数据';
    card.setAttribute('role','button');card.tabIndex=0;
    const open=()=>{timeStates.ads={...timeStates.overview};delete LOADED.ads;switchTab('ads');selectAdsView('advertising');$('#adEffects').scrollIntoView({behavior:'smooth',block:'start'});};
    card.onclick=open;card.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}};
  };
  let contextVersion=0;
  /** 读取广告辅助资料，固定动作由后端校验；payload为业务参数；返回对象；失败抛错。 */
  async function contextRequest(payload,force=false) {
    const advisorRead=window.LsouAdvisor?.beginRead('/api/capabilities/ads',payload);
    const r=await fetch('/api/capabilities/ads',{method:'POST',headers:{'Content-Type':'application/json',...(force?{'X-Refresh-Data':'1'}:{})},body:JSON.stringify(payload)});
    const data=await r.json();window.LsouAdvisor?.finishRead(advisorRead,data,!r.ok||!data.ok);if(!r.ok||!data.ok)throw new Error(data.error||'资料读取失败');return data.data;
  }
  /** 三项资料独立加载，失败不抹去其他查询；无参数；返回Promise；错误在对应区显示。 */
  async function loadContext(force=false) {
    const version=++contextVersion;$('#adContextRefresh').disabled=true;
    const targets={main:'#adMainCategory',behaviors:'#adBehaviorStatus',categories:'#adCategoryPaths'};
    Object.values(targets).forEach(id=>{$(id).innerHTML=status(null);});
    await Promise.allSettled(Object.entries(targets).map(async([action,id])=>{
      try{const d=await contextRequest({action},force);if(version!==contextVersion)return;
        if(action==='main')$(id).innerHTML=`<span class="hint">主营二级类目</span><h3>${esc(d.name||'平台已返回类目，但名称暂未匹配')}</h3>`;
        else if(action==='behaviors')$(id).innerHTML=`<span class="hint">站内行为序列</span><p>${d.state==='empty'?'暂无行为记录':'行为记录暂不可展示'}</p>`;
        else {const groups=new Map();d.items.forEach(r=>{const key=[r.level1,r.level2].filter(Boolean).join(' / ');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r.level3);});$(id).innerHTML=[...groups].map(([label,children])=>`<div class="ad-category-path"><b>${esc(label)}</b><p>${children.map(x=>`<span>${esc(x||'名称未返回')}</span>`).join('')}</p></div>`).join('')||status({},'未返回类目路径');}
      }catch(e){if(version===contextVersion)$(id).innerHTML=status({error:e.message});}
    }));if(version===contextVersion)$('#adContextRefresh').disabled=false;
  }
  $('#adContextRefresh').onclick=()=>{void loadContext(true);};
  const contextLoader=LOADERS.ads;
  LOADERS.ads=()=>{void loadContext();return contextLoader?.();};
  const originalOverview=LOADERS.overview;
  LOADERS.overview=()=>{
    const g=++overviewGeneration,range=dates('overview');overviewSpend=null;
    const loading=originalOverview();
    Promise.all(['search','whole_site'].map(scope=>request('report',{scope,...range}))).then(rows=>{if(g===overviewGeneration){overviewSpend=rows;if(summaryRows.length)renderKpis();}});
    return loading;
  };
})();
