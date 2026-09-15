/* 历史通用能力抽屉实现：已退出前端加载链，保留供后续业务整合参考；不再自动创建入口或查询目录。 */
(() => {
  'use strict';
  const names={overview:'经营总览',visitor:'客户与询盘',product:'商品运营','product-publish':'产品发布',flow:'流量分析',ads:'关键词与广告',rfq:'RFQ商机',orders:'订单与物流',risk:'风险合规',storefront:'店铺装修',assets:'素材工坊',staff:'团队绩效',knowledge:'知识库与接待',access:'账号与权限',console:'全部业务能力'};
  const state={tools:[],choices:[],jobs:[],page:'',selected:null,ticket:null,loading:false};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fieldNames={productId:'商品',prodId:'商品',prod_id:'商品',productIds:'商品列表',modelId:'3D模型',modelIds:'3D模型列表',modelKey:'模型机位',companyId:'公司',cateId:'商品类目',categoryId:'商品类目',priceUnit:'计价单位',batchNum:'每批数量',saleType:'销售方式',strategyId:'接待策略',topicId:'征品主题',requestKey:'已提交任务',taskId:'任务',pageId:'店铺页面',selfAliId:'卖家账号',contactAliId:'联系人',conversationId:'客户会话',memberId:'成员',accountId:'账号',rfqId:'RFQ商机',quoteId:'报价'};
  const modes={read:'查询',write:'需确认',internal:'后台连接',restricted:'专属流程',unverified:'待核验'};
  const statuses={queued:'等待执行',running:'执行中',submitted:'已提交',succeeded:'查询完成',failed:'失败',unknown:'待核对'};
  let dialog, pollTimer;
  /** 请求本地能力接口。route为固定路径，payload为可选对象；返回JSON；失败抛Error。 */
  async function api(route,payload){const response=await fetch('/api/capabilities/'+route,payload===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||'请求失败');return data;}
  /** 打开当前侧栏对应的功能抽屉。page为导航键；返回void；无主动异常。 */
  function open(page){
    state.page=page;state.selected=null;state.ticket=null;
    if(!dialog){dialog=document.createElement('dialog');dialog.className='cap-dialog';document.body.append(dialog);dialog.addEventListener('close',()=>clearTimeout(pollTimer));}
    dialog.innerHTML=`<header class="cap-header"><div><small>业务功能</small><h2>${esc(names[page])}</h2></div><button type="button" class="ghost cap-close" aria-label="关闭业务功能">关闭</button></header><div class="cap-layout"><aside class="cap-sidebar"><input type="search" aria-label="搜索业务功能" placeholder="搜索业务功能"><div class="cap-list"></div></aside><main class="cap-main"><div class="cap-editor"><div class="cap-welcome"><h3>选择要处理的业务</h3><p>左侧按业务环节分组。查询按需执行，修改先核对具体内容。</p><p>已提交不等于发布、审核或生成完成，请继续查询结果。</p></div></div><section class="cap-history"><h3>本模块执行记录</h3><div class="cap-jobs">正在读取任务…</div></section></main></div>`;
    dialog.querySelector('.cap-close').onclick=()=>dialog.close();dialog.querySelector('input[type=search]').oninput=renderList;renderList();if(!dialog.open)dialog.showModal();void refresh();
  }
  /** 按当前页与搜索词呈现工具目录；返回void；无异常。 */
  function renderList(){
    const search=dialog.querySelector('input[type=search]').value.trim().toLowerCase();
    const items=state.tools.filter(t=>(state.page==='console'||t.page===state.page)&&(!search||[t.title,t.section,t.description].join(' ').toLowerCase().includes(search)));
    const groups=[...new Set(items.map(t=>t.section))];
    dialog.querySelector('.cap-list').innerHTML=groups.map(group=>`<section><h3>${esc(group)}</h3>${items.filter(t=>t.section===group).map(t=>`<button type="button" data-cap-id="${t.id}" class="${state.selected?.id===t.id?'selected':''}"><span>${esc(t.title)}</span><small>${modes[t.mode]}</small></button>`).join('')}</section>`).join('')||'<p>没有匹配功能</p>';
    dialog.querySelectorAll('[data-cap-id]').forEach(button=>button.onclick=()=>select(state.tools.find(t=>t.id===button.dataset.capId)));
  }
  /** 显示参数字段，内部编号只能从已读结果中选择；p为字段合同；返回HTML字符串。 */
  function field(p,index){
    const label=fieldNames[p.name]||(p.description||p.name).split(/[。；\n]/)[0].slice(0,64),attrs=`data-param="${esc(p.name)}" id="cap-field-${index}" ${p.required?'required':''}`;
    let input;
    if(p.reference)input=`<select ${attrs} ${p.type==='array'?'multiple':''}><option value="">从已查询的业务对象选择</option>${state.choices.filter(c=>c.name===p.name).map(c=>`<option value="${esc(c.ref)}">${esc(c.label)}</option>`).join('')}</select>`;
    else if(p.enum||p.type==='boolean')input=`<select ${attrs}><option value="">${p.required?'请选择':'不指定'}</option>${(p.enum||[true,false]).map(v=>`<option value="${esc(v)}">${typeof v==='boolean'?(v?'是':'否'):esc(v)}</option>`).join('')}</select>`;
    else if(['object','array'].includes(p.type))input=`<textarea ${attrs} rows="5" placeholder='${p.type==='array'?'填写结构化列表，例如 []':'填写结构化内容，例如 {}'}'></textarea><small>高级结构化字段，按下方平台说明填写；不会自动猜测内容。</small>`;
    else input= p.type==='string'?`<textarea ${attrs} rows="2"></textarea>`:`<input ${attrs} type="number" step="${p.type==='integer'?'1':'any'}">`;
    return `<div class="cap-field"><label for="cap-field-${index}">${esc(label)} ${p.required?'<b>*</b>':'<small>选填</small>'}</label>${input}<details><summary>字段说明</summary><p>${esc(p.description||p.name)}</p><code>${esc(p.name)}</code></details></div>`;
  }
  /** 选择业务功能并生成合同表单；tool为目录项；返回void；无异常。 */
  function select(tool){
    state.selected=tool;state.ticket=null;renderList();const runnable=['read','write'].includes(tool.mode);
    const reason=tool.mode==='internal'?'此项属于后台连接能力，凭据不在页面展示。':tool.mode==='restricted'?'平台规定此工具仅用于专属发品Skill，普通页面不能直接调用。':'当前平台接口说明或参数不完整，待核验后开放执行。';
    dialog.querySelector('.cap-editor').innerHTML=`<h3>${esc(tool.title)} <small>${modes[tool.mode]}</small></h3><details class="cap-description"><summary>适用范围与平台说明</summary><p>${esc(tool.description)}</p><code>${esc(tool.command)}</code></details>${!runnable?`<p class="cap-notice">${reason}</p>`:`<form class="cap-form">${tool.params.some(p=>p.reference)?'<div class="cap-context"><label>读取可选业务对象<select class="cap-source"><option value="products">店铺商品</option><option value="models">自有3D模型</option><option value="strategies">接待策略</option><option value="pages">店铺页面</option><option value="contacts">联系人</option><option value="tasks">已有优化任务</option></select><input type="search" placeholder="商品名称，可留空"></label><button type="button" class="ghost">读取可选对象</button><small>其他对象来自本工作区已完成的查询结果，例如模型、策略、任务和页面。先运行相应列表查询，再选择。</small></div>':''}${tool.params.map(field).join('')||'<p>使用当前账号查询，无需填写参数。</p>'}<p class="cap-error" role="alert"></p><button type="submit" class="primary">${tool.mode==='write'?'核对本次操作':'执行查询'}</button></form><div class="cap-preview"></div>`}`;
    const form=dialog.querySelector('.cap-form');if(!form)return;
    form.oninput=()=>{state.ticket=null;state.lastJob=null;dialog.querySelector('.cap-preview').replaceChildren();};
    const context=form.querySelector('.cap-context button');if(context)context.onclick=async()=>{
      context.disabled=true;try{const values=readValues(false);const data=await api('context',{query:form.querySelector('.cap-context input').value,kind:form.querySelector('.cap-source').value});state.choices=data.choices;select(tool);restore(values);}catch(e){form.querySelector('.cap-error').textContent=e.message;}finally{context.disabled=false;}
    };
    form.onsubmit=async event=>{
      event.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;
      try{const params=readValues();const data=await api('preview',{toolId:tool.id,params});state.ticket=data.ticket;
        if(tool.mode==='read'){await execute(tool,data.ticket,false);return;}
        const box=dialog.querySelector('.cap-preview');box.innerHTML='<h4>核对本次操作</h4><p>请核对目标、内容及范围。生成可能消耗额度，发布、删除、分配及保存会改变平台数据。</p><pre></pre><label><input type="checkbox"> 我已核对本次操作和影响</label><button type="button" class="primary" disabled>确认执行</button>';
        box.querySelector('pre').textContent=JSON.stringify(data.summary,null,2);const confirm=box.querySelector('button');box.querySelector('input').onchange=e=>{confirm.disabled=!e.target.checked;};confirm.onclick=async()=>{confirm.disabled=true;try{await execute(tool,data.ticket,true);}catch(e){form.querySelector('.cap-error').textContent=e.message;}finally{confirm.disabled=false;}};
      }catch(e){form.querySelector('.cap-error').textContent=e.message;}finally{button.disabled=false;}
    };
  }
  /** 读取表单并按Schema类型转换；strict控制JSON解析；返回参数对象；格式错误抛Error。 */
  function readValues(strict=true){const params={};for(const p of state.selected.params){const input=dialog.querySelector(`[data-param="${p.name}"]`);const value=input?.value;if(!value)continue;try{params[p.name]=p.reference?(p.type==='array'?[...input.selectedOptions].map(o=>o.value).filter(Boolean):value):['object','array'].includes(p.type)?JSON.parse(value):['number','integer'].includes(p.type)?Number(value):p.type==='boolean'?value==='true':value;}catch{if(strict)throw new Error('结构化字段不是有效JSON');params[p.name]=value;}}return params;}
  /** 恢复用户已填字段；values为参数对象；返回void；无异常。 */
  function restore(values){for(const [key,v]of Object.entries(values)){const input=dialog.querySelector(`[data-param="${key}"]`);if(input)input.value=typeof v==='object'?JSON.stringify(v):String(v);}}
  /** 提交服务器预览票据；返回Promise；失败抛Error，不自动重试写操作。 */
  async function execute(tool,ticket,confirmed){const data=await api('run',{toolId:tool.id,ticket,confirmed});state.lastJob=data.job.id;dialog.querySelector('.cap-preview').textContent=`${data.job.title}：${statuses[data.job.status]}`;await refresh();}
  /** 更新执行记录与结果引用，不覆盖表单；返回Promise；错误显示在任务区。 */
  async function refresh(){
    clearTimeout(pollTimer);if(!dialog?.open)return;
    try{const data=await api('jobs');state.jobs=data.jobs;state.choices=data.choices;
      const recent=data.jobs.find(j=>j.id===state.lastJob);if(recent && state.selected?.id===recent.toolId)dialog.querySelector('.cap-preview').textContent=recent.title+'：'+(statuses[recent.status]||recent.status);
      const jobs=data.jobs.filter(j=>state.page==='console'||j.page===state.page);
      const host=dialog.querySelector('.cap-jobs');host.replaceChildren();
      if(!jobs.length)host.textContent='暂无执行记录。';
      for(const job of jobs){const row=document.createElement('article');row.className='cap-job';row.innerHTML=`<header><b>${esc(job.title)}</b><span>${statuses[job.status]||esc(job.status)}</span></header><p>${esc(job.message)}</p><small>${esc(new Date(job.createdAt).toLocaleString())}</small>${job.result!==undefined?'<details><summary>查看平台结果</summary><pre></pre></details>':''}`;if(job.result!==undefined)row.querySelector('pre').textContent=JSON.stringify(job.result,null,2);host.append(row);}
      // 查询完成后补充新出现的对象选项，但保留当前选择及未保存输入。
      dialog.querySelectorAll('select[data-param]').forEach(select=>{const p=state.selected?.params.find(p=>p.name===select.dataset.param);if(!p?.reference)return;for(const choice of state.choices.filter(c=>c.name===p.name)){if(![...select.options].some(o=>o.value===choice.ref)){const option=new Option(choice.label,choice.ref);select.add(option);}}});
    }catch(e){dialog.querySelector('.cap-jobs').textContent=e.message;}
    if(dialog.open)pollTimer=setTimeout(refresh,3000);
  }
})();
