/* 八页运营工作区共用真实 平台服务 读取与日期控制；产品发布沿用原入口。 */
(() => {
  'use strict';
  const names={overview:'数据看板',plan:'运营规划',position:'营销定位',foundation:'运营基建',ads:'运营推广',cultivation:'优爆品提升',product:'数据分析与优化',visitor:'商机转化'};
  let active='overview', bypass=false;
  const policy=window.TimePolicy;
  let selectedRange={mode:'month',...policy.period('month',policy.addMonths(policy.today().slice(0,7)+'-01',-1).slice(0,7))};
  const reads=new Map();
  let dataVersion=0;const pageRecords=new Map();
  /** 将读取状态同步到唯一的顶部刷新按钮；无参数/返回值，不触碰表单内容。 */
  function refreshState(){const b=document.querySelector('#avMast [data-av-action="refresh"]');if(b){b.disabled=reads.size>0;b.innerHTML=reads.size?'正在刷新…':icon('refresh-line')+' 刷新';}}
  /** 读取同源只读接口并合并并发请求。path为API路径；返回响应JSON；网络/业务失败抛Error。 */
  async function read(path){
    if(!/^\/api\/(q\/|dashboard\/|advertising\/|workspaces\/|overview-tasks(?:$|\?)|health(?:$|\?))/.test(path))throw new Error('不是允许的数据读取接口');
    const version=dataVersion;
    if(reads.has(path)){const result=await reads.get(path);if(version===dataVersion)pageRecords.set(path,{source:path.split('?')[0],scope:path.split('?')[1]||'接口独立周期',data:result.data??result});return result;}
    const pending=(async()=>{
      const response=await fetch(path,{signal:AbortSignal.timeout(120000)});
      const result=await response.json();
      if(!response.ok||result.ok===false)throw new Error(String(result.error?.message||result.error||'数据读取失败，请重试').replace(/workctl/gi,'数据服务'));
      if(version===dataVersion)pageRecords.set(path,{source:path.split('?')[0],scope:path.split('?')[1]||'接口独立周期',data:result.data??result});
      return result;
    })();
    reads.set(path,pending);refreshState();
    try{return await pending;}finally{reads.delete(path);refreshState();}
  }
  /** 只返回有效数值，缺失显示破折号。value为原始数值；返回展示文字，无主动异常。 */
  function format(value){return value==null||value===''||!Number.isFinite(Number(value))?'—':Number(value).toLocaleString('zh-CN',{maximumFractionDigits:2});}
  // 不静默截断已经读取的资料；请求体过大时由后端明确提示缩小范围。
  window.AdvisorLive={fetch:read,range:()=>({...selectedRange}),version:()=>dataVersion,records:()=>structuredClone([...pageRecords.values()]),ready:async()=>{while(reads.size)await Promise.allSettled([...reads.values()]);},format};
  /** 商品效果只允许指定日/月；其余经营区间支持完整周。返回模式数组，无异常。 */
  function periodModes(){return ['product','cultivation'].includes(active)?['day','month']:['day','week','month'];}
  /** 返回最新可选周期值。mode为日/周/月；按北京时间计算，周日已结束时可选上一周。 */
  function latestPeriodValue(mode){
    const yesterday=policy.shift(policy.today(),-1);
    if(mode==='month')return policy.addMonths(policy.today().slice(0,7)+'-01',-1).slice(0,7);
    if(mode==='week'){const week=policy.period('week',policy.weekValue(yesterday),'9999-12-31');return policy.weekValue(week.endDate<=yesterday?week.startDate:policy.shift(week.startDate,-7));}
    return yesterday;
  }
  /** 校验后应用日/周/月，商品额外按真实工具合同限制近90天。非法输入抛Error，不刷新数据。 */
  function applyPeriod(mode,value){
    if(!periodModes().includes(mode))throw new Error('此页面不支持该统计周期');
    const dates=policy.period(mode,value);
    if(['product','cultivation'].includes(active))policy.validate('shop-product',{statDate:dates.startDate,statisticsType:mode});
    if(active==='visitor')policy.validate('visitor-detail',dates);
    selectedRange={mode,...dates};
  }
  /** 切换统计粒度，默认日为前天、周/月为最新完整周期；无返回值。 */
  function changePeriod(mode){
    if(!periodModes().includes(mode))return;
    applyPeriod(mode,mode==='day'?policy.shift(policy.today(),-2):latestPeriodValue(mode));navigate(active);
  }
  /** 日期按钮下方展开选择器；保留区间校验，点击外部或Escape关闭，不遮罩页面。 */
  function periodDialog(){
    const existing=document.getElementById('avDatePopover');if(existing){existing.remove();return;}
    const anchor=document.querySelector('[data-av-action="period"]');if(!anchor)return;
    const el=document.createElement('div');el.id='avDatePopover';el.className='av-date-popover';el.setAttribute('popover','auto');el.setAttribute('role','dialog');el.setAttribute('aria-label','选择统计周期');
    const mode=selectedRange.mode, value=mode==='month'?selectedRange.startDate.slice(0,7):mode==='week'?policy.weekValue(selectedRange.startDate):selectedRange.startDate;
    const earliest=policy.shift(policy.today(),-89);
    const min=['product','cultivation'].includes(active)?(mode==='month'?(earliest.endsWith('-01')?earliest.slice(0,7):policy.addMonths(earliest.slice(0,7)+'-01',1).slice(0,7)):earliest):'';
    const label={day:'统计日',week:'自然周（周一至周日）',month:'自然月'}[mode];
    el.innerHTML=`<form><strong>选择${label}</strong><div class="av-date-fields" style="grid-template-columns:1fr"><label>${label}<input name="period" type="${mode==='day'?'date':mode}" required value="${value}" min="${min}" max="${latestPeriodValue(mode)}"></label></div><p>${min?'商品仅支持近90天内的统计日或月初；':''}只可选择已结束的${{day:'日期',week:'完整自然周',month:'完整自然月'}[mode]}。</p><p role="alert" id="avDateError"></p><div class="av-date-actions"><button class="av-btn secondary" type="button" id="avDateCancel">取消</button><button class="av-btn" type="submit">应用</button></div></form>`;
    document.body.append(el);anchor.setAttribute('aria-expanded','true');
    const controller=new AbortController();
    const close=()=>{el.remove();anchor.setAttribute('aria-expanded','false');controller.abort();};
    el.addEventListener('toggle',event=>{if(event.newState==='closed')close();});
    el.querySelector('#avDateCancel').onclick=()=>{close();anchor.focus();};
    el.querySelector('form').onsubmit=event=>{event.preventDefault();try{applyPeriod(mode,new FormData(event.currentTarget).get('period'));close();navigate(active);}catch(error){el.querySelector('#avDateError').textContent=error.message;}};
    el.showPopover();const rect=anchor.getBoundingClientRect();
    el.style.left=Math.max(12,Math.min(rect.right-el.offsetWidth,window.innerWidth-el.offsetWidth-12))+'px';
    el.style.top=Math.max(12,Math.min(rect.bottom+8,window.innerHeight-el.offsetHeight-12))+'px';
    window.addEventListener('resize',close,{once:true,signal:controller.signal});
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
  let identityPending=null;
  /** 读取当前账号已有公司资料，跨页复用顶部身份；失败显示缺失状态，不使用示例账号。 */
  async function loadIdentity(){
    if(identityPending)return identityPending;
    const host=document.querySelector('#avMast .av-company-identity');if(!host)return;
    host.innerHTML=`<span class="av-avatar">${icon('store-2-line')}</span><b>正在读取公司…</b>`;
    identityPending=(async()=>{
      try{
        const response=await fetch('/api/workspaces/identity',{signal:AbortSignal.timeout(120000)}),result=await response.json();
        if(!response.ok||result.ok===false)throw new Error('公司资料暂不可用');
        const name=result.data?.companyName;
        let logo='';try{const url=new URL(String(result.data?.companyLogo||'').replace(/^\/\//,'https://'));if(url.protocol==='https:')logo=url.href;}catch{}
        host.innerHTML=`<span class="av-avatar">${logo?`<img src="${esc(logo)}" alt="公司头像" referrerpolicy="no-referrer">`:icon('store-2-line')}</span><b title="${esc(name||'公司名称未返回')}">${esc(name||'公司名称未返回')}</b>`;
        host.querySelector('img')?.addEventListener('error',()=>{host.querySelector('.av-avatar').innerHTML=icon('store-2-line');},{once:true});
      }catch{host.innerHTML=`<span class="av-avatar">${icon('store-2-line')}</span><b title="点击刷新重试">公司资料暂不可用</b>`;}
      finally{identityPending=null;}
    })();return identityPending;
  }
  /** 确保所有业务页共用顶栏；layout为应用容器，不替换发布编辑器DOM。 */
  function ensureMast(layout){
    let mast=document.getElementById('avMast');if(!mast){mast=document.createElement('header');mast.id='avMast';mast.innerHTML=`<div class="av-brand"><img src="/assets/lsou-logo-square.png" alt="来搜 L-SOU"><b>运营顾问</b></div><span class="av-company-identity" aria-live="polite"></span><div class="av-account"><div id="avMastPeriod" class="av-mast-period"></div><button data-av-action="refresh" class="av-refresh">${icon('refresh-line')} 刷新</button></div>`;layout.prepend(mast);void loadIdentity();}
  }
  /** 处理主导航；返回true表示由新视觉工作区承接，false交回原工作区。 */
  function navigate(tab){
    // 离开顾问页也使旧快照失效，避免发品/旧工作区仍复用上页的分析点击。
    dataVersion++;pageRecords.clear();
    window.AdvisorRestoreRfq?.();
    const layout=document.querySelector('.app-layout');const page=window.AdvisorPages?.[tab];
    if(tab==='product-publish'){
      window.AdvisorServices?.attach('');
      active=tab;layout?.classList.add('av-mode');layout?.classList.remove('sidebar-collapsed');
      ensureMast(layout);document.getElementById('avMastPeriod').innerHTML='';document.getElementById('avDatePopover')?.hidePopover();document.getElementById('advisorDesign')?.setAttribute('hidden','');
      return false;
    }
    if(bypass||!page){window.AdvisorServices?.attach('');layout?.classList.remove('av-mode');document.getElementById('advisorDesign')?.setAttribute('hidden','');return false;}
    active=tab;if(!periodModes().includes(selectedRange.mode)){applyPeriod('month',latestPeriodValue('month'));}if(['product','cultivation'].includes(active)){try{policy.validate('shop-product',{statDate:selectedRange.startDate,statisticsType:selectedRange.mode});}catch{applyPeriod('month',latestPeriodValue('month'));}}document.getElementById('avDatePopover')?.hidePopover();layout.classList.add('av-mode');layout.classList.remove('product-publish-mode','sidebar-collapsed');
    let root=document.getElementById('advisorDesign');if(!root){root=document.createElement('section');root.id='advisorDesign';root.className='av-design';document.querySelector('main').append(root);}root.hidden=false;
    document.querySelectorAll('main>.tab').forEach(e=>e.classList.remove('on'));
    document.querySelectorAll('#tabs button[data-tab]').forEach(b=>{b.classList.toggle('on',b.dataset.tab===tab);b.classList.remove('module-on');if(b.dataset.tab===tab)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
    ensureMast(layout);
    document.getElementById('avMastPeriod').innerHTML=`<div class="av-period">${[['day','日'],['week','周'],['month','月']].filter(([mode])=>periodModes().includes(mode)).map(([mode,label])=>`<button data-av-period="${mode}" class="${selectedRange.mode===mode?'selected':''}">${label}</button>`).join('')}</div><button class="av-select" data-av-action="period">${icon('calendar-line')} ${selectedRange.startDate} — ${selectedRange.endDate} ${icon('arrow-down-s-line')}</button>`;
    root.innerHTML=`<div class="av-workbench ${tab==='overview'?'':tab==='position'?'av-position-workbench':'av-data-workbench'}"><div class="av-content">${page()}</div></div>`;
    window.AdvisorMounts?.[tab]?.();window.AdvisorServices?.attach(tab);refreshState();window.dispatchEvent(new CustomEvent('lsou:navigation',{detail:tab}));window.scrollTo(0,0);return true;
  }
  document.addEventListener('click',e=>{
    const b=e.target.closest('[data-av-action],[data-advisor-route],[data-nav]');if(!b)return;const a=b.dataset.avAction||b.dataset.advisorRoute||b.dataset.nav;
    if(a==='refresh'){void loadIdentity();if(active==='product-publish')document.getElementById('btnReload')?.click();else navigate(active);return;}
    if(a==='real'){real(active);return;}
    if(a==='product-publish'||a==='publish'){real('product-publish');return;}
    if(names[a]){window.switchTab(a);return;}
    if(a?.startsWith('next:')){window.switchTab(a.slice(5));return;}
    if(a==='history'){dialog('历史规划','仅展示你实际保存的规划；尚未保存的规划不会生成历史记录。');return;}
    if(a==='period'){periodDialog();return;}
  });
  document.addEventListener('click',e=>{const b=e.target.closest('[data-av-period]');if(b)changePeriod(b.dataset.avPeriod);});
  window.AdvisorDesign={navigate,real,dialog};
})();
