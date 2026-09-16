/** 运营顾问广告、核心品和产品分析：所有数值均来自当前账号的 平台服务 只读接口。 */
(function () {
  'use strict';
  const pages = window.AdvisorPages = window.AdvisorPages || {};
  const mounts = window.AdvisorMounts = window.AdvisorMounts || {};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = name => `<i class="ri-${name}" aria-hidden="true"></i>`;
  const fmt = value => value == null || String(value).trim() === '' || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('zh-CN', {maximumFractionDigits:2});
  const pct = value => value == null ? '—' : `${fmt(Number(value)*100)}%`;
  const title = (text, note='') => `<h3 class="av-title">${esc(text)}${note?`<small>${esc(note)}</small>`:''}</h3>`;
  const table = (heads,rows) => `<div class="aa-table-wrap"><table class="av-table"><thead><tr>${heads.map(x=>`<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(row=>`<tr>${row.map(x=>`<td>${x}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${heads.length}">当前查询没有记录</td></tr>`}</tbody></table></div>`;
  const button = (text,action) => `<button type="button" class="av-btn secondary" data-aa="${action}">${esc(text)}</button>`;
  const empty = text => `<p class="aa-notice">${esc(text)}</p>`;
  const kpis = items => `<div class="aa-kpis">${items.map(([label,value,symbol='bar-chart-line'])=>`<div class="aa-kpi"><span class="aa-circle">${icon(symbol)}</span><div><p>${esc(label)}</p><strong>${esc(value)}</strong></div></div>`).join('')}</div>`;
  const next = (name,route) => `<div class="aa-next">${icon('bar-chart-grouped-line')}<div><strong>下一步：${esc(name)}</strong><p>继续查看当前账号的运营数据与业务工作区。</p></div><button class="av-btn" data-nav="${route}">前往${esc(name)} →</button></div>`;
  /** 仅显示平台提供的 HTTP(S) 图片；缺图显示占位，不替换成生成商品图。参数为商品对象，返回转义后的 HTML，不抛出异常。 */
  function product(row) {
    const safe = /^https?:\/\//i.test(row.image || '');
    return `<div class="aa-product">${safe?`<img class="aa-thumb" style="object-fit:contain" src="${esc(row.image)}" alt="" loading="lazy">`:`<span class="aa-thumb">${icon('image-line')}</span>`}<span><b>${esc(row.title || '未命名商品')}</b><small>${esc(row.level || '未分层')}</small></span></div>`;
  }
  const styles = `<style>
  .av-design .aa-tabs{display:flex;gap:5px;align-items:center;border-bottom:1px solid #e8edf4;margin:0 0 10px}.av-design .aa-tabs button{border:0;background:#fff;color:#334160;padding:12px 24px;font-size:14px;cursor:pointer;border-bottom:2px solid transparent}.av-design .aa-tabs button.active{color:#ff640c;border-color:#ff640c;font-weight:700}.av-design .aa-sample{color:#8390a8;font-size:11px}.av-design .aa-kpis{display:flex;background:#fff;border-radius:8px;padding:15px 20px;margin-bottom:10px;min-height:82px;align-items:center}.av-design .aa-kpi{flex:1;display:flex;gap:18px;align-items:center;border-right:1px solid #e7ebf3;padding:0 20px}.av-design .aa-kpi:first-child{padding-left:0}.av-design .aa-kpi:last-child{border:0}.av-design .aa-circle{width:56px;height:56px;display:grid;place-items:center;border-radius:50%;font-size:26px;background:#fff0e6;color:#ff650d;flex:none}.av-design .aa-circle.blue{background:#eaf3ff;color:#318aff}.av-design .aa-circle.green{background:#e2f7ed;color:#12ad79}.av-design .aa-kpi p{font-size:12px;margin:0 0 5px;color:#576784}.av-design .aa-kpi strong{font-size:27px;letter-spacing:-.5px;color:#0c173b}.av-design .aa-kpi small{color:#8794af;font-size:11px;margin-left:9px}.av-design .aa-date{font-size:12px;color:#7c88a2;line-height:1.8;padding-left:20px}.av-design .aa-row{display:flex;justify-content:space-between;align-items:center;gap:12px}.av-design .aa-actions{display:flex;gap:9px;align-items:center}.av-design .aa-grid{display:grid;grid-template-columns:1.28fr 1fr;gap:10px;margin-bottom:10px}.av-design .aa-grid.equal{grid-template-columns:1fr 1fr}.av-design .aa-card{background:white;border-radius:8px;padding:14px;margin-bottom:10px;min-width:0}.av-design .aa-grid>.aa-card{margin-bottom:0}.av-design .aa-card .av-title{margin:0 0 13px;font-size:16px}.av-design .av-title small{font-weight:400;font-size:11px;color:#8390a8;margin-left:10px}.av-design .aa-chart{width:100%;height:210px;display:block}.av-design .aa-chart.small{height:166px}.av-design .aa-table-wrap{overflow:auto}.av-design .av-table{width:100%;border-collapse:collapse;font-size:12px;color:#39486b}.av-design .av-table th{text-align:left;padding:7px 9px;background:#f2f5f9;font-size:11px;font-weight:500;white-space:nowrap}.av-design .av-table td{padding:8px 9px;border-bottom:1px solid #edf0f6;line-height:1.4}.av-design .aa-product{display:flex;align-items:center;gap:10px;min-width:145px}.av-design .aa-product b{font-size:12px;font-weight:500;color:#142345}.av-design .aa-product small{display:block;font-size:11px;color:#8996ae}.av-design .aa-thumb{width:36px;height:36px;display:grid;place-items:center;background:linear-gradient(140deg,#e5e3df,#f4f5f7);color:#536270;border-radius:5px;flex:none;font-size:27px}.av-design .aa-link{border:0;background:none;color:#2686ff;cursor:pointer;font-size:12px;padding:3px 5px}.av-design .aa-muted{color:#8490a9;font-size:11px}.av-design .aa-next{display:flex;justify-content:space-between;align-items:center;background:#fff3e9;border:1px solid #ffd3b6;border-radius:6px;padding:12px 20px;gap:15px}.av-design .aa-next strong{font-size:16px}.av-design .aa-next p{color:#8792a7;font-size:11px;margin:5px 0 0}.av-design .aa-next>i{color:#ff6a13;font-size:30px}.av-design .aa-next>div{flex:1}.av-design .aa-filters{display:flex;align-items:center;gap:6px;padding-bottom:10px;flex-wrap:wrap;font-size:12px}.av-design .aa-filters button{background:#f3f5f8;border:1px solid transparent;border-radius:5px;color:#61708d;padding:5px 12px;cursor:pointer}.av-design .aa-filters button.active{background:#fff8f1;color:#ff650d;border-color:#ff9f62}.av-design .aa-selected td{background:#fff6ef}.av-design input[type=checkbox]{accent-color:#ff6509}.av-design .aa-tiny-stats{display:flex;gap:6px}.av-design .aa-tiny-stats>div{border:1px solid #e8ecf4;border-radius:5px;padding:10px 8px;min-width:66px;font-size:11px;line-height:1.8}.av-design .aa-tiny-stats b{display:block;font-size:20px;color:#102246}.av-design .aa-track{display:grid;grid-template-columns:1fr 90px 1fr;gap:10px;border-bottom:1px solid #edf0f5;padding:10px 0;font-size:12px;align-items:center}.av-design .aa-track label{display:flex;align-items:flex-start;gap:10px;line-height:1.7}.av-design .aa-track input[type=text]{border:1px solid #e0e6ef;padding:8px;border-radius:5px;width:100%;font-size:11px}.av-design .aa-diagnostic{display:grid;grid-template-columns:minmax(0,2.4fr) minmax(280px,1fr);gap:12px}.av-design .aa-funnel{display:flex;align-items:center;justify-content:space-between;padding:9px 6px}.av-design .aa-funnel-item{display:flex;align-items:center;gap:12px}.av-design .aa-funnel-item b{display:block;font-size:24px;margin:2px 0;color:#152445}.av-design .aa-funnel-item p{font-size:12px;margin:0}.av-design .aa-funnel-arrow{color:#9ba9bf;font-size:21px;text-align:center}.av-design .aa-funnel-arrow small{display:block;font-size:11px}.av-design .aa-chat{display:flex;gap:10px;margin:12px 0}.av-design .aa-avatar{height:30px;width:30px;display:grid;place-items:center;background:#ff761c;color:white;border-radius:50%;flex:none}.av-design .aa-bubble{background:#f5f7fa;border-radius:9px;padding:12px;font-size:12px;line-height:1.8;color:#435271}.av-design .aa-bubble p{margin:0 0 7px}.av-design .aa-bubble ol{padding-left:18px;margin:8px 0}.av-design .aa-chatbox{border:1px solid #dfe6f1;border-radius:6px;padding:8px;display:flex;gap:6px}.av-design .aa-chatbox input{border:0;flex:1;min-width:0;outline:none;font-size:12px}.av-design .aa-search{padding:8px 10px;border:1px solid #dfe5ee;border-radius:5px;font-size:12px;max-width:190px}.av-design .aa-detail{display:grid;grid-template-columns:1.7fr 1fr;gap:15px;margin-top:14px}.av-design .aa-detail p{font-size:12px;line-height:1.8;color:#6d7d96}.av-design .aa-notice{background:#fff2e7;color:#a65d26;padding:8px 12px;border-radius:5px;font-size:12px;margin:8px 0}.av-design .aa-compact td{padding:5px 9px}.av-design .aa-subtitle{margin:13px 0 8px;font-size:13px;color:#1f2d50}.av-design .aa-tabs.compact button{padding:6px 15px;font-size:12px}.av-design .aa-diagnostic .aa-card{margin-bottom:10px}.av-design .aa-canvas-tip{min-height:16px;text-align:right;font-size:11px;color:#8491a7}.av-design .aa-dialog{border:0;border-radius:12px;box-shadow:0 20px 90px #16243c38;max-width:650px;width:80%;padding:24px}.av-design .aa-dialog::backdrop{background:#18213655}.av-design .aa-dialog p{line-height:1.8;font-size:14px}.av-design .aa-chart-row{display:flex;align-items:center;gap:10px}.av-design .aa-chart-row>div:first-child{flex:1;min-width:0}@media(max-width:1000px){.av-design .aa-diagnostic,.av-design .aa-grid{grid-template-columns:1fr}.av-design .aa-date{display:none}}@media(max-width:650px){.av-design .aa-kpis{flex-wrap:wrap}.av-design .aa-kpi{padding:8px;gap:8px}.av-design .aa-kpi strong{font-size:22px}.av-design .aa-grid.equal,.av-design .aa-detail{grid-template-columns:1fr}.av-design .aa-chart-row{display:block}.av-design .aa-tabs button{padding:9px}.av-design .aa-funnel{flex-wrap:wrap;gap:10px}.av-design .aa-row{flex-wrap:wrap}}
  </style>`;

  /** 为异步页面建立独立容器；后续只更新本次容器，路由切换后不覆盖新页面。 */
  function shell(type) { return `${styles}<div class="aa-analytics" data-analytics="${type}"><p role="status" class="aa-notice">正在读取当前账号数据…</p></div>`; }
  pages.ads=()=>shell('ads');pages.cultivation=()=>shell('cultivation');pages.product=()=>shell('product');
  /** 使用统一带认证的只读客户端；HTTP或业务失败均抛错，不转换为空数据。 */
  async function read(path) {
    if(window.AdvisorLive?.fetch) return window.AdvisorLive.fetch(path);
    const response=await fetch(path),data=await response.json();
    if(!response.ok || data.ok===false) throw new Error(data.error || '读取失败');
    return data;
  }
  /** 返回共享查询周期，缺少公共模块时明确失败，不编造日期。 */
  function range() { if(!window.AdvisorLive?.range) throw new Error('日期组件尚未就绪');return window.AdvisorLive.range(); }
  /** 来源说明明确区分缓存、接口记录及完整性，不将缺失值显示为零。 */
  function source(r,note='') { return `<p class="aa-muted">来源：当前账号 · ${esc(r.startDate)} 至 ${esc(r.endDate)}${note?' · '+esc(note):''}</p>`; }
  /** 绘制真实序列，缺失值中断折线；左右轴分开计算，无数据时不生成模拟曲线。 */
  function chart(canvas,rows) {
    if(!canvas || !rows.length)return;
    const width=Math.max(canvas.clientWidth,250),height=canvas.clientHeight||210,ratio=window.devicePixelRatio||1;
    canvas.width=width*ratio;canvas.height=height*ratio;
    const c=canvas.getContext('2d');if(!c)return;c.scale(ratio,ratio);
    const left=48,right=34,top=20,bottom=32,w=width-left-right,h=height-top-bottom;
    const maxSpend=Math.max(1,...rows.map(x=>x.spend??0)),maxInquiry=Math.max(1,...rows.map(x=>x.inquiries??0));
    c.font='10px Arial';c.strokeStyle='#e9eef5';c.fillStyle='#8291aa';
    for(let i=0;i<=4;i++){const y=top+h-h*i/4;c.beginPath();c.moveTo(left,y);c.lineTo(width-right,y);c.stroke();c.textAlign='right';c.fillText(fmt(maxSpend*i/4),left-6,y+3);c.textAlign='left';c.fillText(fmt(maxInquiry*i/4),width-right+5,y+3);}
    c.textAlign='left';c.fillText('花费（元）',0,10);c.textAlign='right';c.fillText('询盘（个）',width,10);
    rows.forEach((row,i)=>{const x=left+(i+.5)*w/rows.length;if(row.spend!=null){c.fillStyle='#ff9857';c.fillRect(x-w/rows.length*.22,top+h-row.spend/maxSpend*h,w/rows.length*.44,row.spend/maxSpend*h);}if(i%Math.max(1,Math.ceil(rows.length/7))===0){c.fillStyle='#8291aa';c.textAlign='center';c.fillText(String(row.date).slice(5,10),x,height-10);}});
    c.strokeStyle='#2684ff';c.lineWidth=2;c.beginPath();let connected=false;
    rows.forEach((row,i)=>{if(row.inquiries==null){connected=false;return;}const x=left+(i+.5)*w/rows.length,y=top+h-row.inquiries/maxInquiry*h;connected?c.lineTo(x,y):c.moveTo(x,y);connected=true;});c.stroke();
    canvas.onpointermove=e=>{const i=Math.max(0,Math.min(rows.length-1,Math.floor((e.offsetX-left)/w*rows.length))),row=rows[i];canvas.title=`${row.date}：花费 ¥${fmt(row.spend)} · 询盘 ${fmt(row.inquiries)}`;};
  }
  /** 绑定已有真实工作区入口；此模块不伪造任务创建、执行完成或 AI 回复。 */
  function realButton(root,type) {root.querySelectorAll('[data-aa="real"]').forEach(b=>b.onclick=()=>window.AdvisorDesign?.real(type));}
  /** 广告页并发读取独立报表和计划；某个来源失败仍呈现其余成功来源。 */
  async function mountAds() {
    const root=document.querySelector('[data-analytics="ads"]');if(!root)return;
    let currentScope='search',request=0;
    async function load() {
      const token=++request;
      try {
        const r=range();root.innerHTML=`<div class="aa-tabs"><button data-aa="scope" data-value="search" class="${currentScope==='search'?'active':''}">直通车</button><button data-aa="scope" data-value="whole_site" class="${currentScope==='whole_site'?'active':''}">全站推</button></div>${source(r)}<div data-ad-kpi>${kpis([['花费（人民币）','—'],['广告询盘','—'],['单条询盘成本（元）','—']])}</div><div class="aa-grid"><section class="aa-card">${title('每日花费与询盘走势')}<div data-ad-report>${empty('读取真实广告报表中…')}</div></section><section class="aa-card">${title('当前投放计划','平台实时配置，不等于区间效果')}<div data-ad-plans>${empty('读取真实投放计划中…')}</div></section></div><section class="aa-card">${title('广告效果明细')}<div data-ad-rows>${empty('等待报表返回…')}</div></section><section class="aa-card">${title('广告诊断与执行')}${empty('未在当前报表中返回国家、关键词、询盘质量及执行任务；不会据此生成诊断结论或标记执行完成。')}${button('查看真实广告工作区','real')}</section>${next('优爆品提升','cultivation')}`;
        realButton(root,'ads');root.querySelectorAll('[data-aa="scope"]').forEach(b=>b.onclick=()=>{currentScope=b.dataset.value;load();});
        const valid=()=>root.isConnected&&token===request;
        await Promise.allSettled([
          read('/api/advertising/report?'+new URLSearchParams({scope:currentScope,startDate:r.startDate,endDate:r.endDate})).then(response=>{
            if(!valid())return;const d=response.data||{},rows=Array.isArray(d.rows)?d.rows:[],total=d.total||{};
            root.querySelector('[data-ad-kpi]').innerHTML=kpis([['花费（人民币）',total.spend==null?'—':'¥'+fmt(total.spend)],['广告询盘',fmt(total.inquiries)],['单条询盘成本（元）',total.spend!=null&&total.inquiries>0?'¥'+fmt(total.spend/total.inquiries):'—']]);
            root.querySelector('[data-ad-report]').innerHTML=rows.length?`<canvas class="aa-chart" aria-label="当前账号每日广告花费与询盘"></canvas><p class="aa-muted">橙色：花费　蓝色：询盘 · ${d.cached?'已读取当前账号缓存':'平台返回'} · ${esc(d.fetchedAt||'')}</p>`:empty('平台在所选区间未返回广告记录，指标保持缺失。');
            chart(root.querySelector('canvas'),rows);
            root.querySelector('[data-ad-rows]').innerHTML=table(['日期','花费（元）','曝光','点击','询盘','TM咨询','订单'],rows.map(row=>[esc(row.date),fmt(row.spend),fmt(row.impressions),fmt(row.clicks),fmt(row.inquiries),fmt(row.tm),fmt(row.orders)]));
          }).catch(error=>{if(valid()){root.querySelector('[data-ad-report]').innerHTML=empty('广告报表未接通：'+error.message);root.querySelector('[data-ad-rows]').innerHTML=empty('报表读取失败，未用零值或样例替代。');}}),
          read('/api/advertising/plans?'+new URLSearchParams({kind:currentScope,page:'1'})).then(response=>{if(!valid())return;const d=response.data||{};root.querySelector('[data-ad-plans]').innerHTML=table(['计划','类型','预算（元）','商品数'],(d.rows||[]).map(row=>[esc(row.campaignName||'未命名计划'),esc(row.campaignTypeDesc||row.subType||'—'),fmt(row.budget),fmt(row.onlineProductCount)]))+`<p class="aa-muted">第 1 页，最多 50 条 · 平台总数 ${fmt(d.total)}；预算为计划配置值。</p>`;}).catch(error=>{if(valid())root.querySelector('[data-ad-plans]').innerHTML=empty('投放计划未接通：'+error.message);})
        ]);
      }catch(error){if(root.isConnected&&token===request)root.innerHTML=empty(error.message);root.querySelector('[data-aa="retry"]')?.addEventListener('click',load);}
    }
    await load();
  }
  const quadrants={highExposureHighCtr:'高曝高点',highExposureLowCtr:'高曝低点',lowExposureHighCtr:'低曝高点',lowExposureLowCtr:'低曝低点'};
  /** 聚合互斥四象限；同一商品在“点击无询盘”附加分组中不重复计数。 */
  function records(data) {return Object.keys(quadrants).flatMap(key=>(data.focusProducts?.[key]||[]).map(row=>({...row,quadrant:key})));}
  /** 产品两页共享既有服务端分析；保留分层、筛选、诊断详情，缺少历史和任务时显式留空。 */
  async function mountProducts(type) {
    const root=document.querySelector(`[data-analytics="${type}"]`);if(!root)return;
    try {
      const requested=range(),r=['day','month'].includes(requested.mode)?requested:{...window.TimePolicy.period('month',window.TimePolicy.addMonths(window.TimePolicy.today().slice(0,7)+'-01',-1).slice(0,7)),mode:'month'},response=await read('/api/dashboard/product-analysis?'+new URLSearchParams({statDate:r.startDate,statisticsType:r.mode==='day'?'day':'month'}));
      if(!root.isConnected)return;
      const data=response.data||{},rows=records(data),complete=Number(data.population)===Number(data.recordCount),countNote=`已读取 ${fmt(data.population)} / 平台 ${fmt(data.recordCount)} 件；${complete?'分页完整':'分页不完整，仅展示已返回商品'}`;
      let selected=rows[0]||null,filter='全部',query='',page=1;
      const isCore=type==='cultivation',period=`${r.mode==='day'?'自然日':'自然月'}商品分析；${countNote}`;
      root.innerHTML=source(r,period)+(requested.mode!==r.mode?empty('商品接口不支持所选周或自定义区间，以下单独使用上一个完整自然月；不与顶部区间混算。'):'')+(isCore?kpis([['已读取商品',fmt(data.population)],['高曝低点商品',fmt(data.quadrantCounts?.highExposureLowCtr)],['有点击无询盘',fmt(data.diagnostics?.clickedNoInquiry)]]):`<section class="aa-card">${title('产品核心链路数据','商品搜索口径 · 起草单不等于成交订单')}<div class="aa-funnel">${[['曝光',data.totals?.exposure,'eye-line'],['点击',data.totals?.clicks,'cursor-line'],['询盘',rows.length?rows.reduce((s,x)=>s+x.inquiries,0):null,'message-3-line'],['起草单',rows.length?rows.reduce((s,x)=>s+x.draftOrders,0):null,'file-text-line']].map(([label,value,symbol])=>`<div class="aa-funnel-item"><span class="aa-circle">${icon(symbol)}</span><div><p>${esc(label)}</p><b>${fmt(value)}</b></div></div>`).join('')}</div></section>`)+`${!complete?empty('当前分页未完整返回，不将本页汇总视为全店总量。'):''}<div class="${isCore?'':'aa-diagnostic'}"><div><section class="aa-card"><div class="aa-row">${title(isCore?'核心商品跟进':'待分析产品')}<div class="aa-actions"><input class="aa-search" data-search aria-label="搜索真实商品名称" placeholder="搜索商品名称">${button('导出当前数据','export')}</div></div><div class="aa-filters" data-filters></div><div data-products></div><div class="aa-row" style="margin-top:10px"><span class="aa-muted" data-page-info></span><div class="aa-actions">${button('上一页','prev')}${button('下一页','next')}</div></div></section><section class="aa-card">${title('已选商品 · 当前周期表现')}<div data-detail></div></section></div>${isCore?'':`<section class="aa-card">${title('诊断依据')}<div data-diagnosis></div>${empty('AI 诊断助手尚未在新版接通。以下只呈现接口数据与既有统计分组，不生成虚构对话。')}${button('打开真实产品工作区','real')}</section>`}</div>${isCore?`<div class="aa-grid equal"><section class="aa-card">${title('单品历史趋势')}${empty('当前接口返回自然月或自然日汇总，没有连续时间序列，暂不绘制历史曲线。')}</section><section class="aa-card">${title('跟进动作清单')}${empty('该数据源不包含负责人、认证、橱窗及任务状态，尚未接通；没有创建或完成任何任务。')}${button('打开真实产品工作区','real')}</section></div>`:`<section class="aa-card">${title('诊断执行清单')}${empty('任务记录尚未接入此页面，未自动创建或完成执行事项。')}</section>`}${next(isCore?'数据分析与优化':'广告与流量',isCore?'product':'ads')}`;
      const filters=isCore?['全部',...Object.keys(data.layerCounts||{})]:['全部',...Object.values(quadrants)];
      root.querySelector('[data-filters]').innerHTML=`<b>${isCore?'平台分层':'统计象限'}：</b>`+filters.map(label=>`<button type="button" data-filter="${esc(label)}" class="${label==='全部'?'active':''}">${esc(label)}</button>`).join('');
      /** 按真实字段过滤分页；详情只读取选中的返回记录，不推断认证或任务状态。 */
      function render() {
        const filtered=rows.filter(row=>(filter==='全部'||(isCore?row.level:quadrants[row.quadrant])===filter)&&String(row.title).toLowerCase().includes(query.toLowerCase()));
        const pages=Math.max(1,Math.ceil(filtered.length/20));page=Math.min(page,pages);
        const visible=filtered.slice((page-1)*20,page*20);
        root.querySelector('[data-products]').innerHTML=table(['商品','平台分层','曝光','点击','点击率','询盘','TM咨询','数据分组','操作'],visible.map(row=>[product(row),esc(row.level),fmt(row.exposure),fmt(row.clicks),pct(row.clickRate),fmt(row.inquiries),fmt(row.tmInquiries),esc(quadrants[row.quadrant]),`<button class="aa-link" data-select="${rows.indexOf(row)}">查看详情</button>`]));
        root.querySelector('[data-page-info]').textContent=`共 ${filtered.length} 件 · 第 ${page} / ${pages} 页 · 每页 20 件`;
        root.querySelector('[data-aa="prev"]').disabled=page===1;root.querySelector('[data-aa="next"]').disabled=page===pages;
        if(!selected){root.querySelector('[data-detail]').innerHTML=empty('当前账号在所选周期没有返回商品记录。');root.querySelector('[data-diagnosis]')?.replaceChildren();return;}
        root.querySelector('[data-detail]').innerHTML=product(selected)+table(['曝光','点击','点击率','访客','询盘','TM咨询','起草单'],[[fmt(selected.exposure),fmt(selected.clicks),pct(selected.clickRate),fmt(selected.visitors),fmt(selected.inquiries),fmt(selected.tmInquiries),fmt(selected.draftOrders)]])+`<p class="aa-muted">${esc(quadrants[selected.quadrant])}：曝光阈值为本次样本 P75（${fmt(data.thresholds?.exposureP75)}），点击率阈值为本次样本加权点击率（${pct(data.thresholds?.storeWeightedCtr)}）。统计分组不代表平台爆品认定。</p>`;
        if(!isCore)root.querySelector('[data-diagnosis]').innerHTML=`<div class="aa-bubble"><p>${esc(selected.title)}</p><p>当前周期：${fmt(selected.exposure)} 次曝光、${fmt(selected.clicks)} 次点击、${fmt(selected.inquiries)} 条询盘。</p><p>统计分组：${esc(quadrants[selected.quadrant])}。${selected.clicks>0&&selected.inquiries===0?'本期有点击，但询盘为 0。':'仅凭汇总数据无法确定原因。'}</p><p>来源：店铺商品效果，${esc(r.startDate)} ${r.mode==='day'?'自然日':'自然月'}。</p></div>`;
      }
      root.querySelector('[data-search]').oninput=e=>{query=e.target.value;page=1;render();};
      root.onclick=e=>{const b=e.target.closest('button');if(!b)return;if(b.hasAttribute('data-filter')){filter=b.dataset.filter;page=1;root.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));render();}else if(b.hasAttribute('data-select')){selected=rows[Number(b.dataset.select)];render();}else if(b.dataset.aa==='prev'){page--;render();}else if(b.dataset.aa==='next'){page++;render();}else if(b.dataset.aa==='export'){const blob=new Blob([JSON.stringify({source:'当前店铺',period:r,complete,records:rows},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='商品经营数据.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}};
      realButton(root,'product');render();
    }catch(error){if(root.isConnected){root.innerHTML=empty('商品数据读取失败：'+error.message)+button('查看真实工作区','real');realButton(root,'product');}}
  }
  mounts.ads=mountAds;mounts.cultivation=()=>mountProducts('cultivation');mounts.product=()=>mountProducts('product');
})();
