/* 国际站五条运营能力：业务表单与实际查询/任务分离。 */
'use strict';
(() => {
  const state = { jobs: [], selected: {}, conversation: null, cursor: null, messageCursor: null, productQuery: '', productPage: 1 };
  const labels = {
    attr: '商品属性', attrName: '属性名称', attrValue: '属性值', trade: '价格与交易', fulfillment: '包装与履约', pkgLength: '包装长度', pkgWidth: '包装宽度', pkgHeight: '包装高度', priceUnit: '计价单位代码', saleType: '销售方式', ladderPrices: '阶梯价格', minQuantity: '起订数量', unitPrice: '单价', moq: '最小起订量', inventory: '库存', ladderPeriod: '交期', quantity: '数量', period: '天数', pkgWeight: '包装重量', pkgMeasure: '包装尺寸', logisticsProperty: '物流属性', shippingTemplate: '运费模板', basic: '基础信息修改', detail: '详情修改', originalImageUrl: '原始图片', operationType: '操作方式', abilityCode: '创作能力', prompt: '创作要求', hexColor: '目标颜色', modelImageUrl: '参考模特', targetLang: '目标语言', userInput: '视频要求', inputImgUrls: '参考图片',
    finalStar: '当前星等级', displayLevelStar: '展示星级', pageLevelStar: '评定星级', trackList: '评定赛道', trackName: '赛道名称', abilityList: '经营能力', abilityName: '能力名称', adviceList: '平台提升建议', indicatorList: '指标明细', thresholdList: '达标门槛', thresholdAllReached: '门槛全部达标', progress: '进度', alert: '预警', tips: '提示',
    totalRiskProdCnt: '风险商品总数', punishPoint: '累计扣分', todayPunishNum: '今日处罚数量', todayPunishPoint: '今日扣分', majorViolationTypes: '主要违规类型', violationList: '违规明细', latestViolation: '最近违规', controlReason: '管控原因', deductionPoints: '扣分', penaltyMeasure: '处罚措施', suggestionDesc: '整改建议', violationTime: '违规时间', viewAllUrl: '平台全部记录', hasViolation: '存在违规', hasIpViolation: '存在知识产权违规', hasPrViolation: '存在禁限售违规',
    buyer_persona: '买家画像', buyer_level: '买家等级', buyer_country_code: '买家国家', messages: '消息记录', isRead: '已读', hasMore: '还有历史消息', nextPointTimeStamp: '历史分页位置',
    abCnt: '商机量', abCntYoy: '商机同比', dAbRate: '需求商机率', detailUv: '访客数', detailUvRivalAvg: '同行平均访客', detailUvRivalGood: '同行优秀访客', dataList: '物流记录', tradeList: '合同记录', orderNumber: '物流单号', orderStatusDesc: '物流状态', cargoDesc: '货物说明', destinationCountryName: '目的国家', originCountryName: '起运国家', solutionName: '物流方案', warehouseName: '仓库',
    data: '业务数据', result: '结果', list: '记录', records: '记录', rows: '记录', total: '总数', totalCount: '总数', recordCount: '总数',
    productTitle: '商品标题', productKeywords: '关键词', productSellingPoint: '商品卖点', companyDesc: '公司介绍', images: '主副图', detailImage: '详情图片', faqs: '常见问题', question: '问题', answer: '回答',
    tradeId: '交易号', tradeBizId: '信保单号', orderId: '订单号', orderNo: '订单号', number: '物流订单号', status: '状态', orderStatus: '订单状态', logisticsStatus: '物流状态', createTime: '创建时间', createDate: '创建日期', gmtCreate: '创建时间', gmtModified: '更新时间', amount: '金额', totalAmount: '总金额', currency: '币种', buyerName: '买家', buyerCountry: '买家国家', country: '国家', countryCode: '国家代码',
    title: '标题', subject: '商品名称', productName: '商品名称', imageUrl: '图片', newImageUrl: '图片', prodImage: '图片', url: '链接', videoUrl: '视频', name: '名称', content: '正文', text: '文本', message: '消息', messageContent: '消息内容', msgContent: '消息内容', sendTime: '发送时间', senderName: '发送人', timestamp: '时间戳', unreadCount: '未读数',
    troProdCnt: 'TRO风险商品', repeatedComplaintProdCnt: '重复投诉商品', highFreqComplaintProdCnt: '高频投诉商品', forbidDescriptionRiskProdCnt: '禁限售描述风险', toRectifyTaskCnt: '整改超时', fraudOrderCnt: '欺诈订单', aiAutoRaiseUrl: '平台处理入口', violationType: '违规类型', violationReason: '违规原因', punishType: '处罚类型',
    statDate: '统计日期', shopUv: '访客', shop_uv: '访客', fb_mc_uv: '询盘人数', fb_uv: 'TM咨询人数', visitor_to_fb_rate: '商机转化率', supplyDemandRate: '供需比', supplyCnt: '供给量', demandCnt: '需求量', starLevel: '星等级', currentStarLevel: '当前星级', score: '评分', finalScore: '质量分', suggestions: '改进建议', actionList: '提升行动',
    channelType: '渠道', dimensionType: '指标', statisticsType: '周期', terminalType: '终端', buyerLevel: '买家等级', tags: '标签', description: '说明', productId: '商品编号', requestKey: '平台任务凭据', taskId: '平台任务编号', taskStatus: '任务状态', storyboardList: '分镜', storyboard: '分镜内容', seconds: '秒数', ratio: '画面比例', success: '平台返回成功', isSuccess: '业务成功', code: '状态码', resultCode: '结果码', msg: '说明', errorMsg: '错误说明',
  };
  const statusLabels = { queued: '等待执行', running: '执行中', submitted: '已提交平台', processing: '生成中', succeeded: '已完成', failed: '失败', unknown: '待核对', interrupted: '已中断' };
  /** 转义所有平台和用户文本。@param {*} value 文本。@returns {string} 安全HTML。@throws 无。 */
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  /** 只允许HTTP(S)链接。@param {*} value 地址。@returns {string} 可用地址或空。@throws 无。 */
  function url(value) { try { const u = new URL(String(value)); return ['https:', 'http:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } }
  /** 请求运营接口。@param {string} path 路径。@param {object} payload 请求体。@returns {Promise<object>} 响应。@throws 网络或业务错误。 */
  async function request(path, payload) {
    const response = await fetch(`/api/operations/${path}`, payload === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const value = await response.json();
    if (!response.ok || !value.ok) throw new Error(value.error || '请求失败');
    return value;
  }
  /** 构造查询。@param {string} action 查询名。@param {object} params 业务参数。@returns {Promise<object>} 数据。@throws 请求错误。 */
  const read = (action, params = {}) => request('read', { action, params });
  /** 递归查找业务字段。@param {*} data 数据。@param {string[]} names 字段。@returns {*} 值。@throws 无。 */
  function find(data, names, depth = 0) {
    if (!data || typeof data !== 'object' || depth > 12) return undefined;
    for (const k of names) if (data[k] !== undefined && data[k] !== null) return data[k];
    for (const v of Object.values(data)) { const found = find(v, names, depth + 1); if (found !== undefined) return found; }
  }
  /** 以可展开字段表保留完整返回值，不用模拟值补空缺。@param {*} data 数据。@param {number} depth 深度。@returns {string} HTML。@throws 无。 */
  function facts(data, depth = 0) {
    if (data === null || data === undefined || data === '') return '<span class="ops-muted">未返回</span>';
    if (typeof data !== 'object') {
      const link = url(data);
      if (link) return `<a href="${escape(link)}" target="_blank" rel="noopener noreferrer">打开${/\.(png|jpg|jpeg|webp)(\?|$)/i.test(link) ? '图片' : '结果'} ↗</a>`;
      return `<span class="ops-value">${escape(typeof data === 'boolean' ? (data ? '是' : '否') : data)}</span>`;
    }
    if (!Object.keys(data).length) return '<div class="ops-muted">本次查询没有记录</div>';
    if (Array.isArray(data)) return `<div class="ops-records">${data.map((row, i) => `<details ${data.length < 4 ? 'open' : ''}><summary>${escape(find(row, ['productTitle', 'subject', 'productName', 'buyerName', 'title', 'name', 'orderNo', 'tradeId']) || `记录 ${i + 1}`)}</summary>${facts(row, depth + 1)}</details>`).join('')}</div>`;
    const enumNames = { imageGenerate: '场景图', imageExtraction: '白底图', imageHighDefinition: '高清图', imageDetails: '细节图', marketingSellPoint: '营销卖点图', REPLACE: '替换', ADD: '新增' };
    return `<dl class="ops-facts">${Object.entries(data).map(([k, raw]) => {
      const v = ['abilityCode', 'operationType'].includes(k) ? enumNames[raw] || raw : raw;
      return `<div><dt>${escape(labels[k] || k)}</dt><dd>${depth > 1 && v && typeof v === 'object' ? `<details><summary>展开${Array.isArray(v) ? ` ${v.length} 项` : ''}</summary>${facts(v, depth + 1)}</details>` : facts(v, depth + 1)}</dd></div>`;
    }).join('')}</dl>`;
  }
  /** 业务概要优先展示，完整字段折叠保留。@param {string} name 查询名。@param {*} data 上游数据。@returns {string} HTML。@throws 无。 */
  function overview(name, data) {
    const count = (label, value) => `<article><span>${escape(label)}</span><strong>${escape(value ?? '未返回')}</strong></article>`;
    let content = '';
    if (name === 'orders' && Array.isArray(data?.tradeList)) {
      content = `<div class="ops-kpis">${count('匹配合同', data.totalCount)}${count('本页合同', data.tradeList.length)}</div><div class="tablewrap"><table><thead><tr><th>合同号</th><th>买家 / 国家</th><th>状态</th><th>创建日期</th><th>详情</th></tr></thead><tbody>${data.tradeList.map(row => `<tr><td>${escape(row.contractNumber || row.id)}</td><td>${escape(row.buyer?.participantName || row.buyer?.companyName || '未返回')}<small>${escape(row.buyer?.country || '')}</small></td><td>${escape(row.status?.status || row.status || '未返回')}</td><td>${escape(row.createDate)}</td><td><details><summary>查看合同</summary>${facts(row)}</details></td></tr>`).join('')}</tbody></table></div>`;
    } else if (name === 'logistics' && Array.isArray(data?.dataList)) {
      content = `<div class="ops-kpis">${count('匹配物流订单', data.total)}${count('本页物流订单', data.dataList.length)}</div><div class="tablewrap"><table><thead><tr><th>物流单号</th><th>货物</th><th>状态</th><th>目的国家</th><th>详情</th></tr></thead><tbody>${data.dataList.map(row => `<tr><td>${escape(row.orderNumber)}</td><td>${escape(row.cargoDesc || '未返回')}</td><td>${escape(row.orderStatusDesc || row.orderStatus)}</td><td>${escape(row.destinationCountryName || row.destinationCountryCode)}</td><td><details><summary>查看物流</summary>${facts(row)}</details></td></tr>`).join('')}</tbody></table></div>`;
    } else if (name === 'risk' && data && typeof data === 'object') {
      content = `<div class="ops-kpis">${['totalRiskProdCnt', 'troProdCnt', 'repeatedComplaintProdCnt', 'forbidDescriptionRiskProdCnt', 'toRectifyTaskCnt', 'fraudOrderCnt'].map(k => count(labels[k], data[k])).join('')}</div>`;
    } else if (name === 'stars' && data?.finalStar) {
      content = `<div class="ops-kpis">${count('当前展示星级', data.finalStar.displayLevelStar)}${count('当前评定星级', data.finalStar.pageLevelStar)}${count('统计日期', data.statDate)}</div>${(data.trackList || []).map(track => `<article class="ops-job"><h3>${escape(track.trackName)} · ${escape(track.star ?? '未返回')} 星</h3>${(track.abilityList || []).map(ability => `<details><summary>${escape(ability.abilityName)} · ${escape(ability.score ?? '未返回')} 分</summary>${facts({ adviceList: ability.adviceList, indicatorList: ability.indicatorList, tips: ability.tips })}</details>`).join('')}</article>`).join('')}`;
    } else if (name === 'messages' && Array.isArray(data?.messages)) {
      content = data.messages.map(message => `<article class="ops-message"><small>${message.timestamp ? escape(new Date(Number(message.timestamp)).toLocaleString()) : '时间未返回'} · ${message.isRead === true ? '已读' : message.isRead === false ? '未读' : '已读状态未返回'}</small><div>${facts(message.content)}</div></article>`).join('') || '<p class="ops-muted">本次没有消息</p>';
    } else if (name === 'channel-trend') {
      const rows = find(data, ['shop_uv', 'fb_mc_uv', 'fb_uv', 'visitor_to_fb_rate']);
      if (Array.isArray(rows)) {
        const keys = [...new Set(rows.flatMap(row => Object.keys(row)))];
        content = `<div class="tablewrap"><table><thead><tr>${keys.map(k => `<th>${escape(labels[k] || k)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${keys.map(k => `<td>${escape(row[k] ?? '未返回')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      }
    }
    return content ? `${content}<details class="ops-full-result"><summary>查看平台完整字段</summary>${facts(data)}</details>` : facts(data);
  }
  /** 业务卡片容器。@param {string} id DOM标识。@param {string} title 名称。@param {string} hint 说明。@param {string} content 内容。@returns {string} HTML。@throws 无。 */
  function card(id, title, hint, content = '') { return `<section class="card ops-card" id="${id}"><div class="card-hd"><div><h2>${title}</h2><div class="hint">${hint}</div></div></div><div class="ops-body">${content}</div></section>`; }
  /** 表单字段。@param {string} name 名称。@param {string} label 标签。@param {string} type 类型。@param {string} value 值。@returns {string} HTML。@throws 无。 */
  function input(name, label, type = 'text', value = '') { return `<label>${label}<input name="${name}" type="${type}" value="${escape(value)}"></label>`; }
  /** 多行业务输入。@param {string} name 名称。@param {string} label 标签。@param {string} hint 提示。@returns {string} HTML。@throws 无。 */
  function textarea(name, label, hint = '') { return `<label>${label}<textarea name="${name}" rows="3" placeholder="${hint}"></textarea></label>`; }
  /** 业务选择列表。@param {string} name 字段。@param {string} label 标签。@param {Array} options 值和名称。@returns {string} HTML。@throws 无。 */
  function select(name, label, options) { return `<label>${label}<select name="${name}">${options.map(([v, t]) => `<option value="${escape(v)}">${escape(t)}</option>`).join('')}</select></label>`; }
  /** 绑定异步按钮并显示局部错误。@param {Element} button 按钮。@param {Function} fn 操作。@param {Element} target 状态区域。@returns {void}。@throws 无，错误渲染到页面。 */
  function action(button, fn, target) {
    button.addEventListener('click', async event => {
      event.preventDefault(); if (button.disabled) return; button.disabled = true;
      try { await fn(); } catch (e) { if (target) target.innerHTML = `<p class="ops-error" role="alert">${escape(e.message)}</p>`; else toast(e.message, true); }
      finally { button.disabled = false; }
    });
  }
  /** 在局部区域显示真实查询。@param {Element} target 结果区。@param {string} name 查询名。@param {object} params 参数。@returns {Promise<object>} 结果。@throws 上游错误。 */
  async function query(target, name, params) {
    target.innerHTML = '<p class="ops-muted" role="status">正在读取当前账号数据…</p>';
    try {
      const response = await read(name, params);
      target.innerHTML = `<p class="ops-stamp">实时读取 · ${escape(new Date(response.fetchedAt).toLocaleString())}</p>${overview(name, response.data ?? response.items ?? response)}`;
      return response;
    } catch (e) { target.innerHTML = `<p class="ops-error" role="alert">${escape(e.message)}。请调整条件或再次查询。</p>`; throw e; }
  }
  /** 读取表单纯文本值。@param {Element} root 表单。@returns {object} 参数。@throws 无。 */
  function values(root) { return Object.fromEntries([...root.querySelectorAll('[name]')].map(el => [el.name, el.value.trim()])); }
  /** 商品选择器，用户无需填写内部编号。@param {Element} target 容器。@param {string} slot 选择状态名。@param {Function} onSelect 选择后动作。@returns {void}。@throws 无，查询错误显示。 */
  function picker(target, slot, onSelect = () => {}) {
    let page = 1, total = null;
    target.innerHTML = `<div class="ops-picker"><div class="ops-form">${input('query', '选择店铺商品')}<button type="button" class="ghost ops-search">搜索商品</button></div><div class="ops-products"></div><div class="ops-actions"><button class="ghost ops-prev">上一页</button><span class="ops-page"></span><button class="ghost ops-next">下一页</button></div><div class="ops-selected">尚未选择商品</div></div>`;
    const list = target.querySelector('.ops-products');
    const load = async () => {
      list.innerHTML = '<p class="ops-muted">正在读取商品…</p>';
      const response = await read('products', { query: target.querySelector('[name=query]').value, page }); total = response.total;
      list.innerHTML = response.items.length ? response.items.map((p, i) => `<button type="button" class="ops-product" data-index="${i}">${url(p.image) ? `<img src="${escape(url(p.image))}" alt="" loading="lazy">` : ''}<span>${escape(p.title)}<small>${escape(p.category)} · 曝光 ${escape(p.exposure ?? '未返回')} · 点击 ${escape(p.clicks ?? '未返回')}</small></span></button>`).join('') : '<p class="ops-muted">没有匹配商品，请换个名称搜索</p>';
      target.querySelector('.ops-page').textContent = `第 ${page} 页${total !== null ? ` / 共 ${total} 件` : ''}`;
      target.querySelector('.ops-prev').disabled = page === 1;
      target.querySelector('.ops-next').disabled = response.items.length < 20 || (total !== null && page * 20 >= total);
      list.querySelectorAll('[data-index]').forEach(button => action(button, async () => {
        const p = response.items[Number(button.dataset.index)]; state.selected[slot] = p;
        target.querySelector('.ops-selected').textContent = `已选：${p.title}`;
        await onSelect(p);
      }));
    };
    action(target.querySelector('.ops-search'), () => { page = 1; return load(); }, list);
    action(target.querySelector('.ops-prev'), () => { page--; return load(); }, list);
    action(target.querySelector('.ops-next'), () => { page++; return load(); }, list);
    load().catch(e => { list.innerHTML = `<p class="ops-error">${escape(e.message)}</p>`; });
  }
  /** 取已选商品的短期引用。@param {string} slot 名称。@returns {string} 引用。@throws 未选择。 */
  function productRef(slot) { if (!state.selected[slot]) throw new Error('请先选择店铺商品'); return state.selected[slot].ref; }

  /** 用户查看具体变化后确认；同一对话框网络重试复用请求标识。@param {string} operation 操作名。@param {object} params 参数。@param {string} summary 影响说明。@param {string} ref 商品引用。@returns {Promise<object|null>} 新任务或取消。@throws 无，错误保留在对话框。 */
  function confirmWrite(operation, params, summary, ref) {
    return new Promise(resolve => {
      const dialog = document.createElement('dialog'); dialog.className = 'ops-confirm';
      dialog.innerHTML = `<form method="dialog"><h2>确认本次操作</h2><p>${escape(summary)}</p><div class="ops-confirm-content">${facts(operation === 'submit-edit' ? { description: '提交上方已核对的最新商品草稿' } : params)}</div><label class="ops-check"><input type="checkbox">我已核对以上内容，确认执行${['image-generate', 'image-color', 'image-model', 'image-translate', 'storyboard', 'video'].includes(operation) ? '并知晓可能消耗平台额度' : ''}</label><div class="ops-error" role="alert"></div><div class="ops-actions"><button type="button" class="ghost ops-cancel">取消</button><button type="button" class="primary ops-confirm-go" disabled>确认执行</button></div></form>`;
      document.body.appendChild(dialog); dialog.showModal();
      const key = crypto.randomUUID(), go = dialog.querySelector('.ops-confirm-go');
      let busy = false;
      const finish = result => { dialog.close(); dialog.remove(); resolve(result); };
      dialog.querySelector('input').onchange = event => { go.disabled = !event.target.checked || busy; };
      dialog.querySelector('.ops-cancel').onclick = () => { if (!busy) finish(null); };
      dialog.addEventListener('cancel', event => { event.preventDefault(); if (!busy) finish(null); });
      go.onclick = async () => {
        busy = true; go.disabled = true;
        try {
          const response = await request('jobs', { action: operation, params, productRef: ref, idempotencyKey: key, confirmed: true, acknowledgement: 'CONFIRM_OPERATIONS_WRITE' });
          finish(response.job); await refreshJobs();
        } catch (e) { dialog.querySelector('.ops-error').textContent = `${e.message}。再次点击会复用本次请求标识。`; }
        finally { busy = false; go.disabled = !dialog.querySelector('input')?.checked; }
      };
    });
  }
  /** 渲染可恢复的任务列表。@returns {Promise<void>}。@throws 网络错误。 */
  async function refreshJobs() {
    if (!document.querySelector('.ops-jobs')) return;
    const response = await request('jobs'); state.jobs = response.jobs;
    document.querySelectorAll('.ops-jobs').forEach(root => {
      const filter = root.dataset.kind;
      const rows = state.jobs.filter(j => filter === 'assets' ? /^(image|video|storyboard)/.test(j.action) : !/^(image|video|storyboard)/.test(j.action));
      root.innerHTML = rows.length ? rows.map(job => `<article class="ops-job"><div><strong>${escape(job.label)}</strong><span class="ops-badge ${job.status}">${escape(statusLabels[job.status] || job.status)}</span></div><p>${escape(job.title)}</p><p>${escape(job.message)}</p><small>${escape(new Date(job.createdAt).toLocaleString())} · ${job.completedSteps}/${job.totalSteps} 步</small>${job.pollError ? `<p class="ops-error">结果查询：${escape(job.pollError)}；可再次查询，不会重复创建任务。</p>` : ''}<div class="ops-media">${(job.urls || []).map(link => job.action === 'video' ? `<video src="${escape(url(link))}" controls preload="metadata"></video><a href="${escape(url(link))}" target="_blank" rel="noopener">打开视频</a>` : `<a href="${escape(url(link))}" target="_blank" rel="noopener"><img src="${escape(url(link))}" alt="生成结果" loading="lazy"></a>`).join('')}</div><div class="ops-actions">${job.canPoll ? `<button class="ghost" data-poll="${job.id}">查询生成结果</button>` : ''}${job.action === 'save-edit' && job.status === 'succeeded' ? `<button class="primary" data-submit-edit="${job.id}">确认提交此草稿</button>` : ''}${job.action === 'storyboard' && job.status === 'succeeded' ? `<button class="ghost" data-use-storyboard="${job.id}">带入分镜编辑器</button>` : ''}</div>${job.result ? `<details><summary>查看平台完整结果</summary>${facts(job.result)}</details>` : ''}</article>`).join('') : '<p class="ops-muted">暂无任务。确认操作后，这里显示进度与平台结果。</p>';
      root.querySelectorAll('[data-poll]').forEach(button => action(button, async () => { await request(`jobs/${button.dataset.poll}/poll`, {}); await refreshJobs(); }));
      root.querySelectorAll('[data-submit-edit]').forEach(button => action(button, async () => {
        const job = state.jobs.find(j => j.id === button.dataset.submitEdit);
        const chosen = state.selected.optimize;
        if (!chosen) throw new Error('请先在上方重新选择这件商品，系统会核对草稿归属');
        await confirmWrite('submit-edit', { savedJobId: job.id }, `将“${job.title}”的已保存草稿提交平台。审核通过或即时生效后会改变线上商品。`, productRef('optimize'));
      }));
      root.querySelectorAll('[data-use-storyboard]').forEach(button => action(button, async () => {
        const job = state.jobs.find(j => j.id === button.dataset.useStoryboard);
        const shots = find(job.result, ['storyboardList']);
        if (!Array.isArray(shots) || !shots.length) throw new Error('平台未返回可带入的分镜列表');
        const editor = document.querySelector('#ops-video [name=shots]');
        if (!editor) throw new Error('请打开素材工坊的视频编辑器');
        editor.value = shots.map(s => `${s.seconds} | ${s.storyboard}`).join('\n');
        editor.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }));
    });
  }
  /** 安装实时订单和物流页面。@returns {void}。@throws 无。 */
  function orders() {
    const root = document.querySelector('#blueprint-orders');
    root.innerHTML = `<div class="ops-heading"><h1>订单与物流</h1><p>按当前账号实时核对合同、发货状态和关税测算。</p></div>${card('ops-orders', '交易合同', '日期与状态筛选作用于平台查询', `<div class="ops-form">${input('from', '创建开始日期', 'date', dates().startDate)}${input('to', '创建结束日期', 'date', dates().endDate)}${select('status', '物流状态', [['', '全部'], ['not_shipped', '未发货'], ['shipped', '已发货'], ['in_transit', '运输中'], ['delivered', '已送达']])}<button class="primary ops-query">查询合同</button></div><div class="ops-result"></div><div class="ops-actions"><button class="ghost ops-prev">上一页</button><span class="ops-page"></span><button class="ghost ops-next">下一页</button></div>`)}${card('ops-logistics', '物流订单', '状态、物流订单号和信保单号可组合查询', `<div class="ops-form">${input('number', '物流订单号（可选）')}${input('tradeBizId', '信保单号（可选）')}${select('status', '状态', [['', '全部'], ['TRANSPORTING', '运输中'], ['DELIVERY_SUCCESS', '派送成功'], ['DELIVERY_FAIL', '派送失败'], ['WAIT_ENTER_WAREHOUSE', '待入库'], ['WAIT_LEAVE_WAREHOUSE', '待出库'], ['TERMINATED', '终止'], ['CLOSED', '关闭']])}<button class="primary ops-query">查询物流</button></div><div class="ops-result"></div><div class="ops-actions"><button class="ghost ops-prev">上一页</button><span class="ops-page"></span><button class="ghost ops-next">下一页</button></div>`)}${card('ops-tariff', '商品关税测算', '选择商品与起运、目的国家，显示平台返回的测算依据', `<div class="ops-tariff-picker"></div><div class="ops-form">${input('originCountryCode', '起运国家代码', 'text', 'CN')}${input('destinationCountryCode', '目的国家代码', 'text', 'US')}<button class="primary">测算关税</button></div><div class="ops-result"></div>`)}`;
    for (const [id, endpoint] of [['ops-orders', 'orders'], ['ops-logistics', 'logistics']]) {
      const section = document.getElementById(id), result = section.querySelector('.ops-result'); let page = 1;
      const run = async () => {
        const v = values(section); let params;
        if (endpoint === 'orders') {
          if (v.from && v.to && v.from > v.to) throw new Error('开始日期不能晚于结束日期');
          params = { start: (page - 1) * 20, limit: 20, ...(v.from ? { createDateFrom: `${v.from} 00:00:00` } : {}), ...(v.to ? { createDateTo: `${v.to} 23:59:59` } : {}), ...(v.status ? { logisticsStatus: v.status } : {}) };
        } else params = { currentPage: page, pageSize: 20, ...(v.number ? { number: v.number } : {}), ...(v.tradeBizId ? { tradeBizId: v.tradeBizId } : {}), ...(v.status ? { statusList: [v.status] } : {}) };
        const response = await query(result, endpoint, params);
        const total = response.data?.totalCount ?? response.data?.total;
        section.querySelector('.ops-next').disabled = total !== undefined && page * 20 >= total;
        section.querySelector('.ops-page').textContent = `第 ${page} 页 · 每页最多20条`;
        section.querySelector('.ops-prev').disabled = page === 1;
      };
      action(section.querySelector('.ops-query'), () => { page = 1; return run(); }, result);
      action(section.querySelector('.ops-prev'), () => { page = Math.max(1, page - 1); return run(); }, result);
      action(section.querySelector('.ops-next'), () => { page++; return run(); }, result);
      run().catch(() => {});
    }
    const tariff = document.querySelector('#ops-tariff'); picker(tariff.querySelector('.ops-tariff-picker'), 'tariff');
    action(tariff.querySelector('button.primary'), () => { const v = values(tariff); return query(tariff.querySelector('.ops-result'), 'tariff', { productRef: productRef('tariff'), originCountryCode: v.originCountryCode.toUpperCase(), destinationCountryCode: v.destinationCountryCode.toUpperCase() }); }, tariff.querySelector('.ops-result'));
  }
  /** 安装实时风控与违规查询。@returns {void}。@throws 无。 */
  function risk() {
    const root = document.querySelector('#blueprint-risk');
    root.innerHTML = `<div class="ops-heading"><h1>风险合规</h1><p>当前账号风险诊断与违规记录；每个结果独立显示读取状态。</p></div>${card('ops-risk', '店铺风险诊断', '查看风险数量、检测时间与平台处理入口', '<button class="primary">重新诊断</button><div class="ops-result"></div>')}${card('ops-violations', '违规记录', '查询商品与店铺实际违规记录', `<div class="ops-form">${input('startDate', '开始日期', 'date', dates().startDate)}${input('endDate', '结束日期', 'date', dates().endDate)}${input('violationType', '违规类型（可选）')}<button class="primary" data-kind="product-violations">商品违规</button><button class="ghost" data-kind="shop-violations">店铺违规</button></div><div class="ops-result"></div>`)}`;
    const diagnosis = root.querySelector('#ops-risk .ops-result');
    action(root.querySelector('#ops-risk button'), () => query(diagnosis, 'risk', {}), diagnosis);
    root.querySelectorAll('[data-kind]').forEach(button => action(button, () => { const v = values(root.querySelector('#ops-violations')); return query(root.querySelector('#ops-violations .ops-result'), button.dataset.kind, { ...Object.fromEntries(Object.entries(v).filter(([, x]) => x)), limit: 50, language: 'zh_CN' }); }, root.querySelector('#ops-violations .ops-result')));
    query(diagnosis, 'risk', {}).catch(() => {});
  }
  /** 已有商品整改表单；保存与正式提交分别确认。@returns {void}。@throws 无。 */
  function optimize() {
    if (document.querySelector('#ops-optimize')) return;
    document.querySelector('#tab-product').insertAdjacentHTML('beforeend', card('ops-optimize', '优化已有商品', '查看当前内容与诊断，填写需要修改的字段；保存草稿后单独确认提交', `<p class="ops-edit-selected"></p><div class="ops-actions"><button class="ghost ops-original">读取线上内容</button><button class="ghost ops-draft">读取平台草稿</button><button class="ghost ops-score">查询质量诊断</button></div><div class="ops-original-result"></div><div class="ops-form ops-edit-form">${textarea('productTitle', '商品标题')}${textarea('productKeywords', '商品关键词')}${textarea('productSellingPoint', '商品卖点')}${textarea('companyDesc', '公司介绍')}${input('originalImageUrl', '要替换的原图地址（读取线上内容后可选择）', 'url')}${input('newImageUrl', '替换后的图片地址', 'url')}${textarea('question', '新增FAQ问题')}${textarea('answer', '新增FAQ答案')}</div><div class="ops-actions"><button class="primary ops-save">查看修改并保存草稿</button><button class="ghost ops-auto">提交平台诊断优化</button></div><div class="ops-error ops-edit-error"></div><h3>优化任务记录</h3><div class="ops-jobs" data-kind="optimize"></div>`));
    const root = document.querySelector('#ops-optimize'), result = root.querySelector('.ops-original-result');
    const dialog = document.createElement('dialog'); dialog.id = 'productEditDialog'; dialog.className = 'product-edit-dialog';
    dialog.setAttribute('aria-label', '修改商品内容');
    document.body.appendChild(dialog); dialog.appendChild(root);
    root.querySelector('.card-hd').insertAdjacentHTML('beforeend', '<button type="button" class="ghost ops-close-editor" aria-label="关闭商品修改">关闭</button>');
    root.querySelector('.ops-close-editor').onclick = () => dialog.close();
    // 刷新任务记录仍在页面上可见，关闭编辑弹窗后也能继续确认提交。
    const history = document.createElement('section'); history.className = 'card product-edit-history';
    history.innerHTML = '<div class="card-hd"><h2>优化任务记录</h2></div><div class="ops-body"></div>';
    history.querySelector('.ops-body').appendChild(root.querySelector('.ops-jobs'));
    root.querySelector('.ops-body>h3').remove(); document.querySelector('#tab-product').appendChild(history);
    // 复用已有字段和事件，只调整容器，避免布局改动改变保存参数。
    const form = root.querySelector('.ops-edit-form');
    const workspace = document.createElement('div'); workspace.className = 'ops-publish-layout';
    form.before(workspace);
    const navigation = document.createElement('nav'); navigation.className = 'ops-publish-nav'; navigation.setAttribute('aria-label', '商品编辑分区');
    workspace.append(navigation, form);
    const sections = [
      ['images', '产品图片', ['originalImageUrl', 'newImageUrl']],
      ['basic', '基础信息', ['productTitle', 'productKeywords']],
      ['attributes', '类目属性', []], ['trade', '交易信息', []], ['fulfillment', '履约与包装', []],
      ['detail', '商品详情', ['productSellingPoint', 'companyDesc', 'question', 'answer']],
    ];
    sections.forEach(([key, title, names], index) => {
      const section = document.createElement('section'); section.id = `ops-edit-section-${key}`; section.className = 'ops-publish-section';
      section.innerHTML = `<h3><span>${String(index + 1).padStart(2, '0')}</span>${title}${['attributes','trade','fulfillment'].includes(key) ? '<small>当前资料 · 只读</small>' : ''}</h3><div class="ops-section-fields"></div>`;
      names.forEach(name => section.querySelector('.ops-section-fields').appendChild(form.querySelector(`[name="${name}"]`).closest('label')));
      if (key === 'images') section.querySelector('.ops-section-fields').before(result);
      if (['attributes','trade','fulfillment','detail'].includes(key)) section.insertAdjacentHTML('beforeend', `<div class="ops-read-${key}"></div>`);
      form.appendChild(section);
      const button = document.createElement('button'); button.type = 'button'; button.innerHTML = `<span>${String(index+1).padStart(2,'0')}</span>${title}`;
      button.addEventListener('click', () => { section.scrollIntoView({behavior:'smooth', block:'start'}); });
      navigation.appendChild(button);
    });
    // 滚动时同步左侧当前分区；观察范围限定在右侧表单。
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting).sort((a,b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (!visible) return;
      const index = sections.findIndex(([key]) => visible.target.id === `ops-edit-section-${key}`);
      [...navigation.children].forEach((button,i) => { button.classList.toggle('is-active', i === index); if(i === index) button.setAttribute('aria-current','location'); else button.removeAttribute('aria-current'); });
    }, {root:form, rootMargin:'0px 0px -65% 0px', threshold:0});
    form.querySelectorAll('.ops-publish-section').forEach(section => observer.observe(section));
    const footer = document.createElement('footer'); footer.className = 'ops-publish-footer';
    footer.innerHTML = '<span>修改当前商品<small>保存草稿后，仍需单独确认提交</small></span>';
    footer.appendChild(root.querySelector('.ops-save').closest('.ops-actions'));
    footer.appendChild(root.querySelector('.ops-edit-error')); root.appendChild(footer);
    let loadVersion = 0, baseline = {}, loadedRef = null;
    /** 读取当前商品并填充编辑字段。版本号隔离快速切换，加载中禁用保存。
     * @param {string} version trunk 线上或 draft 草稿。@returns {Promise<void>}。@throws 无，错误就地展示。
     */
    const info = async version => {
      const ref = productRef('optimize'), sequence = ++loadVersion;
      loadedRef = null; baseline = {};
      root.querySelectorAll('[class^=ops-read-]').forEach(area => { area.innerHTML = '<p class="ops-muted">正在读取当前资料…</p>'; });
      root.querySelector('.ops-save').disabled = true;
      const fields = [...root.querySelectorAll('.ops-edit-form input,.ops-edit-form textarea')];
      fields.forEach(field => { field.disabled = true; field.value = ''; });
      result.innerHTML = '<p class="ops-muted">正在读取标题、图片、属性、交易与履约信息…</p>';
      try {
        const response = await read('product-info', { productRef: ref, queryType: version });
        if (state.selected.optimize?.ref !== ref || sequence !== loadVersion) return;
        const data = response.data || {}, basic = data.basicInfo || {}, detail = data.detail || {};
        for (const key of ['productTitle', 'productKeywords', 'productSellingPoint', 'companyDesc']) {
          const value = key in basic ? basic[key] : detail[key];
          baseline[key] = typeof value === 'string' ? value : Array.isArray(value) && value.every(item => typeof item === 'string') ? value.join('\n') : '';
          const field = root.querySelector(`[name="${key}"]`); field.value = baseline[key];
          field.placeholder = value === undefined ? '平台未返回，可补充填写' : '当前为空，可补充填写';
        }
        const pictures = (Array.isArray(basic.images) ? basic.images : []).map(image => url(image.originalImageUrl || image.imageUrl)).filter(Boolean);
        const detailPictures = (Array.isArray(detail.detailImage) ? detail.detailImage : []).map(image => url(image.originalImageUrl || image.imageUrl)).filter(Boolean);
        // 主图直接展示，属性、交易与履约使用只读字段，避免误用不支持的修改接口。
        result.innerHTML = `<h3>产品图片</h3><div class="ops-current-gallery">${pictures.map((u,i) => `<button type="button" data-current-image="${i}" aria-label="选择第 ${i+1} 张主图替换"><img src="${escape(u)}" alt="商品图片 ${i+1}"><span>${i === 0 ? '主图' : `图片 ${i+1}`}</span></button>`).join('') || '<p class="ops-muted">平台未返回产品图片</p>'}</div><p class="ops-muted">点击图片可选择替换；下方已填入当前商品内容。</p>`;
        root.querySelector('.ops-product-reference')?.remove();
        const reference = document.createElement('section'); reference.className = 'ops-product-reference';
        reference.innerHTML = `<h3>商品属性与交易资料 <small>当前信息</small></h3><div class="ops-reference-columns"><section><h4>商品属性</h4>${Array.isArray(basic.attr ?? data.attr) ? `<dl class="ops-facts">${(basic.attr ?? data.attr).map(attr => `<div><dt>${escape(attr.attrName || '属性')}</dt><dd>${escape(attr.attrValue ?? '未返回')}</dd></div>`).join('')}</dl>` : facts(basic.attr ?? data.attr)}</section><section><h4>价格与交易</h4>${facts(Object.fromEntries(Object.entries(data.trade || {}).filter(([key]) => key !== 'featureMap')))}</section><section><h4>包装与履约</h4>${facts(Object.fromEntries(Object.entries(data.fulfillment || {}).filter(([key]) => !['featureMap', 'shippingTemplateId'].includes(key))))}</section></div><details><summary>商品详情图片（${detailPictures.length}）</summary><div class="ops-current-gallery">${detailPictures.map(u => `<img src="${escape(u)}" alt="商品详情图" loading="lazy">`).join('')}</div></details><details><summary>已有常见问答</summary>${facts(detail.faqs)}</details>`;
        const blocks = reference.querySelectorAll('.ops-reference-columns>section');
        ['attributes','trade','fulfillment'].forEach((key,index) => {
          blocks[index].querySelector('h4').remove();
          root.querySelector(`.ops-read-${key}`).replaceChildren(...blocks[index].childNodes);
        });
        root.querySelector('.ops-read-detail').replaceChildren(...reference.querySelectorAll(':scope>details'));
        result.querySelectorAll('[data-current-image]').forEach(button => button.addEventListener('click', () => {
          root.querySelector('[name=originalImageUrl]').value = pictures[Number(button.dataset.currentImage)];
          result.querySelectorAll('[data-current-image]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
        }));
        loadedRef = ref;
      } catch (error) {
        if (state.selected.optimize?.ref === ref && sequence === loadVersion) result.innerHTML = `<p class="ops-error">${escape(error.message)}，请重新读取。</p>`;
      } finally {
        if (state.selected.optimize?.ref === ref && sequence === loadVersion) {
          fields.forEach(field => { field.disabled = !loadedRef; });
          root.querySelector('.ops-save').disabled = !loadedRef;
        }
      }
    };
    root.loadProductInfo = info;
    root.querySelector('.ops-original').onclick = () => { void info('trunk'); };
    root.querySelector('.ops-draft').onclick = () => { void info('draft'); };
    const scoreResult = document.createElement('div'); scoreResult.className = 'ops-score-result'; result.after(scoreResult);
    action(root.querySelector('.ops-score'), () => query(scoreResult, 'product-score', { productRef: productRef('optimize') }), scoreResult);
    action(root.querySelector('.ops-save'), async () => {
      if (loadedRef !== productRef('optimize')) throw new Error('请等待当前产品信息读取完成');
      const v = values(root.querySelector('.ops-edit-form')), basic = {}, detail = {};
      for (const key of Object.keys(baseline)) {
        if (v[key] === baseline[key].trim()) delete v[key];
        else if (!v[key]) throw new Error('当前接口不支持清空已有内容，请填写替换内容');
      }
      for (const k of ['productTitle', 'productKeywords']) if (v[k]) basic[k] = v[k];
      for (const k of ['productSellingPoint', 'companyDesc']) if (v[k]) detail[k] = v[k];
      if (v.newImageUrl) {
        if (!v.originalImageUrl || !v.newImageUrl) throw new Error('替换图片需同时指定原图与新图');
        basic.images = [{ operationType: 'REPLACE', originalImageUrl: v.originalImageUrl, newImageUrl: v.newImageUrl }];
      }
      if (v.question || v.answer) { if (!v.question || !v.answer) throw new Error('FAQ需同时填写问题和答案'); detail.faqs = [{ operationType: 'ADD', question: v.question, answer: v.answer }]; }
      if (!Object.keys(basic).length && !Object.keys(detail).length) throw new Error('尚未修改商品内容');
      await confirmWrite('save-edit', { basic, detail }, `保存“${state.selected.optimize?.title || ''}”的优化草稿。仅覆盖下列填写的字段，保存后仍需单独确认提交。`, productRef('optimize'));
    }, root.querySelector('.ops-edit-error'));
    action(root.querySelector('.ops-auto'), () => confirmWrite('diagnosis-optimize', {}, `请先查看上方质量诊断。将“${state.selected.optimize?.title || ''}”提交平台自动诊断优化，平台可能调整商品内容。`, productRef('optimize')), root.querySelector('.ops-edit-error'));
    refreshJobs().catch(() => {});
  }
  /** 素材生产工作台：真实生成、分镜编辑与结果轮询。@returns {void}。@throws 无。 */
  function assets() {
    const root = document.querySelector('#blueprint-assets');
    root.innerHTML = `<div class="ops-heading"><h1>素材工坊</h1><p>选择商品图片，确认创作要求，再查看真实生成结果。</p></div>${card('ops-asset-source', '选择原始素材', '使用店铺已有图片，或粘贴可公开访问的 HTTPS 图片地址', '<div class="ops-asset-picker"></div>')}${card('ops-image', '商品图片创作', '场景图、白底图、高清图、换色、模特图和图片翻译', `<div class="ops-form">${select('mode', '创作类型', [['imageGenerate', '场景图'], ['imageExtraction', '白底图'], ['imageHighDefinition', '高清图'], ['imageDetails', '细节图'], ['marketingSellPoint', '营销卖点图'], ['color', '图片换色'], ['model', '模特图'], ['translate', '图片翻译']])}${input('imageUrl', '原始图片地址', 'url')}${textarea('prompt', '创作要求')}${input('hexColor', '换色色卡', 'color', '#ff6600')}${input('modelImageUrl', '参考模特图片（可选）', 'url')}${select('targetLang', '翻译目标语言', [['en', '英语'], ['es', '西班牙语'], ['fr', '法语'], ['de', '德语'], ['ar', '阿拉伯语'], ['pt', '葡萄牙语'], ['ja', '日语']])}<button class="primary">查看要求并开始创作</button></div><div class="ops-error"></div>`)}${card('ops-video', '商品视频', '生成分镜后可逐行调整，再单独确认生成视频', `<div class="ops-form">${input('imageUrl', '参考图片地址（可选）', 'url')}${textarea('userInput', '视频创作要求')}${select('ratio', '画面比例', [['16:9', '横屏 16:9'], ['9:16', '竖屏 9:16'], ['1:1', '方形 1:1']])}<button class="ghost ops-storyboard">生成分镜方案</button>${textarea('shots', '分镜：每行“秒数 | 画面描述”', '5 | 展示商品外观与细节\n5 | 展示实际使用场景')}<button class="primary ops-video-submit">确认分镜并生成视频</button></div><div class="ops-error"></div>`)}${card('ops-asset-jobs', '创作任务与产物', '任务记录会保留；查询结果不会重复创建或扣费', '<button class="ghost ops-refresh-jobs">刷新任务记录</button><div class="ops-jobs" data-kind="assets"></div>')}`;
    const sourceGallery = document.createElement('div'); sourceGallery.className = 'ops-media';
    root.querySelector('#ops-asset-source .ops-body').appendChild(sourceGallery);
    picker(root.querySelector('.ops-asset-picker'), 'assets', async p => {
      document.querySelector('#ops-image [name=imageUrl]').value = '';
      document.querySelector('#ops-video [name=imageUrl]').value = '';
      sourceGallery.innerHTML = '<p>正在读取商品原图…</p>';
      try {
        const response = await read('product-info', { productRef: p.ref, queryType: 'trunk' });
        const images = find(response.data, ['images']) || [];
        const urls = images.map(image => url(image.originalImageUrl || image.imageUrl || image.newImageUrl)).filter(Boolean);
        if (!urls.length) throw new Error('该商品没有返回原图，请手动提供高清图片地址');
        sourceGallery.innerHTML = urls.map((u, i) => `<button type="button" data-source-image="${i}"><img src="${escape(u)}" alt="使用原图 ${i + 1}"></button>`).join('');
        sourceGallery.querySelectorAll('button').forEach((button, index) => { button.onclick = () => {
          document.querySelector('#ops-image [name=imageUrl]').value = urls[index];
          document.querySelector('#ops-video [name=imageUrl]').value = urls[index];
          sourceGallery.querySelectorAll('button').forEach(b => { b.setAttribute('aria-pressed', String(b === button)); });
        }; });
        sourceGallery.querySelector('button').click();
      } catch (e) { sourceGallery.innerHTML = `<p class="ops-error">${escape(e.message)}</p>`; }
    });
    const image = root.querySelector('#ops-image');
    const updateFields = () => {
      const mode = image.querySelector('[name=mode]').value;
      image.querySelector('[name=hexColor]').closest('label').hidden = mode !== 'color';
      image.querySelector('[name=modelImageUrl]').closest('label').hidden = mode !== 'model';
      image.querySelector('[name=targetLang]').closest('label').hidden = mode !== 'translate';
      image.querySelector('[name=prompt]').closest('label').hidden = mode === 'translate';
    };
    image.querySelector('[name=mode]').onchange = updateFields; updateFields();
    action(image.querySelector('button.primary'), async () => {
      const v = values(image); let operation = 'image-generate', params = { abilityCode: v.mode, imageUrl: v.imageUrl, prompt: v.prompt };
      if (v.mode === 'color') { operation = 'image-color'; params = { imageUrl: v.imageUrl, prompt: v.prompt, hexColor: v.hexColor }; }
      if (v.mode === 'model') { operation = 'image-model'; params = { imageUrl: v.imageUrl, prompt: v.prompt, ...(v.modelImageUrl ? { modelImageUrl: v.modelImageUrl } : {}) }; }
      if (v.mode === 'translate') { operation = 'image-translate'; params = { imageUrl: v.imageUrl, targetLang: v.targetLang }; }
      if (!v.imageUrl) throw new Error('请选择或填写原始图片');
      await confirmWrite(operation, params, '将在当前账号创建图片任务，可能消耗平台额度。生成结果会保存在下方任务记录中。');
    }, image.querySelector('.ops-error'));
    const video = root.querySelector('#ops-video');
    action(video.querySelector('.ops-storyboard'), () => { const v = values(video); return confirmWrite('storyboard', { userInput: v.userInput, ...(v.imageUrl ? { inputImgUrls: [v.imageUrl] } : {}) }, '根据以下要求生成视频分镜方案，完成后可带入编辑器修改。'); }, video.querySelector('.ops-error'));
    action(video.querySelector('.ops-video-submit'), () => {
      const v = values(video); const shots = v.shots.split('\n').filter(s => s.trim()).map(line => { const split = line.indexOf('|'); if (split < 0) throw new Error('分镜每行使用“秒数 | 画面描述”'); return { seconds: line.slice(0, split).trim(), storyboard: line.slice(split + 1).trim() }; });
      return confirmWrite('video', { ratio: v.ratio, storyboardList: shots, ...(v.imageUrl ? { inputImgUrls: [v.imageUrl] } : {}) }, '按下列分镜生成视频，可能消耗平台额度。请确认画面内容和时长。');
    }, video.querySelector('.ops-error'));
    action(root.querySelector('.ops-refresh-jobs'), refreshJobs);
    const library = document.createElement('div');
    library.innerHTML = card('ops-asset-library', '店铺素材与3D资产', '继续查看已有商品、自有模型与公共模型库', '<button class="ghost">读取素材库</button><div class="ops-result"></div>');
    root.appendChild(library);
    action(library.querySelector('button'), async () => {
      const target = library.querySelector('.ops-result'); target.innerHTML = '<p>正在读取素材库…</p>';
      const response = await fetch('/api/workspaces/assets').then(r => r.json());
      if (!response.ok) throw new Error(response.error || '素材库读取失败');
      target.innerHTML = facts(response.data);
    }, library.querySelector('.ops-result'));
    refreshJobs().catch(() => {});
  }
  /** 实时客户上下文，列表提供会话关联键。@returns {void}。@throws 无。 */
  function customers() {
    if (document.querySelector('#ops-customer')) {
      document.querySelector('[data-customer-view=analysis]').click();
      return;
    }
    const page = document.querySelector('#tab-visitor');
    page.insertAdjacentHTML('beforeend', `<section id="ops-customer" class="customer-workbench ops-body" hidden>
      <aside class="customer-directory"><header><h2>最近会话</h2><button class="ghost ops-load-conversations">刷新</button></header>
        <label class="customer-search"><i class="ri-search-line" aria-hidden="true"></i><input aria-label="搜索已加载的客户" placeholder="搜索姓名、国家或消息"></label>
        <div class="ops-conversations" aria-label="客户列表"></div><footer><button class="ghost ops-older-conversations" disabled>加载更早会话</button></footer></aside>
      <section class="customer-thread"><header><div><h2 class="ops-customer-name">选择一位客户</h2><p class="customer-thread-sub">在左侧选择会话，查看沟通记录</p></div><button class="ghost ops-messages" disabled>刷新消息</button></header>
        <div class="customer-message-scroll"><button class="ghost ops-older-messages" disabled>加载更早消息</button><div class="ops-customer-result" aria-live="polite"><div class="customer-empty"><i class="ri-chat-3-line" aria-hidden="true"></i><h3>让每次沟通都有上下文</h3><p>消息记录和买家背景将在这里同步展开</p></div></div></div><footer>会话记录 · 仅查看</footer></section>
      <aside class="customer-context"><header><h2>客户背景</h2><button class="ghost ops-buyer" disabled>刷新</button></header><div class="customer-context-scroll"><div class="ops-buyer-result" aria-live="polite"><p class="ops-muted">选择客户后自动读取买家画像</p></div>
        <details class="customer-product-panel"><summary>查看商品资料 <span>规格 / 价格 / 履约</span></summary><div class="ops-knowledge-picker"></div><div class="ops-form">${input('buyer_country_code', '买家国家代码', 'text', '')}<button class="ghost ops-product-query">查询商品资料</button></div><div class="ops-product-result"></div></details>
        <details class="customer-seller-panel"><summary>商家资料</summary><button class="ghost ops-seller">读取商家资料</button><div class="ops-seller-result"></div></details></div></aside></section>`);
    const root = page.querySelector('#ops-customer'), list = root.querySelector('.ops-conversations');
    const result = root.querySelector('.ops-customer-result'), background = root.querySelector('.ops-buyer-result');
    let conversations = [], selected = null, selectionVersion = 0, messageRows = [], messageVersion = 0, buyerVersion = 0;
    /** 切换同页工作台与分析视图。@param {string} view 视图名称。@returns {void}。@throws 无。 */
    const switchView = view => {
      root.hidden = view !== 'work'; page.querySelector('#customerAnalysis').hidden = view !== 'analysis';
      page.querySelectorAll('[data-customer-view]').forEach(button => {
        const active = button.dataset.customerView === view;
        button.classList.toggle('is-active', active); button.setAttribute('aria-pressed', String(active));
      });
    };
    page.querySelectorAll('[data-customer-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.customerView)));
    /** 将平台时间安全转换为本地日期。@param {*} value 时间值。@returns {string} 日期或空。@throws 无。 */
    const time = value => {
      if (!value) return '';
      const date = new Date(/^\d+$/.test(String(value)) ? Number(value) : value);
      return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', {month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'});
    };
    /** 渲染当前已加载的会话；筛选不会改变选中客户。@returns {void}。@throws 无。 */
    const renderList = () => {
      const term = root.querySelector('.customer-search input').value.trim().toLowerCase();
      list.innerHTML = conversations.map((c, i) => {
        const summary = typeof c.summary === 'string' ? c.summary : find(c.summary, ['content', 'text']) || '';
        if (!`${c.name} ${c.country} ${summary}`.toLowerCase().includes(term)) return '';
        return `<button class="ops-conversation ${selected?.ref === c.ref ? 'is-selected' : ''}" data-index="${i}" aria-pressed="${selected?.ref === c.ref}"><span class="customer-avatar">${escape(Array.from(c.name || '?')[0])}</span><span class="customer-list-copy"><span class="customer-list-title"><strong>${escape(c.name)}</strong><time>${escape(time(c.time))}</time></span><span class="customer-list-meta">${escape(c.country || '国家未返回')}${Number(c.unread) > 0 ? `<b class="customer-unread">${escape(c.unread)}</b>` : ''}</span><small>${escape(summary || '暂无消息摘要')}</small></span></button>`;
      }).join('') || '<p class="ops-muted customer-list-empty">没有匹配的会话</p>';
      list.querySelectorAll('button').forEach(button => button.addEventListener('click', () => selectCustomer(conversations[Number(button.dataset.index)])));
    };
    /** 加载消息并防止旧请求覆盖新客户；历史记录累积展示。@param {boolean} older 是否向前翻页。@returns {Promise<void>}。@throws 无，错误在消息区展示。 */
    const messages = async older => {
      if (!selected) return;
      const version = selectionVersion, requestVersion = ++messageVersion;
      const params = { conversationRef: selected.ref, ...(older && state.messageCursor ? {limitTimeStamp: Number(state.messageCursor)} : {}) };
      result.innerHTML = '<p class="ops-muted">正在读取消息…</p>';
      root.querySelector('.ops-older-messages').disabled = true;
      try {
        const response = await read('messages', params);
        if (version !== selectionVersion || requestVersion !== messageVersion) return;
        const rows = Array.isArray(response.data?.messages) ? response.data.messages : [];
        const unique = new Map((older ? [...rows, ...messageRows] : rows).map(row => [JSON.stringify(row), row]));
        messageRows = [...unique.values()].sort((a,b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
        state.messageCursor = response.cursor;
        result.innerHTML = overview('messages', {...response.data, messages: messageRows});
        if (!older) root.querySelector('.customer-message-scroll').scrollTop = 0;
      } catch (error) { if (version === selectionVersion && requestVersion === messageVersion) result.innerHTML = `<p class="ops-error">${escape(error.message)}，可点击刷新消息重试。</p>`; }
      finally { if (version === selectionVersion && requestVersion === messageVersion) root.querySelector('.ops-older-messages').disabled = !state.messageCursor; }
    };
    /** 独立加载买家背景，不覆盖消息。@returns {Promise<void>}。@throws 无，错误就地显示。 */
    const buyer = async () => {
      if (!selected) return;
      const version = selectionVersion, requestVersion = ++buyerVersion, ref = selected.ref;
      background.innerHTML = '<p class="ops-muted">正在读取买家背景…</p>';
      try {
        const response = await read('buyer-basic', {conversationRef: ref});
        if (version === selectionVersion && requestVersion === buyerVersion) {
          const persona = find(response.data, ['buyer_persona']);
          background.innerHTML = typeof persona === 'string' ?
            facts({buyer_country_code: find(response.data, ['buyer_country_code']), buyer_level: find(response.data, ['buyer_level'])}) +
            `<section class="customer-persona"><h3>买家画像</h3><p>${escape(persona.slice(0, 220))}${persona.length > 220 ? '…' : ''}</p><details><summary>展开完整画像</summary>${facts(persona)}</details></section>` : facts(response.data);
        }
      } catch (error) { if (version === selectionVersion && requestVersion === buyerVersion) background.innerHTML = `<p class="ops-error">${escape(error.message)}，可点击刷新重试。</p>`; }
    };
    /** 选中客户后并发读取只读上下文；版本号隔离快速切换。@param {object} customer 会话对象。@returns {void}。@throws 无。 */
    const selectCustomer = customer => {
      selected = customer; state.conversation = customer; selectionVersion++; state.messageCursor = null; messageRows = [];
      root.querySelector('.ops-customer-name').textContent = customer.name;
      root.querySelector('.customer-thread-sub').textContent = `${customer.country || '国家未返回'} · 消息与背景同步查看`;
      root.querySelector('[name=buyer_country_code]').value = customer.country || '';
      root.querySelector('.ops-product-result').innerHTML = '';
      root.querySelector('.ops-messages').disabled = false; root.querySelector('.ops-buyer').disabled = false;
      renderList(); void messages(false); void buyer();
    };
    /** 读取会话页，失败保留已有列表并支持重试。@param {boolean} older 是否加载历史。@returns {Promise<void>}。@throws 请求错误，由 action 展示。 */
    const load = async older => {
      const response = await read('conversations', older && state.cursor ? {limitTimeStamp:Number(state.cursor), domain:'icbu'} : {domain:'icbu'});
      state.cursor = response.cursor; root.querySelector('.ops-older-conversations').disabled = !state.cursor;
      conversations = older ? [...conversations, ...response.items] : response.items;
      renderList();
    };
    root.querySelector('.customer-search input').addEventListener('input', renderList);
    action(root.querySelector('.ops-load-conversations'), () => load(false), list);
    root.querySelector('.ops-older-conversations').addEventListener('click', async event => {
      const button = event.currentTarget; if (button.disabled || !state.cursor) return;
      button.disabled = true;
      try { await load(true); } catch (error) { list.insertAdjacentHTML('beforeend', `<p class="ops-error">${escape(error.message)}</p>`); }
      finally { button.disabled = !state.cursor; }
    });
    action(root.querySelector('.ops-messages'), () => messages(false), result);
    root.querySelector('.ops-older-messages').addEventListener('click', () => { if (state.messageCursor) void messages(true); });
    action(root.querySelector('.ops-buyer'), buyer, background);
    action(root.querySelector('.ops-seller'), () => query(root.querySelector('.ops-seller-result'), 'seller-basic', {}), root.querySelector('.ops-seller-result'));
    // 商品目录只在展开时读取，避免首屏加载无关商品。
    let pickerReady = false;
    root.querySelector('.customer-product-panel').addEventListener('toggle', event => {
      if (event.target.open && !pickerReady) { pickerReady = true; picker(root.querySelector('.ops-knowledge-picker'), 'customer-product'); }
    });
    action(root.querySelector('.ops-product-query'), () => query(root.querySelector('.ops-product-result'), 'product-knowledge', {productRef:productRef('customer-product'), buyer_country_code:root.querySelector('[name=buyer_country_code]').value.toUpperCase()}), root.querySelector('.ops-product-result'));
    list.innerHTML = '<p class="ops-muted customer-list-empty">正在读取最近会话…</p>';
    load(false).catch(error => { list.innerHTML = `<p class="ops-error customer-list-empty">${escape(error.message)}，请点击刷新重试。</p>`; });
  }
  /** 行业判断和渠道趋势补充，类目来自所选真实商品。@returns {void}。@throws 无。 */
  function insights() {
    if (document.querySelector('#ops-channel')) return;
    document.querySelector('#tab-flow').insertAdjacentHTML('beforeend', card('ops-channel', '渠道变化趋势', '最多30天；按渠道和指标查询每日变化', `<div class="ops-form">${input('startDate', '开始日期', 'date', dates().startDate)}${input('endDate', '结束日期', 'date', dates().endDate)}${select('channelType', '渠道', ['搜索', '系统推荐', '会场', '站内收藏', '询盘&TM', '直接访问', '店内', '站外', '其他'].map(v => [v, v]))}${select('dimensionType', '指标', [['shop_uv', '访客'], ['fb_mc_uv', '询盘人数'], ['fb_uv', 'TM咨询人数'], ['visitor_to_fb_rate', '商机转化率']])}${select('terminalType', '终端', [['TOTAL', '全部'], ['PC', '电脑'], ['WS', '无线端']])}<button class="primary">查询渠道趋势</button></div><div class="ops-result"></div>`) + card('ops-market', '行业供需与竞争情况', '选择店铺商品确定类目，再查询对应市场事实', `<div class="ops-market-picker"></div><div class="ops-actions"><button class="primary" data-query="market-detail">行业供需</button><button class="ghost" data-query="market-trend">行业趋势</button><button class="ghost" data-query="seller-portrait">同行卖家画像</button><button class="ghost" data-query="crowd-insight">买家偏好</button><button class="ghost" data-query="also-viewed">买家还看过的商品</button></div><div class="ops-result"></div>`));
    const channel = document.querySelector('#ops-channel');
    action(channel.querySelector('button'), () => query(channel.querySelector('.ops-result'), 'channel-trend', { ...values(channel), statisticsType: 'day' }), channel.querySelector('.ops-result'));
    const market = document.querySelector('#ops-market'); picker(market.querySelector('.ops-market-picker'), 'market');
    market.querySelectorAll('[data-query]').forEach(b => action(b, () => {
      const name = b.dataset.query;
      const params = name === 'also-viewed' ? { sourceType: 'total_traffic', terminalType: 'TOTAL' } : name === 'crowd-insight' ? { industryId: 'TOTAL', nd: '30d', terminalType: 'TOTAL' } : { productRef: productRef('market') };
      return query(market.querySelector('.ops-result'), name, params);
    }, market.querySelector('.ops-result')));
  }
  /** 总览星级提升区域。@returns {void}。@throws 无。 */
  function stars() {
    if (document.querySelector('#ops-stars')) return;
    document.querySelector('#tab-overview').insertAdjacentHTML('beforeend', card('ops-stars', '星等级与提升建议', '读取当前账号最新星级、能力项、门槛与平台行动建议', '<button class="primary">查询最新星等级</button><div class="ops-result"></div>'));
    const root = document.querySelector('#ops-stars'); action(root.querySelector('button'), () => query(root.querySelector('.ops-result'), 'stars', { locale: 'zh_CN', terminal: 'chrome' }), root.querySelector('.ops-result'));
  }
  /** 四象限商品直接进入编辑弹窗；限时引用由服务端完整商品分析发放。 */
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-ops-product-ref]');
    if (!button || button.disabled || !button.dataset.opsProductRef) return;
    optimize();
    const editor = document.querySelector('#ops-optimize');
    state.selected.optimize = {ref: button.dataset.opsProductRef, title: button.dataset.opsProductTitle};
    editor.querySelector('.ops-edit-selected').textContent = `正在修改：${state.selected.optimize.title}`;
    editor.querySelector('.ops-original-result').innerHTML = '';
    editor.querySelector('.ops-edit-error').textContent = '';
    editor.querySelectorAll('.ops-edit-form input,.ops-edit-form textarea').forEach(field => { field.value = ''; });
    document.querySelector('#productEditDialog').showModal();
    editor.querySelector('.ops-edit-form').scrollTop = 0;
    editor.querySelector('.ops-score-result').innerHTML = '';
    void editor.loadProductInfo('trunk');
  });
  // 扩展区立即显示，原有数据查询独立运行，不让慢接口阻塞新增交互。
  LOADERS.orders = orders; LOADERS.risk = risk; LOADERS.assets = assets;
  for (const [tab, install] of [['product', optimize], ['visitor', customers], ['flow', insights], ['overview', stars]]) {
    const original = LOADERS[tab]; LOADERS[tab] = () => { install(); return original?.(); };
  }
  // app.js 的启动查询可能先完成；此处兼容已经激活的页面。
  for (const [tab, install] of [['product', optimize], ['visitor', customers], ['flow', insights], ['overview', stars]]) if (document.querySelector(`#tab-${tab}.on`)) install();
  setInterval(() => {
    if (document.hidden || !document.querySelector('#tab-assets.on,#tab-product.on')) return;
    refreshJobs().then(async () => {
      const active = state.jobs.filter(job => job.canPoll).slice(0, 2);
      for (const job of active) await request(`jobs/${job.id}/poll`, {}).catch(() => {});
    }).catch(() => {});
  }, 12000);
})();
