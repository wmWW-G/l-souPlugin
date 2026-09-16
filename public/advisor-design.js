/* 八页运营工作区共用真实 平台服务 读取与日期控制；产品发布沿用原入口。 */
(() => {
  'use strict';
  const names={overview:'数据看板',plan:'运营规划',position:'营销定位',foundation:'运营基建',ads:'运营推广',cultivation:'优爆品提升',product:'数据分析与优化',visitor:'商机转化'};
  const descriptions={overview:'看清数据表现，发现问题，制定策略，推动业务增长。',plan:'基于店铺阶段，制定清晰的运营路径与执行计划，分解目标、落实动作，助力业务持续增长。',position:'确定卖给谁、凭什么被选择。',foundation:'打好运营基础，从选品到发品的全流程支持，提升商品发布效率与质量。',ads:'基于数据诊断广告效果，制定优化策略，提升广告询盘与投放效率。',cultivation:'围绕核心商品进行持续跟进与资源投入，提升商品竞争力与转化效率。',product:'基于数据发现问题，定位原因，提供优化建议并跟踪执行效果。',visitor:'沉淀询盘资源，规范跟进流程，推动商机转化为实际订单。'};
  let active='overview', bypass=false;
  const policy=window.TimePolicy;
  let selectedRange={mode:'month',...policy.period('month',policy.addMonths(policy.today().slice(0,7)+'-01',-1).slice(0,7))};
  const reads=new Map();
  /** 将读取状态同步到唯一的顶部刷新按钮；无参数/返回值，不触碰表单内容。 */
  function refreshState(){const b=document.querySelector('#avMast [data-av-action="refresh"]');if(b){b.disabled=reads.size>0;b.innerHTML=reads.size?'正在刷新…':icon('refresh-line')+' 刷新';}}
  /** 读取同源只读接口并合并并发请求。path为API路径；返回响应JSON；网络/业务失败抛Error。 */
  async function read(path){
    if(!/^\/api\/(q\/|dashboard\/|advertising\/|workspaces\/|overview-tasks(?:$|\?)|health(?:$|\?))/.test(path))throw new Error('不是允许的数据读取接口');
    if(reads.has(path))return reads.get(path);
    const pending=(async()=>{
      const response=await fetch(path,{signal:AbortSignal.timeout(120000)});
      const result=await response.json();
      if(!response.ok||result.ok===false)throw new Error(String(result.error?.message||result.error||'数据读取失败，请重试').replace(/workctl/gi,'数据服务'));
      return result;
    })();
    reads.set(path,pending);refreshState();
    try{return await pending;}finally{reads.delete(path);refreshState();}
  }
  /** 只返回有效数值，缺失显示破折号。value为原始数值；返回展示文字，无主动异常。 */
  function format(value){return value==null||value===''||!Number.isFinite(Number(value))?'—':Number(value).toLocaleString('zh-CN',{maximumFractionDigits:2});}
  window.AdvisorLive={fetch:read,range:()=>({...selectedRange}),format};
  /** 改变完整报告周期并重新读取当前页。mode为day/week/month；无返回，日期非法抛Error。 */
  function changePeriod(mode){
    const yesterday=policy.shift(policy.today(),-1);
    const value=mode==='month'?policy.addMonths(policy.today().slice(0,7)+'-01',-1).slice(0,7):mode==='week'?policy.weekValue(policy.shift(policy.period('week',policy.weekValue(yesterday),'9999-12-31').startDate,-7)):policy.shift(policy.today(),-2);
    selectedRange={mode,...policy.period(mode,value)};navigate(active);
  }
  /** 打开日期区间表单，提交前校验日期；返回void，无主动异常。 */
  function periodDialog(){
    document.getElementById('avDialog')?.remove();const el=document.createElement('dialog');el.id='avDialog';el.className='av-dialog';
    el.innerHTML=`<form id="avDateForm"><h2>统计周期</h2><p>按当前账号读取；商品等独立口径会在卡片中注明。自定义最多31天。</p><label>开始日期<input name="from" type="date" required value="${selectedRange.startDate}"></label><label>结束日期<input name="to" type="date" required value="${selectedRange.endDate}" max="${policy.shift(policy.today(),-1)}"></label><p role="alert" id="avDateError"></p><button class="av-btn" type="submit">读取数据</button><button class="av-btn secondary" type="button" id="avDateCancel">取消</button></form>`;
    document.body.append(el);el.querySelector('#avDateCancel').onclick=()=>el.close();
    el.querySelector('form').onsubmit=event=>{event.preventDefault();try{const data=new FormData(event.currentTarget);const value=policy.range(data.get('from'),data.get('to'),{latest:policy.shift(policy.today(),-1),days:31});if(value.startDate<policy.shift(policy.today(),-89))throw new Error('请选择最近90天内的日期');selectedRange={mode:'range',...value};el.close();navigate(active);}catch(error){el.querySelector('#avDateError').textContent=error.message;}};el.showModal();
  }

  /** 转义外部文字。参数为任意值，返回安全字符串，无主动异常。 */
  function esc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  /** 返回库图标，名称为Remix Icon短名，返回可信HTML。 */
  function icon(name){return `<i class="ri-${esc(name)}" aria-hidden="true"></i>`;}
  /** 返回操作按钮；action为内部动作名，cls为附加样式。 */
  function button(text,action,cls=''){return `<button class="av-btn ${esc(cls)}" data-av-action="${esc(action)}">${text}</button>`;}
  /** 组装可信模板表格；行中可包含本模块构造的控件HTML。 */
  function table(headers,rows){return `<div class="av-table-scroll"><table class="av-table"><thead><tr>${headers.map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(x=>`<td>${x}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;}
  window.AdvisorUI={icon,button,table,esc};
  /** 打开可关闭的原型操作面板。不会写入平台；text为文字说明。 */
  function dialog(title,text){
    document.getElementById('avDialog')?.remove();const el=document.createElement('dialog');el.id='avDialog';el.className='av-dialog';el.innerHTML=`<form method="dialog"><h2>${esc(title)}</h2><p>${esc(text)}</p><button class="av-btn">知道了</button></form>`;document.body.append(el);el.showModal();
  }
  /** 原工作区入口；仅本次导航跳过视觉层，保留原数据及发布编辑状态。 */
  function real(tab){bypass=true;try{window.switchTab(tab);}finally{bypass=false;}}
  /** 处理主导航；返回true表示由新视觉工作区承接，false交回原工作区。 */
  function navigate(tab){
    const layout=document.querySelector('.app-layout');const page=window.AdvisorPages?.[tab];
    if(bypass||!page){layout?.classList.remove('av-mode');document.getElementById('advisorDesign')?.setAttribute('hidden','');return false;}
    active=tab;layout.classList.add('av-mode');layout.classList.remove('product-publish-mode','sidebar-collapsed');
    let root=document.getElementById('advisorDesign');if(!root){root=document.createElement('section');root.id='advisorDesign';root.className='av-design';document.querySelector('main').append(root);}root.hidden=false;
    document.querySelectorAll('main>.tab').forEach(e=>e.classList.remove('on'));
    document.querySelectorAll('#tabs button[data-tab]').forEach(b=>{b.classList.toggle('on',b.dataset.tab===tab);b.classList.remove('module-on');if(b.dataset.tab===tab)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
    let mast=document.getElementById('avMast');if(!mast){mast=document.createElement('header');mast.id='avMast';mast.innerHTML=`<div class="av-brand"><strong>来搜</strong><b>ALI运营顾问</b></div><div class="av-account"><button data-av-action="refresh" class="av-refresh">${icon('refresh-line')} 刷新</button><button data-av-action="help">${icon('question-line')} 帮助中心</button><button data-av-action="notifications" aria-label="通知">${icon('notification-3-line')}</button><span class="av-avatar">A</span><b>当前登录店铺</b>${icon('arrow-down-s-line')}</div>`;layout.prepend(mast);}
    const controls=tab==='plan'?button(icon('history-line')+' 历史规划','history','secondary'):tab==='position'?'<span class="av-select">基于当前店铺资料</span>':tab==='overview'?'': '<span class="av-select">'+icon('store-2-line')+' 当前登录店铺 '+icon('arrow-down-s-line')+'</span>';
    root.innerHTML=`<div class="av-page-heading"><div>${tab==='overview'?'':`<div class="av-breadcrumb">运营顾问 / ${names[tab]}</div>`}<div class="av-heading-line"><h1>${tab==='cultivation'?'核心品跟进':names[tab]}</h1><p>${descriptions[tab]}</p></div></div><div class="av-page-controls">${controls}<div class="av-period">${[['day','日'],['week','周'],['month','月']].map(([mode,label])=>`<button data-av-period="${mode}" class="${selectedRange.mode===mode?'selected':''}">${label}</button>`).join('')}</div><button class="av-select" data-av-action="period">${icon('calendar-line')} ${selectedRange.startDate} — ${selectedRange.endDate} ${icon('arrow-down-s-line')}</button></div></div><div class="av-content">${page()}</div>`;
    window.AdvisorMounts?.[tab]?.();refreshState();window.dispatchEvent(new CustomEvent('lsou:navigation',{detail:tab}));window.scrollTo(0,0);return true;
  }
  document.addEventListener('click',e=>{
    const b=e.target.closest('[data-av-action],[data-advisor-route],[data-nav]');if(!b)return;const a=b.dataset.avAction||b.dataset.advisorRoute||b.dataset.nav;
    if(a==='refresh'){navigate(active);return;}
    if(a==='real'){real(active);return;}
    if(a==='product-publish'||a==='publish'){real('product-publish');return;}
    if(names[a]){window.switchTab(a);return;}
    if(a?.startsWith('next:')){window.switchTab(a.slice(5));return;}
    if(a==='history'){dialog('历史规划','仅展示你实际保存的规划；尚未保存的规划不会生成历史记录。');return;}
    if(a==='help'){dialog('运营顾问','经营数据通过当前登录账号的 平台服务 读取；每个板块注明统计口径。未返回的指标保持空态。本地规划和跟进记录不会自动执行平台操作。产品发布保留完整功能。');return;}
    if(a==='notifications'){dialog('通知','当前尚未接入平台通知。读取经营数据不会自动执行平台写操作。');return;}
    if(a==='period'){periodDialog();return;}
  });
  document.addEventListener('click',e=>{const b=e.target.closest('[data-av-period]');if(b)changePeriod(b.dataset.avPeriod);});
  window.AdvisorDesign={navigate,real,dialog};
})();
