/* 国际站五条运营能力：业务表单与实际查询/任务分离。 */
'use strict';
(() => {
  const state = { jobs: [], editJobRefs: new Map(), selected: {}, conversation: null, cursor: null, messageCursor: null, productQuery: '', productPage: 1 };
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
  /** 翻译已知订单状态，未知值保留以免误判。@param {*} value 状态。@returns {string} 标签。@throws 无。 */
  function orderLabel(value) {
    const raw = typeof value === 'object' ? value?.status : value;
    return ({unpay: '待付款', undeliver: '待发货', wait_confirm_receipt: '待确认收货', trade_close: '交易关闭', trade_success: '交易成功', WAIT_BUYER_PAY: '待买家付款', WAIT_SELLER_SEND_GOODS: '待卖家发货', WAIT_BUYER_CONFIRM_GOODS: '待买家确认收货', TRADE_FINISHED: '交易完成', TRADE_CLOSED: '交易关闭', not_shipped: '未发货', shipped: '已发货', in_transit: '运输中', delivered: '已送达', TRANSPORTING: '运输中', DELIVERY_SUCCESS: '派送成功', DELIVERY_FAIL: '派送失败', WAIT_ENTER_WAREHOUSE: '待入库', WAIT_LEAVE_WAREHOUSE: '待出库', TERMINATED: '终止', CLOSED: '关闭'})[raw] || String(raw || '状态未返回');
  }
  /** 格式化平台日期，非法日期保留。@param {*} value 日期或时间戳。@returns {string} 本地日期时间。@throws 无。 */
  function businessDate(value) {
    if (!value) return '日期未返回';
    const stamp = /^\d{10,13}$/.test(String(value)) ? Number(value) * (String(value).length === 10 ? 1000 : 1) : value;
    const date = new Date(stamp);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', {hour12: false});
  }
  /** 转义所有平台和用户文本。@param {*} value 文本。@returns {string} 安全HTML。@throws 无。 */
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  /** 只允许HTTP(S)链接。@param {*} value 地址。@returns {string} 可用地址或空。@throws 无。 */
  function url(value) { try { const u = new URL(String(value)); return ['https:', 'http:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } }
  /** 请求运营接口。@param {string} path 路径。@param {object} payload 请求体。@returns {Promise<object>} 响应。@throws 网络或业务错误。 */
  async function request(path, payload) {
    if(path==='read') TimePolicy.validate(payload.action,payload.params || {});
    const advisorRead=path==='read'?window.LsouAdvisor?.beginRead('/api/operations/read',payload):null;
    const response = await fetch(`/api/operations/${path}`, payload === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const value = await response.json();
    window.LsouAdvisor?.finishRead(advisorRead,value,!response.ok||!value.ok);
    if (!response.ok || !value.ok) throw new Error(value.error || '请求失败');
    return value;
  }
  /** 构造查询。@param {string} action 查询名。@param {object} params 业务参数。@returns {Promise<object>} 数据。@throws 请求错误。 */
  const read = (action, params = {}, refresh=false) => request('read', { action, params, refresh });
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
    if(['market-detail','market-trend','seller-portrait','crowd-insight','also-viewed'].includes(name))return marketOverview(name,data);
    const count = (label, value) => `<article><span>${escape(label)}</span><strong>${escape(value ?? '未返回')}</strong></article>`;
    let content = '';
    if (name === 'orders' || name === 'logistics') {
      return orderOverview(name, data || {});
    } else if (name === 'risk' && data && typeof data === 'object') {
      return riskOverview(data);
    } else if (name === 'product-violations' || name === 'shop-violations') {
      return riskRecordsView(data);
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
  /** 格式化市场数值，空值不作零；value为平台值，percent为比例口径；返回文本；无异常。 */
  function marketNumber(value,percent=false) {
    if(value===null||value===undefined||value===''||!Number.isFinite(Number(value)))return '未返回';
    return (Number(value)*(percent?100:1)).toLocaleString('zh-CN',{maximumFractionDigits:percent?2:2})+(percent?'%':'');
  }
  /** 渲染带明确口径的市场结果；name为固定查询名，data为真实响应；返回HTML；无主动异常。 */
  function marketOverview(name,data) {
    const rows=Array.isArray(data)?data:[data],row=rows[0]||{};
    const empty=message=>`<div class="market-empty"><i class="ri-search-line" aria-hidden="true"></i><h3>暂时没有可展示的数据</h3><p>${escape(message)}</p></div>`;
    const metricFields=[['商机量','abCnt',false],['商机同比','abCntYoy',true],['需求商机率','dAbRate',true],['供需比','supplyDemandRate',false]];
    const bars=(title,entries)=>`<section class="market-distribution"><h3>${escape(title)}</h3>${entries.map(([label,value])=>`<div class="market-bar"><div><span>${escape(label)}</span><b>${marketNumber(value,true)}</b></div><div class="market-bar-track"><span style="width:${value==null?0:Math.max(0,Math.min(100,Number(value)*100))}%"></span></div></div>`).join('')}</section>`;
    if(name==='market-detail') {
      if(!rows.some(r=>metricFields.some(([,key])=>r?.[key]!=null)))return empty('该类目暂未返回供需指标，可更换商品类目后重试。');
      return `<div class="market-report"><header><h3>行业供需概览</h3><p>平台类目数据 · 统计周期未返回</p></header>${rows.map(r=>`<dl class="market-metrics">${metricFields.map(([label,key,pct])=>`<div><dt>${label}</dt><dd>${marketNumber(r[key],pct)}</dd></div>`).join('')}</dl>`).join('')}<p class="market-footnote">同比已换算为百分比；供需比为平台原始比值。排名的比较范围未说明，暂不作为竞争结论展示。</p></div>`;
    }
    if(name==='market-trend') {
      if(!rows.some(r=>metricFields.some(([,key])=>r?.[key]!=null)))return empty('平台暂未返回该类目的趋势数据。');
      // 没有日期时使用明确的序号轴；不同指标各用独立刻度，不把百分比与数量放在同一轴。
      const charts=metricFields.map(([label,key,pct])=>{
        const valid=rows.map((r,i)=>({i,v:r?.[key]})).filter(p=>p.v!==null&&p.v!==undefined&&p.v!==''&&Number.isFinite(Number(p.v)));
        if(!valid.length)return `<section><h4>${label}</h4><p>未返回</p></section>`;
        const lo=Math.min(...valid.map(p=>Number(p.v))),hi=Math.max(...valid.map(p=>Number(p.v))),span=hi-lo||1;
        const points=valid.map(p=>({...p,x:48+p.i*202/Math.max(1,rows.length-1),y:125-(Number(p.v)-lo)/span*90}));
        return `<section class="market-trend-chart"><h4>${label}</h4><svg viewBox="0 0 260 160" role="img" aria-label="${label}，按平台返回顺序展示"><text x="4" y="29">${marketNumber(hi,pct)}</text><text x="4" y="128">${marketNumber(lo,pct)}</text><line x1="48" y1="125" x2="250" y2="125" stroke="#e4e7ec"/>${points.map((p,i)=>`${i&&p.i===points[i-1].i+1?`<line x1="${points[i-1].x}" y1="${points[i-1].y}" x2="${p.x}" y2="${p.y}" stroke="#e5772b" stroke-width="2"/>`:''}<circle cx="${p.x}" cy="${p.y}" r="2" fill="#e5772b"><title>序号 ${p.i+1}：${marketNumber(p.v,pct)}</title></circle>`).join('')}<text x="48" y="151">序号 1</text><text x="250" y="151" text-anchor="end">序号 ${rows.length}</text></svg></section>`;
      }).join('');
      return `<div class="market-report"><header><h3>行业指标变化</h3><p>${rows.length} 个数据点 · 平台未提供日期，按返回顺序展示，不能据此判断具体月份</p></header><div class="market-chart-grid">${charts}</div><details class="market-data-table"><summary>查看数值明细</summary><div class="tablewrap"><table><thead><tr><th>返回序号</th>${metricFields.map(([label])=>`<th>${label}</th>`).join('')}</tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${i+1}</td>${metricFields.map(([,key,pct])=>`<td>${marketNumber(r?.[key],pct)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details></div>`;
    }
    if(name==='seller-portrait') {
      if(!Object.keys(row).length)return empty('当前类目未返回同行分布，请更换类目重试。');
      const revenue=row.rcvdCompCntRatio||{};
      return `<div class="market-report"><header><h3>同行卖家分布</h3><p>平台类目样本 · 各组占比独立，不跨组相加</p></header><div class="market-chart-grid">${bars('星等级分布',[['0星',row.star0CompCntRatio],['1星',row.star1CompCntRatio],['2星',row.star2CompCntRatio],['3星',row.star3CompCntRatio]])}${bars('收款规模分布（美元）',[['低于50万',revenue.lessThan500000Usd],['50万至不足100万',revenue.from500000ToLessThan1000000Usd],['100万至不足200万',revenue.from1000000ToLessThan2000000Usd],['200万及以上',revenue.atLeast2000000Usd]])}</div><p class="market-footnote">星等级仅显示接口返回的0—3星，未返回的等级不视为0；收款统计周期未返回，不能当作年营收。</p></div>`;
    }
    if(name==='also-viewed') {
      const groups=rows.flatMap(r=>Object.entries(r||{})).filter(([date,list])=>/^\d{4}-\d{2}-\d{2}$/.test(date)&&Array.isArray(list));
      if(!groups.some(([,list])=>list.length))return empty('当前买家关联浏览样本为空，稍后可重新查询。');
      return `<div class="market-report"><header><h3>买家还看过的商品</h3><p>本店买家关联浏览 · 全部流量 / 全端 · 独立于上方所选商品类目</p></header>${groups.map(([date,list])=>`<h4 class="market-list-date">${escape(date)} <span>${list.length} 件商品</span></h4><div class="market-related-list">${list.map(p=>`<article>${url(p.prodImage)?`<img src="${escape(url(p.prodImage))}" alt="" loading="lazy">`:''}<div><h4>${escape(p.prodName||'商品名称未返回')}</h4><p>${escape(p.compCnName||'供应商未返回')}</p><div class="market-product-facts"><span>价格 <b>${escape(p.price??'未返回')}</b></span><span>起订量 <b>${marketNumber(p.minOrderQuantity)}</b></span><span>浏览人数 <b>${marketNumber(p.toUvDetail)}</b></span><span>商机人数 <b>${marketNumber(p.toAbuvDetail)}</b></span></div></div></article>`).join('')}</div>`).join('')}<p class="market-footnote">价格币种未返回，不推断为美元；人数按单个商品显示，不跨商品累计。</p></div>`;
    }
    if(rows.some(r=>r&&typeof r==='object'&&Object.keys(r).length))return empty('平台已返回买家偏好数据，但当前结构尚不能可靠解析，请稍后重试。');
    return empty('平台目前没有返回可展示的买家偏好。当前查询为全行业、近30天、全端，不代表买家没有偏好。');
  }

  /** 业务卡片容器。@param {string} id DOM标识。@param {string} title 名称。@param {string} hint 说明。@param {string} content 内容。@returns {string} HTML。@throws 无。 */
  function card(id, title, hint, content = '') { return `<section class="card ops-card" id="${id}"><div class="card-hd"><div><h2>${title}</h2><div class="hint">${hint}</div></div></div><div class="ops-body">${content}</div></section>`; }
  /** 表单字段。@param {string} name 名称。@param {string} label 标签。@param {string} type 类型。@param {string} value 值。@returns {string} HTML。@throws 无。 */
  function input(name, label, type = 'text', value = '') { return `<label>${label}<input name="${name}" type="${type}" value="${escape(value)}" ${type==='date'?`max="${TimePolicy.today()}"`: ''}></label>`; }
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
  async function query(target, name, params, refresh=false) {
    const revision=target._queryRevision=(target._queryRevision || 0)+1;
    target.innerHTML = '<p class="ops-muted" role="status">正在读取当前账号数据…</p>';
    try {
      const response = await read(name, params, refresh);
      if(revision!==target._queryRevision)return {...response,stale:true};
      target.innerHTML = `<p class="ops-stamp">本次加载 · ${escape(new Date(response.fetchedAt).toLocaleString())}</p>${overview(name, response.data ?? response.items ?? response)}`;
      return response;
    } catch (e) { if(revision!==target._queryRevision)return {stale:true}; target.innerHTML = `<p class="ops-error" role="alert">${escape(e.message)}。请调整条件或再次查询。</p>`; throw e; }
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
          if (ref && response.job?.id) state.editJobRefs.set(response.job.id, ref);
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
      const rows = state.jobs.filter(j => filter === 'current-product' ? state.editJobRefs.get(j.id) === state.selected.optimize?.ref
        : filter === 'assets' ? /^(image|video|storyboard)/.test(j.action) : !/^(image|video|storyboard)/.test(j.action));
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
  /** 按当前返回行汇总状态，不使用匹配总数充当图表分母。@param {object[]} rows 本页记录。@param {Function} getter 状态读取器。@returns {Array} 标签、数量。@throws 无。 */
  function orderDistribution(rows, getter) {
    const counts = new Map();
    rows.forEach(row => { const label = orderLabel(getter(row)); counts.set(label, (counts.get(label) || 0) + 1); });
    return [...counts];
  }
  /** 格式化独立金额对象；缺项不补零，不合并币种。@param {object} value 平台金额。@returns {string} 金额和币种。@throws 无。 */
  function orderMoney(value) {
    if (value?.amount == null || value.amount === '') return '未返回';
    const amount = Number(value.amount), currency = value.currency?.currencyCode || (typeof value.currency === 'string' ? value.currency : '币种未返回');
    return `${Number.isFinite(amount) ? amount.toLocaleString('zh-CN', {maximumFractionDigits: 2}) : value.amount} ${currency}`;
  }
  /** 绘制本页环形图，图例同时提供精确数值。@param {object[]} rows 本页行。@param {Function} getter 状态读取器。@param {*} total 平台匹配总数。@returns {string} 图表HTML。@throws 无。 */
  function orderChart(rows, getter, total) {
    const groups = orderDistribution(rows, getter), colors = ['#ff6a00','#5b8fc2','#8d85bb','#b4bac4','#42a285','#d9ad59','#69a7ad'];
    // 固定同一状态的颜色，翻页后仍能沿用同一视觉含义。
    const color = (label, i) => ({'待付款':'#ff6a00','待发货':'#5b8fc2','待确认收货':'#8d85bb','交易关闭':'#b4bac4','交易成功':'#42a285','运输中':'#5b8fc2','派送成功':'#42a285','订单关闭':'#b4bac4','派送失败':'#cf6868'})[label] || colors[i % colors.length];
    let offset = 0;
    const arcs = groups.map(([label, count], i) => {
      const percent = count / rows.length * 100, start = offset; offset += percent;
      return `<circle cx="70" cy="70" r="56" pathLength="100" fill="none" stroke="${color(label,i)}" stroke-width="16" stroke-dasharray="${percent} ${100-percent}" stroke-dashoffset="${-start}" transform="rotate(-90 70 70)"><title>${escape(label)}：${count} 条</title></circle>`;
    }).join('');
    return `<div class="order-distribution"><div class="order-chart-title"><h3>状态分布</h3><span>当前页 · ${rows.length} 条</span><p>匹配总数 <b>${escape(total ?? '—')}</b> 条</p></div><div class="order-donut"><svg viewBox="0 0 140 140" role="img" aria-label="当前页${rows.length}条记录的状态分布"><circle cx="70" cy="70" r="56" fill="none" stroke="#eef0f3" stroke-width="16"/>${arcs}</svg><div><strong>${rows.length}</strong><small>本页记录</small></div></div><div class="order-legend">${groups.map(([label,count],i)=>`<div><i style="background:${color(label,i)}"></i><span>${escape(label)}</span><strong>${count}</strong><small>${(count/rows.length*100).toFixed(0)}%</small></div>`).join('') || '<p class="ops-muted">当前条件下没有记录</p>'}</div></div>`;
  }
  /** 合同与物流概览：状态图和紧凑表格共用本页数据。@param {string} name 查询名。@param {object} data 响应。@returns {string} HTML。@throws 无。 */
  function orderOverview(name, data) {
    const contracts = name === 'orders', rows = (contracts ? data.tradeList : data.dataList) || [];
    state[name] = rows;
    const status = row => contracts ? row.status : row.orderStatusDesc || row.orderStatus;
    const check=data.dateCheck;
    const note=check?`<p class="ops-muted">创建日期：${escape(check.start.slice(0,10))} — ${escape(check.end.slice(0,10))} · 北京时间 · 本页符合日期 ${check.included} 条${check.outside || check.unknown?`；已排除 ${check.outside} 条超范围、${check.unknown} 条日期不明记录`:''}。平台匹配总数未经全量日期核验。</p>`:'';
    return `${note}${orderChart(rows,status,contracts?data.totalCount:data.total)}<div class="tablewrap order-table"><table><thead><tr><th>${contracts?'合同 / 商品':'物流单 / 货物'}</th><th>${contracts?'买家 / 国家':'目的国家'}</th>${contracts?'<th>合同金额</th>':''}<th>状态</th><th>${contracts?'创建时间':'物流方案'}</th><th></th></tr></thead><tbody>${rows.map((row,i)=>`<tr><td><b>${escape(contracts?row.contractNumber||row.id:row.orderNumber)}</b><small class="order-product-title">${escape(contracts?row.subjectMatter?.details?.map(p=>p.name).filter(Boolean).join('、')||'商品信息未返回':row.cargoDesc||'货物信息未返回')}</small></td><td>${escape(contracts?row.buyer?.participantName||row.buyer?.companyName||'未返回':businessCountry(row.destinationCountryName||row.destinationCountryCode))}${contracts?`<small>${escape(businessCountry(row.buyer?.country))}</small>`:''}</td>${contracts?`<td class="order-amount">${escape(orderMoney(row.payment?.totalAmount))}</td>`:''}<td><span class="order-status">${escape(orderLabel(status(row)))}</span></td><td>${escape(contracts?businessDate(row.createDate):row.solutionName||'未返回')}</td><td><button class="order-detail-button" data-order-kind="${name}" data-order-index="${i}">查看${contracts?'合同':'物流'} ↗</button></td></tr>`).join('') || `<tr><td colspan="6"><div class="empty">当前条件下没有${contracts?'合同':'物流订单'}</div></td></tr>`}</tbody></table></div>`;
  }
  /** 语义化详情字段，安全转义且保留缺项。@param {Array} entries 标签和值。@returns {string} HTML。@throws 无。 */
  function orderFields(entries) {
    return `<dl class="order-detail-fields">${entries.map(([label,value])=>`<div><dt>${escape(label)}</dt><dd>${escape(value == null || value === '' ? '未返回' : value)}</dd></div>`).join('')}</dl>`;
  }
  /** 使用独立原生弹窗展示合同/物流，关闭后返回触发按钮。@param {string} kind 查询名。@param {number} index 行索引。@param {Element} trigger 触发按钮。@returns {void}。@throws 无。 */
  function showOrderDetail(kind, index, trigger) {
    const row = state[kind]?.[index]; if (!row) return;
    const contracts = kind === 'orders', buyer = row.buyer || row.participants?.buyer || {}, payment = row.payment || {};
    const dialog = document.createElement('dialog'); dialog.className = 'order-dialog';
    const products = Array.isArray(row.subjectMatter?.details) ? row.subjectMatter.details : [];
    dialog.innerHTML = `<header><div><small>${contracts?'交易合同':'物流订单'}</small><h2 id="orderDialogTitle">${escape(contracts?row.contractNumber||row.id:row.orderNumber)}</h2></div><button type="button" class="order-dialog-close" aria-label="关闭详情">×</button></header><div class="order-dialog-body"><span class="order-status">${escape(orderLabel(contracts?row.status:row.orderStatusDesc||row.orderStatus))}</span>${contracts?`<div class="order-payment"><div><span>合同金额</span><strong>${escape(orderMoney(payment.totalAmount))}</strong></div><div><span>已收金额</span><strong>${escape(orderMoney(payment.receivedAmount))}</strong></div></div><h3>买家与合同信息</h3>${orderFields([['买家',buyer.participantName],['国家',businessCountry(buyer.country)],['公司',buyer.companyName],['创建时间',businessDate(row.createDate)],['更新时间',businessDate(row.modifyDate)],['确认时间',businessDate(row.confirmDate||row.contractConfirmDate)]])}<h3>合同商品 <small>${products.length} 项</small></h3><div class="order-contract-products">${products.map(p=>`<article>${url(p.snapshotImage||p.skuImageUrl||p.customProductImageUrl)?`<img src="${escape(url(p.snapshotImage||p.skuImageUrl||p.customProductImageUrl))}" alt="">`:'<i class="ri-box-3-line"></i>'}<div><b>${escape(p.name||'商品名称未返回')}</b><small>商品编号 ${escape(p.productId??'未返回')}</small>${p.specificationDesc||p.skuDescription?`<p>${escape(p.specificationDesc||p.skuDescription)}</p>`:''}</div><strong>${escape(p.quantity??'—')} <small>${escape(p.unit||'')}</small></strong></article>`).join('')||'<p class="ops-muted">平台未返回商品明细</p>'}</div>${row.contractRemark||row.remark?`<h3>合同备注</h3><p class="order-note">${escape(row.contractRemark||row.remark)}</p>`:''}`:`<h3>物流信息</h3>${orderFields([['货物',row.cargoDesc],['起运国家',businessCountry(row.originCountryName||row.originCountryCode)],['目的国家',businessCountry(row.destinationCountryName||row.destinationCountryCode)],['物流方案',row.solutionName],['仓库',row.warehouseName],['信保单号',row.tradeBizId],['承运单号',row.headOrderNumber],['应付运费',orderMoney({amount:row.chargeSummary?.payableAmount,currency:row.chargeSummary?.currency})],['实际计费重量',row.actualChargeWeight],['付款状态',({PAYMENT_SUCCESS:'已付款'})[row.payStatus]||row.payStatus]])}`}</div>`;
    dialog.setAttribute('aria-labelledby','orderDialogTitle'); document.body.append(dialog);
    dialog.querySelector('.order-dialog-close').onclick = () => dialog.close();
    dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
    dialog.addEventListener('close',()=>{dialog.remove();trigger?.focus();},{once:true}); dialog.showModal();
  }
  /** 将平台税率、公式、归类路径集中展示，不自行推导税额或税率。@param {object} data 测算返回。@param {object} context 请求时商品与路线。@returns {string} HTML。@throws 无。 */
  function tariffView(data, context) {
    const hs = data?.classifiedHsCode || {}, paths = Array.isArray(data?.classifiedHsCodePathList) ? data.classifiedHsCodePathList : [];
    const description = value => String(value?.descriptionCn || value?.description || value?.descriptionEn || '').replace(/\*\*/g,'').replace(/\|/g,'\n');
    return `<section class="tariff-report"><header><div><small>本次测算</small><h3>${escape(businessCountry(context.originCountryCode))} <i class="ri-arrow-right-line"></i> ${escape(businessCountry(context.destinationCountryCode))}</h3><p>${escape(context.product.title)}</p></div><span>平台测算结果</span></header><div class="tariff-summary"><div><span>参考关税税率</span><strong>${data?.tariffRate != null && data.tariffRate !== '' ? `${escape(data.tariffRate)}<small>%</small>`:'—'}</strong></div><div><span>商品 HS 编码</span><strong>${escape(hs.hscode??'—')}</strong></div><div><span>计税方式</span><strong class="tariff-method">${escape(({ByAmount:'从价计征',ByQuantity:'从量计征'})[data?.tariffCalculateType] || data?.tariffCalculateType || '未返回')}</strong></div></div><div class="tariff-formula"><i class="ri-calculator-line"></i><div><small>平台计算公式</small><b>${escape(data?.tariffFormula||'平台未返回计算公式')}</b></div></div><div class="tariff-classification"><h4>HS 归类依据</h4>${(paths.length?paths:[hs]).map((p,i)=>`<article><div><small>${paths.length>1?(i===0?'品目':'关税子目'):'商品归类'}</small><b>${escape(p.hscode??'—')}</b></div><p>${escape(description(p)||'平台未返回归类说明')}</p></article>`).join('')}</div><footer>税率与归类依据来自本次平台返回；未提供申报金额，本次不展示应缴税额。</footer></section>`;
  }
  /** 安装实时订单和物流页面。@returns {void}。@throws 无。 */
  function orders() {
    const root = document.querySelector('#blueprint-orders');
    root.innerHTML = `${card('ops-orders', '交易合同', '日期与状态筛选作用于平台查询', `<div class="ops-form">${input('from', '创建开始日期', 'date', dates('orders').startDate)}${input('to', '创建结束日期', 'date', dates('orders').endDate)}${select('status', '物流状态', [['', '全部'], ['not_shipped', '未发货'], ['shipped', '已发货'], ['in_transit', '运输中'], ['delivered', '已送达']])}<button class="primary ops-query">查询合同</button></div><div class="ops-result"></div><div class="ops-actions"><button class="ghost ops-prev">上一页</button><span class="ops-page"></span><button class="ghost ops-next">下一页</button></div>`)}${card('ops-logistics', '物流订单', '当前物流状态 · 不按合同创建日期筛选', `<div class="ops-form">${input('number', '物流订单号（可选）')}${input('tradeBizId', '信保单号（可选）')}${select('status', '状态', [['', '全部'], ['TRANSPORTING', '运输中'], ['DELIVERY_SUCCESS', '派送成功'], ['DELIVERY_FAIL', '派送失败'], ['WAIT_ENTER_WAREHOUSE', '待入库'], ['WAIT_LEAVE_WAREHOUSE', '待出库'], ['TERMINATED', '终止'], ['CLOSED', '关闭']])}<button class="primary ops-query">查询物流</button></div><div class="ops-result"></div><div class="ops-actions"><button class="ghost ops-prev">上一页</button><span class="ops-page"></span><button class="ghost ops-next">下一页</button></div>`)}${card('ops-tariff', '商品关税测算', '选择商品与起运、目的国家，显示平台返回的测算依据', `<div class="ops-tariff-picker"></div><div class="ops-form">${input('originCountryCode', '起运国家代码', 'text', 'CN')}${input('destinationCountryCode', '目的国家代码', 'text', 'US')}<button class="primary">测算关税</button></div><div class="ops-result"></div>`)}`;
    for (const [id, endpoint] of [['ops-orders', 'orders'], ['ops-logistics', 'logistics']]) {
      const section = document.getElementById(id), result = section.querySelector('.ops-result'); let page = 1;
      const run = async () => {
        const v = values(section); let params;
        if (endpoint === 'orders') {
          TimePolicy.range(v.from,v.to);
          timeStates.orders={mode:'range',value:'',startDate:v.from,endDate:v.to};
          params = { start: (page - 1) * 20, limit: 20, ...(v.from ? { createDateFrom: `${v.from} 00:00:00` } : {}), ...(v.to ? { createDateTo: `${v.to} 23:59:59` } : {}), ...(v.status ? { logisticsStatus: v.status } : {}) };
        } else params = { currentPage: page, pageSize: 20, ...(v.number ? { number: v.number } : {}), ...(v.tradeBizId ? { tradeBizId: v.tradeBizId } : {}), ...(v.status ? { statusList: [v.status] } : {}) };
        const response = await query(result, endpoint, params);
        if(response.stale)return;
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
    // 页面刷新时替换委托，避免重复监听导致一次点击弹出多个窗口。
    root.onclick = event => {
      const button = event.target.closest('[data-order-kind]');
      if(button) showOrderDetail(button.dataset.orderKind, Number(button.dataset.orderIndex), button);
    };
    delete state.selected.tariff;
    const tariff = document.querySelector('#ops-tariff'), pickerHost = tariff.querySelector('.ops-tariff-picker'), result = tariff.querySelector('.ops-result');
    let revision = 0;
    // 商品或路线变化时移除旧结果，避免把上一笔税率绑定到新的测算对象。
    const invalidate = () => { revision++; result.innerHTML = '<div class="tariff-placeholder"><i class="ri-calculator-line"></i><span>点击测算关税，查看当前商品的税率与归类依据</span></div>'; };
    picker(pickerHost, 'tariff', p => {
      pickerHost.classList.add('has-selection');
      pickerHost.querySelector('.ops-selected').innerHTML = `<div>${url(p.image)?`<img src="${escape(url(p.image))}" alt="">`:''}<span><small>已选商品</small><b>${escape(p.title)}</b></span><button type="button" class="ghost tariff-change">更换商品</button></div>`;
      pickerHost.querySelector('.tariff-change').onclick = () => pickerHost.classList.remove('has-selection');
      invalidate();
    });
    tariff.querySelectorAll('[name$="CountryCode"]').forEach(el=>el.addEventListener('input',invalidate));
    invalidate();
    action(tariff.querySelector('button.primary'), async () => {
      const v = values(tariff), params = {productRef:productRef('tariff'),originCountryCode:v.originCountryCode.toUpperCase(),destinationCountryCode:v.destinationCountryCode.toUpperCase()};
      if(!/^[A-Z]{2}$/.test(params.originCountryCode)||!/^[A-Z]{2}$/.test(params.destinationCountryCode)) throw new Error('请输入两位国家代码，例如 CN、US');
      const context = {...params,product:{...state.selected.tariff}}, current = ++revision;
      result.innerHTML = '<p class="ops-muted" role="status">正在测算所选商品关税…</p>';
      try {
        const response = await read('tariff',params);
        if(current!==revision)return;
        result.innerHTML = `<p class="ops-stamp">测算时间 · ${escape(businessDate(response.fetchedAt))}</p>${tariffView(response.data,context)}`;
      } catch(error) { if(current===revision)throw error; }
    }, result);
  }
  const riskMetrics = [
    ['totalRiskProdCnt','风险商品总数',null], ['highFreqComplaintProdCnt','高频投诉商品','highFreqComplaintDetectDate'],
    ['troProdCnt','TRO风险商品','troDetectDate'], ['repeatedComplaintProdCnt','重复投诉商品','repeatedComplaintDetectDate'],
    ['forbidDescriptionRiskProdCnt','禁限售描述风险','forbidDescriptionRiskDetectDate'], ['toRectifyTaskCnt','整改超时','toRectifyTaskDetectDate'],
    ['fraudOrderCnt','欺诈订单','fraudOrderDetectDate'], ['punishPoint','累计扣分',null],['todayPunishNum','今日处罚数量',null],['todayPunishPoint','今日扣分',null]
  ];
  /** 将平台HTML说明转换为纯文本，禁止平台脚本、图片和事件进入页面。@param {*} html 原文。@returns {string} 文本。@throws 无。 */
  function riskText(html) {
    // 先移除标记与脚本，再解码HTML实体；解析器不会接收到图片/链接等资源节点。
    const text = String(html ?? '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<\/(p|li|div)>/gi,'\n').replace(/<[^>]*>/g,'').replace(/</g,'&lt;');
    const doc = new DOMParser().parseFromString(text, 'text/html');
    return doc.body.textContent.replace(/[ \t]+/g,' ').replace(/\n[ \n]+/g,'\n\n').trim();
  }
  /** 提取明确的违规记录并去重，不把汇总计数伪装成商品明细。@param {object} data 响应。@returns {object[]} 记录。@throws 无。 */
  function riskRecords(data) {
    const result = [], seen = new Set();
    const walk = value => {
      if (!value || typeof value !== 'object') return;
      if (value.violationId != null || value.productTitle && value.violationType) {
        const key=String(value.violationId ?? `${value.productId}|${value.violationType}|${value.violationTime}`);
        if(!seen.has(key)){seen.add(key);result.push(value);} return;
      }
      Object.values(value).forEach(walk);
    };
    walk(data); return result;
  }
  /** 直接展示商品、管控、原因和整改说明，不输出技术字段树。@param {object} data 违规响应。@returns {string} 卡片HTML。@throws 无。 */
  function riskRecordsView(data) {
    const rows=riskRecords(data);
    const allUrl=url(data?.viewAllUrl);
    const names={countryRestrictedSale:'国别限售',countryBlocking:'国家屏蔽'};
    return `<div class="risk-record-list">${rows.map(row=>`<article class="risk-product-record"><header>${url(row.productImage)?`<img src="${escape(url(row.productImage))}" alt="" loading="lazy">`:''}<div><h3>${escape(row.productTitle || row.productName || '店铺违规记录')}</h3><small>${row.productId?'商品编号 '+escape(row.productId)+' · ':''}${escape(businessDate(row.violationTime))}</small></div><span class="risk-type">${escape(names[row.violationType] || row.violationType || '类型未返回')}</span></header><div class="risk-record-facts"><span>管控范围 <b>${escape((row.restrictedCountryNames || row.restrictedCountryCodes || []).join('、') || '未返回')}</b></span><span>处罚措施 <b>${escape(names[row.penaltyMeasure] || row.penaltyMeasure || '未返回')}</b></span><span>扣分 <b>${escape(row.deductionPoints ?? '未返回')}</b></span></div><h4>平台管控原因</h4><p>${escape(riskText(row.controlReason || row.violationReason || '未返回'))}</p><h4>平台整改说明</h4><p class="risk-remedy">${escape(riskText(row.suggestionDesc || '未返回'))}</p></article>`).join('') || `<div class="empty">${data?.hasViolation===false?'平台返回本次无违规记录':'本次未返回商品或店铺违规明细'}</div>`}</div>${allUrl?`<a class="risk-platform-link" href="${escape(allUrl)}" target="_blank" rel="noopener noreferrer">查看平台违规记录 ↗</a>`:''}`;
  }
  /** 用可点击指标和分类条形图呈现诊断，不以零值补齐缺失。@param {object} data 风险汇总。@returns {string} HTML。@throws 无。 */
  function riskOverview(data) {
    state.riskData=data;
    const max=Math.max(1,...riskMetrics.slice(1,7).map(([key])=>Number(data[key])||0));
    return `<div class="risk-kpis">${riskMetrics.map(([key,label,date])=>`<button type="button" data-risk-key="${key}" class="${Number(data[key])>0?'has-risk':''}" aria-label="查看${label}明细"><span>${label}</span><strong>${escape(data[key] ?? '—')}</strong><small>查看明细 ›</small></button>`).join('')}</div><div class="risk-distribution"><h3>风险类别分布</h3>${riskMetrics.slice(1,7).map(([key,label,date])=>`<button type="button" data-risk-key="${key}"><span>${label}</span><i><b style="width:${Math.min(100,Math.max(0,Number(data[key])||0)/max*100)}%"></b></i><strong>${escape(data[key]??'—')}</strong><small>${data[date]?String(data[date]).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'):'检测日期未返回'}</small></button>`).join('')}<p>各类别可能交叉，不能相加当作风险商品总数。点击数量查看对应数据可用情况。</p></div>`;
  }
  /** 每个风险指标均可查看详情；汇总没有对象ID时明确区分近期违规与该项风险。@param {string} key 指标键。@returns {Promise<void>} 打开明细。@throws 查询错误转为局部提示。 */
  async function showRiskDetail(key) {
    const metric=riskMetrics.find(item=>item[0]===key); if(!metric)return;
    const data=state.riskData || {}, value=data[key];
    const body=document.querySelector('#modalBody');
    body.innerHTML=`<h2>${escape(metric[1])} · ${escape(value??'—')}</h2><div class="risk-drill-content">正在读取违规对象…</div>`;
    document.querySelector('#modal').classList.add('on');
    const target=body.querySelector('.risk-drill-content');
    if(value===0){target.innerHTML='<div class="empty">本次诊断该项为 0，暂无该项明细。</div>';return;}
    try {
      const response=await read(key==='fraudOrderCnt' || key==='punishPoint' || key.startsWith('today')?'shop-violations':'product-violations',{limit:50,language:'zh_CN'});
      target.innerHTML=`${url(data.aiAutoRaiseUrl)?`<a class="risk-platform-link" href="${escape(url(data.aiAutoRaiseUrl))}" target="_blank" rel="noopener noreferrer">打开平台风险诊断 ↗</a>`:''}<p class="risk-unlinked">诊断只返回${escape(metric[1])}汇总，未返回对应商品或订单编号。以下是独立查询的近期违规记录，不能确认与该统计项属于同一对象。</p>${riskRecordsView(response.data)}`;
    } catch(e) {target.innerHTML=`<p class="ops-error">明细读取失败：${escape(e.message)}</p>`;}
  }
  /** 安装实时风控与违规查询。@returns {void}。@throws 无。 */
  function risk() {
    const root = document.querySelector('#blueprint-risk');
    root.innerHTML = `${card('ops-risk', '店铺风险诊断', '查看风险数量、检测时间与平台处理入口', '<button class="primary">重新诊断</button><div class="ops-result"></div>')}${card('ops-violations', '违规记录', '查询商品与店铺实际违规记录', `<div class="ops-form">${input('startDate', '开始日期', 'date', dates('risk').startDate)}${input('endDate', '结束日期', 'date', dates('risk').endDate)}${input('violationType', '违规类型（可选）')}<button class="primary" data-kind="product-violations">商品违规</button><button class="ghost" data-kind="shop-violations">店铺违规</button></div><div class="ops-result"></div>`)}`;
    window.mountRiskWorkbench?.(root);
    const diagnosis = root.querySelector('#ops-risk .ops-result');
    diagnosis.addEventListener('click', event => {const button=event.target.closest('[data-risk-key]');if(button)void showRiskDetail(button.dataset.riskKey);});
    action(root.querySelector('#ops-risk button'), () => query(diagnosis, 'risk', {}), diagnosis);
    root.querySelectorAll('[data-kind]').forEach(button => action(button, () => { const v = values(root.querySelector('#ops-violations')); TimePolicy.range(v.startDate,v.endDate); timeStates.risk={mode:'range',value:'',startDate:v.startDate,endDate:v.endDate}; return query(root.querySelector('#ops-violations .ops-result'), button.dataset.kind, { ...Object.fromEntries(Object.entries(v).filter(([, x]) => x)), limit: 50, language: 'zh_CN' }); }, root.querySelector('#ops-violations .ops-result')));
    query(diagnosis, 'risk', {}).catch(() => {});
    query(root.querySelector('#ops-violations .ops-result'), 'product-violations', {startDate:dates('risk').startDate,endDate:dates('risk').endDate,limit:50,language:'zh_CN'}).catch(()=>{});
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
    form.insertAdjacentHTML('beforeend', '<section class="ops-publish-section"><h3>本次编辑任务</h3><div class="ops-jobs" data-kind="current-product"></div></section>');
    let loadVersion = 0, baseline = {}, loadedRef = null;
    /** 读取当前商品并填充编辑字段。版本号隔离快速切换，加载中禁用保存。
     * @param {string} version trunk 线上或 draft 草稿。@returns {Promise<void>}。@throws 无，错误就地展示。
     */
    const info = async (version, prefetched = null) => {
      const ref = productRef('optimize'), sequence = ++loadVersion;
      loadedRef = null; baseline = {};
      root.querySelectorAll('[class^=ops-read-]').forEach(area => { area.innerHTML = '<p class="ops-muted">正在读取当前资料…</p>'; });
      root.querySelector('.ops-save').disabled = true;
      const fields = [...root.querySelectorAll('.ops-edit-form input,.ops-edit-form textarea')];
      fields.forEach(field => { field.disabled = true; field.value = ''; });
      result.innerHTML = '<p class="ops-muted">正在读取标题、图片、属性、交易与履约信息…</p>';
      try {
        const response = prefetched || await read('product-info', { productRef: ref, queryType: version }, true);
        if (state.selected.optimize?.ref !== ref || sequence !== loadVersion) return;
        const data = response.data?.agentModel || response.data || {};
        if (!data.basicInfo || !Object.keys(data.basicInfo).length) throw new Error('平台服务 未返回可编辑的商品资料');
        const basic = data.basicInfo, detail = data.detail || {};
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
    root.querySelector('.ops-draft').onclick = () => { void info('draftFirst'); };
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
        return `<button class="ops-conversation ${selected?.ref === c.ref ? 'is-selected' : ''}" data-index="${i}" aria-pressed="${selected?.ref === c.ref}"><span class="customer-avatar">${escape(Array.from(c.name || '?')[0])}</span><span class="customer-list-copy"><span class="customer-list-title"><strong>${escape(c.name)}</strong><time>${escape(time(c.time))}</time></span><span class="customer-list-meta">${escape(businessCountry(c.country))}${Number(c.unread) > 0 ? `<b class="customer-unread">${escape(c.unread)}</b>` : ''}</span><small>${escape(summary || '暂无消息摘要')}</small></span></button>`;
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
      root.querySelector('.customer-thread-sub').textContent = `${businessCountry(customer.country)} · 消息与背景同步查看`;
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
  /** 市场研究从可见商品进入；无参数；返回void；读取失败在对应区域报告。 */
  function insights() {
    if(document.querySelector('#ops-market'))return;
    const views=[['market-detail','行业供需'],['market-trend','行业趋势'],['seller-portrait','同行卖家画像']];
    const buyerViews=[['crowd-insight','买家偏好'],['also-viewed','买家还看过的商品']];
    const panel=([key,label])=>`<section class="market-dashboard-section" aria-label="${label}"><header class="market-panel-toolbar"><span>${label}</span><button class="ghost sm" type="button" data-refresh="${key}">重新读取</button></header><div data-market-result="${key}" aria-live="polite"><p class="ops-muted">正在加载${label}…</p></div></section>`;
    document.querySelector('#flowMarketHost').insertAdjacentHTML('beforeend',card('ops-market','商品与行业全景','左侧选择商品，右侧自动展示所属类目的行业数据',`
      <div class="market-dashboard-layout"><aside class="market-product-sidebar" aria-label="店铺商品列表">
      <form class="market-product-search"><label>查找店铺商品<input type="search" name="marketSearch" placeholder="输入商品名称"></label><button class="ghost" type="submit">搜索</button></form>
      <div class="market-product-options" aria-label="选择研究商品"></div>
      <div class="market-product-paging"><button class="ghost sm market-prev" type="button">上一页</button><span></span><button class="ghost sm market-next" type="button">下一页</button></div></aside>
      <div class="market-dashboard-content"><div class="market-object-heading">正在加载店铺商品…</div>${views.map(panel).join('')}
      <div class="market-buyer-scope"><h3>买家研究</h3><p>以下两项独立于左侧商品：买家偏好查询全行业近30天，关联商品查询本店买家全端浏览。</p></div>${buyerViews.map(panel).join('')}</div></div>`));
    const root=document.querySelector('#ops-market'),options=root.querySelector('.market-product-options');
    let page=1,items=[],current=null,listRevision=0;
    /** 独立读取一个图表区，其他区域不受其失败影响；name为固定查询；返回Promise，错误就地显示。 */
    async function loadPanel(name,refresh=false) {
      const scoped=views.some(([key])=>key===name);
      if(scoped&&!current)return;
      const params=scoped?{productRef:current.ref}:name==='crowd-insight'?{industryId:'TOTAL',nd:'30d',terminalType:'TOTAL'}:{sourceType:'total_traffic',terminalType:'TOTAL'};
      await query(root.querySelector(`[data-market-result="${name}"]`),name,params,refresh).catch(()=>{});
    }
    /** 更新商品卡片选中状态及按钮文字；无参数；返回void；无主动异常。 */
    function renderOptions() {
      options.innerHTML=items.length?items.map((p,i)=>`<button type="button" data-product-index="${i}" class="market-product-option ${current?.ref===p.ref?'is-selected':''}" aria-pressed="${current?.ref===p.ref}">${url(p.image)?`<img src="${escape(url(p.image))}" alt="">`:''}<span><b>${escape(p.title)}</b><small>${escape(p.category||'类目未返回')}</small></span><em>${current?.ref===p.ref?'已选':'选择'}</em></button>`).join(''):'<p class="ops-muted">没有找到商品，请换个名称搜索。</p>';
    }
    /** 选择真实商品并并行读取三个行业区域；p为目录记录；返回void；查询失败就地显示。 */
    function choose(p) {
      current=p;state.selected.market=p;
      root.querySelector('.market-object-heading').innerHTML=`${url(p.image)?`<img src="${escape(url(p.image))}" alt="">`:''}<div><span>当前研究商品</span><h3>${escape(p.title)}</h3><p>所属类目 <strong>${escape(p.category||'未返回')}</strong> → 下方展示该类目的行业数据</p></div>`;
      root.querySelectorAll('[data-refresh]').forEach(b=>{b.disabled=false;});
      renderOptions();void Promise.allSettled(views.map(([name])=>loadPanel(name)));
    }
    /** 读取一页真实商品，在左栏展示并选择第一件；无参数；返回Promise；目录异常提供重试。 */
    async function loadProducts() {
      const revision=++listRevision;
      current=null;
      views.forEach(([name])=>{const target=root.querySelector(`[data-market-result="${name}"]`);target._queryRevision=(target._queryRevision||0)+1;target.innerHTML='<p class="ops-muted">等待选择商品…</p>';root.querySelector(`[data-refresh="${name}"]`).disabled=true;});
      root.querySelector('.market-object-heading').textContent='正在读取商品，完成后自动更新当前行业视图';
      options.innerHTML='<p class="ops-muted" role="status">正在加载店铺商品…</p>';
      root.querySelectorAll('.market-product-paging button').forEach(b=>{b.disabled=true;});
      try {
        const response=await read('products',{query:root.querySelector('[name=marketSearch]').value.trim(),page});
        if(revision!==listRevision)return;
        items=response.items||[];renderOptions();
        root.querySelector('.market-product-paging span').textContent=`第 ${page} 页${response.total!=null?' · 共 '+response.total+' 件':''}`;
        root.querySelector('.market-prev').disabled=page<=1;
        root.querySelector('.market-next').disabled=items.length<20||(response.total!=null&&page*20>=response.total);
        if(items.length)choose(items[0]);else root.querySelector('.market-object-heading').textContent='找到商品后，即可查看它所属类目的行业情况。';
      }catch(error){if(revision!==listRevision)return;options.innerHTML=`<p class="ops-error">${escape(error.message)}。请点击搜索商品重试。</p>`;root.querySelector('.market-object-heading').textContent='商品未加载，请重试。';}
    }
    options.addEventListener('click',event=>{const b=event.target.closest('[data-product-index]');if(b)choose(items[Number(b.dataset.productIndex)]);});
    root.querySelector('.market-product-search').addEventListener('submit',event=>{event.preventDefault();page=1;void loadProducts();});
    root.querySelector('.market-prev').onclick=()=>{page--;void loadProducts();};
    root.querySelector('.market-next').onclick=()=>{page++;void loadProducts();};
    root.querySelectorAll('[data-refresh]').forEach(b=>{b.onclick=()=>void loadPanel(b.dataset.refresh,true);});
    void Promise.allSettled(buyerViews.map(([name])=>loadPanel(name)));
    void loadProducts();
  }
  /** 展示平台格式化指标，保留币种和百分比。@param {object|null} value 指标对象。@returns {string} 安全文本。@throws 无。 */
  function starValue(value) { return escape(value?.displayText ?? value?.value ?? '—'); }
  /** 渲染当前赛道的紧凑摘要、指标和平台建议。@param {Element} root 结果容器。@param {object} data 星级数据。@param {number} selected 赛道索引。@returns {void}。@throws DOM缺失时抛错。 */
  function renderStars(root, data, selected = 0) {
    const tracks = Array.isArray(data.trackList) ? data.trackList : [];
    const track = tracks[selected];
    const final = data.finalStar || {};
    const star = value => value == null ? '—' : `${escape(value)} 星`;
    root.innerHTML = `<div class="star-summary"><article><span>当前展示星级</span><strong>${star(final.displayLevelStar)}</strong></article><article><span>当前评定星级</span><strong>${star(final.pageLevelStar)}</strong></article><article><span>统计日期</span><b>${escape(data.statDate || '未返回')}</b><small>平台最新评定，不随顶部日期变化</small></article></div>`;
    if (!track) {root.insertAdjacentHTML('beforeend', '<p class="ops-muted">平台未返回赛道明细</p>'); return;}
    const abilities = Array.isArray(track.abilityList) ? track.abilityList : [];
    root.insertAdjacentHTML('beforeend', `<div class="star-trackbar"><div role="group" aria-label="星等级赛道">${tracks.map((item,i) => `<button type="button" class="${i === selected ? 'primary' : 'ghost'}" data-star-track="${i}" aria-pressed="${i === selected}">${escape(item.trackName || '赛道')}${item.scoreHighestTrack ? ' · 当前最优' : ''}</button>`).join('')}</div><b>${escape(track.score ?? '—')} 分 <span>${escape(track.progress?.currentPositionText || '')}</span></b></div>
      <div class="star-abilities">${abilities.map(ability => `<article><header><h3>${escape(ability.abilityName || '能力指标')}</h3><strong>${escape(ability.score ?? '—')}<small> 分</small></strong></header><div class="tablewrap"><table><thead><tr><th>指标</th><th>当前值</th><th>下一星级参考值</th></tr></thead><tbody>${(ability.indicatorList || []).map(indicator => `<tr><td title="${escape(indicator.tips || '')}">${escape(indicator.name || '指标')}</td><td>${starValue(indicator.currentValue)}</td><td>${starValue(indicator.nextStarCateLv2Value)}</td></tr>`).join('')}</tbody></table></div><div class="star-advice">${(ability.adviceList || []).map(advice => `<div><b>${escape(advice.title || '平台建议')}</b><p>${escape(advice.description || '')}</p>${(advice.actionList || []).filter(action => url(action.target)).map(action => `<a href="${escape(url(action.target))}" target="_blank" rel="noopener noreferrer">${escape(action.text || '前往平台')} ↗</a>`).join(' ')}</div>`).join('')}</div></article>`).join('')}</div>
      <div class="star-thresholds"><b>基础门槛</b>${(track.thresholdList || []).map(item => `<span class="${item.completed === true ? 'is-met' : ''}" title="${escape(item.title || '')}">${escape(item.indicatorName || item.title || '门槛')} <strong>${starValue(item.currentValue)}</strong> · ${item.completed === true ? '已达标' : item.completed === false ? '未达标' : '状态未返回'}</span>`).join('')}</div><p class="star-note">建议和下一星级参考值来自平台，达到单项参考值不等于保证升星。</p>`);
    root.querySelectorAll('[data-star-track]').forEach(button => {button.onclick = () => renderStars(root, data, Number(button.dataset.starTrack));});
  }
  /** 进入总览即加载星级，失败显示重试，手动刷新不重复创建区域。@returns {void}。@throws 异步错误在页面显示。 */
  function stars() {
    if (document.querySelector('#ops-stars')) return;
    document.querySelector('#tab-overview').insertAdjacentHTML('beforeend', card('ops-stars', '星等级与提升建议', '当前星级、升星参考与平台建议', '<div class="ops-result" aria-live="polite"></div>'));
    const root = document.querySelector('#ops-stars');
    root.querySelector('.card-hd').insertAdjacentHTML('beforeend', '<button type="button" class="ghost sm">刷新星等级</button>');
    const button = root.querySelector('button');
    const target = root.querySelector('.ops-result');
    /** 读取并展示最新星级。@returns {Promise<void>}。@throws 无，失败信息就地显示。 */
    async function loadStars() {
      if (button.disabled) return;
      button.disabled = true;
      target.innerHTML = '<p class="ops-muted" role="status">正在读取星等级…</p>';
      try {
        const response = await read('stars', {locale: 'zh_CN', terminal: 'chrome'});
        const data = response.data || {};
        const preferred = (data.trackList || []).findIndex(track => track.scoreHighestTrack);
        renderStars(target, data, Math.max(0, preferred));
      } catch (error) {target.innerHTML = `<p class="ops-error" role="alert">星等级读取失败：${escape(error.message)}。可点击“刷新星等级”重试。</p>`;}
      finally {button.disabled = false;}
    }
    button.addEventListener('click', loadStars);
    window.overviewStarsReady = loadStars();
  }
  /**
   * 用已验证的商品引用打开原商品编辑器，保留底下的历史列表和发布工作区。
   * @param {object} product 服务端发放的 ref 与 title。
   * @param {object|null} prefetched 历史入口已通过平台服务读取的资料，避免重复读取。
   * @returns {void} 打开编辑器；保存仍走已有商品patch，发布仍需单独确认。
   * @throws {Error} DOM初始化异常交给调用入口显示。
   */
  function openProductEditor(product, prefetched = null) {
    optimize();
    const editor = document.querySelector('#ops-optimize');
    state.selected.optimize = product;
    editor.querySelector('.ops-edit-selected').textContent = `正在修改：${state.selected.optimize.title}`;
    editor.querySelector('.ops-original-result').innerHTML = '';
    editor.querySelector('.ops-edit-error').textContent = '';
    editor.querySelectorAll('.ops-edit-form input,.ops-edit-form textarea').forEach(field => { field.value = ''; });
    document.querySelector('#productEditDialog').showModal();
    editor.querySelector('.ops-edit-form').scrollTop = 0;
    editor.querySelector('.ops-score-result').innerHTML = '';
    void editor.loadProductInfo(prefetched ? 'draftFirst' : 'trunk', prefetched);
    void refreshJobs().catch(() => {});
  }
  let historyEditLoading = false;
  /** 历史条目先只读原商品，读取失败就地提示；参数只提交历史ID，不能由浏览器替换商品号。 */
  document.addEventListener('click', async event => {
    const historical = event.target.closest('[data-publish-edit-job]');
    if (historical) {
      if (historical.disabled || historyEditLoading) return;
      historyEditLoading = true;
      const label = historical.querySelector('small');
      const errorArea = historical.closest('article').querySelector('[data-publish-edit-error]');
      historical.disabled = true;
      errorArea.textContent = '';
      label.textContent = '正在读取商品…';
      try {
        const response = await fetch(`/api/publish/jobs/${encodeURIComponent(historical.dataset.publishEditJob)}/edit`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.error || '商品读取失败，请重试');
        // 用户可能已关闭或切换历史弹窗；迟到的只读结果不能抢回焦点。
        if (!historical.isConnected || !document.querySelector('#modal.on')) return;
        if (!payload.product?.ref) throw new Error('未取得原商品编辑引用，请重试');
        openProductEditor(payload.product, payload);
      } catch (error) { if (historical.isConnected) errorArea.textContent = String(error.message || error); }
      finally { historyEditLoading = false; historical.disabled = false; label.textContent = '继续编辑'; }
      return;
    }
    const button = event.target.closest('[data-ops-product-ref]');
    if (!button || button.disabled || !button.dataset.opsProductRef) return;
    openProductEditor({ ref: button.dataset.opsProductRef, title: button.dataset.opsProductTitle });
  });
  // 扩展区立即显示，原有数据查询独立运行，不让慢接口阻塞新增交互。
  LOADERS.orders = orders; LOADERS.risk = risk; LOADERS.assets = assets;
  for (const [tab, install] of [['product', optimize], ['visitor', customers], ['market', insights], ['overview', stars]]) {
    const original = LOADERS[tab]; LOADERS[tab] = () => { install(); return original?.(); };
  }
  // app.js 的启动查询可能先完成；此处兼容已经激活的页面。
  for (const [tab, install] of [['product', optimize], ['visitor', customers], ['market', insights], ['overview', stars]]) if (document.querySelector(`#tab-${tab}.on`)) install();
  setInterval(() => {
    if (document.hidden || !document.querySelector('#tab-assets.on,#tab-product.on,#productEditDialog[open]')) return;
    refreshJobs().then(async () => {
      const active = state.jobs.filter(job => job.canPoll).slice(0, 2);
      for (const job of active) await request(`jobs/${job.id}/poll`, {}).catch(() => {});
    }).catch(() => {});
  }, 12000);
})();
