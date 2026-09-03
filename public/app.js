/* workctl 经营数据面板 — 前端 (零依赖) */
'use strict';

// ============================ 基础工具 ============================
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const NS = 'http://www.w3.org/2000/svg';

let inflight = 0;
function busy(on) {
  inflight += on ? 1 : -1;
  if (inflight < 0) inflight = 0;
  $('.dot').className = 'dot' + (inflight > 0 ? ' busy' : '');
}
function toast(msg, isErr) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast on' + (isErr ? ' err' : '');
  clearTimeout(t._h);
  t._h = setTimeout(() => { t.className = 'toast' + (isErr ? ' err' : ''); }, 3200);
}
async function api(ep, params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== '' && v !== null && v !== undefined && v !== false) qs.set(k, v);
  }
  busy(true);
  try {
    const r = await fetch(`/api/q/${ep}?${qs}`);
    const j = await r.json();
    if (!j.ok) { toast(`${ep} 失败: ${(j.error || '').slice(0, 110)}`, true); return null; }
    return j;
  } catch (e) {
    toast(`${ep} 网络错误: ${e.message}`, true); return null;
  } finally { busy(false); refreshLog(); }
}

/**
 * 调用由本地服务端聚合的经营分析接口。
 *
 * @param {string} path - 以 /api/dashboard/ 开头的只读接口路径。
 * @returns {Promise<object|null>} 成功时返回 JSON，失败时返回 null。
 * @throws {Error} 网络或解析异常会被转换成页面提示，不向外抛出。
 */
async function dashboardApi(path) {
  busy(true);
  try {
    const response = await fetch(path);
    const payload = await response.json();
    if (!payload.ok) {
      toast(`经营分析失败: ${(payload.error || '').slice(0, 110)}`, true);
      return null;
    }
    return payload;
  } catch (error) {
    toast(`经营分析网络错误: ${error.message}`, true);
    return null;
  } finally {
    busy(false);
    refreshLog();
  }
}

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
function fmt(v) {
  const n = num(v);
  if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(2) + '亿';
  if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(2) + '万';
  if (!Number.isInteger(n)) return n.toFixed(2);
  return n.toLocaleString();
}
const pct = v => (num(v) * 100).toFixed(2) + '%';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function el(tag, attrs = {}, txt) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (txt != null) e.textContent = txt;
  return e;
}

// 悬浮提示
const tip = document.createElement('div');
tip.className = 'tipbox'; document.body.appendChild(tip);
function showTip(ev, text) {
  tip.textContent = text; tip.style.display = 'block';
  const x = ev.clientX + 14, y = ev.clientY + 14;
  tip.style.left = Math.min(x, innerWidth - tip.offsetWidth - 12) + 'px';
  tip.style.top = Math.min(y, innerHeight - tip.offsetHeight - 12) + 'px';
}
const hideTip = () => { tip.style.display = 'none'; };

// ============================ 日期 ============================
const iso = d => d.toISOString().slice(0, 10);
function setRange(days) {
  const end = new Date(Date.now() - 86400000);          // 昨天
  const start = new Date(end.getTime() - (days - 1) * 86400000);
  $('#startDate').value = iso(start);
  $('#endDate').value = iso(end);
}
const dates = () => ({ startDate: $('#startDate').value, endDate: $('#endDate').value });

/** 访客接口最长 1 个月，自动收敛 */
function visitorRange() {
  const { startDate, endDate } = dates();
  const e = new Date(endDate), s = new Date(startDate);
  const min = new Date(e.getTime() - 29 * 86400000);
  return { startDate: iso(s < min ? min : s), endDate: endDate };
}

// ============================ KPI 定义 ============================
const KPIS = [
  { k: 'totalImpsCnt', n: '曝光量', c: '#ff6600', aggregate: 'sum', format: 'number' },
  { k: 'totalClkCnt', n: '点击量', c: '#ef7b2d', aggregate: 'sum', format: 'number' },
  { k: 'fbCnt', n: '询盘数', c: '#289b69', aggregate: 'sum', format: 'number' },
  { k: 'sucOrdCnt', n: '成交订单', c: '#7468d9', aggregate: 'sum', format: 'number' },
  { k: 'fstReplyRate30d', n: '首次回复率', c: '#278c98', aggregate: 'latest', format: 'percent' },
  { k: 'avgReplyTime30d', n: '平均回复时长', c: '#d88a13', aggregate: 'latest', format: 'hours', lowerBetter: true },
];
let curKpi = 'totalImpsCnt';
let summaryRows = [];

// ============================ 经营大盘 ============================
async function loadOverview() {
  const j = await api('shop-summary', { ...dates(), statisticsType: 'day' });
  if (!j) return;
  summaryRows = (Array.isArray(j.data) ? j.data : [])
    .filter(r => r && r.statDate)
    .sort((a, b) => a.statDate < b.statDate ? -1 : 1);
  if (!summaryRows.length) { $('#kpis').innerHTML = '<div class="empty">该区间无数据</div>'; return; }
  renderKpis();
  renderJourney();
  renderTrend();
  renderActionItems();
  $('#dataFreshness').textContent = `已更新 · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  loadOverviewInsights();
}

function sum(key) { return summaryRows.reduce((a, r) => a + num(r[key]), 0); }

/**
 * 读取汇总序列中最后一天的指标值。
 *
 * @param {string} key - shop-summary 返回的数据字段名。
 * @returns {number} 最后一天的数值；没有数据时返回 0。
 * @throws {Error} 不主动抛出异常，非法或缺失数值统一按 0 处理。
 */
function latest(key) {
  return summaryRows.length ? num(summaryRows[summaryRows.length - 1][key]) : 0;
}

/**
 * 按指标口径计算区间值，避免把“30 天滚动状态”错误地逐日累加。
 *
 * @param {object} meta - KPI 配置，包含字段名与 aggregate 聚合方式。
 * @param {string} [suffix=''] - 同行字段后缀，例如 RivalAvg 或 RivalGood。
 * @returns {number} 依据配置得到的累计值或最新快照值。
 * @throws {Error} 不主动抛出异常，未知聚合方式按区间求和处理。
 */
function metricValue(meta, suffix = '') {
  const key = meta.k + suffix;
  return meta.aggregate === 'latest' ? latest(key) : sum(key);
}

/**
 * 将指标转换为用户可读文本，并保留指标自身的业务单位。
 *
 * @param {object} meta - KPI 配置，format 可为 number、percent 或 hours。
 * @param {number} value - 已按正确口径聚合的数值。
 * @returns {string} 适合卡片、提示框展示的格式化文本。
 * @throws {Error} 不主动抛出异常，无法识别的格式回退为普通数字。
 */
function formatMetric(meta, value) {
  if (meta.format === 'percent') return pct(value);
  if (meta.format === 'hours') return `${num(value).toFixed(2)}h`;
  return fmt(value);
}

/**
 * 生成本店与同行均值的差异文案，并处理“回复时间越低越好”的反向指标。
 *
 * @param {object} meta - KPI 配置。
 * @param {number} mine - 本店指标值。
 * @param {number} rival - 同行均值。
 * @returns {{className:string, text:string}} 差异的视觉状态与展示文案。
 * @throws {Error} 不主动抛出异常，同行值缺失时返回中性状态。
 */
function metricComparison(meta, mine, rival) {
  if (!rival) return { className: 'neutral', text: '暂无同行参考' };
  if (meta.format === 'percent') {
    const points = (mine - rival) * 100;
    return {
      className: points >= 0 ? 'up' : 'down',
      text: `${points >= 0 ? '↑' : '↓'} ${Math.abs(points).toFixed(1)} 个百分点`,
    };
  }
  if (meta.format === 'hours') {
    const delta = mine - rival;
    const better = meta.lowerBetter ? delta <= 0 : delta >= 0;
    return {
      className: better ? 'up' : 'down',
      text: `${delta >= 0 ? '↑' : '↓'} ${Math.abs(delta).toFixed(2)}h vs 同行`,
    };
  }
  const delta = (mine - rival) / rival * 100;
  return {
    className: delta >= 0 ? 'up' : 'down',
    text: `${delta >= 0 ? '↑' : '↓'} ${Math.abs(delta).toFixed(1)}% vs 同行`,
  };
}

/**
 * 渲染六个最重要的经营结果。点击任一指标会同步切换下方趋势线。
 *
 * @returns {void} 直接更新 #kpis，不返回数据。
 * @throws {Error} 页面缺少 KPI 容器时可能抛出 DOM 访问异常。
 */
function renderKpis() {
  $('#kpis').innerHTML = KPIS.map(m => {
    const mine = metricValue(m);
    const rival = metricValue(m, 'RivalAvg');
    const comparison = metricComparison(m, mine, rival);
    return `<button class="kpi ${m.k === curKpi ? 'on' : ''}" data-k="${m.k}" type="button">
      <span class="k">${m.n}</span><strong class="v">${formatMetric(m, mine)}</strong>
      <span class="c ${comparison.className}">${comparison.text}</span></button>`;
  }).join('');
  $$('.kpi').forEach(e => e.onclick = () => {
    curKpi = e.dataset.k;
    $$('.kpi').forEach(x => x.classList.toggle('on', x.dataset.k === curKpi));
    renderTrend();
  });
}

/**
 * 将原始指标值转换成趋势图坐标值。百分比字段需从 0–1 转成 0–100。
 *
 * @param {object} meta - 当前 KPI 配置。
 * @param {*} value - API 返回的原始值。
 * @returns {number} 可用于绘图的有限数值。
 * @throws {Error} 不主动抛出异常，非法值按 0 处理。
 */
function trendValue(meta, value) {
  const valueNumber = num(value);
  return meta.format === 'percent' ? valueNumber * 100 : valueNumber;
}

/**
 * 格式化趋势图提示框中的值。趋势图百分比坐标已经放大为 0–100。
 *
 * @param {object} meta - 当前 KPI 配置。
 * @param {number} value - 已转换为图表坐标口径的值。
 * @returns {string} 带正确单位的提示文本。
 * @throws {Error} 不主动抛出异常。
 */
function formatTrendValue(meta, value) {
  if (meta.format === 'percent') return `${num(value).toFixed(2)}%`;
  if (meta.format === 'hours') return `${num(value).toFixed(2)}h`;
  return fmt(value);
}

/**
 * 根据当前选中的 KPI 绘制本店与同行优秀的日趋势。
 *
 * @returns {void} 直接更新 #trendChart。
 * @throws {Error} 当前指标不存在或图表容器缺失时可能抛出 DOM 异常。
 */
function renderTrend() {
  const meta = KPIS.find(m => m.k === curKpi);
  $('#trendName').textContent = meta.n;
  const box = $('#trendChart'); box.innerHTML = '';

  const W = Math.max(box.clientWidth - 10, 620), H = 222;
  const P = { t: 14, r: 18, b: 34, l: 62 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const rows = summaryRows;
  const vals = rows.map(r => trendValue(meta, r[curKpi]));
  const rvals = rows.map(r => trendValue(meta, r[curKpi + 'RivalGood']));
  const max = Math.max(...vals, ...rvals, 1) * 1.12;

  const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
  const X = i => P.l + (rows.length === 1 ? iw / 2 : i / (rows.length - 1) * iw);
  const Y = v => P.t + ih - (v / max) * ih;

  // 网格 + y 轴
  for (let i = 0; i <= 5; i++) {
    const y = P.t + ih - (i / 5) * ih;
    svg.appendChild(el('line', { x1: P.l, y1: y, x2: P.l + iw, y2: y, class: 'gl',
      'stroke-dasharray': i ? '3 4' : '', opacity: i ? .4 : 1 }));
    svg.appendChild(el('text', { x: P.l - 9, y: y + 4, class: 'gt', 'text-anchor': 'end' },
      formatTrendValue(meta, max * i / 5)));
  }
  // 面积
  const area = `M${X(0)},${Y(vals[0])} ` + vals.map((v, i) => `L${X(i)},${Y(v)}`).join(' ') +
    ` L${X(vals.length - 1)},${P.t + ih} L${X(0)},${P.t + ih} Z`;
  const grad = el('linearGradient', { id: 'g1', x1: 0, y1: 0, x2: 0, y2: 1 });
  grad.appendChild(el('stop', { offset: '0%', 'stop-color': meta.c, 'stop-opacity': .34 }));
  grad.appendChild(el('stop', { offset: '100%', 'stop-color': meta.c, 'stop-opacity': 0 }));
  const defs = el('defs'); defs.appendChild(grad); svg.appendChild(defs);
  svg.appendChild(el('path', { d: area, fill: 'url(#g1)' }));
  // 主线
  svg.appendChild(el('polyline', {
    points: vals.map((v, i) => `${X(i)},${Y(v)}`).join(' '),
    fill: 'none', stroke: meta.c, 'stroke-width': 2.2,
    'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  // 同行优秀
  if (rvals.some(v => v > 0)) {
    svg.appendChild(el('polyline', {
      points: rvals.map((v, i) => `${X(i)},${Y(v)}`).join(' '),
      fill: 'none', stroke: '#a7a8ad', 'stroke-width': 1.4, 'stroke-dasharray': '5 4', opacity: .8 }));
  }
  // 数据点
  rows.forEach((r, i) => {
    const c = el('circle', { cx: X(i), cy: Y(vals[i]), r: 3.4, fill: '#ffffff',
      stroke: meta.c, 'stroke-width': 1.8, class: 'dotp' });
    c.addEventListener('mousemove', ev => showTip(ev,
      `${r.statDate}\n${meta.n}: ${formatTrendValue(meta, vals[i])}\n同行均值: ${formatTrendValue(meta, trendValue(meta, r[curKpi + 'RivalAvg']))}\n同行优秀: ${formatTrendValue(meta, rvals[i])}`));
    c.addEventListener('mouseleave', hideTip);
    c.addEventListener('click', () => openDayModal(r));
    svg.appendChild(c);
  });
  // x 轴
  const step = Math.max(1, Math.ceil(rows.length / 9));
  rows.forEach((r, i) => {
    if (i % step && i !== rows.length - 1) return;
    svg.appendChild(el('text', { x: X(i), y: P.t + ih + 19, class: 'gt', 'text-anchor': 'middle' },
      r.statDate.slice(5)));
  });
  box.appendChild(svg);
}

/**
 * 渲染曝光到成交的完整经营链路。六个节点均来自 shop-summary 的真实字段。
 *
 * @returns {void} 直接更新 #journeyFlow。
 * @throws {Error} 页面缺少链路容器时可能抛出 DOM 访问异常。
 */
function renderJourney() {
  const stages = [
    { name: '曝光', value: sum('totalImpsCnt') },
    { name: '点击', value: sum('totalClkCnt') },
    { name: '店铺访问', value: sum('pvCnt') },
    { name: '商机', value: sum('abCnt') },
    { name: '询盘', value: sum('fbCnt') },
    { name: '成交', value: sum('sucOrdCnt') },
  ];
  $('#journeyFlow').innerHTML = stages.map((stage, index) => {
    const previous = index ? stages[index - 1].value : 0;
    const conversion = previous ? `${(stage.value / previous * 100).toFixed(index > 2 ? 1 : 2)}%` : '经营起点';
    return `<div class="journey-step"><span>${stage.name}</span><strong>${fmt(stage.value)}</strong><small>${conversion}</small></div>${
      index < stages.length - 1 ? '<i class="ri-arrow-right-s-line journey-arrow" aria-hidden="true"></i>' : ''}`;
  }).join('');
}

/**
 * 根据真实经营差距生成三项可执行任务，并将尚未接入的两项能力明确标为规划中。
 *
 * @returns {void} 直接更新待办列表和待办数量。
 * @throws {Error} 页面缺少待办容器时可能抛出 DOM 访问异常。
 */
function renderActionItems() {
  const clickRate = sum('totalImpsCnt') ? sum('totalClkCnt') / sum('totalImpsCnt') : 0;
  const rivalClickRate = sum('totalImpsCntRivalAvg') ? sum('totalClkCntRivalAvg') / sum('totalImpsCntRivalAvg') : 0;
  const inquiryRate = sum('pvCnt') ? sum('fbCnt') / sum('pvCnt') : 0;
  const rivalInquiryRate = sum('pvCntRivalAvg') ? sum('fbCntRivalAvg') / sum('pvCntRivalAvg') : 0;
  const orderRate = sum('fbCnt') ? sum('sucOrdCnt') / sum('fbCnt') : 0;
  const tasks = [
    {
      level: rivalClickRate && clickRate < rivalClickRate ? '高' : '常规',
      title: '提升全站点击效率',
      detail: `当前点击率 ${(clickRate * 100).toFixed(2)}%${rivalClickRate ? `，同行均值 ${(rivalClickRate * 100).toFixed(2)}%` : ''}`,
      action: '查看商品', tab: 'product', icon: 'ri-cursor-line', tone: 'orange',
    },
    {
      level: rivalInquiryRate && inquiryRate < rivalInquiryRate ? '高' : '常规',
      title: '提升询盘承接效率',
      detail: `访问转询盘率 ${(inquiryRate * 100).toFixed(2)}%${rivalInquiryRate ? `，同行均值 ${(rivalInquiryRate * 100).toFixed(2)}%` : ''}`,
      action: '查看访客', tab: 'visitor', icon: 'ri-customer-service-2-line', tone: 'green',
    },
    {
      level: orderRate < 0.15 ? '高' : '常规',
      title: '复盘成交转化',
      detail: `${fmt(sum('fbCnt'))} 条询盘形成 ${fmt(sum('sucOrdCnt'))} 笔成交，转化率 ${(orderRate * 100).toFixed(1)}%`,
      action: '定位商品', tab: 'product', icon: 'ri-shopping-cart-2-line', tone: 'purple',
    },
    {
      level: '规划中', title: '排查零效果商品', detail: '需接入商品诊断规则后生成具体数量',
      action: '规划中', planned: true, icon: 'ri-error-warning-line', tone: 'yellow',
    },
    {
      level: '规划中', title: '检查风险与物流异常', detail: '需接入订单、物流与风控数据源',
      action: '规划中', planned: true, icon: 'ri-shield-check-line', tone: 'blue',
    },
  ];
  const liveCount = tasks.filter(task => !task.planned).length;
  $('#actionCount').textContent = String(liveCount);
  $('#todoCount').textContent = String(liveCount);
  $('#actionList').innerHTML = tasks.map((task, index) => `<article class="action-row ${task.planned ? 'is-planned' : ''}">
    <span class="action-icon ${task.tone}"><i class="${task.icon}" aria-hidden="true"></i></span>
    <div class="action-copy"><div><b>${task.title}</b><span class="priority p-${task.level}">${task.level}</span></div><p>${task.detail}</p></div>
    <button type="button" class="action-go" data-action-index="${index}">${task.action}<i class="ri-arrow-right-s-line" aria-hidden="true"></i></button>
  </article>`).join('');
  $$('.action-go').forEach(button => {
    button.onclick = () => {
      const task = tasks[Number(button.dataset.actionIndex)];
      if (task.planned) toast(`${task.title}：该能力正在规划中，当前没有伪造数据`);
      else switchTab(task.tab);
    };
  });
}

/**
 * 并行读取渠道、国家和商品数据，为总览底部的三块诊断摘要提供真实数据。
 * 单个接口失败不会阻断另外两块，错误提示由统一 api() 函数负责。
 *
 * @returns {Promise<void>} 所有诊断请求完成后结束，不返回业务值。
 * @throws {Error} 理论上不向外抛出，接口异常会被 api() 转成空结果。
 */
async function loadOverviewInsights() {
  const [flow, region, product] = await Promise.all([
    api('shop-flow', { ...dates(), terminalType: 'TOTAL' }),
    api('shop-region', { ...dates(), statisticsType: 'month', dimensionType: 'shop_uv', terminalType: 'TOTAL' }),
    api('shop-product', { pageNo: 1, pageSize: 5, orderBy: 'views', orderModel: 'DESC' }),
  ]);
  if (flow) renderOverviewFlow(flow);
  if (region) renderOverviewRegion(region);
  if (product) renderOverviewProducts(product);
}

/**
 * 汇总并渲染前五个流量来源，商机率按每日记录做简单平均以保持与原接口口径一致。
 *
 * @param {object} response - shop-flow 接口完整响应。
 * @returns {void} 直接更新渠道摘要列表。
 * @throws {Error} 不主动抛出异常，异常数据会得到空列表。
 */
function renderOverviewFlow(response) {
  const groups = new Map();
  (Array.isArray(response.data) ? response.data : []).forEach(row => {
    if (!row || row.subSourceType !== 'TOTAL' || row.sourceType === 'TOTAL') return;
    const item = groups.get(row.sourceType) || { name: row.sourceType, value: 0, rate: 0, count: 0 };
    item.value += num(row.uv); item.rate += num(row.abRate); item.count += 1;
    groups.set(row.sourceType, item);
  });
  const rows = [...groups.values()].map(row => ({ ...row, rate: row.rate / (row.count || 1) }))
    .sort((a, b) => b.value - a.value).slice(0, 5);
  renderMiniRows('#overviewFlowList', rows, row => `${fmt(row.value)} 访客 · 商机率 ${(row.rate * 100).toFixed(1)}%`);
}

/**
 * 合并月份区块中的国家访客，并按访客数渲染前五名。
 *
 * @param {object} response - shop-region 接口完整响应。
 * @returns {void} 直接更新国家摘要列表。
 * @throws {Error} 不主动抛出异常，结构不完整时跳过对应记录。
 */
function renderOverviewRegion(response) {
  const groups = new Map();
  (Array.isArray(response.data) ? response.data : []).forEach(block => {
    Object.values(block || {}).forEach(list => (Array.isArray(list) ? list : []).forEach(row => {
      const name = row.countryName || row.regionName || '未知';
      groups.set(name, (groups.get(name) || 0) + num(row.countryUv ?? row.regionUv ?? row.value));
    }));
  });
  const rows = [...groups.entries()].map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value).slice(0, 5);
  const total = rows.reduce((acc, row) => acc + row.value, 0);
  renderMiniRows('#overviewRegionList', rows, row => `${fmt(row.value)} 访客 · TOP5 占比 ${total ? (row.value / total * 100).toFixed(1) : '0.0'}%`);
}

/**
 * 渲染前五个商品，并复用 API 返回的真实商品缩略图和指标。
 *
 * @param {object} response - shop-product 接口完整响应。
 * @returns {void} 直接更新商品摘要列表并绑定跳转。
 * @throws {Error} 不主动抛出异常，无商品时展示空状态。
 */
function renderOverviewProducts(response) {
  const rows = Array.isArray(response.data?.data) ? response.data.data.slice(0, 5) : [];
  const box = $('#overviewProductList');
  if (!rows.length) { box.innerHTML = '<div class="empty">暂无商品数据</div>'; return; }
  box.innerHTML = rows.map(row => `<button class="product-mini" type="button">
    ${row.prodImage ? `<img src="${esc(row.prodImage)}" alt="" loading="lazy">` : '<span class="product-placeholder"><i class="ri-image-line"></i></span>'}
    <span class="product-mini-copy"><b title="${esc(row.subject)}">${esc(row.subject || '未命名商品')}</b><small>曝光 ${fmt(row.sumProdShowNum)} · 点击 ${fmt(row.sumProdClickNum)} · 询盘 ${fmt(row.sumProdFbNum)}</small></span>
    <i class="ri-arrow-right-s-line" aria-hidden="true"></i>
  </button>`).join('');
  box.querySelectorAll('.product-mini').forEach(button => { button.onclick = () => switchTab('product'); });
}

/**
 * 渲染通用排行摘要，并按最大值绘制真实相对长度的细条。
 *
 * @param {string} selector - 目标容器选择器。
 * @param {Array<{name:string,value:number}>} rows - 已排序的摘要数据。
 * @param {(row:object)=>string} detail - 将单行数据转换为说明文本的函数。
 * @returns {void} 直接更新指定容器。
 * @throws {Error} 容器不存在时可能抛出 DOM 访问异常。
 */
function renderMiniRows(selector, rows, detail) {
  const box = $(selector);
  if (!rows.length) { box.innerHTML = '<div class="empty">该区间暂无数据</div>'; return; }
  const max = Math.max(...rows.map(row => row.value), 1);
  box.innerHTML = rows.map((row, index) => `<div class="mini-row">
    <span class="mini-rank">${index + 1}</span><div class="mini-copy"><div><b>${esc(row.name)}</b><small>${esc(detail(row))}</small></div>
    <span class="mini-track"><i style="width:${Math.max(row.value / max * 100, 3).toFixed(1)}%"></i></span></div>
  </div>`).join('');
}

function openDayModal(r) {
  const keys = Object.keys(r).filter(k => !/Rival/.test(k) && typeof r[k] !== 'object');
  $('#modalBody').innerHTML = `<h2 style="font-size:15px">${r.statDate} · 当日全量指标</h2>
    <div class="hint" style="margin-top:5px">来源 workctl icbu advisor data-advisor-shop-summary</div>
    <div class="kvgrid">${keys.map(k => `<div class="kv"><div class="k">${esc(k)}</div>
      <div class="v">${esc(String(r[k] ?? '—'))}</div></div>`).join('')}</div>`;
  $('#modal').classList.add('on');
}

function renderFunnel() {
  const box = $('#funnel'); box.innerHTML = '';
  const steps = [
    { n: '全站曝光', v: sum('totalImpsCnt'), c: '#ff6600' },
    { n: '全站点击', v: sum('totalClkCnt'),  c: '#ed8d20' },
    { n: '店铺访问', v: sum('pvCnt'),        c: '#289b69' },
    { n: '商机',     v: sum('abCnt'),        c: '#c88918' },
    { n: '询盘',     v: sum('fbCnt'),        c: '#e24b4b' },
    { n: '成交订单', v: sum('sucOrdCnt'),    c: '#ef7d32' },
  ];
  const W = Math.max(box.clientWidth - 10, 420), rowH = 42, H = steps.length * rowH + 14;
  const max = Math.max(...steps.map(s => s.v), 1), L = 82, iw = W - L - 128;
  const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
  steps.forEach((s, i) => {
    const y = i * rowH + 8, w = Math.max((s.v / max) * iw, 2);
    svg.appendChild(el('text', { x: L - 9, y: y + 20, class: 'gt', 'text-anchor': 'end' }, s.n));
    svg.appendChild(el('rect', { x: L, y, width: iw, height: 25, rx: 4, fill: '#f2eeeb' }));
    const bar = el('rect', { x: L, y, width: w, height: 25, rx: 4, fill: s.c, opacity: .82, class: 'bar' });
    const prev = i ? steps[i - 1].v : 0;
    bar.addEventListener('mousemove', ev => showTip(ev,
      `${s.n}: ${fmt(s.v)}` + (i ? `\n上一环节转化: ${prev ? (s.v / prev * 100).toFixed(3) + '%' : '—'}` : '')));
    bar.addEventListener('mouseleave', hideTip);
    svg.appendChild(bar);
    svg.appendChild(el('text', { x: L + iw + 9, y: y + 17, class: 'gt', fill: '#4c4e53' }, fmt(s.v)));
    if (i) svg.appendChild(el('text', { x: L + iw + 9, y: y + 29, class: 'gt' },
      prev ? '↳ ' + (s.v / prev * 100).toFixed(2) + '%' : '—'));
  });
  box.appendChild(svg);
}

function renderRival() {
  const box = $('#rivalChart'); box.innerHTML = '';
  const items = [
    { n: '全站曝光', k: 'totalImpsCnt' }, { n: '全站点击', k: 'totalClkCnt' },
    { n: '店铺访问', k: 'pvCnt' }, { n: '商机数', k: 'abCnt' },
    { n: 'TM咨询', k: 'fbTmUv' }, { n: '成交订单', k: 'sucOrdCnt' },
  ].map(x => ({ ...x, me: sum(x.k), avg: sum(x.k + 'RivalAvg'), good: sum(x.k + 'RivalGood') }));

  const W = Math.max(box.clientWidth - 10, 420), rowH = 46, H = items.length * rowH + 26, L = 78;
  const iw = W - L - 74;
  const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
  const cols = [['#ff6600', '本店'], ['#a7a8ad', '同行均值'], ['#289b69', '同行优秀']];
  cols.forEach(([c, n], i) => {
    svg.appendChild(el('rect', { x: L + i * 90, y: 0, width: 9, height: 9, rx: 2, fill: c }));
    svg.appendChild(el('text', { x: L + i * 90 + 13, y: 8.5, class: 'gt' }, n));
  });
  items.forEach((it, i) => {
    const y = 22 + i * rowH;
    const max = Math.max(it.me, it.avg, it.good, 1);
    svg.appendChild(el('text', { x: L - 9, y: y + 20, class: 'gt', 'text-anchor': 'end' }, it.n));
    [[it.me, '#ff6600'], [it.avg, '#a7a8ad'], [it.good, '#289b69']].forEach(([v, c], k) => {
      const w = Math.max(v / max * iw, 1.5);
      const b = el('rect', { x: L, y: y + k * 11, width: w, height: 9, rx: 2, fill: c, opacity: .85, class: 'bar' });
      b.addEventListener('mousemove', ev => showTip(ev, `${it.n} · ${cols[k][1]}: ${fmt(v)}`));
      b.addEventListener('mouseleave', hideTip);
      svg.appendChild(b);
    });
    svg.appendChild(el('text', { x: L + iw + 8, y: y + 17, class: 'gt', fill: '#4c4e53' }, fmt(it.me)));
  });
  box.appendChild(svg);
}

// ============================ 商品效果 ============================
const PCOLS = [
  { k: 'subject',           n: '商品',     sort: null,                 t: 'name' },
  { k: 'prodLevel3',        n: '分层',     sort: null,                 t: 'tag' },
  { k: 'sumProdShowNum',    n: '搜索曝光', sort: 'views' },
  { k: 'sumProdClickNum',   n: '搜索点击', sort: 'clicks' },
  { k: 'sumProdClickRate',  n: '点击率',   sort: 'clicksRates',        t: 'pct' },
  { k: 'sumProdVisitorCnt', n: '访客',     sort: 'visitors' },
  { k: 'sumProdFbNum',      n: '询盘',     sort: 'inquiries' },
  { k: 'atmFbUv',           n: 'TM咨询',   sort: 'atmFbUv' },
  { k: 'totalImpsCnt',      n: '全站曝光', sort: 'totalImpsCnt' },
  { k: 'totalClkCnt',       n: '全站点击', sort: 'totalClkCnt' },
  { k: 'crtOrd',            n: '起草单',   sort: 'crtOrd' },
  { k: 'rtsOnlineAmt',      n: '信保金额', sort: 'rtsOnlineAmt' },
];
const pState = { pageNo: 1, pageSize: 20, orderBy: 'views', orderModel: 'DESC', total: 0 };
let productAnalysisData = null;
let productFocusMode = 'highExposureLowCtr';

/**
 * 同时加载完整商品诊断和当前分页明细。
 *
 * @returns {Promise<void>} 两个只读查询都结束后完成。
 * @throws {Error} 单个接口失败由各自加载函数处理，不向外抛出。
 */
async function loadProductPage() {
  await Promise.all([loadProductAnalysis(), loadProduct()]);
}

/**
 * 读取服务端基于完整商品集合计算的四象限、漏斗与质量诊断。
 *
 * @returns {Promise<void>} 渲染完成后结束。
 * @throws {Error} 接口异常由 dashboardApi 转为页面提示。
 */
async function loadProductAnalysis() {
  const response = await dashboardApi('/api/dashboard/product-analysis');
  if (!response) return;
  productAnalysisData = response.data;
  renderProductAnalysis();
}

/**
 * 把完整商品分析结果渲染成结论卡、四象限和问题清单。
 *
 * @returns {void} 直接更新商品运营页面。
 * @throws {Error} 缺少页面容器时可能抛出 DOM 访问异常。
 */
function renderProductAnalysis() {
  const data = productAnalysisData;
  if (!data) return;
  const q = data.quadrantCounts || {};
  const d = data.diagnostics || {};
  const layer = data.layerCounts || {};
  const ctr = num(data.thresholds?.storeWeightedCtr);
  const exposure = num(data.thresholds?.exposureP75);
  const cards = [
    ['完整分析商品', fmt(data.population), `分页记录 ${fmt(data.recordCount)}`],
    ['搜索加权点击率', pct(ctr), `${fmt(data.totals?.clicks)} 次点击 / ${fmt(data.totals?.exposure)} 次曝光`],
    ['高曝低点', fmt(q.highExposureLowCtr), '最优先改主图、标题、价格与 MOQ'],
    ['点击未询盘', fmt(d.clickedNoInquiry), '检查详情承接、信任与询盘入口'],
  ];
  $('#productMetrics').innerHTML = cards.map(([label, value, note]) =>
    `<article class="analysis-kpi"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></article>`).join('');

  const quadrants = [
    ['highExposureHighCtr', '高曝高点', q.highExposureHighCtr, '主推放量', 'green'],
    ['highExposureLowCtr', '高曝低点', q.highExposureLowCtr, '优先优化点击', 'orange'],
    ['lowExposureHighCtr', '低曝高点', q.lowExposureHighCtr, '补关键词与渠道', 'blue'],
    ['lowExposureLowCtr', '低曝低点', q.lowExposureLowCtr, '重做或收缩', 'gray'],
  ];
  $('#productThresholdNote').textContent = `高曝光 ≥ P75（${fmt(exposure)}）；高点击率 ≥ 店铺加权 CTR（${pct(ctr)}）`;
  $('#productQuadrant').innerHTML = quadrants.map(([key, label, count, action, tone]) =>
    `<button type="button" class="quadrant-card ${tone} ${productFocusMode === key ? 'on' : ''}" data-product-focus="${key}">
      <span>${esc(label)}</span><strong>${fmt(count)}</strong><small>${esc(action)}</small></button>`).join('');
  $$('[data-product-focus]').forEach(button => {
    button.onclick = () => {
      productFocusMode = button.dataset.productFocus;
      renderProductAnalysis();
    };
  });

  const diagnostics = [
    ['有点击但无询盘', d.clickedNoInquiry, '检查详情页说服力、证书、价格带与 MOQ', '高'],
    ['有商机但无起草单', d.inquiryNoDraft, '复盘报价速度、样品与跟进节奏', '中'],
    ['搜索曝光为 0', d.noSearchExposure, '补关键词、类目属性或降低无效供给', '中'],
    ['0–4 分质量审计命中', d.lowScoreQueryRows, '逐品查看质量分问题，不等同全店低质总数', '中'],
    ['零效果审计返回', d.zeroEffectRows, '最近一次实跑返回 0 条，不制造待办', '常规'],
    ['P4P 商品', d.p4pProducts, '当前商品效果样本中未识别到投放商品', '观察'],
  ];
  $('#productDiagnostics').innerHTML = diagnostics.map(([label, value, advice, level]) =>
    `<article><span class="diag-count">${value == null ? '—' : fmt(value)}</span><div><b>${esc(label)}</b><p>${esc(advice)}</p></div><em>${esc(level)}</em></article>`).join('');
  $('#productMetrics').setAttribute('data-layer-summary', JSON.stringify(layer));
  renderProductFocus();
}

/**
 * 根据选中的四象限生成重点商品队列，并给出可执行建议。
 *
 * @returns {void} 直接更新重点商品标题与表格。
 * @throws {Error} 缺少分析结果时安全返回。
 */
function renderProductFocus() {
  if (!productAnalysisData) return;
  const config = {
    highExposureHighCtr: ['高曝高点主推商品', '保持核心词排名，扩大优质渠道并观察询盘承接', '保持投放与库存'],
    highExposureLowCtr: ['高曝低点重点商品', '优先优化主图、标题、价格带和 MOQ', '优化主图 / 标题'],
    lowExposureHighCtr: ['低曝高点潜力商品', '点击效率已验证，优先补搜索词、关联品与渠道曝光', '补关键词 / 流量'],
    lowExposureLowCtr: ['低曝低点收缩清单', '先判断是否重做商品表达；无战略价值时减少维护成本', '重做或收缩'],
  };
  const [title, hint, advice] = config[productFocusMode] || config.highExposureLowCtr;
  const rows = productAnalysisData.focusProducts?.[productFocusMode] || [];
  $('#productFocusTitle').textContent = title;
  $('#productFocusHint').textContent = hint;
  $('#productFocusCount').textContent = `${fmt(productAnalysisData.quadrantCounts?.[productFocusMode])} 个 · 展示前 ${rows.length}`;
  if (!rows.length) {
    $('#productFocusTable').innerHTML = '<div class="empty">当前象限没有商品</div>';
    return;
  }
  $('#productFocusTable').innerHTML = `<table><thead><tr><th>商品</th><th>分层</th><th>曝光</th><th>点击</th><th>点击率</th><th>询盘</th><th>TM</th><th>建议</th></tr></thead><tbody>${rows.map(row =>
    `<tr><td><div class="product-cell">${row.image ? `<img src="${esc(row.image)}" alt="" loading="lazy">` : ''}<span class="pname" title="${esc(row.title)}">${esc(row.title || '未命名商品')}</span></div></td><td><span class="tag t-${esc(row.level)}">${esc(row.level)}</span></td><td>${fmt(row.exposure)}</td><td>${fmt(row.clicks)}</td><td>${pct(row.clickRate)}</td><td>${fmt(row.inquiries)}</td><td>${fmt(row.tmInquiries)}</td><td><span class="action-tag">${esc(advice)}</span></td></tr>`).join('')}</tbody></table>`;
}

async function loadProduct() {
  const p = {
    pageNo: pState.pageNo, pageSize: pState.pageSize,
    orderBy: pState.orderBy, orderModel: pState.orderModel,
    prodLevel: $('#prodLevel').value,
    productName: $('#prodSearch').value.trim(),
    hasEffect: $('#fHasEffect').checked ? 'Y' : '',
    p4pProd:   $('#fP4p').checked ? 'Y' : '',
  };
  const j = await api('shop-product', p);
  if (!j) return;
  const rows = j.data?.data || [];
  pState.total = j.data?.recordCount || 0;
  renderProduct(rows);
  $('#prodPageInfo').textContent =
    `第 ${pState.pageNo} 页 · 本页 ${rows.length} 条 · 共 ${fmt(pState.total)} 条${j.cached ? ' (缓存)' : ''}`;
}

function renderProduct(rows) {
  const box = $('#prodTable');
  if (!rows.length) { box.innerHTML = '<div class="empty">无匹配商品</div>'; return; }
  const head = PCOLS.map(c => {
    const act = c.sort && c.sort === pState.orderBy;
    return `<th class="${c.sort ? 'sortable' : ''} ${act ? 'act' : ''}" data-s="${c.sort || ''}">${c.n}${
      c.sort ? `<span class="ar">${act ? (pState.orderModel === 'DESC' ? '▼' : '▲') : '⇅'}</span>` : ''}</th>`;
  }).join('');
  const body = rows.map((r, i) => '<tr data-i="' + i + '">' + PCOLS.map(c => {
    const v = r[c.k];
    if (c.t === 'name') return `<td><span class="pname" title="${esc(v)}">${esc(v)}</span></td>`;
    if (c.t === 'tag')  return `<td><span class="tag t-${esc(v)}">${esc(v || '—')}</span></td>`;
    if (c.t === 'pct')  return `<td>${pct(v)}</td>`;
    return `<td>${fmt(v)}</td>`;
  }).join('') + '</tr>').join('');
  box.innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;

  box.querySelectorAll('th.sortable').forEach(th => th.onclick = () => {
    const s = th.dataset.s; if (!s) return;
    if (pState.orderBy === s) pState.orderModel = pState.orderModel === 'DESC' ? 'ASC' : 'DESC';
    else { pState.orderBy = s; pState.orderModel = 'DESC'; }
    pState.pageNo = 1;
    toast(`重新查询: orderBy=${s} ${pState.orderModel}`);
    loadProduct();
  });
  box.querySelectorAll('tbody tr').forEach(tr => tr.onclick = () => openProdModal(rows[+tr.dataset.i]));
}

/**
 * 打开商品下钻弹层，并追加查询该商品的真实质量分。
 *
 * @param {object} r - 当前商品效果行。
 * @returns {Promise<void>} 基础弹层立即展示，质量分查询完成后补充诊断。
 * @throws {Error} 接口错误由 api() 转为提示，不向外抛出。
 */
async function openProdModal(r) {
  const skip = new Set(['prodImage', 'detailUrl', 'productDetailUrl']);
  const keys = Object.keys(r).filter(k => !skip.has(k));
  $('#modalBody').innerHTML = `
    <div style="display:flex;gap:14px;align-items:flex-start">
      ${r.prodImage ? `<img src="${esc(r.prodImage)}" style="width:86px;height:86px;border-radius:8px;object-fit:cover;flex:none">` : ''}
      <div><h2 style="font-size:15px;line-height:1.4">${esc(r.subject)}</h2>
      <div class="hint" style="margin-top:5px">ID ${esc(r.id)} · ${esc(r.cateName)} · ${esc(r.prodLevel3)} · 负责人 ${esc(r.fullName || '—')}</div>
      <div class="hint">价格 ${esc(r.price)} · MOQ ${esc(r.minOrderQuantity)} · 更新 ${esc(r.gmtModified)}</div>
      ${r.detailUrl ? `<a href="${esc(r.detailUrl)}" target="_blank" style="font-size:12px">打开商品详情页 ↗</a>` : ''}
      </div></div>
    <section id="productScorePanel" class="score-panel"><span class="spin"></span> 正在读取商品质量分…</section>
    <div class="kvgrid">${keys.map(k => `<div class="kv"><div class="k">${esc(k)}</div>
      <div class="v">${esc(String(r[k] ?? '—')).slice(0, 40)}</div></div>`).join('')}</div>`;
  $('#modal').classList.add('on');
  const score = await api('product-score', { productId: r.id });
  const panel = $('#productScorePanel');
  if (!panel) return;
  if (!score) {
    panel.innerHTML = '<b>质量分未读取</b><span>商品效果仍可用于经营判断。</span>';
    return;
  }
  const scoreData = score.data || {};
  const checked = Object.entries(scoreData)
    .filter(([key, value]) => /problem|issue|risk|error/i.test(key) && value === true)
    .map(([key]) => key);
  panel.innerHTML = `<div><span>商品质量分</span><strong>${esc(scoreData.finalScore ?? scoreData.score ?? '—')}</strong></div>
    <p>${checked.length ? `命中问题：${esc(checked.join('、'))}` : '已检查的问题标记均未命中；质量分与经营效果需分开判断。'}</p>`;
}

// ============================ 产品发布 ============================

/**
 * 产品发布原型使用当前店铺商品效果接口返回过的公开缩略图作为演示素材。
 * 这些记录不包含商品 ID、账号或联系人，仅用于还原用户选中的批量矩阵界面。
 */
const PUBLISH_PRODUCT_IMAGES = [
  'https://sc04.alicdn.com/kf/H02062df234f2459b8373706db7805cb7D.png_100x100.png',
  'https://sc04.alicdn.com/kf/Hae721d44b9c749ac96071ba9db2e3374i.jpg_100x100.jpg',
  'https://sc04.alicdn.com/kf/H2bf256178f1f46a8afa8333073437d127.jpg_100x100.jpg',
  'https://sc04.alicdn.com/kf/H72d123173d8d447a90d9a144eb82ed13m.jpg_100x100.jpg',
  'https://sc04.alicdn.com/kf/H7a0c8d1a176446ebad92e5043d56347e8.jpg_100x100.jpg',
  'https://sc04.alicdn.com/kf/H35d797c28baf4073aed62f92e6c35ea7e.png_100x100.png',
  'https://sc04.alicdn.com/kf/Heaaced7cf5fd4e6bbb7268a7e7a708a4O.png_100x100.png',
  'https://sc04.alicdn.com/kf/H1e0057800cc2490dbb1b5af9b17ab95ap.png_100x100.png',
];

/**
 * Alibaba 国际站真实发品页“产地”控件返回的国家/地区名称。
 *
 * 这份列表在 2026-09-03 从用户已登录、已授权读取的发品页逐项核对得到，
 * 保留平台原始英文名称与排列顺序。它不是 WorkCTL 的返回值，也不能自行改写成
 * “中国 / 广东 / 深圳”三级地址；正式发布时应直接提交用户从平台列表选择的名称。
 *
 * @type {string[]}
 */
const PUBLISH_ORIGIN_OPTIONS = [
  'Andorra', 'United Arab Emirates', 'Afghanistan', 'Antigua and Barbuda', 'Anguilla',
  'Albania', 'Aland Islands', 'Armenia', 'Netherlands Antilles', 'Angola', 'Antarctica',
  'Argentina', 'American Samoa', 'Ascension Island', 'Austria', 'Australia', 'Aruba',
  'Azerbaijan', 'Bosnia and Herzegovina', 'Barbados', 'Bangladesh', 'Belgium',
  'Burkina Faso', 'Bulgaria', 'Bahrain', 'Burundi', 'Benin', 'Saint Barthelemy',
  'Bermuda', 'Brunei Darussalam', 'Bolivia', 'Brazil', 'Bahamas', 'Bhutan',
  'Bouvet Island', 'Botswana', 'Belarus', 'Belize', 'Canada', 'Cocos (Keeling) Islands',
  'Central African Republic', 'Congo, The Republic of Congo', 'Switzerland', "Cote D'Ivoire",
  'Cook Islands', 'Chile', 'Cameroon', 'China', 'Colombia', 'Costa Rica', 'Cuba',
  'Cape Verde', 'Curacao', 'Christmas Island', 'Cyprus', 'Czech Republic', 'Germany',
  'Djibouti', 'Denmark', 'Dominica', 'Dominican Republic', 'Algeria', 'Zanzibar', 'Ecuador',
  'Estonia', 'Egypt', 'Western Sahara', 'Eritrea', 'Spain', 'Ethiopia', 'Finland', 'Fiji',
  'Falkland Islands (Malvinas)', 'Micronesia', 'Faroe Islands', 'France',
  'France Metropolitan', 'Gabon', 'Alderney', 'Grenada', 'Georgia', 'French Guiana',
  'Guernsey', 'Ghana', 'Gibraltar', 'Greenland', 'Gambia', 'Guinea', 'Guadeloupe',
  'Equatorial Guinea', 'Greece', 'Guatemala', 'Guam', 'Guinea-Bissau', 'Guyana',
  'Hong Kong S.A.R.', 'Heard and Mc Donald Islands', 'Honduras',
  'Croatia (local name: Hrvatska)', 'Haiti', 'Hungary', 'Indonesia', 'Ireland', 'Israel',
  'Isle of Man', 'India', 'British Indian Ocean Territory', 'Iraq',
  'Iran (Islamic Republic of)', 'Iceland', 'Italy', 'Jersey', 'Jamaica', 'Jordan', 'Japan',
  'Kenya', 'Kyrgyzstan', 'Cambodia', 'Kiribati', 'Comoros', 'Saint Kitts and Nevis',
  'North Korea', 'South Korea', 'Kosovo', 'Kuwait', 'Cayman Islands', 'Kazakhstan',
  "Lao People's Democratic Republic", 'Lebanon', 'Saint Lucia', 'Liechtenstein',
  'Sri Lanka', 'Liberia', 'Lesotho', 'Lithuania', 'Luxembourg', 'Latvia', 'Libya', 'Morocco',
  'Saint Martin', 'Monaco', 'Moldova', 'Madagascar', 'Marshall Islands', 'Macedonia', 'Mali',
  'Myanmar', 'Mongolia', 'Montenegro', 'Macao S.A.R.', 'Northern Mariana Islands',
  'Martinique', 'Mauritania', 'Montserrat', 'Malta', 'Mauritius', 'Maldives', 'Malawi',
  'Mexico', 'Malaysia', 'Mozambique', 'Namibia', 'New Caledonia', 'Niger', 'Norfolk Island',
  'Nigeria', 'Nicaragua', 'Netherlands', 'Norway', 'Nepal', 'Nauru', 'Niue', 'New Zealand',
  'Oman', 'Panama', 'Peru', 'French Polynesia', 'Papua New Guinea', 'Philippines', 'Pakistan',
  'Poland', 'St. Pierre and Miquelon', 'Pitcairn', 'Palestine', 'Portugal', 'Palau',
  'Paraguay', 'Qatar', 'Reunion', 'Romania', 'Russian Federation', 'Rwanda', 'Saudi Arabia',
  'Solomon Islands', 'Seychelles', 'Scotland', 'Sudan', 'Sweden', 'Singapore',
  'South Georgia and the South Sandwich Islands', 'St. Helena', 'Slovenia',
  'Svalbard and Jan Mayen Islands', 'Slovakia (Slovak Republic)', 'Sierra Leone',
  'San Marino', 'Senegal', 'Somalia', 'Suriname', 'Serbia', 'South Sudan',
  'Sao Tome and Principe', 'El Salvador', 'Sint Maarten', 'Syrian Arab Republic',
  'Swaziland', 'Turks and Caicos Islands', 'Chad', 'French Southern Territories', 'Togo',
  'Thailand', 'Tajikistan', 'Tokelau', 'Timor-Leste', 'Turkmenistan', 'Tunisia', 'Tonga',
  'East Timor', 'Turkey', 'Trinidad and Tobago', 'Tuvalu', 'Taiwan, China', 'Tanzania',
  'Ukraine', 'Uganda', 'United Kingdom', 'United States Minor Outlying Islands',
  'United States', 'Uruguay', 'Uzbekistan', 'Vatican City State (Holy See)',
  'Saint Vincent and the Grenadines', 'Venezuela', 'Virgin Islands (British)',
  'Virgin Islands (U.S.)', 'Vietnam', 'Vanuatu', 'Wallis And Futuna Islands', 'Samoa',
  'Yemen', 'Mayotte', 'Yugoslavia', 'South Africa', 'Zambia',
  'Congo, The Democratic Republic Of The', 'Zimbabwe',
];

/**
 * WorkCTL 0.1.53 实时读取到的叶子类目与必填属性。
 *
 * control 的含义：
 * - select：平台固定单选值，必须从 list-attribute-options 返回值中选择。
 * - multi：平台固定多选值，界面用“已选标签 + 添加下拉”避免把数组误做成文本。
 * - region：Alibaba 发品页的国家/地区单选值；使用可搜索下拉，不接受任意自由文本。
 *
 * @type {Record<string, {categoryId:number,label:string,shortLabel:string,fields:Array<object>}>}
 */
const PUBLISH_CATEGORY_CONFIG = {
  watch: {
    categoryId: 127684037,
    label: '消费电子 > 可穿戴设备 > 智能手表',
    shortLabel: '智能手表',
    fields: [
      { key: 'applicablePeople', attrId: 200001175, label: '适用人群', schemaName: 'Applicable People', control: 'select', choices: ['Children', 'Elderly', 'Female', 'Male', 'Unisex'], defaultValue: 'Unisex' },
      { key: 'batteryLife', attrId: 200000564, label: '电池续航', schemaName: 'Battery Life', control: 'select', choices: ['11 to 30 days', '3 months & above', '5 to 10 days', 'Up to 4 days', 'Within 6 hours'], defaultValue: '5 to 10 days' },
      { key: 'displayType', attrId: 100008161, label: '显示类型', schemaName: 'Display Type', control: 'multi', choices: ['AMOLED', 'IPS', 'LCD', 'LED Display Screen', 'OLED Displays', 'TFT'], defaultValue: ['AMOLED'] },
      { key: 'feature', attrId: 191284141, label: '产品特性', schemaName: 'Feature', control: 'multi', choices: ['Air Pump', 'Anti-fluid corrosion', '3 G', 'Anti-Impact', '4 G', 'App Control', '5 G', 'Bluetooth', 'Cellular', 'Dual SIM Card', 'Dustproof', 'E-sim', 'Gps', 'Health Airbag', 'Led Flashlight', 'Microphone', 'NFC Technology', 'SDK available', 'SIM Card', 'Touchscreen', 'USB', 'with earphone'], defaultValue: ['Bluetooth', 'Gps', 'Touchscreen'] },
      { key: 'function', attrId: 210194090, label: '主要功能', schemaName: 'Function', control: 'multi', choices: ['Accelerometer', 'Activity Tracker', 'AI Voice Assistant', 'Alarm Clock', 'Altitude Meter', 'Answer Call', 'Audio Recording', 'Breath Monitor', 'Calculators', 'Calendar', 'Call Reminder', 'Calorie Tracker', 'chronograph', 'COMPASS', 'Countdown', 'Dial Call', 'Distance Tracker', 'EMAIL', 'Fitness Tracker', 'Gesture Control', 'Gps Navigation', 'Heart Rate Tracker', 'Interactive Music', 'Menstrual Management', 'Message Reminder', 'Moisture Measurement', 'Mood Tracker', 'Multisport Tracker', 'Music Player', 'Noctilucent', 'Passometer', 'Payment', 'Pedometer', 'Playing the Quran', 'Positioning', 'Power Reserve', 'Prayer reminder', 'Pregnancy follow-up', 'Push Message', 'Qibla Direction', 'Remote Control', 'Sedentary Reminder', 'Sleep Tracker', 'Smart Counter', 'Social Media Notifications', 'SOS button', 'Speed Measurement', 'THERMOMETER', 'Video Call', 'Voice Call', 'WORLD TIME'], defaultValue: ['Fitness Tracker', 'Heart Rate Tracker', 'Sleep Tracker'] },
      { key: 'screenResolution', attrId: 100008162, label: '屏幕分辨率', schemaName: 'Screen Resolution', control: 'multi', choices: ['1024x768', '1280X720', '1280X800', '128X128', '160X128', '1920X1080', '320x240', '480X320', '640X480', '800X480', '854X480', '960x640'], defaultValue: ['480X320'] },
      { key: 'placeOfOrigin', attrId: 1, label: '原产地', schemaName: 'Place of Origin', control: 'region', choices: PUBLISH_ORIGIN_OPTIONS, defaultValue: 'China' },
      { key: 'itemShape', attrId: 200000161, label: '表盘形状', schemaName: 'Item Shape', control: 'select', choices: ['Heart', 'Others', 'Oval', 'Rectangular', 'Round', 'Square', 'Star'], defaultValue: 'Round' },
      { key: 'screenSize', attrId: 294526319, label: '屏幕尺寸', schemaName: 'Screen Size', control: 'select', choices: ['≤25mm', '28mm', '29-35mm', '36-40mm', '41-43mm', '44-49mm', '≥50mm'], defaultValue: '36-40mm' },
      { key: 'waterproofStandard', attrId: 210188460, label: '防水等级', schemaName: 'Waterproof Standard', control: 'multi', choices: ['3 ATM', '5 ATM', '10 ATM', 'IP65', 'Ip67', 'IP68', 'IP69', 'IPX-6', 'IPX-7', 'IPX 8', 'No'], defaultValue: ['IP68'] },
    ],
  },
  tracker: {
    categoryId: 127688045,
    label: '消费电子 > 可穿戴设备 > 智能手环',
    shortLabel: '智能手环',
    fields: [
      { key: 'displayType', attrId: 100008161, label: '显示类型', schemaName: 'Display Type', control: 'multi', choices: ['AMOLED', 'CSTN', 'IPS', 'no display screen', 'OLED Displays', 'TFT'], defaultValue: ['AMOLED'] },
      { key: 'waterproof', attrId: 191284683, label: '防水能力', schemaName: 'Waterproof', control: 'multi', choices: ['10 ATM', '3 ATM', '5 ATM', 'Ip67', 'IP68', 'IPX 8', 'IPX-6', 'IPX-7'], defaultValue: ['IP68'] },
      { key: 'placeOfOrigin', attrId: 1, label: '原产地', schemaName: 'Place of Origin', control: 'region', choices: PUBLISH_ORIGIN_OPTIONS, defaultValue: 'China' },
      { key: 'operationSystem', attrId: 191286108, label: '操作系统', schemaName: 'Operation System', control: 'select', choices: ['Android', 'Fitbit OS', 'Garmin OS', 'Harmony OS', 'Linux', 'Tizen', 'watch OS', 'Wear OS', 'Windows Mobile', 'Zepp OS'], defaultValue: 'Android' },
      { key: 'style', attrId: 400027416, label: '风格', schemaName: 'sytle', control: 'multi', choices: ['Casual', 'Classic', 'Fashion', 'Sports'], defaultValue: ['Sports'] },
    ],
  },
  earbuds: {
    categoryId: 202055012,
    label: '消费电子 > 音频设备 > 降噪真无线耳机',
    shortLabel: '降噪真无线耳机',
    fields: [
      { key: 'estimatedBatteryLife', attrId: 400013808, label: '预计续航', schemaName: 'Estimated Battery Life', control: 'select', choices: ['less than 3 hours', '3-5 hours', '5-10 hours', '10-15 hours', '15-20 hours', 'more than 20 hours'], defaultValue: '5-10 hours' },
      { key: 'noiseCancelling', attrId: 349387903, label: '降噪方式', schemaName: 'Noise Cancelling', control: 'multi', choices: ['Active Noise Cancellation (ANC)', 'Environmental Noise Cancellation (ENC)'], defaultValue: ['Active Noise Cancellation (ANC)'] },
      { key: 'touchScreen', attrId: 19093, label: '触控屏', schemaName: 'Touch Screen', control: 'select', choices: ['No', 'Yes'], defaultValue: 'No' },
      { key: 'placeOfOrigin', attrId: 1, label: '原产地', schemaName: 'Place of Origin', control: 'region', choices: PUBLISH_ORIGIN_OPTIONS, defaultValue: 'China' },
      { key: 'batteryCapacity', attrId: 200001063, label: '电池容量', schemaName: 'Battery Capacity(mAh)', control: 'select', choices: ['200mAh', '200-500mah', '1000-2000mah', '2000-3000mah', '500-1000mah', '3000-5000mah', '>5000mAh'], defaultValue: '200-500mah' },
      { key: 'headphoneFormFactor', attrId: 395580019, label: '耳机形态', schemaName: 'Headphone Form Factor', control: 'select', choices: ['Ear-clip', 'Ear-hook', 'In ear', 'Semi-in-ear'], defaultValue: 'In ear' },
      { key: 'waterproofStandard', attrId: 210188460, label: '防水等级', schemaName: 'Waterproof Standard', control: 'select', choices: ['IPX-0', 'IPX-2', 'IPX-3', 'IPX-4', 'IPX-5', 'IPX-6', 'IPX-7', 'IPX-8', 'IPX-9', 'No'], defaultValue: 'IPX-5' },
    ],
  },
  sportsHeadphones: {
    categoryId: 202061615,
    label: '消费电子 > 音频设备 > 运动耳机',
    shortLabel: '运动耳机',
    fields: [
      { key: 'placeOfOrigin', attrId: 1, label: '原产地', schemaName: 'Place of Origin', control: 'region', choices: PUBLISH_ORIGIN_OPTIONS, defaultValue: 'China' },
      { key: 'batteryCapacity', attrId: 267221405, label: '电池容量', schemaName: 'Battery Capacity', control: 'select', choices: ['<200mah', '200-500mah', '500-1000mah', '1000-2000mah', '2000-3000mah', '>3000mah'], defaultValue: '200-500mah' },
      { key: 'batteryCapacityMah', attrId: 200001063, label: '电池容量 (mAh)', schemaName: 'Battery Capacity(mAh)', control: 'select', choices: ['<200mah', '200-500mah', '500-1000mah', '1000-2000mah', '2000-3000mah', '>3000mah'], defaultValue: '200-500mah' },
      { key: 'connection', attrId: 102539109, label: '连接方式', schemaName: 'Connection', control: 'select', choices: ['Wired', 'Wired+wireless dual mode', 'Wireless'], defaultValue: 'Wireless' },
      { key: 'estimatedBatteryLife', attrId: 400013808, label: '预计续航', schemaName: 'Estimated Battery Life', control: 'select', choices: ['less than 3 hours', '3-5 hours', '5-10 hours', '10-15 hours', '15-20 hours', 'more than 20 hours'], defaultValue: '5-10 hours' },
      { key: 'volumeControl', attrId: 210236266, label: '音量控制', schemaName: 'Volume Control', control: 'select', choices: ['No', 'Yes'], defaultValue: 'Yes' },
      { key: 'waterproofStandard', attrId: 210188460, label: '防水等级', schemaName: 'Waterproof Standard', control: 'select', choices: ['IPX-0', 'IPX-1', 'IPX-2', 'IPX-3', 'IPX-4', 'IPX-5', 'IPX-6', 'IPX-7', 'IPX-8', 'IPX-9', 'No'], defaultValue: 'IPX-5' },
    ],
  },
};

/**
 * 返回一个字段是否属于当前类目发布时的必填项。
 *
 * 旧 Demo 配置没有 required 字段，按历史行为视为必填；实时 WorkCTL Schema
 * 则严格使用 required=true/false，避免把可选属性错误计入完成度。
 *
 * @param {object} field - PUBLISH_CATEGORY_CONFIG 中的一条字段定义。
 * @returns {boolean} 需要计入必填完整度时返回 true。
 * @throws {Error} 不主动抛出异常。
 */
function isRequiredPublishField(field) {
  return field?.required !== false;
}

/**
 * 把服务端返回的实时类目 Schema 注册为当前页面可渲染的配置。
 *
 * @param {object} schema - `/api/publish/category-schema` 返回的 schema。
 * @returns {string} 注册后的 categoryKey。
 * @throws {Error} schema 缺少有效类目 ID 或属性数组时抛出。
 */
function registerLivePublishCategory(schema) {
  const categoryId = Number(schema?.categoryId);
  if (!Number.isSafeInteger(categoryId) || categoryId <= 0 || !Array.isArray(schema?.attributes)) {
    throw new Error('平台返回的类目 Schema 无效');
  }
  const existingEntry = Object.entries(PUBLISH_CATEGORY_CONFIG)
    .find(([, config]) => Number(config.categoryId) === categoryId);
  const categoryKey = existingEntry?.[0] || `category-${categoryId}`;
  const previousConfig = existingEntry?.[1] || null;
  const previousFieldsById = new Map((previousConfig?.fields || []).map(field => [Number(field.attrId), field]));
  const fields = schema.attributes.map(attribute => {
    const attrId = Number(attribute.attrNameId);
    const previousField = previousFieldsById.get(attrId);
    const choices = (Array.isArray(attribute.options) ? attribute.options : [])
      .map(option => String(option?.label || '')).filter(Boolean);
    const choiceIds = Object.fromEntries((Array.isArray(attribute.options) ? attribute.options : [])
      .filter(option => Number.isSafeInteger(Number(option?.id)) && option?.label)
      .map(option => [String(option.label), Number(option.id)]));
    return {
      key: previousField?.key || `attr_${attrId}`,
      attrId,
      label: previousField?.label || attribute.attrName,
      schemaName: attribute.attrName,
      control: attribute.control || 'text',
      choices: attrId === 1 && !choices.length ? PUBLISH_ORIGIN_OPTIONS : choices,
      choiceIds,
      required: attribute.required === true,
      multiSelect: attribute.multiSelect === true,
      enumProp: attribute.enumProp === true,
      inputProp: attribute.inputProp === true,
      optionSource: attribute.optionSource || 'workctl-live',
      defaultValue: attribute.multiSelect === true ? [] : '',
    };
  });
  PUBLISH_CATEGORY_CONFIG[categoryKey] = {
    categoryId,
    label: String(schema.categoryPath || schema.categoryName || `类目 ${categoryId}`),
    shortLabel: String(schema.categoryName || schema.categoryPath || `类目 ${categoryId}`),
    fields,
    source: 'workctl-live',
    fetchedAt: schema.fetchedAt || '',
  };

  // 同一类目下已经存在的本地草稿同步迁移到实时字段定义。迁移按 attrNameId，
  // 不按中英文标签，避免翻译变化导致用户刚填写的值丢失。
  publishState.products.filter(product => Number(product.categoryId) === categoryId).forEach(product => {
    const previousValuesById = new Map((previousConfig?.fields || []).map(field => [
      Number(field.attrId), product.attributes?.[field.key],
    ]));
    product.categoryKey = categoryKey;
    product.category = PUBLISH_CATEGORY_CONFIG[categoryKey].label;
    product.attributes = Object.fromEntries(fields.map(field => {
      const previousValue = previousValuesById.get(field.attrId);
      const emptyValue = field.multiSelect ? [] : '';
      return [field.key, previousValue === undefined ? emptyValue : previousValue];
    }));
  });
  return categoryKey;
}

/**
 * 从后端读取一个类目的实时属性和官方选项，并注册到页面。
 *
 * @param {number} categoryId - Alibaba 叶子类目 ID。
 * @returns {Promise<string>} 可用于商品状态的 categoryKey。
 * @throws {Error} 网络失败或服务端无法读取当前账号 Schema 时抛出。
 */
async function ensureLivePublishCategory(categoryId) {
  const existing = Object.entries(PUBLISH_CATEGORY_CONFIG)
    .find(([, config]) => Number(config.categoryId) === Number(categoryId) && config.source === 'workctl-live');
  if (existing) return existing[0];
  const response = await fetch(`/api/publish/category-schema?categoryId=${encodeURIComponent(categoryId)}`);
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return registerLivePublishCategory(payload.schema);
}

/**
 * 将用户输入的类目关键词交给当前账号的实时类目树搜索。
 *
 * @param {string} query - 类目中文、英文名称或数字 ID。
 * @returns {Promise<void>} 搜索结果写入 publishState 并更新类目下拉。
 * @throws {Error} 网络异常会被捕获并以页面提示呈现。
 */
async function searchPublishCategories(query) {
  const normalized = String(query || '').trim();
  if (!normalized) return;
  publishState.categorySearchLoading = true;
  updatePublishCategoryResultSelect();
  try {
    const response = await fetch(`/api/publish/categories?q=${encodeURIComponent(normalized)}&limit=40`);
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    publishState.categoryMatches = Array.isArray(payload.categories) ? payload.categories : [];
  } catch (error) {
    publishState.categoryMatches = [];
    toast(`类目搜索失败：${error.message}`, true);
  } finally {
    publishState.categorySearchLoading = false;
    updatePublishCategoryResultSelect();
  }
}

/**
 * 生成并更新当前编辑器的实时类目结果下拉。
 *
 * @returns {void} 仅更新 select，不重绘整个编辑器，因此输入搜索词时不会失焦。
 * @throws {Error} 不主动抛出异常；编辑器尚未渲染时直接返回。
 */
function updatePublishCategoryResultSelect() {
  const select = $('#publishCategoryResults');
  const product = publishState.products.find(item => item.id === publishState.activeId);
  if (!select || !product) return;
  const matches = publishState.categoryMatches.filter(category => Number(category.id) !== Number(product.categoryId));
  select.innerHTML = `<option value="${esc(product.categoryId)}" selected>${esc(product.category)}</option>` +
    matches.map(category => `<option value="${esc(category.id)}" data-category-path="${esc(category.path)}">${esc(category.path)}</option>`).join('');
  select.disabled = publishState.categorySearchLoading || product.schemaLoading ||
    !publishState.accountContextLoaded;
}

/**
 * 切换当前商品类目，并按新类目的 attrNameId 迁移可复用字段。
 *
 * @param {object} product - 当前编辑的本地商品草稿。
 * @param {number} categoryId - 用户从实时搜索结果中选择的叶子类目 ID。
 * @returns {Promise<void>} 新 Schema 加载完成后重绘整个发品页。
 * @throws {Error} 内部错误会被捕获并恢复原类目。
 */
async function applyLivePublishCategory(product, categoryId) {
  product.schemaLoading = true;
  renderPublishEditor();
  try {
    const categoryKey = await ensureLivePublishCategory(categoryId);
    const categoryConfig = PUBLISH_CATEGORY_CONFIG[categoryKey];
    migratePublishProductToAccountCategory(product, categoryKey, 'manual-selection');
    // 物流属性可能随商品类型变化，切换类目时不沿用旧类目的电池等编码。
    product.logisticsProperty = [];
    product.status = 'needs_attention';
    publishState.categoryMatches = [];
    toast(`已切换为 ${categoryConfig.shortLabel}，表单已按当前账号实时规则更新`);
  } catch (error) {
    toast(`无法切换类目：${error.message}`, true);
  } finally {
    product.schemaLoading = false;
    renderProductPublish();
  }
}

/**
 * 为一个叶子类目生成符合当前系统选项的默认必填属性。
 *
 * @param {string} categoryKey - PUBLISH_CATEGORY_CONFIG 中的类目键。
 * @returns {Record<string, string|string[]>} 单选值为字符串，多选值为字符串数组。
 * @throws {Error} 类目键不存在时退回智能手表配置，不主动抛出异常。
 */
function defaultPublishAttributes(categoryKey) {
  const config = PUBLISH_CATEGORY_CONFIG[categoryKey] || PUBLISH_CATEGORY_CONFIG.watch;
  return Object.fromEntries(config.fields.map(field => [
    field.key,
    Array.isArray(field.defaultValue) ? [...field.defaultValue] : field.defaultValue,
  ]));
}

/**
 * 计算类目必填属性的真实完成数，不再依赖容易过期的手写计数。
 *
 * @param {object} product - 当前本地商品草稿。
 * @returns {{completed:number,total:number}} 已填数量和该叶子类目必填总数。
 * @throws {Error} 不主动抛出异常。
 */
function publishAttributeProgress(product) {
  const fields = (PUBLISH_CATEGORY_CONFIG[product.categoryKey] || PUBLISH_CATEGORY_CONFIG.watch).fields
    .filter(isRequiredPublishField);
  const completed = fields.filter(field => {
    const value = product.attributes?.[field.key];
    return Array.isArray(value) ? value.length > 0 : Boolean(String(value || '').trim());
  }).length;
  return { completed, total: fields.length };
}

/**
 * 生成一条本地产品草稿。统一入口让初始 Demo 和用户后续上传的图片保持相同字段结构。
 *
 * @param {object} overrides - 需要覆盖的商品标题、图片、完整度或状态。
 * @returns {object} 可直接进入批量矩阵和右侧编辑器的本地草稿。
 * @throws {Error} 本函数只组合普通对象，不主动抛出异常。
 */
function createPublishProduct(overrides = {}) {
  const categoryKey = overrides.categoryKey || 'watch';
  const categoryConfig = PUBLISH_CATEGORY_CONFIG[categoryKey] || PUBLISH_CATEGORY_CONFIG.watch;
  const attributes = { ...defaultPublishAttributes(categoryKey), ...(overrides.attributes || {}) };
  // 演示草稿通过 requiredCompleted 制造真实的“待补全”状态；被清空的是该类目最后几个必填字段。
  if (Number.isInteger(overrides.requiredCompleted)) {
    categoryConfig.fields.slice(Math.max(0, overrides.requiredCompleted)).forEach(field => {
      attributes[field.key] = field.control === 'multi' ? [] : '';
    });
  }
  const base = {
    id: `publish-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: 'Untitled Product',
    categoryKey,
    categoryId: categoryConfig.categoryId,
    category: categoryConfig.label,
    image: PUBLISH_PRODUCT_IMAGES[0],
    // Demo 商品也必须带真实可访问的远程图片，队列适配器不会把 imageCount 这种
    // 展示计数冒充图片素材。用户后续上传的 blob: 图片则会在确认前明确阻止。
    gallery: [...new Set([overrides.image || PUBLISH_PRODUCT_IMAGES[0], ...PUBLISH_PRODUCT_IMAGES])].slice(0, 5),
    imageCount: 5,
    requiredCompleted: categoryConfig.fields.length,
    requiredTotal: categoryConfig.fields.length,
    tradeReady: true,
    logisticsReady: true,
    status: 'ready',
    selected: true,
    schemaLoading: false,
    uploads: [],
    referenceImported: false,
    keywords: ['AMOLED Display', 'BT Call', 'GPS Tracking', 'Heart Rate', 'IP68'],
    attributes,
    saleType: 'normal',
    batchNum: 1,
    moq: 100,
    inventory: 5000,
    priceUnit: '件 / 个',
    priceUnitId: null,
    priceTiers: [
      { minQuantity: 100, unitPrice: 12.5 },
      { minQuantity: 500, unitPrice: 10.8 },
      { minQuantity: 1000, unitPrice: 8.9 },
    ],
    leadTimeTiers: [
      { maxQuantity: 500, days: 5 },
      { maxQuantity: 2000, days: 7 },
    ],
    package: { length: 10, width: 8, height: 6, weight: 0.18 },
    logisticsProperty: ['battery_0_0'],
    shippingTemplate: '使用国际站默认运费设置',
    shippingTemplateId: null,
    sellingPoints: [
      '1.43-inch AMOLED display with 480×320 platform resolution option, vivid and clear.',
      'Bluetooth calling and GPS tracking for smarter daily connectivity.',
      'IP68 waterproof with all-day health and sports monitoring.',
      'OEM/ODM branding, packaging and multilingual interface options available.',
      'Low-MOQ samples and stable lead times for wholesale buyers.',
    ],
  };
  const result = { ...base, ...overrides, categoryKey, categoryId: categoryConfig.categoryId, category: categoryConfig.label, attributes };
  const progress = publishAttributeProgress(result);
  result.requiredCompleted = progress.completed;
  result.requiredTotal = progress.total;
  return result;
}

const publishState = {
  products: [
    createPublishProduct({ id: 'publish-1', title: '1.43-inch AMOLED Smart Watch', image: PUBLISH_PRODUCT_IMAGES[0], gallery: PUBLISH_PRODUCT_IMAGES.slice(0, 5) }),
    createPublishProduct({ id: 'publish-2', title: 'TWS Wireless Earbuds Noise Cancelling', categoryKey: 'earbuds', image: PUBLISH_PRODUCT_IMAGES[1], imageCount: 5, requiredCompleted: 5, logisticsReady: false, status: 'needs_attention', shippingTemplate: '' }),
    createPublishProduct({ id: 'publish-3', title: 'Kids Smart Watch 4G GPS', image: PUBLISH_PRODUCT_IMAGES[2], imageCount: 4, requiredCompleted: 7, tradeReady: true, logisticsReady: false, status: 'needs_attention', shippingTemplate: '' }),
    createPublishProduct({ id: 'publish-4', title: 'Open-ear Bluetooth Earphones', categoryKey: 'sportsHeadphones', image: PUBLISH_PRODUCT_IMAGES[3] }),
    createPublishProduct({ id: 'publish-5', title: 'Round AMOLED Smart Watch', image: PUBLISH_PRODUCT_IMAGES[4] }),
    createPublishProduct({ id: 'publish-6', title: 'Fitness Tracker Heart Rate', categoryKey: 'tracker', category: '消费电子 > 可穿戴设备 > 智能手环', image: PUBLISH_PRODUCT_IMAGES[5] }),
    createPublishProduct({ id: 'publish-7', title: 'Kids Watch Color Screen', image: PUBLISH_PRODUCT_IMAGES[6], imageCount: 2, requiredCompleted: 4, tradeReady: false, logisticsReady: false, status: 'recognizing', shippingTemplate: '' }),
    createPublishProduct({ id: 'publish-8', title: 'TWS Earbuds Long Battery', categoryKey: 'earbuds', image: PUBLISH_PRODUCT_IMAGES[7], imageCount: 3, requiredCompleted: 4, logisticsReady: false, status: 'needs_attention', shippingTemplate: '' }),
  ],
  activeId: 'publish-1',
  query: '',
  statusFilter: 'all',
  queue: [],
  queueCollapsed: false,
  queuePoller: null,
  activeOperationId: null,
  pendingResultOperationIds: new Set(),
  announcedResultOperationIds: new Set(),
  categoryMatches: [],
  categorySearchLoading: false,
  categorySearchTimer: null,
  businessOptions: {
    priceUnits: [],
    shippingTemplates: [],
    defaultPriceUnit: null,
    defaultShippingTemplate: null,
    shippingFallbackLabel: '使用国际站默认运费设置',
  },
  businessOptionsLoading: false,
  businessOptionsError: '',
  accountContextLoading: false,
  accountContextLoaded: false,
  accountContextError: '',
  accountCategories: [],
  defaultCategoryKey: '',
  uploadCapability: { loaded: false, configured: false, maxBytes: 8 * 1024 * 1024 },
  referenceImportOpen: false,
  referenceImportLoading: false,
  referenceImportValue: '',
  referenceImportError: '',
};

/**
 * 根据商品字段重新计算行状态，避免标题或物流模板修改后列表仍显示旧状态。
 *
 * @param {object} product - 当前商品草稿。
 * @returns {'ready'|'needs_attention'|'recognizing'} 商品最新状态。
 * @throws {Error} 不主动抛出异常。
 */
function publishProductStatus(product) {
  if (product.status === 'recognizing') return 'recognizing';
  const progress = publishAttributeProgress(product);
  product.requiredCompleted = progress.completed;
  product.requiredTotal = progress.total;

  // 交易字段严格按 product-edit-draft-trade 的类型约束做本地校验。
  const priceTiersValid = Array.isArray(product.priceTiers) && product.priceTiers.length > 0 &&
    product.priceTiers.every(tier => Number.isInteger(tier.minQuantity) && tier.minQuantity >= 1 && Number(tier.unitPrice) > 0);
  const batchValid = product.saleType === 'normal' ||
    (product.saleType === 'batch' && Number.isInteger(product.batchNum) && product.batchNum >= 1);
  product.tradeReady = ['normal', 'batch'].includes(product.saleType) && batchValid &&
    Number.isInteger(product.moq) && product.moq >= 1 &&
    Number.isInteger(product.inventory) && product.inventory >= 0 &&
    Number.isSafeInteger(Number(product.priceUnitId)) && Number(product.priceUnitId) > 0 && priceTiersValid;

  // 包装长宽高必须成组填写；交期必须是数量与天数组成的阶梯数组。物流模板
  // 本身不是底层发布素材的必填项：有店铺方案时服务端自动回填，没有时
  // 由国际站使用账号默认设置，因此不能再把内部模板 ID 当成用户完成度。
  const packageValues = ['length', 'width', 'height'].map(key => Number(product.package?.[key]));
  const packageValid = packageValues.every(value => Number.isFinite(value) && value > 0) && Number(product.package?.weight) > 0;
  const leadTimeValid = Array.isArray(product.leadTimeTiers) && product.leadTimeTiers.length > 0 &&
    product.leadTimeTiers.every(tier => Number.isInteger(tier.maxQuantity) && tier.maxQuantity >= 1 && Number.isInteger(tier.days) && tier.days >= 1);
  product.logisticsReady = leadTimeValid && packageValid;

  const complete = product.title.trim() && product.imageCount >= 5 &&
    progress.completed >= progress.total && product.tradeReady && product.logisticsReady;
  return complete ? 'ready' : 'needs_attention';
}

/**
 * 返回当前搜索与筛选条件下的商品，供表格和选择计数共同使用。
 *
 * @returns {object[]} 当前需要展示的商品数组。
 * @throws {Error} 不主动抛出异常。
 */
function visiblePublishProducts() {
  const query = publishState.query.toLowerCase();
  return publishState.products.filter(product => {
    product.status = publishProductStatus(product);
    return (!query || `${product.title} ${product.category}`.toLowerCase().includes(query)) &&
      (publishState.statusFilter === 'all' || product.status === publishState.statusFilter);
  });
}

/**
 * 把服务端返回的账号级业务选项应用到全部本地商品草稿。
 *
 * 用户只选择“件 / 个”“套”“店铺常用运费方案”等业务名称；对应整数编码
 * 始终保存在商品对象内部，并在提交时由服务端再次按当前账号选项复核。
 *
 * @param {object} options - `/api/publish/business-options` 返回的选项集合。
 * @returns {void} 原位更新全部商品的计价单位与物流方案。
 * @throws {Error} 不主动抛出异常；格式不完整的选项会被安全忽略。
 */
function applyPublishBusinessOptionsToProducts(options) {
  const priceUnits = Array.isArray(options?.priceUnits) ? options.priceUnits : [];
  const shippingTemplates = Array.isArray(options?.shippingTemplates) ? options.shippingTemplates : [];
  const defaultPriceUnit = Number(options?.defaultPriceUnit);
  const defaultShippingTemplate = Number(options?.defaultShippingTemplate);
  const shippingFallbackLabel = String(options?.shippingFallbackLabel || '使用国际站默认运费设置');

  publishState.products.forEach(product => {
    const priceUnit = priceUnits.find(item => Number(item.value) === Number(product.priceUnitId)) ||
      priceUnits.find(item => Number(item.value) === defaultPriceUnit) || priceUnits[0];
    if (priceUnit) {
      product.priceUnitId = Number(priceUnit.value);
      product.priceUnit = String(priceUnit.label || '店铺常用计价单位');
    }

    const shippingTemplate = shippingTemplates.find(item =>
      Number(item.value) === Number(product.shippingTemplateId)) ||
      shippingTemplates.find(item => Number(item.value) === defaultShippingTemplate) || shippingTemplates[0];
    product.shippingTemplateId = shippingTemplate ? Number(shippingTemplate.value) : null;
    product.shippingTemplate = String(shippingTemplate?.label || shippingFallbackLabel);
    product.status = publishProductStatus(product);
  });
}

/**
 * 从当前登录店铺读取计价单位和物流方案，并自动为页面草稿选择店铺常用值。
 *
 * @returns {Promise<void>} 同步完成后刷新产品发布页面。
 * @throws {Error} 网络错误会在函数内转为页面状态和提示，不继续向外抛出。
 */
async function loadPublishBusinessOptions() {
  if (publishState.businessOptionsLoading) return;
  publishState.businessOptionsLoading = true;
  publishState.businessOptionsError = '';
  renderProductPublish();
  try {
    const response = await fetch('/api/publish/business-options');
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    publishState.businessOptions = payload.options || publishState.businessOptions;
    applyPublishBusinessOptionsToProducts(publishState.businessOptions);
  } catch (error) {
    publishState.businessOptionsError = String(error?.message || error || '同步失败');
    toast(`店铺发品选项暂未同步：${publishState.businessOptionsError}`, true);
  } finally {
    publishState.businessOptionsLoading = false;
    renderProductPublish();
  }
}

/**
 * 读取服务端是否已经配置发品图片存储。
 *
 * 浏览器只需要知道“能否上传”和单图大小限制；bucket、endpoint 等基础设施参数
 * 永远不会进入前端。读取失败时保守地禁止真实上传，避免把 blob: 误当远程图片。
 *
 * @returns {Promise<void>} 能力状态写入 publishState 后刷新编辑器。
 * @throws {Error} 网络错误会被函数内部转换为页面状态，不向外抛出。
 */
async function loadPublishUploadCapability() {
  try {
    const response = await fetch('/api/publish/upload-capability');
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    publishState.uploadCapability = {
      loaded: true,
      configured: payload.configured === true,
      maxBytes: Number(payload.maxBytes) || 8 * 1024 * 1024,
    };
  } catch (error) {
    publishState.uploadCapability = {
      loaded: true,
      configured: false,
      maxBytes: 8 * 1024 * 1024,
      error: String(error?.message || error || '读取失败'),
    };
  }
  renderPublishEditor();
}

/**
 * 将一条本地待发布商品迁移到当前账号实时读取的类目配置。
 *
 * 可复用值只按平台 attrNameId 迁移；固定选项还必须出现在新类目的官方 choices
 * 中，否则清空等待用户选择。这样既能保住“产地”等通用字段，也不会把智能手表
 * 的选项错误带进耳机或其他商家的类目。
 *
 * @param {object} product - publishState 中的一条本地商品草稿。
 * @param {string} categoryKey - 已由 registerLivePublishCategory 注册的实时类目键。
 * @param {string} matchSource - `same-product` 或 `account-category`，仅供界面解释来源。
 * @returns {void} 原位更新商品类目和属性。
 * @throws {Error} 目标实时类目不存在时抛出，避免静默退回开发账号的演示类目。
 */
function migratePublishProductToAccountCategory(product, categoryKey, matchSource) {
  const oldConfig = PUBLISH_CATEGORY_CONFIG[product.categoryKey];
  const targetConfig = PUBLISH_CATEGORY_CONFIG[categoryKey];
  if (!targetConfig || targetConfig.source !== 'workctl-live') {
    throw new Error('当前账号实时类目尚未加载');
  }
  const oldValuesById = new Map((oldConfig?.fields || []).map(field => [
    Number(field.attrId), product.attributes?.[field.key],
  ]));
  product.categoryKey = categoryKey;
  product.categoryId = targetConfig.categoryId;
  product.category = targetConfig.label;
  product.categoryMatchSource = matchSource;
  product.attributes = Object.fromEntries(targetConfig.fields.map(field => {
    const previousValue = oldValuesById.get(Number(field.attrId));
    if (previousValue === undefined) return [field.key, field.multiSelect ? [] : ''];
    if (!field.enumProp || field.control === 'region' || field.inputProp) {
      return [field.key, Array.isArray(previousValue) ? [...previousValue] : previousValue];
    }
    if (field.multiSelect) {
      const values = Array.isArray(previousValue) ? previousValue : [previousValue];
      return [field.key, values.filter(value => field.choices.includes(String(value)))];
    }
    return [field.key, field.choices.includes(String(previousValue)) ? previousValue : ''];
  }));
  product.status = publishProductStatus(product);
}

/**
 * 按“当前账号商品 -> categoryId -> 类目属性 -> 官方选项”的顺序初始化发品表单。
 *
 * categoryId 始终只是系统内部关联键：页面不会要求运营人员查看或填写。原型中能
 * 与当前店铺缩略图精确匹配的素材沿用该商品类目，其余素材沿用店铺已使用的同类
 * 目；仍无匹配时才使用当前账号出现频率最高的类目作为待校对默认值。
 *
 * @returns {Promise<void>} 类目上下文及所需 Schema 加载完成后刷新页面。
 * @throws {Error} 网络或 WorkCTL 错误在函数内转成页面提示，不继续向外抛出。
 */
async function loadPublishAccountContext() {
  if (publishState.accountContextLoading || publishState.accountContextLoaded) return;
  publishState.accountContextLoading = true;
  publishState.accountContextError = '';
  renderProductPublish();
  try {
    const response = await fetch('/api/publish/account-context?limit=500');
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    const contextProducts = Array.isArray(payload.context?.products) ? payload.context.products : [];
    const contextCategories = Array.isArray(payload.context?.categories) ? payload.context.categories : [];
    const defaultCategoryId = Number(payload.context?.defaultCategory?.categoryId);
    if (!Number.isSafeInteger(defaultCategoryId) || defaultCategoryId <= 0) {
      throw new Error('当前账号没有可用于自动匹配的商品类目');
    }
    const availableCategoryIds = new Set(contextCategories.map(item => Number(item.categoryId)));
    const productByImage = new Map(contextProducts
      .filter(item => item?.image)
      .map(item => [String(item.image), item]));
    const assignments = publishState.products.map(product => {
      const sameProduct = productByImage.get(String(product.image || ''));
      const keepCurrentCategory = availableCategoryIds.has(Number(product.categoryId));
      return {
        product,
        sameProduct,
        categoryId: Number(sameProduct?.categoryId || (keepCurrentCategory ? product.categoryId : defaultCategoryId)),
        matchSource: sameProduct ? 'same-product' : 'account-category',
      };
    });
    const categoryIds = [...new Set(assignments.map(item => item.categoryId))];
    const schemaResults = await Promise.allSettled(categoryIds.map(async categoryId => ({
      categoryId,
      categoryKey: await ensureLivePublishCategory(categoryId),
    })));
    const categoryKeys = new Map(schemaResults
      .filter(result => result.status === 'fulfilled')
      .map(result => [result.value.categoryId, result.value.categoryKey]));
    const defaultCategoryKey = categoryKeys.get(defaultCategoryId) ||
      (await ensureLivePublishCategory(defaultCategoryId));
    assignments.forEach(assignment => {
      const categoryKey = categoryKeys.get(assignment.categoryId) || defaultCategoryKey;
      // 原型早期的标题是人工演示文案，可能与后来抓取的缩略图不是同一商品。
      // 已精确匹配到当前账号商品时同步采用真实标题，避免出现“耳机标题 + 手表参数”。
      if (assignment.sameProduct?.title) assignment.product.title = assignment.sameProduct.title;
      migratePublishProductToAccountCategory(assignment.product, categoryKey, assignment.matchSource);
    });
    // 下拉显示的是当前账号全部商品去重后的类目名称；categoryId 只保存在 value
    // 中供系统查询 Schema，运营人员不需要查看或录入。
    publishState.accountCategories = contextCategories;
    publishState.defaultCategoryKey = defaultCategoryKey;
    publishState.accountContextLoaded = true;
  } catch (error) {
    publishState.accountContextError = String(error?.message || error || '自动匹配失败');
    toast(`当前账号类目暂未匹配：${publishState.accountContextError}`, true);
  } finally {
    publishState.accountContextLoading = false;
    renderProductPublish();
  }
}

/**
 * 初始化产品发布页面并绑定一次性的拖放行为。
 *
 * @returns {void} 首次进入页面时渲染全部本地草稿。
 * @throws {Error} 页面结构缺失时可能抛出 DOM 访问异常。
 */
function initProductPublish() {
  const panel = $('.publish-batch-panel');
  if (panel && !panel.dataset.dropBound) {
    panel.dataset.dropBound = 'true';
    panel.addEventListener('dragover', event => {
      event.preventDefault();
      panel.classList.add('is-dragging');
    });
    panel.addEventListener('dragleave', () => panel.classList.remove('is-dragging'));
    panel.addEventListener('drop', event => {
      event.preventDefault();
      panel.classList.remove('is-dragging');
      handlePublishFolderFiles(event.dataTransfer?.files || []);
    });
  }
  renderProductPublish();
  // 账号级计价单位与物流方案和类目 Schema 相互独立，可以并行加载。
  // 两者都只读，用户无需等待或手工填写平台内部编码。
  loadPublishBusinessOptions();
  loadPublishUploadCapability();
  // 先从当前账号商品读取类目，再使用内部 categoryId 加载字段和固定选项。
  // 这是发品编辑器的初始化主链路，不再以写死的智能手表类目作为真实依据。
  loadPublishAccountContext();
  refreshPublishQueue({ silent: true, announce: false }).then(() => {
    if (publishState.queue.some(job => ['queued', 'running'].includes(job.status))) {
      const operationId = resolveVisiblePublishOperationId();
      if (operationId) publishState.pendingResultOperationIds.add(operationId);
      startPublishQueuePolling();
    }
  });
}

/**
 * 重绘发布页全部联动区域。所有数值均来自 publishState，避免不同区域口径不一致。
 *
 * @returns {void} 完成状态条、表格、编辑器、队列和底部操作栏的同步渲染。
 * @throws {Error} 页面关键容器缺失时可能抛出 DOM 访问异常。
 */
function renderProductPublish() {
  renderPublishStatus();
  renderPublishTable();
  renderPublishEditor();
  renderPublishQueue();
  renderPublishOperationProgress();
  renderPublishBottomBar();
}

/**
 * 渲染上传、待补全、检查通过和队列四项流程状态。
 *
 * @returns {void} 直接更新状态带与顶部发布按钮。
 * @throws {Error} 不主动抛出异常。
 */
function renderPublishStatus() {
  const counts = publishState.products.reduce((result, product) => {
    const status = publishProductStatus(product);
    result[status] = (result[status] || 0) + 1;
    return result;
  }, { ready: 0, needs_attention: 0, recognizing: 0 });
  const activeQueue = publishState.queue.filter(job => ['queued', 'running'].includes(job.status)).length;
  $('#publishStatusStrip').innerHTML = [
    ['上传', publishState.products.length, ''],
    ['待补全', counts.needs_attention + counts.recognizing, 'attention'],
    ['发布前检查通过', counts.ready, 'ready'],
    ['队列中', activeQueue, 'queue'],
  ].map(([label, value, tone]) => `<article class="${tone}"><span>${label}</span><strong>${value}</strong></article>`).join('');
}

/**
 * 渲染批量商品矩阵。文本始终转义，用户上传文件名不会作为 HTML 执行。
 *
 * @returns {void} 更新表格行、选择计数和全选状态。
 * @throws {Error} 不主动抛出异常。
 */
function renderPublishTable() {
  const rows = visiblePublishProducts();
  const statusLabel = { ready: '可发布', needs_attention: '待补全', recognizing: '识别中' };
  $('#publishProductRows').innerHTML = rows.length ? rows.map(product => {
    publishProductStatus(product);
    const tradeClass = product.tradeReady ? 'publish-cell-ok' : 'publish-cell-warn';
    const logisticsClass = product.logisticsReady ? 'publish-cell-ok' : 'publish-cell-warn';
    return `<tr data-publish-id="${esc(product.id)}" class="${product.id === publishState.activeId ? 'active' : ''}">
      <td><input type="checkbox" data-publish-select="${esc(product.id)}" ${product.selected ? 'checked' : ''} aria-label="选择 ${esc(product.title)}"></td>
      <td><img class="publish-product-image" src="${esc(product.image)}" alt="${esc(product.title)}" loading="lazy" referrerpolicy="no-referrer"></td>
      <td><b class="publish-product-title">${esc(product.title)}</b><span class="publish-product-category">${esc(product.category)}</span></td>
      <td class="${product.imageCount >= 5 ? 'publish-cell-ok' : 'publish-cell-warn'}">${Math.min(product.imageCount, 5)}/5</td>
      <td class="${product.requiredCompleted >= product.requiredTotal ? 'publish-cell-ok' : 'publish-cell-warn'}">${product.requiredCompleted}/${product.requiredTotal}</td>
      <td class="${tradeClass}">${product.tradeReady ? '已填写' : '待填写'}</td>
      <td class="${logisticsClass}">${product.logisticsReady ? '已填写' : '待填写'}</td>
      <td><span class="publish-row-status ${product.status}">${statusLabel[product.status]}</span></td>
    </tr>`;
  }).join('') : '<tr><td colspan="8"><div class="empty">没有符合筛选条件的商品</div></td></tr>';
  const selected = publishState.products.filter(product => product.selected).length;
  $('#publishSelectionSummary').textContent = `已选择 ${selected} 项`;
  $('#publishSelectAll').checked = rows.length > 0 && rows.every(product => product.selected);
  const categorySelector = $('#publishCategoryFilter');
  const activeProduct = publishState.products.find(product => product.id === publishState.activeId);
  const accountCategories = [...publishState.accountCategories];
  // 用户仍可在右侧搜索完整官方叶子类目。若手动选中的类目不在账号历史商品
  // 的常用类目里，也要临时补进顶部下拉，避免当前选择在重绘后消失。
  if (activeProduct && !accountCategories.some(category =>
    Number(category.categoryId) === Number(activeProduct.categoryId))) {
    const activeConfig = PUBLISH_CATEGORY_CONFIG[activeProduct.categoryKey];
    accountCategories.unshift({
      categoryId: activeProduct.categoryId,
      name: activeConfig?.shortLabel || activeProduct.category,
      path: activeProduct.category,
      productCount: 0,
    });
  }
  categorySelector.innerHTML = publishState.accountContextLoaded
    ? accountCategories.map(category => `<option value="${esc(category.categoryId)}" ${Number(activeProduct?.categoryId) === Number(category.categoryId) ? 'selected' : ''}>${esc(category.name)}${Number(category.productCount) > 0 ? ` · ${esc(category.productCount)}件` : ''}</option>`).join('')
    : '<option>正在读取账号全部类目…</option>';
  categorySelector.disabled = !publishState.accountContextLoaded || !activeProduct || activeProduct.schemaLoading;
  categorySelector.title = activeProduct ? `为当前商品选择类目：${activeProduct.category}` : '为当前商品选择类目';

  $$('#publishProductRows tr[data-publish-id]').forEach(row => {
    row.onclick = event => {
      if (event.target.matches('input[type="checkbox"]')) return;
      publishState.activeId = row.dataset.publishId;
      renderPublishTable();
      renderPublishEditor();
      const activeProduct = publishState.products.find(product => product.id === publishState.activeId);
      if (activeProduct) {
        ensureLivePublishCategory(activeProduct.categoryId)
          .then(() => renderProductPublish())
          .catch(error => toast(`实时类目规则暂不可用：${error.message}`, true));
      }
    };
  });
  $$('[data-publish-select]').forEach(checkbox => {
    checkbox.onchange = () => {
      const product = publishState.products.find(item => item.id === checkbox.dataset.publishSelect);
      if (product) product.selected = checkbox.checked;
      renderProductPublish();
    };
  });
}

/**
 * 生成下拉框选项，并把当前值标为选中。
 *
 * @param {string} currentValue - 当前字段值。
 * @param {string[]} choices - 字段允许的选项。
 * @returns {string} 已转义的 option HTML。
 * @throws {Error} 不主动抛出异常。
 */
function publishSelectOptions(currentValue, choices) {
  return choices.map(choice => `<option value="${esc(choice)}" ${choice === currentValue ? 'selected' : ''}>${esc(choice)}</option>`).join('');
}

/**
 * 按 Alibaba 发品页的国家名称搜索规则生成“产地”选项。
 *
 * @param {string} currentValue - 当前商品已选择的产地名称。
 * @param {string} [query=''] - 用户在下拉面板搜索框中输入的英文关键词。
 * @returns {string} 可直接放入 listbox 的国家/地区按钮 HTML。
 * @throws {Error} 不主动抛出异常；没有匹配结果时返回明确空状态。
 */
function renderPublishOriginOptions(currentValue, query = '') {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  const matches = PUBLISH_ORIGIN_OPTIONS.filter(origin => origin.toLowerCase().includes(normalizedQuery));
  if (!matches.length) {
    return '<div class="publish-origin-empty">没有匹配的国家/地区</div>';
  }
  return matches.map(origin => `<button type="button" role="option" aria-selected="${origin === currentValue}" class="${origin === currentValue ? 'selected' : ''}" data-publish-origin-option="${esc(origin)}"><span>${esc(origin)}</span>${origin === currentValue ? '<i class="ri-check-line" aria-hidden="true"></i>' : ''}</button>`).join('');
}

/**
 * 关闭产品发布编辑器中已经展开的产地下拉。
 *
 * @param {HTMLElement|null} [exceptPicker=null] - 需要保留展开状态的选择器；为空时全部关闭。
 * @returns {void} 只更新当前页面中的下拉展示和 aria-expanded 状态。
 * @throws {Error} 不主动抛出异常；页面中没有产地控件时直接结束。
 */
function closePublishOriginPickers(exceptPicker = null) {
  $$('.publish-origin-picker.open').forEach(picker => {
    if (picker === exceptPicker) return;
    picker.classList.remove('open');
    picker.querySelector('[data-publish-origin-toggle]')?.setAttribute('aria-expanded', 'false');
  });
}

/**
 * 根据属性元数据渲染正确的系统控件。
 *
 * @param {object} field - 当前类目的属性定义，包含 control、choices 和 attrId。
 * @param {string|string[]} value - 当前单选值或多选值。
 * @returns {string} 已转义的单选、多选标签或平台地区选择器 HTML。
 * @throws {Error} 不主动抛出异常；未知 control 会退回普通单选。
 */
function renderPublishAttributeControl(field, value) {
  if (field.control === 'multi') {
    const selectedValues = Array.isArray(value) ? value : (value ? [value] : []);
    const remainingChoices = field.choices.filter(choice => !selectedValues.includes(choice));
    return `<div class="publish-multi-control">
      <div class="publish-multi-values">${selectedValues.length ? selectedValues.map(choice => `<span>${esc(choice)}<button type="button" data-publish-attribute-remove="${esc(field.key)}" data-publish-option="${esc(choice)}" aria-label="移除 ${esc(choice)}"><i class="ri-close-line" aria-hidden="true"></i></button></span>`).join('') : `<em class="${isRequiredPublishField(field) ? 'is-required' : 'is-optional'}">${isRequiredPublishField(field) ? '请选择必填项' : '选填'}</em>`}</div>
      <select data-publish-attribute-add="${esc(field.key)}" aria-label="为 ${esc(field.label)} 添加平台选项"><option value="">添加平台选项…</option>${remainingChoices.map(choice => `<option value="${esc(choice)}">${esc(choice)}</option>`).join('')}</select>
    </div>`;
  }
  if (field.control === 'region') {
    const currentValue = String(value || '');
    return `<div class="publish-origin-picker" data-publish-origin-picker="${esc(field.key)}">
      <button class="publish-origin-trigger" type="button" data-publish-origin-toggle="${esc(field.key)}" aria-haspopup="listbox" aria-expanded="false">
        <span class="${currentValue ? '' : 'placeholder'}">${esc(currentValue || '请输入或者选择')}</span><i class="ri-arrow-down-s-line" aria-hidden="true"></i>
      </button>
      <div class="publish-origin-menu">
        <label class="publish-origin-search"><i class="ri-search-line" aria-hidden="true"></i><input type="search" data-publish-origin-search="${esc(field.key)}" placeholder="搜索国家/地区英文名" autocomplete="off" aria-label="搜索${esc(field.label)}"></label>
        <div class="publish-origin-options" data-publish-origin-options="${esc(field.key)}" role="listbox" aria-label="${esc(field.label)}国家列表">${renderPublishOriginOptions(currentValue)}</div>
      </div>
    </div>`;
  }
  if (field.control === 'text') {
    return `<input data-publish-attribute="${esc(field.key)}" value="${esc(value || '')}" maxlength="160" placeholder="请输入 ${esc(field.label)}">`;
  }
  if (field.control === 'combo') {
    const listId = `publish-options-${field.attrId}`;
    return `<input data-publish-attribute="${esc(field.key)}" value="${esc(value || '')}" maxlength="160" list="${esc(listId)}" placeholder="选择平台选项或输入自定义值"><datalist id="${esc(listId)}">${field.choices.map(choice => `<option value="${esc(choice)}"></option>`).join('')}</datalist>`;
  }
  if (!field.choices.length) {
    return '<select disabled><option>平台暂未返回可选值</option></select>';
  }
  return `<select data-publish-attribute="${esc(field.key)}"><option value="">请选择平台选项</option>${publishSelectOptions(value, field.choices)}</select>`;
}

/**
 * 为当前商品绑定 Alibaba 同款“搜索国家并单选”的产地交互。
 *
 * @param {object} product - 当前正在编辑的本地商品草稿。
 * @returns {void} 绑定展开、搜索、键盘关闭和单选事件；选中后重绘完成度。
 * @throws {Error} 不主动抛出异常；找不到控件或字段时忽略对应事件。
 */
function bindPublishOriginPickers(product) {
  $$('[data-publish-origin-picker]').forEach(picker => {
    const fieldKey = picker.dataset.publishOriginPicker;
    const trigger = picker.querySelector('[data-publish-origin-toggle]');
    const search = picker.querySelector('[data-publish-origin-search]');
    const options = picker.querySelector('[data-publish-origin-options]');
    if (!trigger || !search || !options) return;

    trigger.onclick = event => {
      event.stopPropagation();
      const willOpen = !picker.classList.contains('open');
      closePublishOriginPickers(picker);
      picker.classList.toggle('open', willOpen);
      trigger.setAttribute('aria-expanded', String(willOpen));
      if (willOpen) {
        search.value = '';
        options.innerHTML = renderPublishOriginOptions(product.attributes[fieldKey]);
        search.focus();
      }
    };

    search.oninput = () => {
      options.innerHTML = renderPublishOriginOptions(product.attributes[fieldKey], search.value);
    };
    search.onkeydown = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closePublishOriginPickers();
        trigger.focus();
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        options.querySelector('[data-publish-origin-option]')?.focus();
      }
    };

    options.onclick = event => {
      const option = event.target.closest('[data-publish-origin-option]');
      if (!option) return;
      product.attributes[fieldKey] = option.dataset.publishOriginOption;
      renderProductPublish();
      toast(`原产地已选择：${product.attributes[fieldKey]}`);
    };
  });
}

/**
 * 渲染阶梯价格数组。起订数量和单价拆开为数字输入，避免把价格区间写成不可提交的文本。
 *
 * @param {object} product - 当前商品草稿。
 * @returns {string} 阶梯价格编辑行 HTML。
 * @throws {Error} 不主动抛出异常。
 */
function renderPublishPriceTiers(product) {
  return product.priceTiers.map((tier, index) => `<div class="publish-tier-row">
    <span>第 ${index + 1} 阶梯</span>
    <label><small>起订数量</small><input type="number" min="1" step="1" inputmode="numeric" data-publish-price-tier="${index}" data-publish-tier-field="minQuantity" value="${esc(tier.minQuantity)}"></label>
    <label><small>单价 USD</small><input type="number" min="0.01" step="0.01" inputmode="decimal" data-publish-price-tier="${index}" data-publish-tier-field="unitPrice" value="${esc(tier.unitPrice)}"></label>
    <button type="button" data-publish-price-remove="${index}" ${product.priceTiers.length === 1 ? 'disabled' : ''} aria-label="删除第 ${index + 1} 个价格阶梯"><i class="ri-delete-bin-line" aria-hidden="true"></i></button>
  </div>`).join('');
}

/**
 * 渲染阶梯发货期数组。每一行同时收集数量上限和承诺发货天数。
 *
 * @param {object} product - 当前商品草稿。
 * @returns {string} 阶梯发货期编辑行 HTML。
 * @throws {Error} 不主动抛出异常。
 */
function renderPublishLeadTimeTiers(product) {
  return product.leadTimeTiers.map((tier, index) => `<div class="publish-tier-row publish-period-row">
    <span>第 ${index + 1} 阶梯</span>
    <label><small>数量上限</small><input type="number" min="1" step="1" inputmode="numeric" data-publish-period-tier="${index}" data-publish-period-field="maxQuantity" value="${esc(tier.maxQuantity)}"></label>
    <label><small>发货天数</small><input type="number" min="1" step="1" inputmode="numeric" data-publish-period-tier="${index}" data-publish-period-field="days" value="${esc(tier.days)}"></label>
    <button type="button" data-publish-period-remove="${index}" ${product.leadTimeTiers.length === 1 ? 'disabled' : ''} aria-label="删除第 ${index + 1} 个交期阶梯"><i class="ri-delete-bin-line" aria-hidden="true"></i></button>
  </div>`).join('');
}

/**
 * 取得当前商品最近一次已经结束的服务端发布结果。
 *
 * @param {string} productId - 浏览器本地商品标识。
 * @returns {object|null} 最近一条终态任务；没有历史结果时返回 null。
 * @throws {Error} 不主动抛出异常。
 */
function latestPublishOutcome(productId) {
  return publishState.queue.find(job => job.localId === productId &&
    ['saved_draft', 'submitted', 'failed'].includes(job.status)) || null;
}

/**
 * 将服务端推断的内部区域键翻译成运营人员可以直接处理的表单区域。
 *
 * @param {string[]} fields - publicPublishJob 返回的 failureFields。
 * @returns {string[]} 去重后的中文区域名称。
 * @throws {Error} 不主动抛出异常。
 */
function publishFailureFieldLabels(fields) {
  const labels = {
    images: '商品图片', title: '标题', keywords: '关键词', attributes: '类目属性',
    price: '阶梯价格', moq: '最小起订量', package: '包装信息', fulfillment: '发货与物流',
    sellingPoints: '卖点和详情',
  };
  return [...new Set((Array.isArray(fields) ? fields : []).map(field => labels[field]).filter(Boolean))];
}

/**
 * 渲染最近一次发布的质量分或失败补全提示。
 *
 * @param {object} product - 当前正在编辑的商品。
 * @returns {string} 可插入编辑器的安全 HTML。
 * @throws {Error} 不主动抛出异常，所有外部文本都会转义。
 */
function renderPublishOutcomeInsight(product) {
  const job = latestPublishOutcome(product.id);
  if (!job) return '';
  if (job.status === 'failed') {
    const fields = publishFailureFieldLabels(job.failureFields);
    const guidance = fields.length
      ? `请重点检查：${fields.join('、')}`
      : '请根据平台提示调整商品资料后重新检查。';
    return `<section class="publish-outcome-card is-failure" aria-live="polite">
      <div class="publish-outcome-icon"><i class="ri-error-warning-line" aria-hidden="true"></i></div>
      <div><b>这次没有发布成功</b><p>${esc(guidance)}</p><small>${esc(job.message || '平台没有接受当前商品资料')}</small></div>
      <button type="button" id="publishFixAndRetry">修改后重新检查</button>
    </section>`;
  }
  const hasScore = Number.isFinite(Number(job.finalScore));
  const reasons = (Array.isArray(job.deductReasons) ? job.deductReasons : []).slice(0, 3);
  const scoreCopy = hasScore ? `商品质量分 ${Number(job.finalScore)}` : (job.qualityScoreMessage || '质量分暂未返回');
  return `<section class="publish-outcome-card is-success" aria-live="polite">
    <div class="publish-outcome-icon"><i class="ri-checkbox-circle-line" aria-hidden="true"></i></div>
    <div><b>${job.status === 'saved_draft' ? '草稿已经保存' : '商品已经提交发布'}</b><p>${esc(scoreCopy)}</p>${reasons.length ? `<small>主要扣分：${reasons.map(esc).join('；')}</small>` : '<small>本次没有返回需要立即处理的扣分项</small>'}</div>
  </section>`;
}

/**
 * 渲染当前商品图片上传状态，失败图片保留浏览器预览并提供原地重试。
 *
 * @param {object} product - 当前商品草稿。
 * @returns {string} 上传状态摘要 HTML。
 * @throws {Error} 不主动抛出异常。
 */
function renderPublishUploadSummary(product) {
  const uploads = Array.isArray(product.uploads) ? product.uploads : [];
  const active = uploads.filter(item => ['reading', 'uploading'].includes(item.status));
  const failed = uploads.filter(item => item.status === 'failed');
  const uploaded = uploads.filter(item => item.status === 'uploaded');
  if (!uploads.length && publishState.uploadCapability.configured) {
    return '<p class="publish-image-helper"><i class="ri-cloud-line" aria-hidden="true"></i>新选择的图片会自动上传，成功后才能进入发布。</p>';
  }
  if (!publishState.uploadCapability.loaded) {
    return '<p class="publish-image-helper"><i class="ri-loader-4-line" aria-hidden="true"></i>正在检查图片上传服务…</p>';
  }
  if (!publishState.uploadCapability.configured && !uploads.length) {
    return '<p class="publish-image-helper is-error"><i class="ri-cloud-off-line" aria-hidden="true"></i>图片上传服务尚未配置；现有远程图片仍可继续使用。</p>';
  }
  return `<div class="publish-upload-summary">
    ${active.map(item => `<span class="is-uploading"><i class="ri-loader-4-line" aria-hidden="true"></i>${esc(item.filename)} ${Math.max(1, Number(item.progress || 0))}%</span>`).join('')}
    ${uploaded.length ? `<span class="is-success"><i class="ri-checkbox-circle-line" aria-hidden="true"></i>${uploaded.length} 张已上传</span>` : ''}
    ${failed.map(item => `<span class="is-error" title="${esc(item.error || '图片上传失败')}"><i class="ri-error-warning-line" aria-hidden="true"></i>${esc(item.filename)}<button type="button" data-publish-upload-retry="${esc(item.id)}">重新上传</button></span>`).join('')}
  </div>`;
}

/**
 * 渲染当前商品快速编辑器，字段来自真实 WorkCTL 发品 Schema 和智能手表类目属性。
 *
 * @returns {void} 直接更新编辑器内容与图片入口。
 * @throws {Error} 不主动抛出异常。
 */
function renderPublishEditor() {
  const product = publishState.products.find(item => item.id === publishState.activeId) || publishState.products[0];
  if (!product) {
    $('#publishEditor').innerHTML = '<div class="empty">请先导入商品图片</div>';
    return;
  }
  publishState.activeId = product.id;
  // 账号类目上下文未完成前不渲染任何演示类目字段，避免网络较慢时让用户误以为
  // 智能手表参数适用于自己的商品。失败状态也停在这里，保存与发布按钮不会出现。
  if (!publishState.accountContextLoaded) {
    const failed = Boolean(publishState.accountContextError);
    $('#publishEditor').innerHTML = `<div class="publish-context-gate ${failed ? 'is-error' : ''}">
      <i class="${failed ? 'ri-error-warning-line' : 'ri-loader-4-line'}" aria-hidden="true"></i>
      <b>${failed ? '暂时无法读取当前账号商品类目' : '正在读取当前账号商品类目'}</b>
      <span>${failed ? '已停止套用演示参数，请点击顶部“刷新数据”后重试。' : '系统会自动生成对应类目参数，无需填写任何编号。'}</span>
    </div>`;
    return;
  }
  const categoryConfig = PUBLISH_CATEGORY_CONFIG[product.categoryKey] || PUBLISH_CATEGORY_CONFIG.watch;
  const requiredAttributeCount = categoryConfig.fields.filter(isRequiredPublishField).length;
  const schemaIsLive = categoryConfig.source === 'workctl-live';
  const accountContextReady = schemaIsLive && publishState.accountContextLoaded;
  const accountContextFailed = Boolean(publishState.accountContextError);
  const schemaBannerTitle = accountContextReady
    ? '已根据当前账号商品匹配发品规则'
    : accountContextFailed
      ? '当前账号类目暂未匹配成功'
      : '正在读取当前账号商品类目';
  const schemaBannerText = accountContextReady
    ? (product.categoryMatchSource === 'same-product'
      ? '已匹配当前店铺同款商品的类目，必填项和固定选项均来自平台实时规则。'
      : product.categoryMatchSource === 'reference-product'
        ? '已按参考商品匹配类目；标题和文本仅作参考，固定选项仍来自当前账号实时规则。'
      : product.categoryMatchSource === 'manual-selection'
        ? '已按你选择的类目重新生成参数，固定选项来自平台实时规则。'
        : '已采用当前店铺正在使用的类目，仍可按实际商品搜索并切换。')
    : accountContextFailed
      ? '为避免套用其他店铺的参数，保存和发布已暂停；请刷新数据后重试。'
      : '系统正在自动读取类目并生成对应参数，无需填写任何编号。';
  const gallery = [...new Set([product.image, ...(product.gallery || [])])].slice(0, 10);
  const uploads = Array.isArray(product.uploads) ? product.uploads : [];
  const referenceImporter = publishState.referenceImportOpen ? `<div class="publish-reference-importer">
    <label for="publishReferenceInput"><span>参考商品链接</span><input id="publishReferenceInput" type="url" value="${esc(publishState.referenceImportValue)}" placeholder="粘贴 Alibaba.com 商品链接" autocomplete="off"></label>
    <button type="button" class="primary" id="publishReferenceImport" ${publishState.referenceImportLoading ? 'disabled' : ''}>${publishState.referenceImportLoading ? '<i class="ri-loader-4-line" aria-hidden="true"></i>正在读取' : '<i class="ri-download-cloud-2-line" aria-hidden="true"></i>带入参考内容'}</button>
    <small class="${publishState.referenceImportError ? 'is-error' : ''}">${esc(publishState.referenceImportError || '系统会自动识别商品号，只带入类目、标题和可用文本，再按当前账号规则生成参数。')}</small>
  </div>` : '';
  const priceUnits = Array.isArray(publishState.businessOptions?.priceUnits)
    ? publishState.businessOptions.priceUnits : [];
  const shippingTemplates = Array.isArray(publishState.businessOptions?.shippingTemplates)
    ? publishState.businessOptions.shippingTemplates : [];
  const priceUnitControl = publishState.businessOptionsLoading
    ? '<select disabled><option>正在同步当前店铺计价单位…</option></select>'
    : priceUnits.length
      ? `<select data-publish-price-unit>${priceUnits.map(option => `<option value="${esc(option.value)}" ${Number(option.value) === Number(product.priceUnitId) ? 'selected' : ''}>${esc(option.label)}</option>`).join('')}</select>`
      : '<select disabled><option>暂未同步到可用计价单位</option></select>';
  const shippingFallbackLabel = String(publishState.businessOptions?.shippingFallbackLabel ||
    '使用国际站默认运费设置');
  const shippingTemplateControl = publishState.businessOptionsLoading
    ? '<select disabled><option>正在同步当前店铺运费方案…</option></select>'
    : `<select data-publish-shipping-template><option value="" ${product.shippingTemplateId ? '' : 'selected'}>${esc(shippingFallbackLabel)}</option>${shippingTemplates.map(option => `<option value="${esc(option.value)}" ${Number(option.value) === Number(product.shippingTemplateId) ? 'selected' : ''}>${esc(option.label)}</option>`).join('')}</select>`;
  // 国际站商品卖点区域按 5 条展示；旧草稿不足 5 条时补空位，避免页面只显示 3 条。
  product.sellingPoints = [...product.sellingPoints, '', '', '', '', ''].slice(0, 5);
  $('#publishEditor').innerHTML = `<div class="publish-editor">
    <div class="publish-editor-head"><h2>${esc(product.title)}</h2><div class="publish-editor-actions"><button type="button" id="publishReferenceToggle" aria-expanded="${publishState.referenceImportOpen}"><i class="ri-file-copy-2-line" aria-hidden="true"></i>导入参考商品</button><button type="button" id="publishRecognize"><i class="ri-refresh-line" aria-hidden="true"></i>重新识别</button></div></div>
    ${referenceImporter}
    <div class="publish-image-strip">${gallery.map((image, index) => {
      const upload = uploads.find(item => item.previewUrl === image || item.remoteUrl === image);
      const status = upload?.status || '';
      const statusLabel = status === 'uploaded' ? '已上传' : status === 'failed' ? '失败' : status ? `${Math.max(1, Number(upload.progress || 0))}%` : '';
      return `<button type="button" class="publish-image-thumb ${index === 0 ? 'active' : ''} ${status ? `is-${status}` : ''}" data-publish-cover="${index}" aria-label="设为封面"><img src="${esc(image)}" alt="商品图 ${index + 1}" referrerpolicy="no-referrer">${statusLabel ? `<span>${esc(statusLabel)}</span>` : ''}</button>`;
    }).join('')}<button type="button" class="publish-add-image" id="publishAddImages" aria-label="继续添加图片" ${publishState.uploadCapability.loaded && !publishState.uploadCapability.configured ? 'disabled' : ''}><i class="ri-add-line" aria-hidden="true"></i><span>上传</span></button></div>
    ${renderPublishUploadSummary(product)}
    <div class="publish-schema-banner ${accountContextReady ? '' : 'is-loading'}"><i class="${accountContextReady ? 'ri-shield-check-line' : accountContextFailed ? 'ri-error-warning-line' : 'ri-loader-4-line'}" aria-hidden="true"></i><div><b>${esc(schemaBannerTitle)}</b><span>${esc(schemaBannerText)}</span></div></div>
    ${renderPublishOutcomeInsight(product)}
    <section class="publish-form-section"><h3>基础信息</h3>
      <label class="publish-field"><span><b><em>*</em> 标题</b><small>${product.title.length}/128</small></span><input data-publish-field="title" value="${esc(product.title)}" maxlength="128"></label>
      <div class="publish-field"><span><b>关键词</b><small>${product.keywords.length}/5 · 可直接修改</small></span><div class="publish-chip-list">${product.keywords.map((keyword, index) => `<span class="publish-keyword-chip"><input data-publish-keyword="${index}" value="${esc(keyword)}" maxlength="40" size="${Math.max(6, Math.min(18, keyword.length))}" aria-label="关键词 ${index + 1}"><button type="button" data-publish-keyword-remove="${index}" aria-label="删除关键词 ${esc(keyword)}"><i class="ri-close-line" aria-hidden="true"></i></button></span>`).join('')}${product.keywords.length < 5 ? `<span class="publish-keyword-add"><input id="publishKeywordAdd" maxlength="40" placeholder="输入关键词" aria-label="新增关键词"><button id="publishKeywordAddButton" type="button">添加</button></span>` : ''}</div></div>
      <div class="publish-field"><span><b><em>*</em> 叶子类目</b><small class="publish-control-tag">系统自动匹配</small></span><div class="publish-category-picker"><label><i class="ri-search-line" aria-hidden="true"></i><input id="publishCategorySearch" type="search" placeholder="输入类目名称搜索" autocomplete="off" ${product.schemaLoading || !publishState.accountContextLoaded ? 'disabled' : ''}></label><select id="publishCategoryResults" data-publish-category ${product.schemaLoading || !publishState.accountContextLoaded ? 'disabled' : ''}><option value="${esc(product.categoryId)}" selected>${esc(product.category)}</option></select></div><small class="publish-schema-note">系统先读取当前账号商品所属类目，再自动加载对应参数；无需填写编号</small></div>
    </section>
    <section class="publish-form-section"><h3>类目属性 <small>${requiredAttributeCount} 项必填 · 共 ${categoryConfig.fields.length} 项</small></h3><div class="publish-form-grid">${categoryConfig.fields.map(field => `<div class="publish-field"><span><b>${isRequiredPublishField(field) ? '<em>*</em> ' : ''}${esc(field.label)}</b><small class="publish-control-tag">${field.control === 'multi' ? '平台多选' : field.control === 'region' ? '平台国家' : field.control === 'text' ? '允许输入' : field.control === 'combo' ? '平台选项 / 可自定义' : '平台单选'}</small></span>${renderPublishAttributeControl(field, product.attributes[field.key])}<small class="publish-schema-note">${esc(field.schemaName)}${field.control === 'region' ? ' · Alibaba 发品页选项' : field.optionSource === 'workctl-live' ? ' · WorkCTL 实时选项' : ''}</small></div>`).join('')}</div></section>
    <section class="publish-form-section"><div class="publish-section-heading"><h3>交易信息</h3><span>填写销售方式、起订量、库存与价格</span></div><div class="publish-form-grid">
      <label class="publish-field"><span><b><em>*</em> 销售方式</b><small class="publish-control-tag">平台选项</small></span><select data-publish-field="saleType"><option value="normal" ${product.saleType === 'normal' ? 'selected' : ''}>按件售卖</option><option value="batch" ${product.saleType === 'batch' ? 'selected' : ''}>按批售卖</option></select></label>
      ${product.saleType === 'batch' ? `<label class="publish-field"><span><b><em>*</em> 每批数量</b><small>整数 ≥ 1</small></span><input type="number" min="1" step="1" inputmode="numeric" data-publish-field="batchNum" value="${esc(product.batchNum)}"></label>` : ''}
      <label class="publish-field"><span><b><em>*</em> 最小起订量 (MOQ)</b><small>整数</small></span><input type="number" min="1" step="1" inputmode="numeric" data-publish-field="moq" value="${esc(product.moq)}"></label>
      <label class="publish-field"><span><b><em>*</em> 可售库存</b><small>整数</small></span><input type="number" min="0" step="1" inputmode="numeric" data-publish-field="inventory" value="${esc(product.inventory)}"></label>
      <label class="publish-field"><span><b><em>*</em> 计价单位</b><small class="publish-control-tag">系统自动匹配</small></span>${priceUnitControl}<small class="publish-schema-note">来自当前店铺与国际站官方单位，提交时自动携带平台编码</small></label>
    </div>
      <div class="publish-structured-field"><div class="publish-structure-head"><div><b><em>*</em> 阶梯价格</b><span>Schema 只接受 ladderPrices 数组，不接受“US$ 8.90–12.50”文本</span></div><button type="button" id="publishAddPriceTier"><i class="ri-add-line" aria-hidden="true"></i>添加阶梯</button></div><div class="publish-tier-list">${renderPublishPriceTiers(product)}</div></div>
    </section>
    <section class="publish-form-section"><div class="publish-section-heading"><h3>履约与包装</h3><span>填写承诺发货期与单件包装信息</span></div>
      <div class="publish-structured-field"><div class="publish-structure-head"><div><b><em>*</em> 阶梯发货期</b><span>数量上限与承诺天数必须成对填写</span></div><button type="button" id="publishAddPeriodTier"><i class="ri-add-line" aria-hidden="true"></i>添加阶梯</button></div><div class="publish-tier-list">${renderPublishLeadTimeTiers(product)}</div></div>
      <div class="publish-package-grid">
        ${['length', 'width', 'height'].map((key, index) => `<label class="publish-field"><span><b><em>*</em> 包装${['长', '宽', '高'][index]}</b><small>CM/件</small></span><input type="number" min="0.01" step="0.01" inputmode="decimal" data-publish-package-field="${key}" value="${esc(product.package[key])}"></label>`).join('')}
        <label class="publish-field"><span><b><em>*</em> 包装毛重</b><small>KG/件</small></span><input type="number" min="0.001" step="0.001" inputmode="decimal" data-publish-package-field="weight" value="${esc(product.package.weight)}"></label>
      </div><p class="publish-group-note"><i class="ri-information-line" aria-hidden="true"></i>长、宽、高在接口中属于一组：要么全部填写，要么全部不传。</p>
      <div class="publish-form-grid">
        <label class="publish-field"><span><b>物流属性</b><small class="publish-control-tag">平台选项</small></span><select data-publish-logistics-property><option value="">普通商品</option><option value="battery_0_0" ${(product.logisticsProperty || []).includes('battery_0_0') ? 'selected' : ''}>内置电池</option></select><small class="publish-schema-note">系统会在提交时转换为国际站要求的物流属性</small></label>
        <label class="publish-field"><span><b>运费设置</b><small class="publish-control-tag">系统自动匹配</small></span>${shippingTemplateControl}<small class="publish-schema-note">默认沿用当前店铺可用方案；无需填写模板编号</small></label>
      </div>
    </section>
    <section class="publish-form-section"><h3>卖点 <small>5 条，可逐条修改</small></h3><div class="publish-selling-points">${product.sellingPoints.map((point, index) => `<label><span>${index + 1}</span><input data-publish-selling-point="${index}" value="${esc(point)}" maxlength="200" placeholder="请输入第 ${index + 1} 条商品卖点" aria-label="卖点 ${index + 1}"><small>${point.length}/200</small></label>`).join('')}</div></section>
    <section class="publish-item-action-bar" aria-label="当前商品操作">
      <div><b>当前商品操作</b><span>只处理右侧这 1 个商品，仍会进入串行队列</span></div>
      <button type="button" id="publishSaveCurrent" ${publishActionIssues(product, 'draft').length ? 'disabled' : ''}><i class="ri-draft-line" aria-hidden="true"></i>保存当前草稿</button>
      <button type="button" class="primary" id="publishCurrent" ${publishActionIssues(product, 'publish').length ? 'disabled' : ''}><i class="ri-send-plane-2-line" aria-hidden="true"></i>发布当前商品</button>
    </section>
  </div>`;
  updatePublishCategoryResultSelect();
  const categorySearch = $('#publishCategorySearch');
  if (categorySearch) {
    categorySearch.oninput = () => {
      if (publishState.categorySearchTimer) clearTimeout(publishState.categorySearchTimer);
      publishState.categorySearchTimer = setTimeout(() => searchPublishCategories(categorySearch.value), 260);
    };
    categorySearch.onkeydown = event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (publishState.categorySearchTimer) clearTimeout(publishState.categorySearchTimer);
        searchPublishCategories(categorySearch.value);
      }
    };
  }
  $('#publishReferenceToggle').onclick = () => {
    publishState.referenceImportOpen = !publishState.referenceImportOpen;
    publishState.referenceImportError = '';
    renderPublishEditor();
    if (publishState.referenceImportOpen) $('#publishReferenceInput')?.focus();
  };
  if ($('#publishReferenceInput')) {
    $('#publishReferenceInput').oninput = event => {
      publishState.referenceImportValue = event.target.value;
      publishState.referenceImportError = '';
    };
    $('#publishReferenceInput').onkeydown = event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        importPublishReference(product);
      }
    };
  }
  if ($('#publishReferenceImport')) $('#publishReferenceImport').onclick = () => importPublishReference(product);
  $('#publishRecognize').onclick = () => simulatePublishRecognition(product.id);
  $('#publishAddImages').onclick = () => $('#publishFileInput').click();
  $$('[data-publish-upload-retry]').forEach(button => {
    button.onclick = () => retryPublishImageUpload(product, button.dataset.publishUploadRetry);
  });
  $$('[data-publish-cover]').forEach(button => {
    button.onclick = () => {
      const index = Number(button.dataset.publishCover);
      const selectedImage = gallery[index];
      product.image = selectedImage;
      product.gallery = [selectedImage, ...gallery.filter(image => image !== selectedImage)];
      renderProductPublish();
    };
  });
  $$('[data-publish-keyword-remove]').forEach(button => {
    button.onclick = () => {
      const index = Number(button.dataset.publishKeywordRemove);
      product.keywords.splice(index, 1);
      renderProductPublish();
      $('#publishKeywordAdd')?.focus();
    };
  });
  if ($('#publishKeywordAddButton')) {
    $('#publishKeywordAddButton').onclick = () => addPublishKeyword(product);
    $('#publishKeywordAdd').onkeydown = event => {
      if (event.key === 'Enter' || event.key === ',') {
        event.preventDefault();
        addPublishKeyword(product);
      }
    };
  }
  $$('[data-publish-attribute-remove]').forEach(button => {
    button.onclick = () => {
      const values = product.attributes[button.dataset.publishAttributeRemove] || [];
      product.attributes[button.dataset.publishAttributeRemove] = values.filter(value => value !== button.dataset.publishOption);
      renderProductPublish();
    };
  });
  bindPublishOriginPickers(product);
  $('#publishAddPriceTier').onclick = () => {
    const last = product.priceTiers[product.priceTiers.length - 1] || { minQuantity: product.moq, unitPrice: 1 };
    product.priceTiers.push({ minQuantity: Number(last.minQuantity) + 500, unitPrice: Number(last.unitPrice) });
    renderProductPublish();
  };
  $$('[data-publish-price-remove]').forEach(button => {
    button.onclick = () => {
      if (product.priceTiers.length > 1) product.priceTiers.splice(Number(button.dataset.publishPriceRemove), 1);
      renderProductPublish();
    };
  });
  $('#publishAddPeriodTier').onclick = () => {
    const last = product.leadTimeTiers[product.leadTimeTiers.length - 1] || { maxQuantity: product.moq, days: 7 };
    product.leadTimeTiers.push({ maxQuantity: Number(last.maxQuantity) + 1000, days: Number(last.days) + 2 });
    renderProductPublish();
  };
  $$('[data-publish-period-remove]').forEach(button => {
    button.onclick = () => {
      if (product.leadTimeTiers.length > 1) product.leadTimeTiers.splice(Number(button.dataset.publishPeriodRemove), 1);
      renderProductPublish();
    };
  });
  $('#publishSaveCurrent').onclick = () => openPublishConfirmation({ scope: 'single', action: 'draft' });
  $('#publishCurrent').onclick = () => openPublishConfirmation({ scope: 'single', action: 'publish' });
  if ($('#publishFixAndRetry')) {
    $('#publishFixAndRetry').onclick = () => {
      const failedJob = latestPublishOutcome(product.id);
      openPublishConfirmation({ scope: 'single', action: failedJob?.action || 'publish' });
    };
  }
}

/**
 * 读取参考商品的精简模板，并重新套用当前账号对应类目的实时字段规则。
 *
 * 参考商品只提供类目、标题和文本。固定选项不会跨商品硬复制；切换类目后仍由
 * migratePublishProductToAccountCategory 按 attrNameId 和官方选项进行安全迁移。
 *
 * @param {object} product - 当前正在编辑的本地商品草稿。
 * @returns {Promise<void>} 导入完成后刷新编辑器和批量列表。
 * @throws {Error} 网络和模板错误会被函数内部转成行内错误提示。
 */
async function importPublishReference(product) {
  const reference = String(publishState.referenceImportValue || '').trim();
  if (!reference) {
    publishState.referenceImportError = '请先粘贴一个 Alibaba.com 商品链接。';
    renderPublishEditor();
    return;
  }
  publishState.referenceImportLoading = true;
  publishState.referenceImportError = '';
  renderPublishEditor();
  try {
    const response = await fetch('/api/publish/reference', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    const template = payload.reference || {};
    const categoryId = Number(template.categoryId);
    const categoryKey = await ensureLivePublishCategory(categoryId);
    migratePublishProductToAccountCategory(product, categoryKey, 'reference-product');
    if (String(template.title || '').trim()) product.title = String(template.title).trim().slice(0, 128);
    const referenceTexts = (Array.isArray(template.texts) ? template.texts : [])
      .map(value => String(value || '').trim()).filter(Boolean);
    if (referenceTexts.length) {
      // “导入参考商品”是一个明确的覆盖动作。这里用参考文本替换原有演示卖点，
      // 才能让运营人员立即看见导入结果；不足五条时保留空白位置供继续编辑。
      // 固定属性不会在此处复制，仍然由当前账号对应类目的官方选项生成。
      const normalizedTitle = String(template.title || '').trim().toLowerCase();
      const importedPoints = referenceTexts
        .filter(text => text.toLowerCase() !== normalizedTitle)
        .filter((text, index, values) => values.indexOf(text) === index)
        .slice(0, 5)
        .map(text => text.slice(0, 200));
      product.sellingPoints = [...importedPoints, '', '', '', '', ''].slice(0, 5);
    }
    product.referenceImported = true;
    product.categoryMatchSource = 'reference-product';
    product.status = publishProductStatus(product);
    publishState.referenceImportOpen = false;
    publishState.referenceImportValue = '';
    toast('参考商品内容已带入，并按当前账号类目规则重新生成参数');
  } catch (error) {
    publishState.referenceImportError = String(error?.message || error || '参考商品读取失败');
  } finally {
    publishState.referenceImportLoading = false;
    renderProductPublish();
  }
}

/**
 * 把关键词输入框中的新词加入当前商品。关键词上限为 5 个，并阻止空值和重复值。
 *
 * @param {object} product - 当前正在编辑的商品草稿。
 * @returns {void} 添加成功后重绘编辑器并把新关键词显示为可编辑标签。
 * @throws {Error} 不主动抛出异常；输入无效时通过页面提示说明原因。
 */
function addPublishKeyword(product) {
  const input = $('#publishKeywordAdd');
  const keyword = input?.value.trim();
  if (!keyword) {
    toast('请输入关键词', true);
    return;
  }
  if (product.keywords.length >= 5) {
    toast('每个商品最多保留 5 个关键词', true);
    return;
  }
  if (product.keywords.some(item => item.toLowerCase() === keyword.toLowerCase())) {
    toast('这个关键词已经存在', true);
    return;
  }
  product.keywords.push(keyword);
  renderProductPublish();
  toast('关键词已添加');
}

/**
 * 判断图片地址是否已经是 WorkCTL 可以访问的远程 URL。
 *
 * @param {*} value - 商品图库中的图片地址。
 * @returns {boolean} http/https 返回 true；blob/data/无效地址返回 false。
 * @throws {Error} URL 解析异常会被捕获并返回 false。
 */
function isRemotePublishImage(value) {
  try {
    return ['http:', 'https:'].includes(new URL(String(value || '')).protocol);
  } catch (_) {
    return false;
  }
}

/**
 * 为真实队列生成一条经过前端白名单整理的商品快照。
 *
 * 服务端仍会重新校验全部字段；前端整理的目的只是去掉纯展示状态，并把页面的
 * priceTiers/leadTimeTiers 命名映射为 WorkCTL Schema 使用的字段。
 *
 * @param {object} product - publishState 中的一条商品草稿。
 * @returns {object} 可提交给 POST /api/publish/enqueue 的商品快照。
 * @throws {Error} 不主动抛出异常；缺失字段会由服务端返回明确校验错误。
 */
function serializePublishProduct(product) {
  const categoryConfig = PUBLISH_CATEGORY_CONFIG[product.categoryKey] || PUBLISH_CATEGORY_CONFIG.watch;
  const images = [...new Set([product.image, ...(product.gallery || [])])].filter(isRemotePublishImage).slice(0, 10);
  return {
    localId: product.id,
    title: product.title,
    categoryId: product.categoryId,
    categoryName: product.category,
    images,
    keywords: product.keywords,
    attributes: categoryConfig.fields.map(field => ({
      attrNameId: field.attrId,
      attrName: field.schemaName,
      attrValue: product.attributes?.[field.key],
      // 单选枚举携带 WorkCTL 实时返回的正整数 ID；多选按平台完整素材约定
      // 以分号合并且使用 -1，自定义文本和产地快照也使用 -1。
      attrValueId: field.multiSelect
        ? -1
        : Number.isSafeInteger(Number(field.choiceIds?.[String(product.attributes?.[field.key] || '')]))
          ? Number(field.choiceIds[String(product.attributes?.[field.key] || '')])
          : -1,
    })),
    sellingPoints: product.sellingPoints,
    trade: {
      saleType: product.saleType,
      batchNum: product.batchNum,
      moq: product.moq,
      inventory: product.inventory,
      priceUnitId: product.priceUnitId,
      priceUnitLabel: product.priceUnit,
      ladderPrices: product.priceTiers,
    },
    fulfillment: {
      ladderPeriod: product.leadTimeTiers.map(tier => ({ quantity: tier.maxQuantity, period: tier.days })),
      logisticsProperty: product.logisticsProperty,
      package: product.package,
      shippingTemplateId: product.shippingTemplateId,
      shippingTemplateLabel: product.shippingTemplate,
    },
  };
}

/**
 * 在打开确认弹窗前检查当前浏览器状态中可确定的问题。
 *
 * 保存草稿允许字段未补齐，但至少要有标题和一张远程图片；正式发布还必须通过
 * publishProductStatus 的完整校验，并确保实际图库至少有 5 张远程图片。
 *
 * @param {object} product - 待保存或发布的商品。
 * @param {'draft'|'publish'} action - 目标动作。
 * @returns {string[]} 阻止进入真实队列的问题列表。
 * @throws {Error} 不主动抛出异常。
 */
function publishActionIssues(product, action) {
  const issues = [];
  const remoteImages = [...new Set([product.image, ...(product.gallery || [])])].filter(isRemotePublishImage);
  if (!String(product.title || '').trim()) issues.push('标题不能为空');
  if (!remoteImages.length) issues.push('本地图片尚未上传到可供 WorkCTL 读取的远程地址');
  const categoryConfig = PUBLISH_CATEGORY_CONFIG[product.categoryKey] || PUBLISH_CATEGORY_CONFIG.watch;
  if (!publishState.accountContextLoaded || categoryConfig.source !== 'workctl-live') {
    issues.push('当前账号商品类目与实时发品规则尚未加载');
  }
  if (action === 'publish') {
    categoryConfig.fields.filter(field => isRequiredPublishField(field) && field.enumProp &&
      !field.multiSelect && !field.inputProp && field.attrId !== 1).forEach(field => {
      const value = String(product.attributes?.[field.key] || '');
      if (!Number.isSafeInteger(Number(field.choiceIds?.[value])) || Number(field.choiceIds?.[value]) <= 0) {
        issues.push(`${field.label} 尚未匹配官方选项 ID`);
      }
    });
    if (!Number.isSafeInteger(Number(product.priceUnitId)) || Number(product.priceUnitId) <= 0) {
      issues.push(publishState.businessOptionsLoading
        ? '计价单位正在从当前店铺自动同步'
        : '计价单位暂未同步成功，请刷新数据后重试');
    }
    if (publishProductStatus(product) !== 'ready') issues.push('本地发布前检查未通过');
    if (remoteImages.length < 5) issues.push('实际远程图库不足 5 张');
    if ((product.sellingPoints || []).length !== 5 || product.sellingPoints.some(point => !String(point || '').trim())) issues.push('5 条卖点尚未填写完整');
  }
  return issues;
}

/**
 * 渲染由服务端真实执行的 WorkCTL 队列及其结果。
 *
 * @returns {void} 更新队列列表、计数和折叠状态。
 * @throws {Error} 不主动抛出异常。
 */
function renderPublishQueue() {
  const panel = $('.publish-queue-panel');
  panel.classList.toggle('collapsed', publishState.queueCollapsed);
  $('#publishQueueToggle').setAttribute('aria-expanded', String(!publishState.queueCollapsed));
  $('#publishQueueToggle').innerHTML = `${publishState.queueCollapsed ? '展开' : '收起'} <i class="ri-arrow-${publishState.queueCollapsed ? 'up' : 'down'}-s-line" aria-hidden="true"></i>`;
  $('#publishQueueCount').textContent = `${publishState.queue.length} 个任务`;
  if (!publishState.queue.length) {
    $('#publishQueueList').innerHTML = '<div class="publish-queue-empty">确认后，任务会在服务端逐条调用真实 WorkCTL。</div>';
    return;
  }
  const stateLabel = { queued: '等待中', running: '执行中', saved_draft: '草稿已保存', submitted: '已提交发布', failed: '失败' };
  $('#publishQueueList').innerHTML = publishState.queue.map(job => {
    const failureLabels = publishFailureFieldLabels(job.failureFields);
    const resultDetail = job.status === 'failed' && failureLabels.length
      ? `检查：${failureLabels.join('、')}`
      : Number.isFinite(Number(job.finalScore))
        ? `质量分 ${Number(job.finalScore)}`
        : job.message || '';
    return `<article class="publish-queue-item">
      <img src="${esc(job.image)}" alt="" referrerpolicy="no-referrer"><div class="publish-queue-copy"><b>${esc(job.title)}</b><span>${job.action === 'draft' ? '保存草稿' : '正式发布'} · ${esc(resultDetail)}</span></div>
      <div class="publish-job-state ${job.status}">${job.status === 'running' ? `<span>${stateLabel[job.status]}</span><span class="publish-queue-progress"><i style="width:${job.progress}%"></i></span>` : job.status === 'failed' ? `<span>${stateLabel[job.status]}</span>${job.canFixAndRetry ? `<button class="publish-retry" type="button" data-publish-fix="${esc(job.localId)}">去补全</button>` : job.retryable ? `<button class="publish-retry" type="button" data-publish-retry="${esc(job.id)}">重试</button>` : ''}` : `<span>${stateLabel[job.status] || esc(job.status)}</span>`}</div>
    </article>`;
  }).join('');
  $$('[data-publish-retry]').forEach(button => {
    button.onclick = () => retryPublishJob(button.dataset.publishRetry);
  });
  $$('[data-publish-fix]').forEach(button => {
    button.onclick = () => {
      publishState.activeId = button.dataset.publishFix;
      renderProductPublish();
      $('.publish-editor-panel')?.scrollTo({ top: 0, behavior: 'smooth' });
    };
  });
}

const PUBLISH_TERMINAL_STATES = new Set(['saved_draft', 'submitted', 'failed']);

/**
 * 返回任务所属的本次操作标识。
 *
 * 服务端升级前创建的进程内任务没有 operationId；此时使用 job.id 回退为一个
 * 单任务操作，保证旧失败记录仍能显示 1/1，而不是让整个进度区域消失。
 *
 * @param {object} job - 服务端返回的一条发布任务。
 * @returns {string} 可用于分组的稳定操作标识。
 * @throws {Error} 不主动抛出异常。
 */
function publishOperationId(job) {
  return String(job?.operationId || job?.id || '');
}

/**
 * 取得某一次单品或批量操作的全部任务，并按 1、2、3… 的执行顺序排列。
 *
 * @param {string} operationId - 本次操作标识。
 * @returns {object[]} 已按 position 排序的任务数组。
 * @throws {Error} 不主动抛出异常。
 */
function publishOperationJobs(operationId) {
  return publishState.queue
    .filter(job => publishOperationId(job) === operationId)
    .sort((left, right) => Number(left.position || 1) - Number(right.position || 1));
}

/**
 * 决定页面顶部应该展示哪一次操作。
 *
 * 优先保留用户刚发起的操作；刷新页面后则优先找仍在执行的操作，最后回退到
 * 服务端返回的最新一组历史任务。队列接口按新到旧排序，因此首项就是最近记录。
 *
 * @returns {string} 当前可见操作标识；没有任务时返回空字符串。
 * @throws {Error} 不主动抛出异常。
 */
function resolveVisiblePublishOperationId() {
  if (publishState.activeOperationId && publishOperationJobs(publishState.activeOperationId).length) {
    return publishState.activeOperationId;
  }
  const activeJob = publishState.queue.find(job => ['queued', 'running'].includes(job.status));
  const operationId = publishOperationId(activeJob || publishState.queue[0]);
  publishState.activeOperationId = operationId || null;
  return operationId;
}

/**
 * 渲染单品 0/1 或批量 0/N 的总进度，以及 1…N 的逐条状态节点。
 *
 * 总进度只按“已经得到终态”的任务计数，避免把 running=50 当成半个商品造成
 * 业务口径难懂。失败也算已处理，因此一批任务全部结束时总进度始终为 100%。
 *
 * @returns {void} 直接更新产品发布页顶部进度组件。
 * @throws {Error} 页面关键节点缺失时可能抛出 DOM 访问异常。
 */
function renderPublishOperationProgress() {
  const panel = $('#publishOperationProgress');
  const operationId = resolveVisiblePublishOperationId();
  const jobs = operationId ? publishOperationJobs(operationId) : [];
  if (!jobs.length) {
    panel.hidden = true;
    return;
  }

  const total = Math.max(jobs.length, ...jobs.map(job => Number(job.total || 1)));
  const completed = jobs.filter(job => PUBLISH_TERMINAL_STATES.has(job.status)).length;
  const succeeded = jobs.filter(job => ['saved_draft', 'submitted'].includes(job.status)).length;
  const failed = jobs.filter(job => job.status === 'failed').length;
  const running = jobs.find(job => job.status === 'running');
  const allFinished = completed >= total;
  const percent = total ? Math.round((completed / total) * 100) : 0;
  const first = jobs[0];
  const actionLabel = first.action === 'draft' ? '保存草稿' : '提交发布';
  const scopeLabel = total === 1 ? '单品' : `批量 ${total} 个`;

  panel.hidden = false;
  panel.classList.toggle('has-failure', allFinished && failed > 0);
  panel.classList.toggle('is-complete', allFinished && failed === 0);
  $('#publishOperationEyebrow').textContent = `本次${scopeLabel}${actionLabel}`;
  $('#publishOperationTitle').textContent = allFinished
    ? `处理完成 ${completed}/${total}`
    : running
      ? `正在处理第 ${Number(running.position || completed + 1)} 个 · ${completed}/${total}`
      : `等待处理 ${completed}/${total}`;
  $('#publishOperationMessage').textContent = allFinished
    ? `${succeeded} 个成功${failed ? ` · ${failed} 个失败` : ''}`
    : '服务端按编号逐条执行，离开当前页面也不会中断';
  $('#publishOperationPercent').textContent = `${percent}%`;
  $('#publishOperationFill').style.width = `${percent}%`;
  $('#publishOperationResult').hidden = !allFinished;

  $('#publishOperationSteps').innerHTML = Array.from({ length: total }, (_, index) => {
    const position = index + 1;
    const job = jobs.find(item => Number(item.position || 1) === position);
    const state = job?.status || 'queued';
    const stateLabel = {
      queued: '等待处理', running: '正在执行', saved_draft: '草稿已保存',
      submitted: '已提交发布', failed: '处理失败',
    }[state] || state;
    return `<span class="publish-operation-step ${esc(state)}" title="${esc(job?.title || `第 ${position} 个商品`)}：${esc(stateLabel)}"><b>${position}</b><small>${esc(stateLabel)}</small></span>`;
  }).join('');
}

/**
 * 打开某次操作的最终结果弹窗。
 *
 * 成功与失败都必须显式呈现；正式发布的 submitted 只表示平台已经接收流程，
 * 文案不会把它误写成“已审核上线”。列表最多展示前 12 条，避免大批量撑满弹层。
 *
 * @param {string} operationId - 需要展示结果的操作标识。
 * @param {boolean} [automatic=false] - 是否由轮询完成后自动弹出。
 * @returns {boolean} 已成功打开弹窗返回 true；任务未结束或弹窗被占用时返回 false。
 * @throws {Error} 不主动抛出异常。
 */
function showPublishOperationResult(operationId, automatic = false) {
  const jobs = publishOperationJobs(operationId);
  if (!jobs.length || !jobs.every(job => PUBLISH_TERMINAL_STATES.has(job.status))) return false;
  if (automatic && $('#modal').classList.contains('on')) return false;

  const succeeded = jobs.filter(job => ['saved_draft', 'submitted'].includes(job.status));
  const failed = jobs.filter(job => job.status === 'failed');
  const first = jobs[0];
  const total = jobs.length;
  const allSucceeded = failed.length === 0;
  let title = failed.length ? `处理完成，${failed.length} 个失败` : '操作完成';
  if (allSucceeded && first.action === 'draft') title = total === 1 ? '草稿保存成功' : `${total} 个草稿保存完成`;
  if (allSucceeded && first.action === 'publish') title = total === 1 ? '商品已提交发布' : `${total} 个商品已提交发布`;

  const visibleJobs = jobs.slice(0, 12);
  $('#modalBody').innerHTML = `<section class="publish-result ${allSucceeded ? 'success' : 'failure'}">
    <div class="publish-result-hero"><i class="${allSucceeded ? 'ri-checkbox-circle-fill' : 'ri-error-warning-fill'}" aria-hidden="true"></i><div><span>本次任务 ${total}/${total}</span><h2>${esc(title)}</h2><p>${first.action === 'publish' ? '已提交的商品仍需以国际站平台审核状态为准。' : '每条任务均已得到国际站返回结果。'}</p></div></div>
    <div class="publish-result-metrics"><article><span>处理总数</span><strong>${total}</strong></article><article><span>成功</span><strong>${succeeded.length}</strong></article><article><span>失败</span><strong>${failed.length}</strong></article></div>
    <div class="publish-result-list">${visibleJobs.map((job, index) => {
      const failureLabels = publishFailureFieldLabels(job.failureFields);
      const detail = job.status === 'failed' && failureLabels.length
        ? `请检查：${failureLabels.join('、')}`
        : Number.isFinite(Number(job.finalScore))
          ? `质量分 ${Number(job.finalScore)}${job.deductReasons?.length ? ` · ${job.deductReasons.slice(0, 2).join('；')}` : ''}`
          : job.qualityScoreMessage || job.message || '';
      return `<article><b>${Number(job.position || index + 1)}</b><img src="${esc(job.image)}" alt="" referrerpolicy="no-referrer"><div><strong>${esc(job.title)}</strong><span>${esc(detail)}</span></div><em class="${esc(job.status)}">${job.status === 'saved_draft' ? '草稿已保存' : job.status === 'submitted' ? '已提交' : '失败'}</em></article>`;
    }).join('')}${total > visibleJobs.length ? `<p>另有 ${total - visibleJobs.length} 条结果，可在右侧发布队列查看。</p>` : ''}</div>
    <div class="publish-result-actions"><button id="publishResultClose" class="primary" type="button">完成</button></div>
  </section>`;
  $('#modal').classList.add('on');
  $('#publishResultClose').onclick = () => $('#modal').classList.remove('on');
  publishState.pendingResultOperationIds.delete(operationId);
  publishState.announcedResultOperationIds.add(operationId);
  return true;
}

/**
 * 当用户刚发起的操作全部结束时自动展示一次结果。
 *
 * @returns {boolean} 已展示或无需展示时返回 true；被其他弹窗暂时阻挡时返回 false。
 * @throws {Error} 不主动抛出异常。
 */
function maybeAnnouncePublishOperationResult() {
  const operationId = publishState.activeOperationId;
  if (!operationId || !publishState.pendingResultOperationIds.has(operationId) ||
      publishState.announcedResultOperationIds.has(operationId)) return true;
  const jobs = publishOperationJobs(operationId);
  if (!jobs.length || !jobs.every(job => PUBLISH_TERMINAL_STATES.has(job.status))) return true;
  return showPublishOperationResult(operationId, true);
}

/**
 * 更新底部检查结果和操作按钮可用性。
 *
 * @returns {void} 更新可发布数量与按钮禁用状态。
 * @throws {Error} 不主动抛出异常。
 */
function renderPublishBottomBar() {
  const selected = publishState.products.filter(product => product.selected);
  const selectedReady = selected.filter(product => publishActionIssues(product, 'publish').length === 0);
  const blocked = selected.length - selectedReady.length;
  $('#publishReadySummary').textContent = selected.length
    ? `已选 ${selected.length} 个 · 可正式发布 ${selectedReady.length} 个${blocked ? ` · 待补全 ${blocked} 个` : ''}`
    : '请先在左侧选择商品';
  $('#publishSaveDraft').textContent = `批量保存草稿（${selected.length}）`;
  $('#publishStartQueue').textContent = `批量发布（${selected.length}）`;
  $('#publishReadyTop span').textContent = `批量发布已选（${selected.length}）`;
  $('#publishSaveDraft').disabled = selected.length === 0;
  $('#publishStartQueue').disabled = selected.length === 0 || blocked > 0;
  $('#publishReadyTop').disabled = selected.length === 0 || blocked > 0;
  const publishHint = blocked ? `已选商品中有 ${blocked} 个未通过发布前检查` : '所选商品将逐条进入真实 WorkCTL 队列';
  $('#publishStartQueue').title = publishHint;
  $('#publishReadyTop').title = publishHint;
}

/**
 * 把右侧编辑器的字段修改同步回当前产品，并重新计算完整度和状态。
 *
 * @param {Event} event - 输入框或下拉框触发的 input/change 事件。
 * @returns {void} 状态更新后重绘表格、状态条和底部操作栏。
 * @throws {Error} 不主动抛出异常。
 */
function handlePublishEditorInput(event) {
  const product = publishState.products.find(item => item.id === publishState.activeId);
  if (!product) return;
  const field = event.target.dataset.publishField;
  const attribute = event.target.dataset.publishAttribute;
  const attributeToAdd = event.target.dataset.publishAttributeAdd;
  const categoryChanged = event.target.hasAttribute('data-publish-category');
  const priceTierIndex = event.target.dataset.publishPriceTier;
  const priceTierField = event.target.dataset.publishTierField;
  const periodTierIndex = event.target.dataset.publishPeriodTier;
  const periodTierField = event.target.dataset.publishPeriodField;
  const packageField = event.target.dataset.publishPackageField;
  const logisticsChanged = event.target.hasAttribute('data-publish-logistics-property');
  const priceUnitChanged = event.target.hasAttribute('data-publish-price-unit');
  const shippingTemplateChanged = event.target.hasAttribute('data-publish-shipping-template');
  const keywordIndex = event.target.dataset.publishKeyword;
  const sellingPointIndex = event.target.dataset.publishSellingPoint;

  if (categoryChanged) {
    const categoryId = Number(event.target.value);
    if (!Number.isSafeInteger(categoryId) || categoryId <= 0 || categoryId === Number(product.categoryId)) return;
    applyLivePublishCategory(product, categoryId);
    return;
  }

  if (field) {
    product[field] = ['moq', 'inventory', 'batchNum'].includes(field) ? Number(event.target.value) : event.target.value;
    // 销售方式决定 batchNum 是否允许出现，切换后必须立即重绘对应的条件字段。
    if (field === 'saleType') {
      if (product.saleType === 'normal') product.batchNum = 1;
      renderProductPublish();
      return;
    }
  }
  if (attribute) product.attributes[attribute] = event.target.value;
  if (attributeToAdd && event.target.value) {
    const values = Array.isArray(product.attributes[attributeToAdd]) ? product.attributes[attributeToAdd] : [];
    if (!values.includes(event.target.value)) product.attributes[attributeToAdd] = [...values, event.target.value];
    renderProductPublish();
    return;
  }
  if (priceTierIndex !== undefined && priceTierField) {
    const tier = product.priceTiers[Number(priceTierIndex)];
    if (tier) tier[priceTierField] = priceTierField === 'minQuantity' ? Math.trunc(Number(event.target.value)) : Number(event.target.value);
  }
  if (periodTierIndex !== undefined && periodTierField) {
    const tier = product.leadTimeTiers[Number(periodTierIndex)];
    if (tier) tier[periodTierField] = Math.trunc(Number(event.target.value));
  }
  if (packageField) product.package[packageField] = Number(event.target.value);
  if (logisticsChanged) product.logisticsProperty = event.target.value ? [event.target.value] : [];
  if (priceUnitChanged) {
    const selected = (publishState.businessOptions?.priceUnits || [])
      .find(option => Number(option.value) === Number(event.target.value));
    product.priceUnitId = selected ? Number(selected.value) : null;
    product.priceUnit = String(selected?.label || '');
  }
  if (shippingTemplateChanged) {
    const selected = (publishState.businessOptions?.shippingTemplates || [])
      .find(option => Number(option.value) === Number(event.target.value));
    product.shippingTemplateId = selected ? Number(selected.value) : null;
    product.shippingTemplate = String(selected?.label ||
      publishState.businessOptions?.shippingFallbackLabel || '使用国际站默认运费设置');
  }
  if (keywordIndex !== undefined) product.keywords[Number(keywordIndex)] = event.target.value;
  if (sellingPointIndex !== undefined) product.sellingPoints[Number(sellingPointIndex)] = event.target.value;
  product.status = publishProductStatus(product);
  renderPublishStatus();
  renderPublishTable();
  renderPublishBottomBar();
}

/**
 * 使用 FileReader 把浏览器 File 转成不含 data URL 前缀的 Base64 正文。
 *
 * @param {File} file - 用户主动选择的图片文件。
 * @param {(progress:number)=>void} onProgress - 读取进度回调，范围 0-45。
 * @returns {Promise<string>} 可作为 JSON 字段发送给本地服务端的 Base64。
 * @throws {Error} 浏览器读取失败或结果格式异常时抛出。
 */
function readPublishImageBase64(file, onProgress) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = event => {
      if (event.lengthComputable) onProgress(Math.max(2, Math.round((event.loaded / event.total) * 45)));
    };
    reader.onerror = () => reject(new Error('浏览器无法读取这张图片，请重新选择'));
    reader.onload = () => {
      const encoded = String(reader.result || '');
      const separator = encoded.indexOf(',');
      if (separator < 0) reject(new Error('图片读取结果无效，请重新选择原始文件'));
      else resolve(encoded.slice(separator + 1));
    };
    reader.readAsDataURL(file);
  });
}

/**
 * 根据实际远程图库重新计算图片完成度。
 *
 * @param {object} product - 当前商品草稿。
 * @returns {number} WorkCTL 可读取的 http/https 图片数量。
 * @throws {Error} 不主动抛出异常。
 */
function syncPublishRemoteImageCount(product) {
  const remoteImages = [...new Set([product.image, ...(product.gallery || [])])].filter(isRemotePublishImage);
  product.imageCount = remoteImages.length;
  product.status = publishProductStatus(product);
  return remoteImages.length;
}

/**
 * 上传一条图片记录，并把图库中的 blob: 预览替换为平台可访问的远程 URL。
 *
 * @param {object} product - 图片所属的本地商品。
 * @param {object} record - 包含 File、预览地址和上传状态的记录。
 * @returns {Promise<boolean>} 上传成功返回 true，失败返回 false 并保留重试入口。
 * @throws {Error} 所有异常都会在函数内写入 record.error，不继续向外抛出。
 */
async function uploadPublishImageRecord(product, record) {
  if (!record?.file) return false;
  if (!publishState.uploadCapability.configured) {
    record.status = 'failed';
    record.progress = 0;
    record.error = '图片上传服务尚未配置';
    renderProductPublish();
    return false;
  }
  if (record.file.size > publishState.uploadCapability.maxBytes) {
    record.status = 'failed';
    record.progress = 0;
    record.error = '单张图片不能超过 8MB';
    renderProductPublish();
    return false;
  }
  record.status = 'reading';
  record.progress = 2;
  record.error = '';
  renderProductPublish();
  busy(true);
  try {
    const base64 = await readPublishImageBase64(record.file, progress => {
      record.progress = progress;
      if (product.id === publishState.activeId) renderPublishEditor();
    });
    record.status = 'uploading';
    record.progress = 55;
    renderProductPublish();
    const response = await fetch('/api/publish/images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: record.file.name,
        contentType: record.file.type,
        base64,
      }),
    });
    record.progress = 85;
    if (product.id === publishState.activeId) renderPublishEditor();
    const payload = await response.json();
    if (!response.ok || !payload.ok || !isRemotePublishImage(payload.image?.url)) {
      throw new Error(payload.error || '平台没有返回可用的图片地址');
    }
    record.status = 'uploaded';
    record.progress = 100;
    record.remoteUrl = payload.image.url;
    product.gallery = (product.gallery || []).map(url => url === record.previewUrl ? record.remoteUrl : url);
    if (product.image === record.previewUrl) product.image = record.remoteUrl;
    syncPublishRemoteImageCount(product);
    renderProductPublish();
    URL.revokeObjectURL(record.previewUrl);
    return true;
  } catch (error) {
    record.status = 'failed';
    record.progress = 0;
    record.error = String(error?.message || error || '图片上传失败');
    syncPublishRemoteImageCount(product);
    renderProductPublish();
    return false;
  } finally {
    busy(false);
    refreshLog();
  }
}

/**
 * 重试当前页面会话中仍保留 File 对象的失败图片。
 *
 * @param {object} product - 图片所属商品。
 * @param {string} uploadId - 上传记录的本地标识。
 * @returns {Promise<void>} 重试完成后通过状态条反馈结果。
 * @throws {Error} 不主动抛出异常。
 */
async function retryPublishImageUpload(product, uploadId) {
  const record = (product.uploads || []).find(item => item.id === uploadId);
  if (!record) return;
  const ok = await uploadPublishImageRecord(product, record);
  toast(ok ? `${record.filename} 已重新上传` : `${record.filename}：${record.error}`, !ok);
}

/**
 * 将用户选择的一组图片追加到当前商品，并立即开始真实远程上传。
 *
 * @param {FileList|File[]} files - 用户主动选择的图片文件。
 * @returns {Promise<void>} 全部图片依次处理完成后给出汇总反馈。
 * @throws {Error} 浏览器 Object URL 异常会被调用环境报告。
 */
async function handlePublishProductImages(files) {
  const product = publishState.products.find(item => item.id === publishState.activeId);
  const capacity = Math.max(0, 10 - new Set(product?.gallery || []).size);
  const images = [...files].filter(file => ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)).slice(0, capacity);
  if (!product || !images.length) {
    if (files.length) toast(capacity ? '图片格式仅支持 JPG、PNG 或 WEBP' : '每个商品最多保留 10 张图片', true);
    return;
  }
  const records = images.map(file => ({
    id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    file,
    filename: file.name,
    previewUrl: URL.createObjectURL(file),
    remoteUrl: '',
    status: 'waiting',
    progress: 0,
    error: '',
  }));
  product.uploads = [...(product.uploads || []), ...records];
  product.gallery = [...records.map(record => record.previewUrl), ...(product.gallery || [])].slice(0, 10);
  product.image = product.gallery[0];
  syncPublishRemoteImageCount(product);
  renderProductPublish();
  let succeeded = 0;
  for (const record of records) {
    if (await uploadPublishImageRecord(product, record)) succeeded += 1;
  }
  const failed = records.length - succeeded;
  toast(failed
    ? `${succeeded} 张上传成功，${failed} 张需要重新上传`
    : `${succeeded} 张图片已上传，可用于发布`, failed > 0);
}

/**
 * 按文件夹归组创建本地商品草稿。一个子文件夹代表一个商品；直接拖入的图片归为同一商品。
 *
 * @param {FileList|File[]} files - 文件夹选择器或拖放区域返回的图片文件。
 * @returns {Promise<void>} 新建商品并依次上传图片后转为待补全。
 * @throws {Error} 浏览器无法创建 Object URL 时可能抛出异常。
 */
async function handlePublishFolderFiles(files) {
  const imageFiles = [...files].filter(file => file.type.startsWith('image/'));
  if (!imageFiles.length) {
    toast('没有识别到 JPG、PNG 或 WEBP 图片', true);
    return;
  }
  const groups = new Map();
  imageFiles.forEach(file => {
    const pathParts = String(file.webkitRelativePath || '').split('/').filter(Boolean);
    const groupName = pathParts.length > 1 ? pathParts[pathParts.length - 2] : '新上传商品';
    if (!groups.has(groupName)) groups.set(groupName, []);
    groups.get(groupName).push(file);
  });
  const created = [];
  groups.forEach((groupFiles, groupName) => {
    const acceptedFiles = groupFiles.slice(0, 10);
    const records = acceptedFiles.map(file => ({
      id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      file,
      filename: file.name,
      previewUrl: URL.createObjectURL(file),
      remoteUrl: '',
      status: 'waiting',
      progress: 0,
      error: '',
    }));
    const urls = records.map(record => record.previewUrl);
    const cleanTitle = groupName === '新上传商品' ? groupFiles[0].name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ') : groupName.replace(/[_-]+/g, ' ');
    const product = createPublishProduct({
      categoryKey: publishState.defaultCategoryKey || publishState.products[0]?.categoryKey || 'watch',
      title: cleanTitle,
      image: urls[0],
      gallery: urls,
      imageCount: 0,
      uploads: records,
      requiredCompleted: 0,
      tradeReady: false,
      logisticsReady: false,
      shippingTemplate: '',
      status: 'recognizing',
    });
    publishState.products.unshift(product);
    created.push(product);
  });
  publishState.activeId = publishState.products[0].id;
  renderProductPublish();
  toast(`已按文件夹创建 ${groups.size} 个商品，正在上传图片`);
  let succeeded = 0;
  let failed = 0;
  for (const product of created) {
    for (const record of product.uploads) {
      if (await uploadPublishImageRecord(product, record)) succeeded += 1;
      else failed += 1;
    }
    product.status = publishProductStatus(product);
  }
  renderProductPublish();
  toast(failed
    ? `商品已创建：${succeeded} 张图片上传成功，${failed} 张需要处理`
    : `${created.length} 个商品的 ${succeeded} 张图片已上传`, failed > 0);
}

/**
 * 模拟素材识别过程，只改变本地状态，不调用 AI、OSS 或发布接口。
 *
 * @param {string} productId - 需要重新识别的本地商品 ID。
 * @returns {void} 识别完成后恢复为待补全或可发布状态。
 * @throws {Error} 不主动抛出异常。
 */
function simulatePublishRecognition(productId) {
  const product = publishState.products.find(item => item.id === productId);
  if (!product) return;
  product.status = 'recognizing';
  renderProductPublish();
  setTimeout(() => {
    product.status = 'needs_attention';
    product.requiredCompleted = Math.max(product.requiredCompleted, 8);
    renderProductPublish();
    toast('素材识别演示完成，请继续校对字段');
  }, 1000);
}

/**
 * 取得当前单品或左侧勾选的批量商品，并按动作执行前端快速校验。
 *
 * @param {'single'|'batch'} scope - single 只取右侧当前商品，batch 取左侧全部勾选项。
 * @param {'draft'|'publish'} action - 保存草稿或提交正式发布。
 * @returns {{products:object[],issues:Array<{product:object,reasons:string[]}>}} 目标商品及问题明细。
 * @throws {Error} 不主动抛出异常。
 */
function resolvePublishTargets(scope, action) {
  const products = scope === 'single'
    ? publishState.products.filter(product => product.id === publishState.activeId)
    : publishState.products.filter(product => product.selected);
  return {
    products,
    issues: products.map(product => ({ product, reasons: publishActionIssues(product, action) }))
      .filter(item => item.reasons.length),
  };
}

/**
 * 打开真实 WorkCTL 写操作的最终确认弹层。
 *
 * 单品与批量、草稿与正式发布共用同一确认组件，但文案和商品来源严格区分。
 * 用户必须勾选确认框后才能发起 POST，避免把浏览动作误当成写入授权。
 *
 * @param {{scope:'single'|'batch',action:'draft'|'publish'}} options - 操作范围和目标状态。
 * @returns {void} 校验通过时显示确认弹层；否则定位并提示首个问题商品。
 * @throws {Error} 不主动抛出异常。
 */
function openPublishConfirmation(options) {
  const { scope, action } = options;
  const { products, issues } = resolvePublishTargets(scope, action);
  if (!products.length) {
    toast(scope === 'single' ? '请先打开一个商品' : '请先在左侧选择商品', true);
    return;
  }
  if (issues.length) {
    publishState.activeId = issues[0].product.id;
    renderProductPublish();
    toast(`${issues[0].product.title}：${issues[0].reasons.join('；')}`, true);
    return;
  }

  const actionName = action === 'draft' ? '保存到国际站草稿箱' : '提交国际站正式发布';
  const scopeName = scope === 'single' ? '当前商品' : `左侧已选 ${products.length} 个商品`;
  $('#modalBody').innerHTML = `<section class="publish-confirm"><h2>确认${actionName}</h2><p>${scopeName}将进入服务端发布队列，相邻商品至少间隔 1 秒提交。</p>
    <div class="publish-confirm-list">${products.map(product => {
      const progress = publishAttributeProgress(product);
      const imageCount = [...new Set([product.image, ...(product.gallery || [])])].filter(isRemotePublishImage).length;
      return `<article><img src="${esc(product.image)}" alt="" referrerpolicy="no-referrer"><div><b>${esc(product.title)}</b><span>${esc(product.category)} · ${imageCount} 张远程图 · 属性 ${progress.completed}/${progress.total}</span></div></article>`;
    }).join('')}</div>
    <div class="publish-confirm-warning"><i class="${action === 'draft' ? 'ri-draft-line' : 'ri-error-warning-line'}" aria-hidden="true"></i><div><b>即将调用真实 WorkCTL 发布流水线</b><p>${action === 'draft' ? '每个商品会经过发布前校验，并保存到国际站草稿箱。' : '每个商品会经过发布前校验后提交平台；提交成功不等于审核通过或已经在线。'} 单条失败不会阻塞后续商品，成功后会返回质量分。</p></div></div>
    <label class="publish-confirm-check"><input type="checkbox" id="publishConfirmAcknowledge"><span>我已核对商品信息、价格和目标操作，并确认执行真实写入</span></label>
    <div class="publish-confirm-actions"><button type="button" id="publishConfirmCancel">返回修改</button><button type="button" class="primary" id="publishConfirmStart" disabled>确认${scope === 'batch' ? '批量' : ''}${action === 'draft' ? '保存草稿' : '加入发布队列'}</button></div></section>`;
  $('#modal').classList.add('on');
  $('#publishConfirmCancel').onclick = () => $('#modal').classList.remove('on');
  $('#publishConfirmAcknowledge').onchange = event => {
    $('#publishConfirmStart').disabled = !event.target.checked;
  };
  $('#publishConfirmStart').onclick = async event => {
    event.currentTarget.disabled = true;
    const queued = await startPublishQueue(products, action, scope);
    if (queued) $('#modal').classList.remove('on');
    else event.currentTarget.disabled = false;
  };
}

/**
 * 生成浏览器侧的请求幂等键。
 *
 * @returns {string} 优先使用 crypto.randomUUID；旧浏览器使用时间戳和随机数组合。
 * @throws {Error} 不主动抛出异常。
 */
function createPublishIdempotencyKey() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `publish-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * 把用户最终确认的商品加入服务端真实 WorkCTL 串行队列。
 *
 * @param {object[]} products - 单品或左侧勾选后的商品数组。
 * @param {'draft'|'publish'} action - 远端保存目标。
 * @param {'single'|'batch'} scope - 用于服务端审计和页面文案的操作范围。
 * @returns {Promise<boolean>} 入队成功返回 true；失败已提示并返回 false。
 * @throws {Error} 网络和解析异常会被转换成页面提示，不向外抛出。
 */
async function startPublishQueue(products, action, scope) {
  busy(true);
  try {
    const response = await fetch('/api/publish/enqueue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        scope,
        confirmed: true,
        acknowledgement: 'I_CONFIRM_PRODUCT_WRITE',
        idempotencyKey: createPublishIdempotencyKey(),
        products: products.map(serializePublishProduct),
      }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      toast(`加入真实队列失败：${String(payload.error || response.status).slice(0, 180)}`, true);
      return false;
    }
    const returnedJobs = Array.isArray(payload.jobs) ? payload.jobs : [];
    const operationId = String(payload.operation?.id || returnedJobs[0]?.operationId || returnedJobs[0]?.id || '');
    const returnedIds = new Set(returnedJobs.map(job => job.id));
    // 先把 POST 返回的 0/N 状态画出来，再延迟刷新；这样确认弹窗关闭后用户能立刻
    // 看见进度，极快完成的单品任务也不会让结果弹窗被确认弹窗覆盖。
    publishState.queue = [...returnedJobs, ...publishState.queue.filter(job => !returnedIds.has(job.id))];
    publishState.activeOperationId = operationId || null;
    if (operationId) {
      publishState.pendingResultOperationIds.add(operationId);
      publishState.announcedResultOperationIds.delete(operationId);
    }
    publishState.queueCollapsed = false;
    renderPublishStatus();
    renderPublishQueue();
    renderPublishOperationProgress();
    renderPublishBottomBar();
    startPublishQueuePolling();
    setTimeout(() => refreshPublishQueue({ silent: true }), 250);
    toast(`${products.length} 个商品已加入真实 WorkCTL ${action === 'draft' ? '草稿' : '发布'}队列`);
    return true;
  } catch (error) {
    toast(`发布队列网络错误：${error.message}`, true);
    return false;
  } finally {
    busy(false);
    refreshLog();
  }
}

/**
 * 从服务端读取真实队列快照，并在所有任务终止后停止轮询。
 *
 * @param {{silent?:boolean,announce?:boolean}} [options={}] - silent 控制错误提示；announce=false 用于首次加载，避免把历史结果再次弹出。
 * @returns {Promise<boolean>} 成功刷新返回 true。
 * @throws {Error} 网络异常会被捕获并按 silent 设置提示。
 */
async function refreshPublishQueue(options = {}) {
  try {
    const response = await fetch('/api/publish/jobs');
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    publishState.queue = Array.isArray(payload.jobs) ? payload.jobs : [];
    renderPublishStatus();
    renderPublishQueue();
    renderPublishOperationProgress();
    renderPublishBottomBar();
    const resultShown = options.announce === false ? true : maybeAnnouncePublishOperationResult();
    if (!publishState.queue.some(job => ['queued', 'running'].includes(job.status)) && resultShown && publishState.queuePoller) {
      clearInterval(publishState.queuePoller);
      publishState.queuePoller = null;
    }
    return true;
  } catch (error) {
    if (!options.silent) toast(`读取发布队列失败：${error.message}`, true);
    return false;
  }
}

/**
 * 启动低频队列轮询；重复调用只保留一个定时器。
 *
 * @returns {void} 每 1.5 秒读取一次服务端状态。
 * @throws {Error} 不主动抛出异常。
 */
function startPublishQueuePolling() {
  if (publishState.queuePoller) return;
  publishState.queuePoller = setInterval(() => refreshPublishQueue({ silent: true }), 1500);
}

/**
 * 对 WorkCTL 明确标记为可重试的失败任务进行人工二次确认。
 *
 * @param {string} jobId - 需要重试的服务端队列任务 ID。
 * @returns {void} 打开确认弹层；确认后重新加入同一串行队列。
 * @throws {Error} 网络异常会被转换成页面提示。
 */
function retryPublishJob(jobId) {
  const job = publishState.queue.find(item => item.id === jobId);
  if (!job || !job.retryable) return;
  $('#modalBody').innerHTML = `<section class="publish-confirm"><h2>确认重试这个真实写任务</h2><p>${esc(job.title)} · ${job.action === 'draft' ? '保存草稿' : '正式发布'}</p><div class="publish-confirm-warning"><i class="ri-error-warning-line" aria-hidden="true"></i><div><b>请先确认国际站没有生成重复商品</b><p>只有 WorkCTL 明确标记为可重试的失败才允许继续；重试仍会再次调用真实写接口。</p></div></div><label class="publish-confirm-check"><input type="checkbox" id="publishConfirmAcknowledge"><span>我已核对国际站状态，确认重试</span></label><div class="publish-confirm-actions"><button type="button" id="publishConfirmCancel">取消</button><button type="button" class="primary" id="publishConfirmStart" disabled>确认重试</button></div></section>`;
  $('#modal').classList.add('on');
  $('#publishConfirmCancel').onclick = () => $('#modal').classList.remove('on');
  $('#publishConfirmAcknowledge').onchange = event => { $('#publishConfirmStart').disabled = !event.target.checked; };
  $('#publishConfirmStart').onclick = async event => {
    event.currentTarget.disabled = true;
    try {
      const response = await fetch(`/api/publish/jobs/${encodeURIComponent(jobId)}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed: true, acknowledgement: 'I_CONFIRM_PRODUCT_WRITE' }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      $('#modal').classList.remove('on');
      const operationId = publishOperationId(payload.job || job);
      publishState.activeOperationId = operationId;
      publishState.pendingResultOperationIds.add(operationId);
      publishState.announcedResultOperationIds.delete(operationId);
      startPublishQueuePolling();
      setTimeout(() => refreshPublishQueue({ silent: true }), 250);
      toast('失败任务已重新加入真实队列');
    } catch (error) {
      toast(`重试失败：${error.message}`, true);
      event.currentTarget.disabled = false;
    }
  };
}

// ============================ 地域分布 ============================
let regionRows = [];
async function loadRegion() {
  const j = await api('shop-region', {
    ...dates(), statisticsType: 'month',
    dimensionType: $('#regionDim').value, terminalType: $('#regionTerm').value });
  if (!j) return;
  // data: [ { "2026-07-01": [ {countryName, countryUv, countryUvRate} ] } ]
  const agg = new Map();
  (Array.isArray(j.data) ? j.data : []).forEach(blk => {
    Object.values(blk || {}).forEach(list => (list || []).forEach(row => {
      const name = row.countryName || row.regionName || '未知';
      const v = num(row.countryUv ?? row.regionUv ?? row.value);
      agg.set(name, (agg.get(name) || 0) + v);
    }));
  });
  regionRows = [...agg.entries()].map(([n, v]) => ({ n, v }))
    .sort((a, b) => b.v - a.v).slice(0, 12);
  renderRegion(regionRows);
}

function renderRegion(rows) {
  const box = $('#regionChart'); box.innerHTML = '';
  if (!rows.length) { box.innerHTML = '<div class="empty">该维度无数据</div>'; return; }
  const total = rows.reduce((a, r) => a + r.v, 0);
  const W = Math.max(box.clientWidth - 10, 620), rowH = 25, H = rows.length * rowH + 12;
  const L = 152, iw = W - L - 132, max = Math.max(...rows.map(r => r.v), 1);
  const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
  rows.forEach((r, i) => {
    const y = i * rowH + 5, w = Math.max(r.v / max * iw, 2);
    svg.appendChild(el('text', { x: L - 9, y: y + 14, class: 'gt', 'text-anchor': 'end' },
      r.n.length > 20 ? r.n.slice(0, 19) + '…' : r.n));
    const b = el('rect', { x: L, y, width: w, height: 17, rx: 3,
      fill: `hsl(${24 + i * 1.2},84%,${58 - Math.min(i * .65, 13)}%)`, class: 'bar' });
    b.addEventListener('mousemove', ev => showTip(ev,
      `${r.n}\n数值: ${fmt(r.v)}\n占比: ${(r.v / total * 100).toFixed(2)}%\n\n点击 → 下钻该国访客明细`));
    b.addEventListener('mouseleave', hideTip);
    b.addEventListener('click', () => drillCountry(r.n));
    svg.appendChild(b);
    svg.appendChild(el('text', { x: L + iw + 8, y: y + 13, class: 'gt', fill: '#4c4e53' },
      `${fmt(r.v)}  (${(r.v / total * 100).toFixed(1)}%)`));
  });
  box.appendChild(svg);
}

function drillCountry(name) {
  $('#visCountry').value = name;
  vState.pageNO = 1;
  switchTab('visitor');
  toast(`下钻: ${name} → 发起访客明细真实查询`);
  loadVisitor();
}

// ============================ 流量渠道 ============================
let flowRaw = [];

/**
 * 读取流量来源、国家、买家画像、搜索词和行业市场机会，并在一个页面汇总。
 *
 * @returns {Promise<void>} 所有只读查询结束并完成渲染后返回。
 * @throws {Error} 单个接口失败由 api() 隔离，其余数据仍可展示。
 */
async function loadFlow() {
  const terminalType = $('#flowTerm').value;
  const [flow, channel, region, summary, identity, keyword, source, marketCountry, marketCategory, marketScenes] = await Promise.all([
    api('shop-flow', { ...dates(), terminalType }),
    api('shop-channel', { ...dates(), statisticsType: 'day', terminalType }),
    api('shop-region', { ...dates(), statisticsType: 'month', dimensionType: $('#regionDim').value, terminalType: $('#regionTerm').value }),
    api('shop-summary', { ...dates(), statisticsType: 'day' }),
    api('customer-profile', { dimensionType: 'byr_identity', terminalType }),
    api('customer-profile', { dimensionType: 'shop_keyword', terminalType }),
    api('customer-profile', { dimensionType: 'source', terminalType }),
    api('market-country', { cateId: '127734059', rankType: 'blueOcean', orderBy: 'supplyDemandRate', orderModel: 'ASC' }),
    api('market-categories', { cateId: '127734059', rankType: 'opportunity', orderBy: 'abCnt', orderModel: 'DESC' }),
    api('market-opportunities', { cateId: '127734059', currentPage: 1, pageSize: 10, statCycle: 90, terminalType: 'TOTAL' }),
  ]);
  flowRaw = Array.isArray(flow?.data) ? flow.data : [];
  renderFlow();
  regionRows = extractRegionRows(region);
  renderRegion(regionRows);
  renderTrafficMetrics(summary);
  renderRankList('#trafficIdentity', profileRows(identity, 'byr_identity').map(row => ({
    name: buyerIdentityName(row.byrIdentity), value: num(row.visitorRate), detail: pct(row.visitorRate), ratio: num(row.visitorRate),
  })));
  renderRankList('#trafficKeywords', profileRows(keyword, 'shop_keyword').slice(0, 8).map(row => ({
    name: row.query || row.queryRaw || '未知搜索词', value: num(row.pv),
    detail: `${fmt(row.pv)} 热度 · ${fmt(row.shopUv)} 访客 · ${num(row.pvCrc) >= 0 ? '↑' : '↓'}${Math.abs(num(row.pvCrc) * 100).toFixed(1)}%`,
  })));
  renderChannelProfile(channel, source);
  renderMarketOpportunity(marketCountry, marketCategory, marketScenes);
}

/**
 * 从客户画像响应中读取指定维度数组。
 *
 * @param {object|null} response - customer-profile 的完整接口响应。
 * @param {string} key - 维度字段名，例如 country 或 shop_keyword。
 * @returns {object[]} 画像行数组；结构缺失时返回空数组。
 * @throws {Error} 不主动抛出异常。
 */
function profileRows(response, key) {
  const blocks = Array.isArray(response?.data) ? response.data : [];
  return blocks.flatMap(block => Array.isArray(block?.[key]) ? block[key] : []);
}

/**
 * 将买家身份枚举转换成运营人员可读中文。
 *
 * @param {string} value - WorkCTL 返回的买家身份枚举。
 * @returns {string} 中文名称，未知值保留原文。
 * @throws {Error} 不主动抛出异常。
 */
function buyerIdentityName(value) {
  return ({ offline_retailer: '线下零售商', online_retailer: '线上零售商', wholesale: '批发商', manufacturer: '制造商' })[value] || value || '未知身份';
}

/**
 * 把 shop-region 的月份分块结构聚合成国家排行。
 *
 * @param {object|null} response - shop-region 完整响应。
 * @returns {{n:string,v:number}[]} 排名前 12 的国家与指标值。
 * @throws {Error} 不主动抛出异常。
 */
function extractRegionRows(response) {
  const aggregate = new Map();
  (Array.isArray(response?.data) ? response.data : []).forEach(block => {
    Object.values(block || {}).forEach(list => (Array.isArray(list) ? list : []).forEach(row => {
      const name = row.countryName || row.regionName || '未知';
      const value = num(row.countryUv ?? row.regionUv ?? row.value);
      aggregate.set(name, (aggregate.get(name) || 0) + value);
    }));
  });
  return [...aggregate.entries()].map(([n, v]) => ({ n, v })).sort((a, b) => b.v - a.v).slice(0, 12);
}

/**
 * 渲染流量页顶部经营指标，强调流量规模与承接结果。
 *
 * @param {object|null} response - shop-summary 完整响应。
 * @returns {void} 直接更新 #trafficMetrics。
 * @throws {Error} 页面容器不存在时可能抛出 DOM 异常。
 */
function renderTrafficMetrics(response) {
  const rows = Array.isArray(response?.data) ? response.data : [];
  const total = key => rows.reduce((sumValue, row) => sumValue + num(row?.[key]), 0);
  const exposure = total('totalImpsCnt');
  const clicks = total('totalClkCnt');
  const visitors = total('uvCnt') || total('visitorCnt') || total('pvCnt');
  const inquiries = total('fbCnt') + total('fbTmUv');
  const metrics = [
    ['全站曝光', fmt(exposure), `点击率 ${exposure ? (clicks / exposure * 100).toFixed(2) : '0.00'}%`],
    ['全站点击', fmt(clicks), '承接到店铺访问'],
    ['店铺访问', fmt(visitors), '渠道与国家合并观察'],
    ['询盘 + TM', fmt(inquiries), `访问承接率 ${visitors ? (inquiries / visitors * 100).toFixed(2) : '0.00'}%`],
  ];
  $('#trafficMetrics').innerHTML = metrics.map(([label, value, detail]) =>
    `<article class="analysis-kpi"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(detail)}</small></article>`).join('');
}

/**
 * 渲染通用排名列表，长度条仅表达当前列表内的相对强弱。
 *
 * @param {string} selector - 目标容器选择器。
 * @param {{name:string,value:number,detail:string,ratio?:number}[]} rows - 排名数据。
 * @returns {void} 直接更新目标容器。
 * @throws {Error} 选择器不存在时可能抛出 DOM 异常。
 */
function renderRankList(selector, rows) {
  const box = $(selector);
  if (!rows.length) { box.innerHTML = '<div class="empty">当前维度无数据</div>'; return; }
  const max = Math.max(...rows.map(row => num(row.ratio ?? row.value)), 1e-9);
  box.innerHTML = rows.map((row, index) => `<article class="rank-row"><span class="rank-no">${index + 1}</span><div><div><b>${esc(row.name)}</b><small>${esc(row.detail)}</small></div><i><em style="width:${Math.max(num(row.ratio ?? row.value) / max * 100, 3).toFixed(1)}%"></em></i></div></article>`).join('');
}

/**
 * 聚合每日渠道数据，同时保留客户画像口径作为交叉校验。
 *
 * @param {object|null} channelResponse - shop-channel 完整响应。
 * @param {object|null} sourceResponse - customer-profile(source) 响应。
 * @returns {void} 更新渠道结构排行。
 * @throws {Error} 不主动抛出异常。
 */
function renderChannelProfile(channelResponse, sourceResponse) {
  const aggregate = new Map();
  (Array.isArray(channelResponse?.data) ? channelResponse.data : []).forEach(block => {
    Object.values(block || {}).forEach(list => (Array.isArray(list) ? list : []).forEach(row => {
      const item = aggregate.get(row.channelType) || { name: row.channelType, uv: 0, tm: 0, inquiry: 0 };
      item.uv += num(row.detailUv); item.tm += num(row.tmUv); item.inquiry += num(row.fbUv);
      aggregate.set(row.channelType, item);
    }));
  });
  let rows = [...aggregate.values()].sort((a, b) => b.uv - a.uv).slice(0, 8)
    .map(row => ({ name: row.name, value: row.uv, detail: `${fmt(row.uv)} 访客 · ${fmt(row.tm)} TM · ${fmt(row.inquiry)} 询盘` }));
  if (!rows.length) {
    rows = profileRows(sourceResponse, 'source').map(row => ({ name: row.source, value: num(row.visitorRate), detail: pct(row.visitorRate), ratio: num(row.visitorRate) }));
  }
  renderRankList('#trafficSourceProfile', rows);
}

/**
 * 渲染行业国家、细分类目与需求场景，把市场机会并入流量页。
 *
 * @param {object|null} countries - 行业国家排名响应。
 * @param {object|null} categories - 细分类目排名响应。
 * @param {object|null} scenes - 需求场景响应。
 * @returns {void} 更新三块市场机会表。
 * @throws {Error} 不主动抛出异常。
 */
function renderMarketOpportunity(countries, categories, scenes) {
  const countryRows = (Array.isArray(countries?.data) ? countries.data : [])
    .filter(row => num(row.abCnt) > 0).sort((a, b) => num(a.supplyDemandRate) - num(b.supplyDemandRate)).slice(0, 8);
  const categoryRows = (Array.isArray(categories?.data) ? categories.data : []).slice(0, 6);
  const sceneRows = (Array.isArray(scenes?.data) ? scenes.data : [])
    .filter(row => row.countryId === 'all').slice(0, 6);
  const table = (headers, rows) => rows.length
    ? `<table><thead><tr>${headers.map(item => `<th>${esc(item)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`
    : '<div class="empty">当前维度无数据</div>';
  $('#trafficMarketCountry').innerHTML = table(['国家', '商机', '同比', '直达率', '供需比'], countryRows.map(row =>
    `<tr><td>${esc(row.countryId)}</td><td>${fmt(row.abCnt)}</td><td class="${num(row.abCntYoy) >= 0 ? 'positive' : 'negative'}">${num(row.abCntYoy) >= 0 ? '+' : ''}${pct(row.abCntYoy)}</td><td>${pct(row.dAbRate)}</td><td>${num(row.supplyDemandRate).toFixed(2)}</td></tr>`));
  $('#trafficMarketCategory').innerHTML = table(['细分类目', '商机', '同比', '供需比'], categoryRows.map(row =>
    `<tr><td>${esc(row.cateCnName || row.cateName || row.cateId)}</td><td>${fmt(row.abCnt)}</td><td class="${num(row.abCntYoy) >= 0 ? 'positive' : 'negative'}">${num(row.abCntYoy) >= 0 ? '+' : ''}${pct(row.abCntYoy)}</td><td>${num(row.supplyDemandRate).toFixed(2)}</td></tr>`));
  $('#trafficMarketScenes').innerHTML = table(['需求场景', '需求指数', '环比', '店铺商品占比'], sceneRows.map(row =>
    `<tr><td><b>${esc(row.sceneNameCn || row.sceneName)}</b><small>${esc(String(row.top3HotKw || '').split('|').join(' · '))}</small></td><td>${num(row.needsIndex).toFixed(1)}</td><td class="${num(row.needsIndexQoq) >= 0 ? 'positive' : 'negative'}">${num(row.needsIndexQoq) >= 0 ? '+' : ''}${pct(row.needsIndexQoq)}</td><td>${pct(row.busProdRate)}</td></tr>`));
}

function renderFlow() {
  const box = $('#flowChart'); box.innerHTML = ''; $('#flowSub').innerHTML = '';
  const tops = new Map();
  flowRaw.forEach(r => {
    if (r.subSourceType !== 'TOTAL') return;
    const k = r.sourceType;
    const o = tops.get(k) || { n: k, uv: 0, ab: 0, cateUv: 0, cnt: 0, abRate: 0, cateAb: 0 };
    o.uv += num(r.uv); o.cateUv += num(r.cateTopUvDetail);
    o.abRate += num(r.abRate); o.cateAb += num(r.cateTopAbRate); o.cnt++;
    tops.set(k, o);
  });
  const rows = [...tops.values()].filter(r => r.n !== 'TOTAL')
    .map(r => ({ ...r, abRate: r.abRate / (r.cnt || 1), cateAb: r.cateAb / (r.cnt || 1) }))
    .sort((a, b) => b.uv - a.uv);
  if (!rows.length) { box.innerHTML = '<div class="empty">无渠道数据</div>'; return; }

  const W = Math.max(box.clientWidth - 10, 620), rowH = 46, H = rows.length * rowH + 28;
  const L = 104, iw = W - L - 210, max = Math.max(...rows.map(r => r.uv), 1);
  const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
  svg.appendChild(el('text', { x: L, y: 10, class: 'gt' }, '访客数(uv) · 右侧为商机率 abRate,灰色为类目 TOP'));
  rows.forEach((r, i) => {
    const y = 22 + i * rowH, w = Math.max(r.uv / max * iw, 2);
    svg.appendChild(el('text', { x: L - 9, y: y + 17, class: 'gt', 'text-anchor': 'end' }, r.n));
    const b = el('rect', { x: L, y, width: w, height: 22, rx: 3, fill: '#ff6600', opacity: .84, class: 'bar' });
    b.addEventListener('mousemove', ev => showTip(ev,
      `${r.n}\n访客: ${fmt(r.uv)}\n商机率: ${(r.abRate * 100).toFixed(2)}%\n类目TOP: ${(r.cateAb * 100).toFixed(2)}%\n\n点击查看子渠道`));
    b.addEventListener('mouseleave', hideTip);
    b.addEventListener('click', () => renderFlowSub(r.n));
    svg.appendChild(b);
    svg.appendChild(el('text', { x: L + iw + 8, y: y + 15, class: 'gt', fill: '#4c4e53' }, fmt(r.uv)));
    // 商机率对比小条
    const bx = L + iw + 74, bw = 110;
    svg.appendChild(el('rect', { x: bx, y: y + 3, width: bw, height: 7, rx: 3, fill: '#f2eeeb' }));
    svg.appendChild(el('rect', { x: bx, y: y + 3, width: Math.min(r.abRate, 1) * bw, height: 7, rx: 3, fill: '#289b69' }));
    svg.appendChild(el('rect', { x: bx, y: y + 13, width: bw, height: 7, rx: 3, fill: '#f2eeeb' }));
    svg.appendChild(el('rect', { x: bx, y: y + 13, width: Math.min(r.cateAb, 1) * bw, height: 7, rx: 3, fill: '#a7a8ad' }));
    svg.appendChild(el('text', { x: bx, y: y + 33, class: 'gt' }, `${(r.abRate * 100).toFixed(1)}% vs ${(r.cateAb * 100).toFixed(1)}%`));
  });
  box.appendChild(svg);
}

function renderFlowSub(source) {
  const subs = flowRaw.filter(r => r.sourceType === source && r.subSourceType !== 'TOTAL');
  const box = $('#flowSub');
  if (!subs.length) { box.innerHTML = `<div class="empty">「${esc(source)}」无子渠道拆解</div>`; return; }
  const agg = new Map();
  subs.forEach(r => {
    const o = agg.get(r.subSourceType) || { n: r.subSourceType, uv: 0, ab: 0, cnt: 0 };
    o.uv += num(r.uv); o.ab += num(r.abRate); o.cnt++; agg.set(r.subSourceType, o);
  });
  const rows = [...agg.values()].sort((a, b) => b.uv - a.uv);
  box.innerHTML = `<div class="hint pad">「${esc(source)}」子渠道拆解</div>
    <div class="tablewrap"><table><thead><tr><th>子渠道</th><th>访客</th><th>商机率</th></tr></thead>
    <tbody>${rows.map(r => `<tr><td>${esc(r.n)}</td><td>${fmt(r.uv)}</td>
      <td>${(r.ab / r.cnt * 100).toFixed(2)}%</td></tr>`).join('')}</tbody></table></div>`;
}

// ============================ 访客明细 ============================
const vState = { pageNO: 1, pageSize: 10, total: 0 };
let customerContextPromise = null;

/**
 * 读取客户页需要的服务质量、最近会话实跑快照、100 位访客样本与三类画像。
 *
 * @returns {Promise<object>} 多数据源响应集合；单个接口失败时对应字段为 null。
 * @throws {Error} 单个接口错误由 api() 处理，不向外抛出。
 */
async function loadCustomerContext() {
  const range = visitorRange();
  const [summary, visitors, identity, countries, keywords, demo] = await Promise.all([
    api('shop-summary', { ...dates(), statisticsType: 'day' }),
    api('visitor-detail', { ...range, pageNO: 1, pageSize: 100 }),
    api('customer-profile', { dimensionType: 'byr_identity' }),
    api('customer-profile', { dimensionType: 'country' }),
    api('customer-profile', { dimensionType: 'shop_keyword' }),
    fetch('/api/demo').then(response => response.json()).catch(() => null),
  ]);
  return { summary, visitors, identity, countries, keywords, recentSnapshot: demo?.pages?.customerInquiry || {} };
}

async function loadVisitor() {
  if (!customerContextPromise) customerContextPromise = loadCustomerContext();
  const [j, context] = await Promise.all([
    api('visitor-detail', {
      ...visitorRange(),
      pageNO: vState.pageNO, pageSize: vState.pageSize,
      buyerCountry: $('#visCountry').value.trim(),
      isAtmFb: $('#visAtm').checked ? 'true' : '',
      isMcFb:  $('#visMc').checked  ? 'true' : '',
    }),
    customerContextPromise,
  ]);
  if (!j) return;
  const d = j.data?.data || {};
  const rows = d.data || [];
  vState.total = d.total || 0;
  renderVisitor(rows);
  renderCustomerDashboard(context);
  $('#visPageInfo').textContent =
    `第 ${vState.pageNO} 页 · 本页 ${rows.length} 条 · 共 ${fmt(vState.total)} 位访客`;
}

/**
 * 计算访客优先级。该分数只用于排序，不冒充平台官方评分。
 *
 * @param {object} row - visitor-detail 返回的访客记录。
 * @returns {number} 行为越接近成交，分数越高。
 * @throws {Error} 不主动抛出异常，缺失字段按 0 处理。
 */
function customerIntentScore(row) {
  return (row.isClickPlaceOrder ? 8 : 0) + (row.isMcFb ? 6 : 0) + (row.isAtmFb ? 5 : 0) +
    (num(row.totalRfqCnt) > 0 ? 3 : 0) + (row.isViewContactInformation ? 2 : 0) +
    (row.isAddInquiryCart ? 2 : 0) + Math.min(num(row.totalMcFbCnt), 3) * 2 +
    Math.min(num(row.totalAtmFbCnt), 3) + Math.min(num(row.visitPv), 5) * 0.4 +
    Math.min(num(row.staySecond) / 60, 3);
}

/**
 * 渲染客户页顶部结论、高意向访客、最近会话与画像排行。
 *
 * @param {object} context - loadCustomerContext 聚合的数据源。
 * @returns {void} 直接更新客户页所有分析区。
 * @throws {Error} 页面容器缺失时可能抛出 DOM 访问异常。
 */
function renderCustomerDashboard(context) {
  const summaryRowsLocal = Array.isArray(context?.summary?.data) ? context.summary.data.filter(row => row?.statDate) : [];
  const latestRow = summaryRowsLocal.slice().sort((a, b) => String(a.statDate).localeCompare(String(b.statDate))).at(-1) || {};
  const visitorData = context?.visitors?.data?.data || {};
  const visitorRows = Array.isArray(visitorData.data) ? visitorData.data : [];
  const conversations = Array.isArray(context?.recent?.data?.conversations) ? context.recent.data.conversations : [];
  const recentSnapshot = context?.recentSnapshot || {};
  const unreadConversations = conversations.length ? conversations.filter(item => item.hasUnread).length : num(recentSnapshot.recentUnreadConversations);
  const unreadMessages = conversations.length ? conversations.reduce((total, item) => total + num(item.unreadMessageCount), 0) : num(recentSnapshot.recentUnreadMessages);
  const metrics = [
    ['近 30 天访客', fmt(visitorData.total || vState.total), '访客明细完整计数'],
    ['最近未读会话', fmt(unreadConversations), `${fmt(unreadMessages)} 条未读消息 · 实跑快照`],
    ['首次回复率', pct(latestRow.fstReplyRate30d), '最近经营日快照'],
    ['平均回复时长', `${num(latestRow.avgReplyTime30d).toFixed(2)}h`, '越低越好'],
  ];
  $('#customerMetrics').innerHTML = metrics.map(([label, value, detail]) =>
    `<article class="analysis-kpi"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(detail)}</small></article>`).join('');

  const priority = visitorRows.map(row => ({ row, score: customerIntentScore(row) }))
    .filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 8);
  $('#customerPriorityCount').textContent = `${priority.length} 位 · 100 人样本`;
  $('#customerPriority').innerHTML = priority.length ? priority.map((item, index) => {
    const row = item.row;
    const behaviors = [row.isClickPlaceOrder && '下单', row.isMcFb && '询盘', row.isAtmFb && 'TM',
      num(row.totalRfqCnt) > 0 && `RFQ ${fmt(row.totalRfqCnt)}`, row.isViewContactInformation && '看联系方式',
      row.isAddInquiryCart && '加购', num(row.totalMcFbCnt) > 0 && `累计询盘 ${fmt(row.totalMcFbCnt)}`,
      num(row.totalAtmFbCnt) > 0 && `累计TM ${fmt(row.totalAtmFbCnt)}`].filter(Boolean);
    const visitor = String(row.visitorId || `访客 ${index + 1}`);
    const masked = visitor.length > 6 ? `${visitor.slice(0, 6)}***` : visitor;
    return `<article class="priority-row"><span class="priority-score">${item.score.toFixed(1)}</span><div><div><b>${esc(masked)} · ${esc(row.buyerCountryId || '未知国家')}</b><span>${esc(row.levelTag || '未分层')}</span></div><p>${esc(row.searchKeyword || '直接访问')} · 本次 ${fmt(row.visitPv)} 页 / ${fmt(row.staySecond)} 秒</p><div class="behavior-tags">${behaviors.map(text => `<em>${esc(text)}</em>`).join('') || '<em>深度浏览</em>'}</div></div></article>`;
  }).join('') : '<div class="empty">100 位访客样本中没有高意向行为</div>';

  $('#customerConversations').innerHTML = conversations.length ? conversations
    .slice().sort((a, b) => Number(b.hasUnread) - Number(a.hasUnread)).slice(0, 8).map(item => {
      const rawTime = item.conversationModifyTime || item.latestMessage?.sendTime;
      const time = rawTime ? new Date(Number(rawTime) || rawTime).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '时间未知';
      return `<article class="conversation-row ${item.hasUnread ? 'unread' : ''}"><span class="country-badge">${esc(item.contactCountry || '—')}</span><div><div><b>${item.hasUnread ? `${fmt(item.unreadMessageCount)} 条未读` : '已读会话'}</b><small>${esc(time)}</small></div><p>${(item.tags || []).map(tag => `<em>${esc(tag)}</em>`).join('') || '<em>未标记</em>'}</p></div></article>`;
    }).join('') : Object.entries(recentSnapshot.recentConversationCountries || {}).map(([country, count]) => {
      const isUnreadCountry = country === recentSnapshot.recentUnreadCountry;
      return `<article class="conversation-row ${isUnreadCountry ? 'unread' : ''}"><span class="country-badge">${esc(country)}</span><div><div><b>${fmt(count)} 个最近会话${isUnreadCountry ? ` · ${fmt(unreadMessages)} 条未读` : ''}</b><small>本轮实跑快照</small></div><p>${isUnreadCountry ? `<em>${esc(recentSnapshot.recentUnreadTag || '待处理')}</em>` : '<em>已脱敏汇总</em>'}</p></div></article>`;
    }).join('') || '<div class="empty">当前没有可读取的最近会话</div>';

  renderRankList('#customerIdentity', profileRows(context?.identity, 'byr_identity').map(row => ({
    name: buyerIdentityName(row.byrIdentity), value: num(row.visitorRate), ratio: num(row.visitorRate), detail: pct(row.visitorRate),
  })));
  renderRankList('#customerCountries', profileRows(context?.countries, 'country').slice(0, 8).map(row => ({
    name: row.country, value: num(row.visitorRate), ratio: num(row.visitorRate), detail: pct(row.visitorRate),
  })));
  renderRankList('#customerKeywords', profileRows(context?.keywords, 'shop_keyword').slice(0, 8).map(row => ({
    name: row.query || row.queryRaw || '未知搜索词', value: num(row.pv), detail: `${fmt(row.pv)} 热度 · ${fmt(row.shopUv)} 访客`,
  })));
}

const VCOLS = [
  ['visitorId', '访客ID'], ['buyerCountryId', '国家'], ['levelTag', '层级'],
  ['searchKeyword', '进店词'], ['visitPv', '本次浏览'], ['staySecond', '停留(秒)'],
  ['totalVisitPv', '累计浏览'], ['totalAtmFbCnt', '累计TM'], ['totalMcFbCnt', '累计询盘'],
  ['totalRfqCnt', 'RFQ'], ['totalVisitSellerCnt', '看过供应商'], ['statDate', '日期'],
];

function renderVisitor(rows) {
  const box = $('#visTable');
  if (!rows.length) { box.innerHTML = '<div class="empty">无匹配访客</div>'; return; }
  box.innerHTML = `<table><thead><tr>${
    VCOLS.map(([, n]) => `<th>${n}</th>`).join('')}<th>行为</th></tr></thead><tbody>${
    rows.map((r, i) => `<tr data-i="${i}">${VCOLS.map(([k]) => {
      const v = r[k];
      if (k === 'searchKeyword') return `<td><span class="pname" title="${esc(v)}">${esc(v || '—')}</span></td>`;
      if (k === 'visitorId' || k === 'buyerCountryId' || k === 'levelTag' || k === 'statDate')
        return `<td>${esc(v ?? '—')}</td>`;
      return `<td>${fmt(v)}</td>`;
    }).join('')}<td>${
      [r.isAtmFb && 'TM', r.isMcFb && '询盘', r.isViewContactInformation && '看联系方式',
       r.isAddInquiryCart && '加购', r.isClickPlaceOrder && '下单']
        .filter(Boolean).map(t => `<span class="tag t-潜力优品">${t}</span>`).join(' ') || '—'
    }</td></tr>`).join('')}</tbody></table>`;
  box.querySelectorAll('tbody tr').forEach(tr => tr.onclick = () => {
    const r = rows[+tr.dataset.i];
    $('#modalBody').innerHTML = `<h2 style="font-size:15px">访客 ${esc(r.visitorId)}</h2>
      <div class="hint" style="margin-top:5px">${esc(r.buyerCountryId)} · ${esc(r.levelTag)} · ${esc(r.statDate)}</div>
      <div class="kvgrid">${Object.keys(r).map(k => `<div class="kv"><div class="k">${esc(k)}</div>
        <div class="v" style="font-size:12px">${esc(String(r[k] ?? '—')).slice(0, 60)}</div></div>`).join('')}</div>`;
    $('#modal').classList.add('on');
  });
}

// ============================ 关键词与广告 ============================
const ADS_PRODUCT_IDS = ['110102001', '110102004'];

/**
 * 从广告产出日期响应中寻找 YYYYMMDD 日期字符串。
 *
 * @param {*} value - ads-stat-date 返回的任意层级结构。
 * @returns {string} 找到的 8 位日期，未找到时返回空字符串。
 * @throws {Error} 不主动抛出异常。
 */
function findCompactDate(value) {
  if (typeof value === 'string' && /^20\d{6}$/.test(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) { const found = findCompactDate(item); if (found) return found; }
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) { const found = findCompactDate(item); if (found) return found; }
  }
  return '';
}

/**
 * 把 YYYYMMDD 转换为可读日期，并计算前 29 天作为 30 天窗口起点。
 *
 * @param {string} compact - YYYYMMDD 日期。
 * @returns {{compact:string,readable:string,startCompact:string,startReadable:string}} 广告查询日期窗口。
 * @throws {Error} 不主动抛出异常，非法值回退到页面结束日期。
 */
function adsDateRange(compact) {
  const fallback = dates().endDate.replaceAll('-', '');
  const endCompact = /^20\d{6}$/.test(compact) ? compact : fallback;
  const readable = `${endCompact.slice(0, 4)}-${endCompact.slice(4, 6)}-${endCompact.slice(6, 8)}`;
  const end = new Date(Date.UTC(Number(endCompact.slice(0, 4)), Number(endCompact.slice(4, 6)) - 1, Number(endCompact.slice(6, 8))));
  const start = new Date(end.getTime() - 29 * 86400000);
  const startReadable = iso(start);
  return { compact: endCompact, readable, startCompact: startReadable.replaceAll('-', ''), startReadable };
}

/**
 * 从常见分页响应结构中提取行和总数。
 *
 * @param {object|null} response - WorkCTL 接口完整响应。
 * @returns {{rows:object[],total:number}} 标准化后的分页结果。
 * @throws {Error} 不主动抛出异常。
 */
function pagedRows(response) {
  const candidates = [response?.data?.data, response?.data];
  const page = candidates.find(item => item && typeof item === 'object') || {};
  const rows = Array.isArray(page.items) ? page.items : Array.isArray(page.data) ? page.data : [];
  return { rows, total: num(page.count ?? page.totalCount ?? page.total ?? rows.length) };
}

/**
 * 读取广告效果接口的记录总数，兼容不同返回嵌套。
 *
 * @param {object|null} response - 任一广告效果响应。
 * @returns {number} 明细总数；无数据或失败时返回 0。
 * @throws {Error} 不主动抛出异常。
 */
function effectRecordCount(response) {
  return num(response?.data?.totalCount ?? response?.data?.data?.totalCount ?? response?.data?.count ?? response?.data?.data?.count);
}

/**
 * 读取实时可售资源与次月资源，并拼接最近一次广告词库和效果链路实跑快照。
 *
 * @returns {Promise<void>} 所有查询与页面渲染结束后返回。
 * @throws {Error} 单个 WorkCTL 接口失败不会阻断其他区域。
 */
async function loadAds() {
  const demo = await fetch('/api/demo').then(response => response.json()).catch(() => null);
  const snapshot = demo?.pages?.ads || {};
  const auditedDate = String(demo?.pages?.ads?.latestPlatformDataDate || '').replaceAll('-', '');
  const range = adsDateRange(auditedDate);
  const pageParam = JSON.stringify({ pageIndex: 1, pageSize: 100 });
  const [keywords, resources] = await Promise.all([
    api('ads-keywords', { productId: ADS_PRODUCT_IDS[0], sellStatus: 0, requestPage: pageParam }),
    api('ads-next-resources', { productId: ADS_PRODUCT_IDS[0], sellNode: 'nextFirstAuctionWord' }),
  ]);
  const keywordProfile = snapshot.shopKeywordProfile || {};
  const toRows = words => (Array.isArray(words) ? words : []).map(keyword => ({ keyword, channel: '全端', productId: 0 }));
  const profile = { data: {
    highInquiryWords: toRows(keywordProfile.highInquiryKeywordSample),
    highTrafficWords: toRows(keywordProfile.highTrafficKeywordSample),
    highP4pWords: toRows(keywordProfile.highP4pKeywordSample),
  } };
  renderAdsDashboard({ range, profile, keywords, resources, effectSnapshot: snapshot });
}

/**
 * 将高询盘、高引流与高 P4P 词合并为去重核心词列表。
 *
 * @param {object} profile - 已由服务端脱敏的店铺广告画像。
 * @returns {object[]} 带信号、渠道与关联商品数的核心词。
 * @throws {Error} 不主动抛出异常。
 */
function mergeAdsCoreWords(profile) {
  const merged = new Map();
  const groups = [
    ['高询盘', profile?.highInquiryWords],
    ['高引流', profile?.highTrafficWords],
    ['高P4P', profile?.highP4pWords],
  ];
  groups.forEach(([signal, rows]) => (Array.isArray(rows) ? rows : []).forEach(row => {
    const key = `${String(row.keyword).toLowerCase()}|${row.channel || '全端'}`;
    const item = merged.get(key) || { keyword: row.keyword, channel: row.channel || '全端', signals: new Set(), products: new Set() };
    item.signals.add(signal);
    if (row.productId) item.products.add(row.productId);
    merged.set(key, item);
  }));
  return [...merged.values()].sort((a, b) => b.signals.size - a.signals.size || b.products.size - a.products.size);
}

/**
 * 渲染广告单页，明确区分店铺词库、可售资源和投放效果三种口径。
 *
 * @param {object} data - loadAds 聚合的广告数据。
 * @returns {void} 直接更新关键词与广告页面。
 * @throws {Error} 页面容器缺失时可能抛出 DOM 访问异常。
 */
function renderAdsDashboard(data) {
  const profile = data.profile?.data || {};
  const coreWords = mergeAdsCoreWords(profile);
  const keywordPage = pagedRows(data.keywords);
  const resourcePage = pagedRows(data.resources);
  const snapshotCounts = [
    num(data.effectSnapshot?.companyEffectRows),
    num(data.effectSnapshot?.keywordEffectRows),
    num(data.effectSnapshot?.searchTermEffectRows),
    num(data.effectSnapshot?.productEffectRows),
    num(data.effectSnapshot?.achieveRateRows),
  ];
  // 审计快照记录的是两条产品线核验后的合计状态；复制为两行只用于说明均为 0。
  const effectCounts = [...snapshotCounts, ...snapshotCounts];
  const totalEffects = effectCounts.reduce((total, value) => total + value, 0);
  const highInquiryCount = num(data.effectSnapshot?.shopKeywordProfile?.highInquiryRows) || (Array.isArray(profile.highInquiryWords) ? profile.highInquiryWords.length : 0);
  const highTrafficCount = num(data.effectSnapshot?.shopKeywordProfile?.highTrafficRows) || (Array.isArray(profile.highTrafficWords) ? profile.highTrafficWords.length : 0);
  const highP4pCount = num(data.effectSnapshot?.shopKeywordProfile?.highP4pRows) || (Array.isArray(profile.highP4pWords) ? profile.highP4pWords.length : 0);
  $('#adsDataDate').textContent = `平台最新产出 · ${data.range.readable}`;
  $('#adsMetrics').innerHTML = [
    ['店铺核心词', fmt(coreWords.length), `${highInquiryCount} 高询盘 · ${highTrafficCount} 高引流 · ${highP4pCount} 高 P4P`],
    ['可售关键词', fmt(keywordPage.total), '资源机会，不等于正在投放'],
    ['次月释放资源', fmt(resourcePage.total), '可预约与受限资源合计'],
    ['效果明细记录', fmt(totalEffects), `两条产品线 · ${data.range.startReadable} 至 ${data.range.readable}`],
  ].map(([label, value, note]) => `<article class="analysis-kpi"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></article>`).join('');

  const lineNames = ['问鼎', '顶展'];
  const effectNames = ['公司', '关键词', '搜索词', '商品', '达标率'];
  const checkedText = lineNames.map((line, lineIndex) => `${line}：${effectNames.map((name, typeIndex) => `${name}${effectCounts[lineIndex * 5 + typeIndex] || 0}`).join(' / ')}`).join('；');
  $('#adsStatusNotice').className = `notice-card ${totalEffects ? 'has-data' : 'is-empty'}`;
  $('#adsStatusNotice').innerHTML = `<i class="${totalEffects ? 'ri-checkbox-circle-line' : 'ri-information-line'}" aria-hidden="true"></i><div><b>${totalEffects ? '广告效果已读取' : '不是接口没接：最新周期确实没有投放效果记录'}</b><p>平台最新产出日 ${esc(data.range.readable)}；本轮实跑快照已核验问鼎（110102001）与顶展（110102004）五层效果。${esc(checkedText)}</p></div>`;

  $('#adsCoreWords').innerHTML = coreWords.length ? `<table><thead><tr><th>关键词</th><th>渠道</th><th>经营信号</th><th>关联商品</th></tr></thead><tbody>${coreWords.slice(0, 14).map(row =>
    `<tr><td><b>${esc(row.keyword)}</b></td><td>${esc(row.channel)}</td><td>${[...row.signals].map(signal => `<span class="signal-tag">${esc(signal)}</span>`).join('')}</td><td>${fmt(row.products.size)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">店铺 90 天词库暂无数据</div>';
  const allSignals = coreWords.filter(row => row.signals.size === 3);
  const inquiryWithoutP4p = coreWords.filter(row => row.signals.has('高询盘') && !row.signals.has('高P4P'));
  const trafficWithoutInquiry = coreWords.filter(row => row.signals.has('高引流') && !row.signals.has('高询盘'));
  $('#adsInsights').innerHTML = [
    [allSignals.length, '三类信号重合', '既能引流又能产询盘且已有 P4P 信号，优先保护核心词资源。'],
    [inquiryWithoutP4p.length, '高询盘但非高 P4P', '先核对可售资源和商品利润，再决定是否扩投。'],
    [trafficWithoutInquiry.length, '高引流但非高询盘', '不要只追流量，检查落地商品、价格与询盘承接。'],
    [resourcePage.total, '次月资源机会', '预定属于写操作，本页面只显示，不自动执行。'],
  ].map(([value, label, note]) => `<article><span class="diag-count">${fmt(value)}</span><div><b>${esc(label)}</b><p>${esc(note)}</p></div></article>`).join('');

  $('#adsKeywordCount').textContent = `共 ${fmt(keywordPage.total)} 个 · 展示前 ${Math.min(keywordPage.rows.length, 15)}`;
  $('#adsKeywordTable').innerHTML = keywordPage.rows.length ? `<table><thead><tr><th>关键词</th><th>渠道</th><th>搜索曝光指数</th><th>搜索点击率</th><th>商机转化率</th><th>关联优爆品</th><th>售卖状态</th></tr></thead><tbody>${keywordPage.rows.slice(0, 15).map(row =>
    `<tr><td><b>${esc(row['关键词'] || row.keyword || '—')}</b></td><td>${esc(row['关键词渠道'] || row.channel || '—')}</td><td>${esc(row['全站搜索曝光指数'] ?? '—')}</td><td>${esc(row['全站搜索点击率'] ?? '—')}</td><td>${esc(row['全站商机转化率'] ?? '—')}</td><td>${fmt(row['关联优爆品数量'])}</td><td><span class="action-tag">${esc(row['关键词售卖状态'] || row.sellStatus || '可查询')}</span></td></tr>`).join('')}</tbody></table>` : '<div class="empty">当前没有可售关键词资源</div>';

  $('#adsEffectState').textContent = totalEffects ? `${fmt(totalEffects)} 条记录` : '已核验 · 真实为空';
  $('#adsEffectState').className = `data-state ${totalEffects ? 'is-live' : ''}`;
  $('#adsEffectBody').innerHTML = totalEffects ? `<div class="effect-chain">${effectNames.map((name, index) => `<article><span>${esc(name)}</span><strong>${fmt(effectCounts[index] + effectCounts[index + 5])}</strong><small>两条产品线合计</small></article>`).join('')}</div>` : `<div class="designed-empty ads-empty"><i class="ri-bar-chart-grouped-line" aria-hidden="true"></i><b>当前窗口没有广告效果明细</b><span>店铺 90 天词库有数据、可售关键词有 ${fmt(keywordPage.total)} 个；空的是问鼎与顶展的投放效果，不应拿资源词库冒充广告表现。</span></div>`;
}

// ============================ RFQ 商机 ============================
let rfqState = {
  items: [],
  filtered: [],
  selected: null,
  source: 'all',
  country: 'all',
  keyword: 'smart watch',
  totals: { internal: 0, external: 0, quotes: 0 },
};

/**
 * 为 RFQ 生成只用于页面排序的运营优先级。
 *
 * 该分数不是 Alibaba.com 平台匹配分。站内商机主要参考买家历史询盘、RFQ、
 * 报价查看和高质量标签；站外商机参考认证、采购量、贸易条款和剩余席位。
 * 分数只用于把信息更完整、意向信号更强的商机排在前面。
 *
 * @param {object} item - 服务端已经脱敏的 RFQ 商机。
 * @returns {number} 0 到 100 的页面排序分。
 * @throws {Error} 不主动抛异常；字段缺失时按 0 处理。
 */
function rfqPriorityScore(item) {
  const behavior = item?.behavior || {};
  const tags = Array.isArray(item?.buyerTags) ? item.buyerTags.join(' ').toLowerCase() : '';
  let score = 20;
  score += Math.min(18, num(behavior.validInquiryCount) * 2);
  score += Math.min(16, num(behavior.validRfqCount) * 3);
  score += Math.min(12, num(behavior.viewedQuoteCount));
  score += tags.includes('typically replies') ? 10 : 0;
  score += tags.includes('complete order') ? 10 : 0;
  score += tags.includes('verified') || item?.buyerVerified ? 8 : 0;
  score += num(item?.quantity) >= 100 ? 6 : num(item?.quantity) > 0 ? 3 : 0;
  score += num(item?.remainingQuota) >= 5 ? 4 : 0;
  score += item?.tradeTerms || item?.paymentTerms ? 4 : 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * 把 ISO 时间转换成紧凑的中文日期时间。
 *
 * @param {*} value - ISO 时间、日期字符串或空值。
 * @returns {string} 可读日期时间；无法解析时返回原字符串或破折号。
 * @throws {Error} 不主动抛异常。
 */
function rfqTimeLabel(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * 读取站内、站外 RFQ 与报价历史，并使用 Demo 中最近一次权益审计快照。
 *
 * 权益接口在当前账号会长时间阻塞，因此首屏不会实时调用它；这能保证商机列表
 * 快速可用，同时在权益卡中明确标注快照日期和实时接口状态。
 *
 * @param {string} [keyword] - 英文产品搜索词，默认沿用当前输入框。
 * @returns {Promise<void>} 数据读取、筛选和页面渲染完成后返回。
 * @throws {Error} 单个接口失败会显示局部空状态，不会让整页失效。
 */
async function loadRfq(keyword = $('#rfqKeyword')?.value.trim() || 'smart watch') {
  rfqState.keyword = keyword || 'smart watch';
  $('#rfqPageState').textContent = '正在读取 WorkCTL';
  $('#rfqOpportunityList').innerHTML = '<div class="empty"><span class="spin"></span> 正在读取商机…</div>';
  const demoPromise = fetch('/api/demo').then(response => response.json()).catch(() => null);
  const [internal, external, history, demo] = await Promise.all([
    api('rfq-internal-search', { pageNum: 1, pageSize: 10, searchText: rfqState.keyword }),
    api('rfq-external-search', { keywords: JSON.stringify([rfqState.keyword]), pageNum: 1, pageSize: 10 }),
    api('rfq-quote-history', { pageSize: 20, currentPage: 1 }),
    demoPromise,
  ]);
  const internalItems = Array.isArray(internal?.data?.items) ? internal.data.items : [];
  const externalItems = Array.isArray(external?.data?.items) ? external.data.items : [];
  rfqState.items = [...internalItems, ...externalItems]
    .map(item => ({ ...item, priority: rfqPriorityScore(item) }))
    .sort((a, b) => b.priority - a.priority || num(b.quantity) - num(a.quantity));
  rfqState.totals = {
    internal: num(internal?.data?.total),
    external: num(external?.data?.total),
    quotes: num(history?.data?.total),
  };
  renderRfqCountries();
  renderRfqKpis(demo?.pages?.rfq?.rightsSnapshot);
  renderRfqHistory(history?.data?.items || []);
  renderRfqRights(demo?.pages?.rfq?.rightsSnapshot, demo?.pages?.rfq?.rightsLiveStatus);
  applyRfqFilters();
  $('#rfqPageState').textContent = `${rfqState.keyword} · 三组数据已读取`;
  $('#dataFreshness').textContent = `已更新 · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
}

/**
 * 根据当前商机集合生成国家选项，并尽量保留用户已选国家。
 *
 * @returns {void} 直接更新 #rfqCountry。
 * @throws {Error} 页面缺少国家筛选控件时可能抛出 DOM 访问异常。
 */
function renderRfqCountries() {
  const countries = [...new Set(rfqState.items.map(item => item.country).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));
  if (!countries.includes(rfqState.country)) rfqState.country = 'all';
  $('#rfqCountry').innerHTML = `<option value="all">全部国家</option>${countries.map(country => `<option value="${esc(country)}">${esc(country)}</option>`).join('')}`;
  $('#rfqCountry').value = rfqState.country;
}

/**
 * 渲染 RFQ 核心指标，权益值必须同时带审计日期。
 *
 * @param {object|null} rights - Demo 保存的最近一次脱敏权益快照。
 * @returns {void} 直接更新 #rfqKpis。
 * @throws {Error} 不主动抛异常。
 */
function renderRfqKpis(rights) {
  const rightsValue = rights && Number.isFinite(Number(rights.availableQuote)) ? fmt(rights.availableQuote) : '—';
  $('#rfqKpis').innerHTML = [
    ['站内 RFQ', fmt(rfqState.totals.internal), `${rfqState.keyword} · WorkCTL 实时`],
    ['站外 RFQ', fmt(rfqState.totals.external), `MIC / Tradewheel · WorkCTL 实时`],
    ['报价历史', fmt(rfqState.totals.quotes), '平台历史记录 · WorkCTL 实时'],
    ['剩余普通权益', rightsValue, rights?.auditedAt ? `审计快照 · ${rights.auditedAt}` : '实时接口本轮未返回'],
  ].map(([label, value, note]) => `<article class="analysis-kpi"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></article>`).join('');
}

/**
 * 应用来源和国家筛选，再重新渲染商机池与当前详情。
 *
 * @returns {void} 直接更新页面状态。
 * @throws {Error} 不主动抛异常。
 */
function applyRfqFilters() {
  rfqState.filtered = rfqState.items.filter(item =>
    (rfqState.source === 'all' || item.sourceType === rfqState.source) &&
    (rfqState.country === 'all' || item.country === rfqState.country));
  const selectedStillVisible = rfqState.selected && rfqState.filtered.some(item => item.id === rfqState.selected.id);
  if (!selectedStillVisible) rfqState.selected = rfqState.filtered[0] || null;
  renderRfqPool();
  renderRfqDetail(rfqState.selected);
}

/**
 * 渲染商机卡片列表；卡片点击只读取详情，不会打开外站或发起报价。
 *
 * @returns {void} 直接更新 #rfqOpportunityList。
 * @throws {Error} 不主动抛异常。
 */
function renderRfqPool() {
  $('#rfqPoolCount').textContent = `当前展示 ${rfqState.filtered.length} 条 · 总量 ${fmt(rfqState.totals.internal + rfqState.totals.external)}`;
  if (!rfqState.filtered.length) {
    $('#rfqOpportunityList').innerHTML = '<div class="designed-empty"><i class="ri-inbox-2-line" aria-hidden="true"></i><b>没有符合筛选的 RFQ</b><span>调整来源、国家或搜索词后再试。</span></div>';
    return;
  }
  $('#rfqOpportunityList').innerHTML = rfqState.filtered.map((item, index) => {
    const selected = rfqState.selected?.id === item.id;
    const quantity = item.quantity ? `${fmt(item.quantity)} ${esc(item.quantityUnit || '')}` : '数量待确认';
    const signals = [item.country, item.category, item.createdText].filter(Boolean).slice(0, 3);
    return `<button class="rfq-opportunity-card ${selected ? 'on' : ''}" type="button" data-rfq-index="${index}" aria-pressed="${selected}">
      <span class="rfq-thumb ${item.image ? 'has-image' : ''}">${item.image ? `<img src="${esc(item.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<i class="${item.sourceType === 'internal' ? 'ri-file-search-line' : 'ri-global-line'}" aria-hidden="true"></i>`}</span>
      <span class="rfq-card-copy"><span class="rfq-card-top"><em>${esc(item.sourceType === 'internal' ? '站内 RFQ' : item.source || '站外 RFQ')}</em><b>运营优先级 ${item.priority}</b></span><strong>${esc(item.title || '未命名采购需求')}</strong><small>${signals.map(esc).join(' · ') || '采购信息待补充'}</small><span class="rfq-card-bottom"><span>${quantity}</span><span>${fmt(item.quotedCount)} 家已报价 · 剩 ${fmt(item.remainingQuota)} 席</span></span></span>
    </button>`;
  }).join('');
  $$('.rfq-opportunity-card').forEach(button => {
    button.onclick = () => selectRfq(rfqState.filtered[Number(button.dataset.rfqIndex)]);
  });
}

/**
 * 选择一条 RFQ，先展示列表携带的详情，再调用专用详情工具刷新。
 *
 * @param {object} item - 用户点击的脱敏商机。
 * @returns {Promise<void>} 详情工具返回或失败后结束。
 * @throws {Error} 接口失败由 api() 转成页面提示。
 */
async function selectRfq(item) {
  if (!item) return;
  // 保存本次请求的商机 ID。详情接口响应较慢时，用户可能已经切换到另一条商机；
  // 只有仍然选中同一条商机时才允许回写，避免旧响应覆盖新的详情面板。
  const requestedId = item.id;
  rfqState.selected = item;
  renderRfqPool();
  renderRfqDetail(item, '正在核对详情');
  const endpoint = item.sourceType === 'internal' ? 'rfq-internal-detail' : 'rfq-external-detail';
  const response = await api(endpoint, item.sourceType === 'internal'
    ? { encRfqId: item.id, language: 'en' }
    : { rfqId: item.id });
  if (rfqState.selected?.id !== requestedId) return;
  const refreshed = response?.data?.items?.[0];
  if (refreshed) {
    rfqState.selected = { ...item, ...refreshed, priority: rfqPriorityScore({ ...item, ...refreshed }) };
    const masterIndex = rfqState.items.findIndex(row => row.id === item.id);
    if (masterIndex >= 0) rfqState.items[masterIndex] = rfqState.selected;
    // 详情刷新可能改变采购量、剩余席位等列表摘要，因此同步刷新选中卡片。
    applyRfqFilters();
  }
  renderRfqDetail(rfqState.selected, refreshed ? '详情已核对' : '列表详情');
}

/**
 * 渲染所选 RFQ 的采购信息、竞争状态和买家行为信号。
 *
 * @param {object|null} item - 当前选中的商机。
 * @param {string} [stateLabel='列表详情'] - 详情来源状态。
 * @returns {void} 直接更新详情卡。
 * @throws {Error} 不主动抛异常。
 */
function renderRfqDetail(item, stateLabel = '列表详情') {
  const panel = $('#rfqDetailPanel');
  if (!item) {
    panel.innerHTML = '<div class="card-hd"><div><h2>RFQ 详情</h2><div class="hint">点击左侧商机查看完整采购与买家信号</div></div><span class="data-state">未选择</span></div><div class="rfq-detail-empty"><i class="ri-file-search-line" aria-hidden="true"></i><b>没有选中的商机</b><span>调整筛选后选择一条 RFQ。</span></div>';
    return;
  }
  const behavior = item.behavior || {};
  const behaviorRows = item.sourceType === 'internal' ? [
    ['近期开店登录', `${fmt(behavior.loginDays)} 天`],
    ['历史搜索', fmt(behavior.searchCount)],
    ['有效询盘', fmt(behavior.validInquiryCount)],
    ['有效 RFQ', fmt(behavior.validRfqCount)],
    ['收到报价', fmt(behavior.receivedQuoteCount)],
    ['查看报价', fmt(behavior.viewedQuoteCount)],
  ] : [
    ['买家认证', item.buyerVerified ? '已认证' : '未标注'],
    ['RFQ 状态', item.status || '—'],
    ['贸易条款', item.tradeTerms || '—'],
    ['付款条款', item.paymentTerms || '—'],
    ['目的港', item.destinationPort || '—'],
    ['有效期', item.expiredTime || '—'],
  ];
  const tags = [...(item.buyerTags || []), ...(item.businessType ? [item.businessType] : [])].slice(0, 8);
  panel.innerHTML = `<div class="card-hd"><div><h2>RFQ 详情</h2><div class="hint">${esc(item.source)} · ${esc(item.country || '国家未知')}</div></div><span class="data-state is-live">${esc(stateLabel)}</span></div>
    <div class="rfq-detail-content">
      <div class="rfq-detail-heading"><span class="rfq-source-badge ${item.sourceType}">${esc(item.sourceType === 'internal' ? 'Alibaba.com 站内' : item.source || '站外')}</span><span class="rfq-priority">运营优先级 <b>${item.priority}</b></span><h3>${esc(item.title)}</h3><p>${esc(item.description || '平台没有返回更详细的采购描述。')}</p></div>
      <div class="rfq-purchase-grid">
        <article><span>采购量</span><strong>${item.quantity ? `${fmt(item.quantity)} ${esc(item.quantityUnit || '')}` : '待确认'}</strong></article>
        <article><span>报价竞争</span><strong>${fmt(item.quotedCount)} 家已报 · 剩 ${fmt(item.remainingQuota)} 席</strong></article>
        <article><span>类目</span><strong>${esc(item.category || '—')}</strong></article>
        <article><span>发布时间</span><strong>${esc(item.createdText || '—')}</strong></article>
      </div>
      ${tags.length ? `<div class="rfq-tag-list">${tags.map(tag => `<span>${esc(tag)}</span>`).join('')}</div>` : ''}
      <section class="rfq-signal-section"><div class="rfq-detail-subhead"><b>${item.sourceType === 'internal' ? '买家行为信号' : '交易条件'}</b><span>${item.sourceType === 'internal' ? '历史行为仅辅助判断意向' : '来自站外 RFQ 详情'}</span></div><div class="rfq-signal-grid">${behaviorRows.map(([label, value]) => `<article><span>${esc(label)}</span><strong>${esc(value)}</strong></article>`).join('')}</div></section>
      ${(item.frequentCategories || []).length ? `<section class="rfq-category-section"><div class="rfq-detail-subhead"><b>常看采购类目</b><span>用于判断需求一致性</span></div><p>${item.frequentCategories.map(esc).join(' · ')}</p></section>` : ''}
    </div>`;
}

/**
 * 渲染最近报价历史，不展示买家姓名、登录账号、报价正文和外链。
 *
 * @param {object[]} rows - 脱敏后的报价记录。
 * @returns {void} 直接更新报价表格。
 * @throws {Error} 不主动抛异常。
 */
function renderRfqHistory(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  $('#rfqHistoryCount').textContent = `${safeRows.length} 条 · WorkCTL 实时`;
  $('#rfqHistoryBody').innerHTML = safeRows.length ? safeRows.map(row => `<tr><td><b>${esc(row.title || '未命名 RFQ')}</b><small>${esc(rfqTimeLabel(row.rfqTime))} 发布</small></td><td>${esc(row.country || '—')}<small>${esc(row.buyerLevel || '等级未返回')}</small></td><td>${esc(rfqTimeLabel(row.quoteTime))}</td><td><span class="action-tag">${esc(row.status || '已报价')}</span></td></tr>`).join('') : '<tr><td colspan="4"><div class="designed-empty"><i class="ri-inbox-2-line" aria-hidden="true"></i><b>暂无报价历史</b><span>当前账号没有返回可展示的记录。</span></div></td></tr>';
}

/**
 * 渲染多档报价权益及当月表现，并明确快照与实时状态。
 *
 * @param {object|null} rights - 最近一次已核验权益快照。
 * @param {string} [liveStatus] - 本轮实时接口状态说明。
 * @returns {void} 直接更新权益卡片。
 * @throws {Error} 不主动抛异常。
 */
function renderRfqRights(rights, liveStatus) {
  if (!rights) {
    $('#rfqRightsState').textContent = '本轮实时接口未返回';
    $('#rfqRightsGrid').innerHTML = '<div class="designed-empty"><i class="ri-timer-line" aria-hidden="true"></i><b>权益数据暂不可用</b><span>商机和报价历史不受影响。</span></div>';
    return;
  }
  $('#rfqRightsState').textContent = `审计快照 · ${rights.auditedAt || '日期未知'}`;
  const rows = [
    ['普通报价', rights.availableQuote, 'ri-mail-send-line'],
    ['顶级报价', rights.availableTopQuote, 'ri-vip-crown-line'],
    ['金牌报价', rights.availableGoldQuote, 'ri-medal-line'],
    ['银牌专享', rights.availableSilverQuote, 'ri-award-line'],
    ['商旅权益', rights.availableTravel, 'ri-flight-takeoff-line'],
  ];
  $('#rfqRightsGrid').innerHTML = `<div class="rfq-equity-list">${rows.map(([label, value, icon]) => `<article><i class="${icon}" aria-hidden="true"></i><span>${esc(label)}</span><strong>${fmt(value)}</strong></article>`).join('')}</div><div class="rfq-rights-summary"><article><span>当月已用</span><strong>${fmt(rights.usedThisMonth)}</strong></article><article><span>当月报价回复</span><strong>${fmt(rights.replyCount)}</strong></article><article><span>本月预测分</span><strong>${fmt(rights.predictedScore)}</strong></article><article><span>上月评分</span><strong>${fmt(rights.lastMonthScore)}</strong></article></div><p class="rfq-rights-note"><i class="ri-information-line" aria-hidden="true"></i>${esc(liveStatus || '实时权益接口本轮未返回，页面使用最近核验快照。')}</p>`;
}

// ============================ 员工绩效 ============================
const SCOLS = [
  ['fullName', '账号'], ['impression', '曝光'], ['clicks', '点击'],
  ['fbUv', '询盘人数'], ['fbPv', '询盘数'], ['uvFbAtm', 'TM访客'],
  ['replyRate', '回复率', 'p'], ['fst5minReplyRate30d', '5分钟回复率', 'p'],
  ['avgReplyTime', '平均回复(h)'], ['drawupMordCnt', '起草单'],
  ['prepayMordCnt', '已付款单'], ['rcvdAmt', '实收金额'],
  ['busToOrdRate', '商机转化', 'p'], ['newProductCount', '新增品'],
  ['alterProductCount', '编辑品'], ['totalProductCount', '在架品'], ['reviewedRfq', 'RFQ'],
];

async function loadStaff() {
  const j = await api('account-summary', { ...dates(), statisticsType: $('#staffType').value });
  if (!j) return;
  const rows = [];
  (Array.isArray(j.data) ? j.data : []).forEach(blk =>
    Object.entries(blk || {}).forEach(([period, list]) =>
      (list || []).forEach(r => rows.push({ ...r, __period: period }))));
  renderStaff(rows);
}

function renderStaff(rows) {
  const box = $('#staffTable');
  if (!rows.length) { box.innerHTML = '<div class="empty">无员工数据</div>'; return; }
  rows.sort((a, b) => (a.fullName === '全部账号' ? -1 : b.fullName === '全部账号' ? 1 : num(b.fbUv) - num(a.fbUv)));
  box.innerHTML = `<table><thead><tr><th>周期</th>${
    SCOLS.map(([, n]) => `<th>${n}</th>`).join('')}</tr></thead><tbody>${
    rows.map((r, i) => `<tr data-i="${i}" ${r.fullName === '全部账号' ? 'style="background:#fff4ec;font-weight:600"' : ''}>
      <td>${esc(r.__period)}</td>${SCOLS.map(([k, , t]) => {
        const v = r[k];
        if (k === 'fullName') return `<td>${esc(v ?? '—')}</td>`;
        if (t === 'p') return `<td>${pct(v)}</td>`;
        return `<td>${fmt(v)}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table>`;
  box.querySelectorAll('tbody tr').forEach(tr => tr.onclick = () => {
    const r = rows[+tr.dataset.i];
    $('#modalBody').innerHTML = `<h2 style="font-size:15px">${esc(r.fullName)} · ${esc(r.__period)}</h2>
      <div class="kvgrid">${Object.keys(r).map(k => `<div class="kv"><div class="k">${esc(k)}</div>
        <div class="v">${esc(String(r[k] ?? '—')).slice(0, 40)}</div></div>`).join('')}</div>`;
    $('#modal').classList.add('on');
  });
}

// ============================ 命令控制台 ============================
let EPS = [];
async function initConsole() {
  const r = await fetch('/api/endpoints'); const j = await r.json();
  EPS = j.endpoints || [];
  $('#cEndpoint').innerHTML = EPS.map(e =>
    `<option value="${e.key}">${e.label} — ${e.command}</option>`).join('');
  buildFlags();
  $('#cEndpoint').onchange = buildFlags;
}

function buildFlags() {
  const ep = EPS.find(e => e.key === $('#cEndpoint').value);
  if (!ep) return;
  const d = dates();
  $('#cFlags').innerHTML = ep.flags.map(f => {
    let def = '';
    if (f === 'startDate') def = d.startDate;
    if (f === 'endDate') def = d.endDate;
    return `<label>--${f}<input type="text" data-f="${f}" value="${def}" placeholder="留空则不传"></label>`;
  }).join('');
  $$('#cFlags input').forEach(i => i.oninput = previewCmd);
  previewCmd();
}

function consoleParams() {
  const p = {};
  $$('#cFlags input').forEach(i => { if (i.value.trim()) p[i.dataset.f] = i.value.trim(); });
  return p;
}
function previewCmd() {
  const ep = EPS.find(e => e.key === $('#cEndpoint').value);
  if (!ep) return;
  const p = consoleParams();
  $('#cPreview').textContent = ep.command +
    Object.entries(p).map(([k, v]) => ` --${k} ${v}`).join('') + ' --format json';
}

async function runConsole() {
  const key = $('#cEndpoint').value;
  $('#cOut').innerHTML = '<span class="spin"></span> 执行中…';
  const j = await api(key, { ...consoleParams(), __nocache: '1' });
  if (!j) { $('#cOut').textContent = '执行失败,详见执行日志'; return; }
  $('#cPreview').textContent = j.command;
  const s = JSON.stringify(j.data, null, 2);
  $('#cOut').textContent =
    `// ${j.durationMs}ms · ${j.cached ? '缓存' : '实时'} · ${s.length.toLocaleString()} 字符\n` +
    (s.length > 200000 ? s.slice(0, 200000) + '\n… (已截断)' : s);
}

// ============================ 执行日志 ============================
async function refreshLog() {
  try {
    const r = await fetch('/api/log'); const j = await r.json();
    $('#logList').innerHTML = (j.log || []).map(l => `
      <div class="logrow ${l.ok ? '' : 'bad'}">
        <span class="t">${l.ts.slice(11, 19)}</span>
        <span class="badge ${l.cached ? 'b-cache' : 'b-live'}">${l.cached ? 'CACHE' : 'LIVE'}</span>
        <span class="c" title="${esc(l.cmd)}">${esc(l.err ? l.cmd + '  ✗ ' + l.err.slice(0, 80) : l.cmd)}</span>
        <span class="m">${l.ms}ms</span>
      </div>`).join('') || '<div class="empty">暂无调用</div>';
  } catch (e) { /* 忽略 */ }
}

// ============================ WorkCTL 审计补齐界面 ============================
/**
 * WorkCTL 业务界面的信息架构定义。
 *
 * 这里描述页面结构、字段和 WorkCTL 数据来源；下面的 MODULE_LIVE_DEMO
 * 只保存本轮只读审计得到的脱敏汇总。这样既能让原型展示真实数据状态，
 * 也不会把买家、订单、账号或凭据复制进前端代码。
 */
const MODULE_DESIGNS = {
  ads: {
    phase: '第二批 · P1',
    title: '关键词与广告',
    summary: '把公司、关键词、搜索词和商品效果放在同一条诊断链路中，先看结果，再找浪费与增长机会。',
    boundary: '当前工具没有广告计划、预算、出价和启停能力，因此本页不是投放后台；关键词预定属于敏感写操作，接入后仍需二次确认。',
    views: [
      {
        id: 'performance', label: '效果概览', title: '广告效果总览',
        description: '公司结果作为基准，向下拆到关键词、搜索词和商品。',
        metrics: [['公司整体效果', '曝光 / 点击 / 询盘'], ['关键词达标率', '达标与未达标分布'], ['数据更新时间', '平台产出日期']],
        steps: ['公司整体效果', '关键词效果', '搜索词承接', '商品效果'],
        table: ['对象', '曝光', '点击', '询盘', '效果状态'],
        sources: [
          ['主查询', 'workctl icbu ads accio-brand-comp-effect', '公司整体效果'],
          ['主查询', 'workctl icbu ads search-keyword-effect', '关键词效果'],
          ['补充', 'workctl icbu ads accio-brand-package-word-effect', '聚量搜索词效果'],
          ['补充', 'workctl icbu ads search-prod-effect', '广告商品效果'],
        ],
      },
      {
        id: 'diagnosis', label: '关键词诊断', title: '关键词四象限',
        description: '按消耗与询盘表现识别核心词、潜力词、观察词和止损词；字段存在后才计算。',
        metrics: [['高询盘词', '核心增长词'], ['高消耗词', '需要判断效率'], ['高引流词', '需要检查承接']],
        steps: ['高消耗 · 高询盘', '低消耗 · 高询盘', '高消耗 · 低询盘', '低消耗 · 低询盘'],
        table: ['关键词', '消耗', '点击', '询盘', '系统分类'],
        sources: [
          ['主查询', 'workctl icbu ads search-keyword-effect', '关键词明细'],
          ['诊断', 'workctl icbu ads search-achieve-rate', '广告达标率'],
          ['补充', 'workctl icbu ads get-behaviors-semantic-for', '站内行为序列'],
        ],
      },
      {
        id: 'resources', label: '资源机会', title: '次月关键词资源',
        description: '查看可售关键词和同行次月释放资源，预定动作与查询区彻底分开。',
        metrics: [['可售关键词', '等待真实数量'], ['次月释放资源', '等待真实数量'], ['待确认预定', '不自动执行']],
        steps: ['发现资源', '核对关键词', '确认数量与账号', '二次确认预定'],
        table: ['关键词', '资源类型', '释放时间', '竞争状态', '操作'],
        sources: [
          ['主查询', 'workctl icbu ads search-list', '可售品牌广告关键词'],
          ['主查询', 'workctl icbu ads search-next-month-auction-resource', '同行次月释放资源'],
          ['写操作', 'workctl icbu ads update-reserve', '批量预定关键词'],
        ],
      },
    ],
  },
  rfq: {
    phase: '第二批 · P1',
    title: 'RFQ 商机',
    summary: '把站内、站外采购需求汇成商机池，并用报价历史和权益约束跟进节奏。',
    boundary: '当前工具支持发现、详情和报价记录查询，不支持创建、提交、修改或撤回报价；匹配度必须标注为系统计算。',
    views: [
      {
        id: 'opportunities', label: '商机池', title: '采购需求商机池',
        description: '站内与站外来源明确分栏，避免把不同口径的数据混成一张榜。',
        metrics: [['新发布商机', '按发布时间统计'], ['高匹配商机', '系统计算'], ['已查看未跟进', '需本地状态']],
        steps: ['站内 RFQ', '站外 RFQ', '匹配度计算', '进入跟进'],
        table: ['采购主题', '国家', '发布时间', '采购数量', '来源', '匹配度'],
        sources: [
          ['主查询', 'workctl icbu rfq rfq-aw-search', '站内 RFQ'],
          ['主查询', 'workctl icbu rfq external-rfq-search', '站外 RFQ'],
          ['下钻', 'workctl icbu rfq rfq-detail-search', '站内商机详情'],
          ['下钻', 'workctl icbu rfq external-rfq-detail-search', '站外商机详情'],
        ],
      },
      {
        id: 'quotes', label: '报价记录', title: '报价与跟进记录',
        description: '以报价历史为事实源，本地只维护负责人、下次跟进和业务备注。',
        metrics: [['已报价', '平台报价记录'], ['待跟进', '本地业务状态'], ['已转订单', '需确认关联字段']],
        steps: ['报价记录', '查看详情', '补充负责人', '安排跟进'],
        table: ['RFQ', '报价时间', '报价负责人', '当前状态', '下次跟进'],
        sources: [
          ['主查询', 'workctl icbu rfq rfq-quote-history-search', '报价历史'],
          ['下钻', 'workctl icbu rfq rfq-quote-detail', '单条报价详情'],
          ['敏感查询', 'workctl icbu rfq rfq-quote-detail-batch', '批量报价详情'],
        ],
      },
      {
        id: 'rights', label: '报价权益', title: '报价权益余量',
        description: '先展示总量、已用和剩余，再提示运营选择更值得投入的商机。',
        metrics: [['权益总数', '平台返回'], ['已使用', '平台返回'], ['剩余额度', '平台返回']],
        steps: ['读取权益', '筛选高匹配商机', '分配报价优先级', '人工报价'],
        table: ['权益类型', '总数', '已使用', '剩余', '更新时间'],
        sources: [
          ['主查询', 'workctl icbu rfq rfq-quote-rights-detail', '报价权益详情'],
          ['关联查询', 'workctl icbu rfq rfq-aw-search', '待报价商机'],
        ],
      },
    ],
  },
  orders: {
    phase: '第二批 · P0',
    title: '订单与物流',
    summary: '把交易合同、物流轨迹和目的国关税放进同一个查询中心，快速定位履约异常。',
    boundary: '当前文档没有创建订单、修改状态、发货确认、退款或取消能力，因此所有操作位均为查询与辅助判断。',
    views: [
      {
        id: 'orders', label: '订单查询', title: '交易合同列表',
        description: '订单状态、金额和付款信息只有在完整 Schema 确认存在后才展示。',
        metrics: [['订单总数', '按状态汇总'], ['待处理订单', '依赖状态字段'], ['异常关联', '订单与物流关联']],
        steps: ['查询合同', '核对商品', '关联物流', '定位异常'],
        table: ['合同编号', '买家', '目的国', '订单状态', '物流状态', '更新时间'],
        sources: [
          ['主查询', 'workctl icbu trade list-trade-list-mcp', '交易合同列表'],
          ['下钻', 'workctl icbu product query-product-by-id', '订单商品详情'],
          ['可选', 'workctl icbu tm list-card', '聊天中的订单卡片'],
        ],
      },
      {
        id: 'logistics', label: '物流跟踪', title: '物流状态与异常',
        description: '以真实物流状态为准，按目的国、状态和更新时间定位需要人工处理的订单。',
        metrics: [['运输中', '物流状态分布'], ['可能异常', '需验证异常字段'], ['待签收', '物流状态分布']],
        steps: ['物流订单', '轨迹状态', '异常识别', '关联交易合同'],
        table: ['物流单号', '关联合同', '目的国', '当前节点', '更新时间', '状态'],
        sources: [
          ['主查询', 'workctl icbu logistics list', '国际站物流订单'],
          ['关联查询', 'workctl icbu trade list-trade-list-mcp', '交易合同'],
        ],
      },
      {
        id: 'tariff', label: '关税测算', title: '目的国关税测算',
        description: '按商品、归类和目的国形成一次可复核的测算记录，不把测算结果当最终海关结论。',
        metrics: [['目标国家', '用户选择'], ['海关编码', '工具归类结果'], ['测算税费', '工具返回']],
        steps: ['选择订单商品', '确认目的国', '核对海关编码', '生成测算结果'],
        table: ['商品', '目的国', '海关编码', '计税基础', '测算税费', '说明'],
        sources: [
          ['工具', 'workctl icbu logistics icbu-logistics-customs-calculate-tariff-tool', '归类并测算关税'],
          ['下钻', 'workctl icbu product query-product-by-id', '商品详情'],
        ],
      },
    ],
  },
  risk: {
    phase: '第二批 · P1',
    title: '风险合规',
    summary: '先给店铺风险全景，再分别处理商品违规、店铺违规、禁限售和拒付证据。',
    boundary: '页面可以查询风险并生成材料，但现有文档没有提交申诉、撤销违规或修改风险状态的命令。',
    views: [
      {
        id: 'health', label: '风险首页', title: '店铺风险健康度',
        description: '风险类型、影响对象和发生时间共同决定优先级，不能只显示一个总分。',
        metrics: [['整体风险', '平台诊断结论'], ['风险商品', '商品违规记录'], ['店铺违规', '店铺违规记录']],
        steps: ['店铺扫描', '风险分类', '影响对象定位', '形成处理建议'],
        table: ['风险类型', '影响对象', '严重程度', '发生时间', '处理建议'],
        sources: [
          ['主查询', 'workctl icbu trade shop-risk-diagnosis', '店铺整体风险'],
          ['主查询', 'workctl icbu trade list-product-violation-result-v2', '商品违规'],
          ['主查询', 'workctl icbu trade list-shop-violation-result-v2', '店铺违规'],
        ],
      },
      {
        id: 'violations', label: '违规明细', title: '商品与店铺违规',
        description: '用处罚结果、违规规则和品牌词风险串起可复核的证据链。',
        metrics: [['新增违规', '按发生时间'], ['待核对商品', '按商品聚合'], ['品牌词风险', '按类目查询']],
        steps: ['发现违规', '查看处罚结果', '核对规则与品牌词', '准备人工处理'],
        table: ['对象', '违规类型', '规则依据', '处罚结果', '处理状态'],
        sources: [
          ['主查询', 'workctl icbu trade list-product-punish-result', '商品处罚结果'],
          ['主查询', 'workctl icbu trade list-product-violation-result-v2', '商品违规明细'],
          ['补充', 'workctl icbu product list-risk-brand-name', '风险品牌词'],
        ],
      },
      {
        id: 'special', label: '禁限售与拒付', title: '专项风险处理',
        description: '禁限售解释、拒付材料和供应商主体核验分别呈现，避免混淆结论来源。',
        metrics: [['禁限售分析', '既有分析结果'], ['拒付订单', '拒付详情'], ['主体核验', '候选与报告']],
        steps: ['选择风险对象', '调用专项查询', '核对证据', '导出处理材料'],
        table: ['专项类型', '业务对象', '当前结论', '证据状态', '下一步'],
        sources: [
          ['查询', 'workctl icbu trade list', '既有禁限售分析'],
          ['材料', 'workctl icbu trade chargeback-material-with-ai', '拒付详情与抗辩材料'],
          ['查询', 'workctl icbu trade supplier-verification-recall', '供应商候选主体'],
          ['下钻', 'workctl icbu trade supplier-verification-detail', '主体核验报告'],
        ],
      },
    ],
  },
  storefront: {
    phase: '第三批 · P2',
    title: '店铺装修',
    summary: '围绕页面版本、预览、编辑任务和发布记录组织工作区，清楚区分两套页面体系。',
    boundary: '创建、编辑和发布都会改变外部店铺状态；本轮仅补界面。删除、重命名、删除历史版本和直接回滚尚无明确工具支持。',
    views: [
      {
        id: 'pages', label: '页面版本', title: 'Accio Work 页面版本',
        description: '主版本与历史版本保持父子关系，发布前必须先确认具体版本。',
        metrics: [['主版本', '页面列表返回'], ['历史版本', '按主版本归档'], ['当前发布版', '需核对发布字段']],
        steps: ['获取 companyId', '读取页面列表', '选择主版本', '查看历史版本'],
        table: ['页面名称', '主版本', '历史版本', '更新时间', '发布状态'],
        sources: [
          ['前置', 'workctl icbu storefront get-company-id', '获取 companyId'],
          ['主查询', 'workctl icbu storefront ai-minisite-get-acciowork-page-list', '主版本与历史版本'],
          ['写操作', 'workctl icbu storefront ai-minisite-acciowork-create-page', '创建页面'],
          ['写操作', 'workctl icbu storefront ai-minisite-acciowork-publish-page', '发布并创建历史版本'],
        ],
      },
      {
        id: 'builder', label: '生成工作流', title: '云端网站生成',
        description: '从公司资料和模板开始，预览确认后才进入完整网站生成与编辑。',
        metrics: [['公司资料', '待读取'], ['当前模板', '待选择'], ['异步任务', '状态查询']],
        steps: ['读取公司资料与模板', '创建预览', '确认并继续编辑', '生成完整网站'],
        table: ['任务', '页面版本', '创建时间', '当前状态', '结果地址'],
        sources: [
          ['查询', 'workctl icbu storefront ai-minisite-get-company-info', '公司装修资料'],
          ['查询', 'workctl icbu storefront get-template-files', '建站模板'],
          ['写操作', 'workctl icbu storefront create-preview-cloud', '创建预览'],
          ['轮询', 'workctl icbu storefront get-task-status', '异步任务状态'],
        ],
      },
      {
        id: 'publish', label: '发布记录', title: '发布前检查与记录',
        description: '发布版本、目标环境和执行账号必须在确认区同时出现。',
        metrics: [['待发布版本', '用户选择'], ['最近发布时间', '发布记录'], ['当前线上版本', '版本查询']],
        steps: ['选定版本', '打开预览', '核对目标与账号', '明确确认发布'],
        table: ['页面', '版本', '发布方式', '执行账号', '结果', '时间'],
        sources: [
          ['查询', 'workctl icbu storefront get-cloud', '获取指定云端版本'],
          ['写操作', 'workctl icbu storefront publish-cloud', '发布云端版本'],
          ['写操作', 'workctl icbu storefront publish-gui', '发布 GUI 版本'],
        ],
      },
    ],
  },
  assets: {
    phase: '第三批 · P2',
    title: '素材工坊',
    summary: '图片、视频、3D 和素材解析共用一个任务中心，所有异步结果都有可追踪状态。',
    boundary: '生成、上传、绑定和解绑均可能产生费用或改变商品状态；这轮只补设计，不发起任务。每类结果接口的对应关系仍需完整 Schema 核对。',
    views: [
      {
        id: 'images', label: 'AI 图片', title: '商品图片工作台',
        description: '一个统一入口承接创作，再按换色、Logo、模特图和翻译进入专项流程。',
        metrics: [['待处理素材', '选择商品或上传'], ['生成中', '异步任务状态'], ['已完成', '结果查询']],
        steps: ['选择商品素材', '选择图片能力', '确认生成参数', '进入任务中心'],
        table: ['任务', '所属商品', '能力类型', '创建时间', '状态', '结果'],
        sources: [
          ['统一入口', 'workctl icbu product ai-image-generate-facade', 'AI 图片生成门面'],
          ['专项', 'workctl icbu product product-ai-image-color-change', '主体换色'],
          ['专项', 'workctl icbu product product-ai-image-model-generate', '模特图'],
          ['结果', 'workctl icbu product product-ai-image-generate-result', '异步结果'],
        ],
      },
      {
        id: 'video', label: '视频', title: '商品视频工作台',
        description: '提示词、分镜和成片分阶段确认，图片转视频单独使用 orderId 跟踪。',
        metrics: [['视频方案', '提示词与分镜'], ['生成任务', '异步状态'], ['可用成片', '结果地址']],
        steps: ['生成提示词建议', '生成并调整分镜', '确认生成视频', '查询任务结果'],
        table: ['视频任务', '所属商品', '生成方式', '任务标识', '状态', '结果'],
        sources: [
          ['辅助', 'workctl icbu product command-video-prompt-recommend', '提示词建议'],
          ['生成', 'workctl icbu product command-video-generate-storyboard', '生成分镜'],
          ['写操作', 'workctl icbu product command-video-generate', '生成视频'],
          ['结果', 'workctl icbu product get-seeshion-result', '图片转视频结果'],
        ],
      },
      {
        id: 'models', label: '3D 模型', title: '3D 模型与商品关联',
        description: '资格与额度是强制前置，生成成功后再选择机位并关联商品。',
        metrics: [['今日资格', 'eligible'], ['剩余额度', '平台返回'], ['已有模型', '模型列表']],
        steps: ['检查资格与额度', '由视频生成模型', '查询状态与机位', '确认关联商品'],
        table: ['模型 ID', '封面', '生成状态', '默认机位', '关联商品', '更新时间'],
        sources: [
          ['前置', 'workctl icbu product icbu-product-3d-eligibility-query', '资格与额度'],
          ['生成', 'workctl icbu product icbu-product-3d-generate-from-video-url', '由视频生成 3D'],
          ['查询', 'workctl icbu product icbu-product-3d-model-list', '商家模型列表'],
          ['写操作', 'workctl icbu product icbu-product-3d-relate-product', '关联商品'],
        ],
      },
      {
        id: 'tasks', label: '任务中心', title: '统一异步任务中心',
        description: '图片、视频、3D 和素材解析统一记录任务标识、状态、结果与失败原因。',
        metrics: [['处理中', '统一状态'], ['已完成', '统一状态'], ['失败任务', '保留失败原因']],
        steps: ['创建任务', '记录 taskId / requestKey / orderId', '按规则查询一次', '保存结果或失败原因'],
        table: ['任务类型', '任务标识', '所属对象', '创建时间', '状态', '失败原因'],
        sources: [
          ['结果', 'workctl icbu product product-ai-image-generate-result', '图片结果'],
          ['结果', 'workctl icbu product product-ai-video-generate-result', '视频结果'],
          ['结果', 'workctl icbu product icbu-product-3d-status-query', '3D 状态'],
          ['结果', 'workctl icbu product list-material-analysis-result', '素材解析结果'],
        ],
      },
    ],
  },
  knowledge: {
    phase: '第三批 · P2',
    title: '知识库与接待',
    summary: '把商家知识、接待策略和服务诊断分开管理，让 AI 回复有来源、策略有边界、效果可复盘。',
    boundary: '知识查询不等于知识库管理。当前工具能检索商家知识并查询接待策略，但没有证明可以在本页批量上传或维护完整知识库。',
    views: [
      {
        id: 'knowledge', label: '商家知识', title: '回复知识来源',
        description: '按买家问题检索物流、付款、售后、起订量和包装等店铺知识。',
        metrics: [['商家档案', '卖家基础信息'], ['知识命中', '按问题检索'], ['待补知识', '需本地复盘']],
        steps: ['读取商家档案', '输入买家问题', '检索匹配知识', '交给回复模型引用'],
        table: ['知识主题', '命中内容', '适用场景', '来源', '更新时间'],
        sources: [
          ['查询', 'workctl icbu tm get-seller-basic', '商家基础档案'],
          ['查询', 'workctl icbu tm list-seller-knowledge', '商家自定义知识'],
          ['公共知识', 'workctl icbu cco icbu-faq-knowledge-chunk', '国际站业务知识切片'],
        ],
      },
      {
        id: 'strategies', label: '接待策略', title: '自动与辅助接待策略',
        description: '先查看策略主题、内容和场景，再进入新建、更新或删除确认。',
        metrics: [['自动接待策略', '按场景查询'], ['辅助接待策略', '按场景查询'], ['待复核策略', '本地审核状态']],
        steps: ['读取策略列表', '选择接待场景', '预览修改差异', '明确确认保存'],
        table: ['策略主题', '场景类型', '策略摘要', '更新时间', '状态'],
        sources: [
          ['主查询', 'workctl icbu tm list-reception-strategies', '查询接待策略'],
          ['写操作', 'workctl icbu tm save-reception-strategy', '创建或更新策略'],
          ['删除', 'workctl icbu tm delete-reception-strategy', '删除接待策略'],
        ],
      },
      {
        id: 'quality', label: '服务诊断', title: '客服服务力诊断',
        description: '店铺对标和聊天质检共同解释回复率、时长、沟通深度与服务评价。',
        metrics: [['回复率', '平台诊断口径'], ['平均回复时长', '平台诊断口径'], ['服务评价', '平台诊断口径']],
        steps: ['读取店铺服务诊断', '对比同行基准', '下钻质检明细', '形成改进方向'],
        table: ['指标', '本店表现', '同行基准', '差距', '建议方向'],
        sources: [
          ['主查询', 'workctl icbu tm list-seller-shop-dim-diag-data', '店铺服务诊断'],
          ['下钻', 'workctl icbu tm list-seller-chat-quality-check', '聊天质检明细'],
          ['账号维度', 'workctl icbu tm list-seller-acct-dim-diag-data', '主账号诊断'],
        ],
      },
    ],
  },
  access: {
    phase: '第三批 · P2',
    title: '账号与权限',
    summary: '先建立统一账号目录，再展示角色、业务范围和数据可见性；没有接口证明的权限编辑不做成按钮。',
    boundary: '当前仅确认子账号查询能力，未确认员工新增删除、角色维护、权限修改和审计日志接口，因此本页先作为只读治理界面。',
    views: [
      {
        id: 'accounts', label: '账号目录', title: '主账号与子账号',
        description: '统一 member、advisor 和 TM 中的多种账号标识，是后续绩效与会话归属的前提。',
        metrics: [['主账号', '当前账号'], ['子账号', '平台查询'], ['待映射标识', 'aliId / accountId']],
        steps: ['读取子账号', '核对姓名与管理员标记', '匹配经营账号', '匹配 TM 账号'],
        table: ['姓名', '账号标识', '管理员', '经营数据映射', '会话数据映射'],
        sources: [
          ['主查询', 'workctl icbu member list', '主账号下的子账号'],
          ['关联', 'workctl icbu advisor data-advisor-account-summary', '员工经营标识'],
          ['关联', 'workctl icbu tm list-seller-acct-dim-diag-data', '客服诊断 aliId'],
        ],
      },
      {
        id: 'matrix', label: '权限矩阵', title: '角色与数据范围',
        description: '先展示每个角色能看什么、能做什么；没有写接口前不提供“保存权限”。',
        metrics: [['角色数量', '本地配置'], ['数据范围', '店铺 / 账号 / 模块'], ['敏感动作', '一律单独授权']],
        steps: ['定义业务角色', '分配可见模块', '限定数据范围', '标记敏感动作'],
        table: ['角色', '可见模块', '数据范围', '敏感动作', '配置来源'],
        sources: [
          ['事实源', 'workctl icbu member list', '账号与管理员标记'],
          ['本地配置', '尚无对应 Workctl 命令', '角色和数据范围需要自有权限模型'],
        ],
      },
      {
        id: 'audit', label: '操作审计', title: '敏感操作审计',
        description: '所有发布、发送、预定、批量修改和删除操作都应保留执行前后与最终回执。',
        metrics: [['敏感操作', '按动作类型'], ['失败记录', '保留错误信息'], ['待复核记录', '人工审计状态']],
        steps: ['记录执行账号', '保存请求与确认', '保存平台回执', '支持审计检索'],
        table: ['操作类型', '业务对象', '执行账号', '确认时间', '执行结果', '回执'],
        sources: [
          ['本地日志', '尚无统一 Workctl 审计命令', '由本系统记录敏感动作'],
          ['账号源', 'workctl icbu member list', '执行账号基础信息'],
        ],
      },
    ],
  },
};

const MODULE_VIEW_STATE = {};

/**
 * 本轮 WorkCTL 全量只读审计得到的脱敏页面数据。
 *
 * 数字只允许来自真实返回、真实空状态或命令审计；没有返回的字段明确写成
 * “未执行 / 无现成任务 / 无权限”，不会为了让画面更满而推算业务数字。
 * 每个 rows 数组严格对应原页面定义中的 table 列，便于通用渲染器复用。
 */
const MODULE_LIVE_DEMO = {
  ads: {
    performance: {
      state: '已读取 · 部分为空',
      metrics: [
        ['可售品牌关键词', 'search-list 返回', '20'],
        ['次月推荐资源', 'auction-resource 返回', '3'],
        ['效果记录', '公司 / 商品 / 关键词均为空', '0'],
      ],
      facts: ['已找到 20 个可售品牌词', '次月释放资源返回 3 条', '公司效果当前周期为真实空数组', '商品与关键词效果当前周期均为 0 条'],
      rows: [
        ['公司整体效果', '—', '—', '—', '当前周期 0 条'],
        ['广告商品效果', '—', '—', '—', '当前周期 0 条'],
        ['广告关键词效果', '—', '—', '—', '当前周期 0 条'],
      ],
    },
    diagnosis: {
      state: '真实空状态',
      metrics: [['高询盘词', '无效果明细，不推算', '0'], ['高消耗词', '无效果明细，不推算', '0'], ['高引流词', '无效果明细，不推算', '0']],
      facts: ['关键词效果接口已成功调用', '当前周期返回 0 条', '缺少消耗字段时不生成四象限', '资源词与效果词保持不同口径'],
      rows: [],
      empty: '当前周期没有关键词效果记录；这不是“接口未接入”。',
    },
    resources: {
      state: '已读取',
      metrics: [['可售关键词', '平台返回', '20'], ['次月释放资源', '平台返回', '3'], ['已执行预定', '写命令未执行', '0']],
      facts: ['smart watch：APP 指数 1000', 'smartwatches：APP 指数 1000', 'smart watch for men：APP 指数 1000', '所有预定动作仍需人工二次确认'],
      rows: [
        ['smart watch', '品牌广告词 · APP', '次月', '可预定', '只读'],
        ['smartwatches', '品牌广告词 · APP', '次月', '可预定', '只读'],
        ['smart watch for men', '品牌广告词 · APP', '次月', '可预定', '只读'],
      ],
    },
  },
  rfq: {
    opportunities: {
      state: '已读取',
      metrics: [['站内 RFQ', 'smart watch 样本查询', '325'], ['站外 RFQ', '同一关键词口径', '45'], ['报价历史', '平台记录', '5']],
      facts: ['站内商机总量 325', '站外商机总量 45', '报价历史共 5 条', '买家身份与商机标题已脱敏，不计算伪匹配分'],
      rows: [
        ['smart watch 商机汇总', '多国家 · 已脱敏', '当前快照', '325 条', '站内 RFQ', '未计算'],
        ['smart watch 商机汇总', '多国家 · 已脱敏', '当前快照', '45 条', '站外 RFQ', '未计算'],
      ],
    },
    quotes: {
      state: '已读取',
      metrics: [['报价历史', '平台返回', '5'], ['本地待跟进', '尚未建立本地状态', '—'], ['已转订单', '无可靠关联字段', '—']],
      facts: ['报价历史接口成功返回', '共读取 5 条记录', '负责人和买家身份未写入 Demo', '本地跟进状态尚未建立'],
      rows: [['报价历史汇总', '当前快照', '已脱敏', '5 条平台记录', '未建立本地跟进']],
    },
    rights: {
      state: '接口可用',
      metrics: [['权益接口', '成功读取', '可用'], ['已执行报价', '写命令未执行', '0'], ['权益数字', '不在脱敏 Demo 保存', '—']],
      facts: ['报价权益查询接口可用', '本轮没有创建或提交报价', '权益只能辅助安排优先级', '所有报价动作保留人工确认'],
      rows: [['报价权益', '平台返回', '未保存明细', '未保存明细', '2026-09-02']],
    },
  },
  orders: {
    orders: {
      state: '已读取',
      metrics: [['交易合同', '列表总量', '30'], ['本页样本', '读取前 20 条', '20'], ['未付款', '样本状态分布', '4']],
      facts: ['样本 20 条中：已关闭 11', '样本 20 条中：未付款 4', '样本 20 条中：交易成功 2', '待确认收货 2，意向处理中 1'],
      rows: [
        ['脱敏合同样本', '已脱敏', '—', '已关闭', '—', '样本 11 / 20'],
        ['脱敏合同样本', '已脱敏', '—', '未付款', '—', '样本 4 / 20'],
        ['脱敏合同样本', '已脱敏', '—', '交易成功', '—', '样本 2 / 20'],
        ['脱敏合同样本', '已脱敏', '—', '待确认收货', '—', '样本 2 / 20'],
      ],
    },
    logistics: {
      state: '已读取',
      metrics: [['物流记录', '列表总量', '162'], ['本页样本', '读取前 20 条', '20'], ['运输中', '样本状态分布', '1']],
      facts: ['样本 20 条中：妥投成功 16', '离开仓库 1', '运输中 1', '关闭 1，终止 1'],
      rows: [
        ['脱敏物流样本', '已脱敏', '—', '妥投', '当前快照', '16 / 20'],
        ['脱敏物流样本', '已脱敏', '—', '运输中', '当前快照', '1 / 20'],
        ['脱敏物流样本', '已脱敏', '—', '离开仓库', '当前快照', '1 / 20'],
      ],
    },
    tariff: {
      state: '工具已验证',
      metrics: [['目标国家', '审计样本', 'US'], ['商品归类', '工具成功返回', '可用'], ['税费金额', '未保存到 Demo', '—']],
      facts: ['关税工具已完成一次只读验证', '目的国样本为美国', '商品归类字段成功返回', '测算结果仅作辅助，不能替代海关结论'],
      rows: [['脱敏商品样本', 'US', '已返回 · 未保存', '未保存', '未保存', '仅作辅助测算']],
    },
  },
  risk: {
    health: {
      state: '已读取 · 双层口径',
      metrics: [['当前风险商品', '2026-09-02 快照', '0'], ['累计处罚分', '历史记录层', '24'], ['违规记录', '脱敏样本', '1']],
      facts: ['今日处罚分 0', '当前整改任务 0', '当前欺诈订单 0', '历史层仍有 1 条 FCC 相关美国市场限制记录'],
      rows: [['FCC 相关市场限制', '无线音频产品（已脱敏）', '历史记录', '历史层', '核对美国市场合规资料']],
    },
    violations: {
      state: '已读取',
      metrics: [['当前风险商品', '快照层', '0'], ['历史违规记录', '记录层', '1'], ['累计处罚分', '记录层', '24']],
      facts: ['快照层与记录层并列展示', '存在历史记录不等于当前风险商品大于 0', '违规类型为 FCC 相关', '受影响市场为美国'],
      rows: [['无线音频产品（已脱敏）', 'FCC 相关', '美国市场限制', '历史记录', '待人工核对资料']],
    },
    special: {
      state: '部分可用',
      metrics: [['拒付材料', '抽样订单返回', '0'], ['禁限售提交', '写命令未执行', '0'], ['主体核验', '需要明确业务对象', '—']],
      facts: ['抽样订单没有拒付材料', '禁限售分析需要提交型命令产生 uniqueKey', '本轮未执行任何提交型命令', '供应商主体核验按具体对象发起'],
      rows: [['拒付材料', '脱敏订单样本', '没有材料', '真实空', '无需处理']],
    },
  },
  storefront: {
    pages: {
      state: '已读取 · 真实为空',
      metrics: [['公司资料', '基础信息接口', '可用'], ['Accio Work 页面', '列表返回', '0'], ['云端页面', 'get-cloud 返回', '0']],
      facts: ['companyId 可读取但不保存到 Demo', '公司装修资料可读取', '当前页面列表为 0', '当前没有可复用模板或任务 ID'],
      rows: [],
      empty: '账号当前没有可读取的页面版本；这是平台真实空状态。',
    },
    builder: {
      state: '前置已读取',
      metrics: [['公司资料', '平台返回', '可用'], ['现成模板 ID', '当前账号没有', '0'], ['现成任务 ID', '当前账号没有', '0']],
      facts: ['公司资料接口可用', '没有现成模板 ID', '没有现成生成任务', '创建预览和完整网站均属于写操作'],
      rows: [],
      empty: '没有可复用的云端建站任务；本轮未创建新任务。',
    },
    publish: {
      state: '真实空状态',
      metrics: [['线上页面', '当前列表', '0'], ['发布记录', '当前返回', '0'], ['已执行发布', '写命令未执行', '0']],
      facts: ['没有当前线上版本可供展示', '没有发布记录', '发布必须确认页面版本与账号', '本轮未执行发布命令'],
      rows: [],
      empty: '当前没有发布记录；发布动作保持禁用。',
    },
  },
  assets: {
    images: {
      state: '已读取 · 任务为空',
      metrics: [['公共素材库', '3D gallery 可读取', '有内容'], ['图片生成任务', '没有现成任务 ID', '0'], ['视频生成任务', '没有现成任务 ID', '0']],
      facts: ['公共 3D 素材库接口可用', '自有图片任务为 0', '自有视频任务为 0', '未发起任何生成或上传'],
      rows: [],
      empty: '没有现成 AI 图片任务；公共素材库与自有任务必须分开显示。',
    },
    video: {
      state: '真实空状态',
      metrics: [['视频方案', '本轮未生成', '0'], ['视频任务', '无现成任务 ID', '0'], ['可用成片', '无现成任务', '0']],
      facts: ['视频能力 Schema 已核对', '没有现成视频生成任务', '没有调用生成写命令', '未来用 taskId / orderId 跟踪结果'],
      rows: [],
      empty: '当前没有可读取的视频生成任务。',
    },
    models: {
      state: '已读取',
      metrics: [['3D 资格接口', '成功读取', '可用'], ['自有 3D 模型', '模型列表', '0'], ['样本商品关联', 'product-model-query', '否']],
      facts: ['3D 资格查询可用', '公共图库有内容', '自有模型列表为 0', '脱敏样本商品尚未关联模型'],
      rows: [],
      empty: '当前账号没有自有 3D 模型；公共图库模型不冒充自有资产。',
    },
    tasks: {
      state: '真实空状态',
      metrics: [['图片任务', '现成任务', '0'], ['视频任务', '现成任务', '0'], ['自有 3D 模型', '现成资产', '0']],
      facts: ['没有现成图片 taskId', '没有现成视频 orderId', '没有自有 3D modelId', '本轮没有执行生成类写命令'],
      rows: [],
      empty: '当前没有可追踪的异步生成任务。',
    },
  },
  knowledge: {
    knowledge: {
      state: '已读取',
      metrics: [['FAQ 知识切片', '平台公共知识', '20'], ['商家知识查询', '接口验证', '可用'], ['接待策略', '两类合计', '23']],
      facts: ['公共 FAQ 知识切片共 20 条', '商家自定义知识可按问题查询', '聊天辅助接待策略 11 条', '自动接待策略 12 条'],
      rows: [
        ['平台 FAQ', '20 条知识切片', '国际站业务问答', '公共知识', '当前快照'],
        ['商家自定义知识', '按问题检索', '店铺个性化回复', '卖家知识', '接口可用'],
      ],
    },
    strategies: {
      state: '已读取',
      metrics: [['辅助接待策略', 'CHAT_RECEPTION', '11'], ['自动接待策略', 'AUTO_RECEPTION', '12'], ['策略总数', '两类合计', '23']],
      facts: ['辅助接待 11 条', '自动接待 12 条', '本轮只读列表', '新增、更新、删除均未执行'],
      rows: [['辅助接待策略', 'CHAT_RECEPTION', '11 条', '当前快照', '只读'], ['自动接待策略', 'AUTO_RECEPTION', '12 条', '当前快照', '只读']],
    },
    quality: {
      state: '已读取',
      metrics: [['首次回复率', '店铺经营口径', '97.34%'], ['平均回复时长', '店铺经营口径', '3.74 小时'], ['店铺诊断行', '服务诊断返回', '7']],
      facts: ['首次回复率 97.34%', '平均回复时长 3.74 小时', '店铺维度诊断 7 行', '账号维度诊断 9 行'],
      rows: [['首次回复率', '97.34%', '平台诊断口径', '—', '结合未回复会话复盘'], ['平均回复时长', '3.74 小时', '平台诊断口径', '—', '结合班次安排复盘']],
    },
  },
  access: {
    accounts: {
      state: '已读取 · 已脱敏',
      metrics: [['成员账号', 'member list', '9'], ['联系人', 'query-contact', '100'], ['受限接口', 'list-contact', '1']],
      facts: ['成员账号共 9 个', '联系人查询返回 100 条', '真实姓名与账号标识不写入 Demo', 'list-contact 返回 no privilege'],
      rows: [
        ['匿名账号 01–09', '已脱敏', '平台字段可用', '经营账号可关联', '客服诊断可关联'],
        ['联系人目录', '100 条 · 已脱敏', '—', 'query-contact 可用', 'list-contact 无权限'],
      ],
    },
    matrix: {
      state: '只读事实层',
      metrics: [['成员账号', '平台事实源', '9'], ['权限模型接口', '尚未发现', '0'], ['保存权限', '写操作不可用', '0']],
      facts: ['WorkCTL 可读取账号目录', '没有证据证明可维护自定义角色', '没有权限保存接口', '数据范围需由本系统另建模型'],
      rows: [['平台账号目录', '成员与管理员字段', '账号级', '不可编辑', 'workctl member list']],
    },
    audit: {
      state: '本地审计边界',
      metrics: [['只读命令尝试', '本轮审计', '123'], ['成功', '含真实空结果', '112'], ['写命令执行', '本轮', '0']],
      facts: ['123 个只读命令完成实跑尝试', '112 个成功', '11 个因权限或缺少上下文受阻', '生成、发布、发送、删除等写命令为 0'],
      rows: [['本轮 WorkCTL 审计', '124 个查询 Schema', '当前账号', '2026-09-02', '112 成功 / 11 受阻 / 1 仅 Schema', '已脱敏']],
    },
  },
};

/**
 * 根据模块和当前子视图生成一张完整的 WorkCTL 业务界面。
 *
 * @param {string} moduleKey - MODULE_DESIGNS 中的模块键，例如 ads 或 risk。
 * @param {string} [requestedView] - 希望激活的子视图 id；省略时沿用上次选择。
 * @returns {void} 将生成后的安全 HTML 写入对应 blueprint 容器。
 * @throws {Error} 正常配置下不会抛错；模块或容器不存在时直接返回。
 */
function renderModuleDesign(moduleKey, requestedView) {
  const module = MODULE_DESIGNS[moduleKey];
  const root = $(`#blueprint-${moduleKey}`);
  if (!module || !root) return;

  const selectedId = requestedView || MODULE_VIEW_STATE[moduleKey] || module.views[0].id;
  const view = module.views.find(item => item.id === selectedId) || module.views[0];
  const live = MODULE_LIVE_DEMO[moduleKey]?.[view.id] || {};
  const metrics = live.metrics || view.metrics.map(([label, note]) => [label, note, '—']);
  const rows = live.rows || [];
  const facts = live.facts || ['尚未获得可安全展示的脱敏汇总'];
  const emptyMessage = live.empty || '当前查询没有可展示的明细记录。';
  MODULE_VIEW_STATE[moduleKey] = view.id;

  root.innerHTML = `
    <section class="module-hero">
      <div class="module-title-block">
        <span class="module-phase">${esc(module.phase)}</span>
        <h2>${esc(module.title)}</h2>
        <p>${esc(module.summary)}</p>
      </div>
      <div class="module-status" role="status">
        <i class="ri-database-2-line" aria-hidden="true"></i>
        <span><b>WorkCTL 已读取</b><small>脱敏 Demo · 2026-09-02</small></span>
      </div>
    </section>
    <div class="module-view-tabs" role="tablist" aria-label="${esc(module.title)}子页面">
      ${module.views.map(item => `<button type="button" role="tab" aria-selected="${item.id === view.id}"
        class="${item.id === view.id ? 'on' : ''}" data-module-key="${esc(moduleKey)}" data-module-view="${esc(item.id)}">
        ${esc(item.label)}</button>`).join('')}
    </div>
    <section class="module-intro">
      <div><span class="section-kicker">当前界面</span><h3>${esc(view.title)}</h3><p>${esc(view.description)}</p></div>
      <button type="button" class="ghost sm blueprint-disabled" disabled title="当前展示本轮只读审计快照">审计快照</button>
    </section>
    <div class="module-metrics">
      ${metrics.map(([label, note, value]) => `<article><span>${esc(label)}</span><strong class="metric-live">${esc(value)}</strong><small>${esc(note)}</small></article>`).join('')}
    </div>
    <div class="module-workspace">
      <div class="module-main-column">
        <section class="module-process" aria-label="${esc(view.title)}业务流程">
          <div class="module-section-head"><div><span class="section-kicker">业务工作区</span><h3>${esc(view.title)}</h3></div><span class="data-state is-live">${esc(live.state || '审计快照')}</span></div>
          <div class="process-track">
            ${view.steps.map((step, index) => `<div class="process-step"><b>${String(index + 1).padStart(2, '0')}</b><span>${esc(step)}</span></div>`).join('')}
          </div>
          <div class="audit-facts" aria-label="WorkCTL 返回摘要">
            ${facts.map((fact, index) => `<article><span>${String(index + 1).padStart(2, '0')}</span><p>${esc(fact)}</p></article>`).join('')}
          </div>
        </section>
        <section class="module-table-panel">
          <div class="module-section-head"><div><span class="section-kicker">明细下钻</span><h3>${esc(view.label)}明细</h3></div><span class="data-state is-live">${rows.length} 条脱敏展示</span></div>
          <div class="module-table-wrap"><table><thead><tr>${view.table.map(column => `<th>${esc(column)}</th>`).join('')}</tr></thead>
          <tbody>${rows.length
            ? rows.map(row => `<tr>${row.map(value => `<td>${esc(value)}</td>`).join('')}</tr>`).join('')
            : `<tr><td colspan="${view.table.length}"><div class="designed-empty"><i class="ri-inbox-2-line" aria-hidden="true"></i><b>真实空状态</b><span>${esc(emptyMessage)}</span></div></td></tr>`}
          </tbody></table></div>
        </section>
      </div>
      <aside class="module-source-column">
        <section class="source-panel">
          <div class="module-section-head"><div><span class="section-kicker">数据契约</span><h3>WorkCTL 映射</h3></div></div>
          <div class="source-list">
            ${view.sources.map(([mode, command, purpose]) => `<article>
              <div><span class="source-mode">${esc(mode)}</span><b>${esc(purpose)}</b></div>
              <code>${esc(command)}</code>
            </article>`).join('')}
          </div>
        </section>
        <section class="boundary-panel">
          <i class="ri-shield-check-line" aria-hidden="true"></i>
          <div><b>当前能力边界</b><p>${esc(module.boundary)}</p></div>
        </section>
      </aside>
    </div>`;
}

/**
 * 处理待接入业务界面内部的子页面切换。
 *
 * 使用事件委托可以避免每次重新渲染页面后重复绑定大量按钮；切换只更新当前
 * 模块的设计内容，不会触发 Workctl 调用或任何写操作。
 *
 * @param {MouseEvent} event - main 内容区捕获到的点击事件。
 * @returns {void} 命中子页面按钮时重新渲染；其他点击直接忽略。
 * @throws {Error} 不主动抛出异常，缺少 data 属性时不执行任何动作。
 */
function handleModuleViewClick(event) {
  const button = event.target.closest('[data-module-view]');
  if (!button) return;
  renderModuleDesign(button.dataset.moduleKey, button.dataset.moduleView);
}

// ============================ tab / 事件 ============================
const LOADED = {};
const LOADERS = { overview: loadOverview, product: loadProductPage, 'product-publish': initProductPublish, region: () => switchTab('flow'),
                  flow: loadFlow, visitor: loadVisitor, staff: loadStaff, console: refreshLog,
                  ads: loadAds, rfq: loadRfq,
                  orders: () => renderModuleDesign('orders'), risk: () => renderModuleDesign('risk'),
                  storefront: () => renderModuleDesign('storefront'), assets: () => renderModuleDesign('assets'),
                  knowledge: () => renderModuleDesign('knowledge'), access: () => renderModuleDesign('access') };

/**
 * 切换左侧业务导航对应的内容区，并同步右侧工作区标题和无障碍状态。
 *
 * @param {string} name - 导航按钮 `data-tab` 中声明的页面名称。
 * @returns {void} 本函数只更新页面状态；首次进入页面时异步加载器自行执行。
 * @throws {Error} 正常 DOM 结构下不会抛错；若导航按钮缺失，标题保持原值。
 */
function switchTab(name) {
  let activeLabel = '';
  $('.app-layout')?.classList.toggle('product-publish-mode', name === 'product-publish');
  $$('#tabs button[data-tab]').forEach(b => {
    const active = b.dataset.tab === name;
    b.classList.toggle('on', active);
    if (active) {
      b.setAttribute('aria-current', 'page');
      activeLabel = b.querySelector('span')?.textContent.trim() || b.textContent.trim();
    } else {
      b.removeAttribute('aria-current');
    }
  });
  $$('.tab').forEach(s => s.classList.toggle('on', s.id === 'tab-' + name));
  if (activeLabel && $('#workspaceTitle')) $('#workspaceTitle').textContent = activeLabel;
  if (!LOADED[name]) { LOADED[name] = 1; LOADERS[name] && LOADERS[name](); }
}

/**
 * 将页面滚动到指定业务模块。若当前不在总览，会先切回总览再定位。
 *
 * @param {string} id - 目标元素 id，不包含井号。
 * @returns {void} 仅触发导航和滚动。
 * @throws {Error} 不主动抛出异常；目标不存在时静默结束。
 */
function scrollToOverviewBlock(id) {
  switchTab('overview');
  requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

/**
 * 绑定导航、筛选、分页、弹层与响应式重绘事件。
 *
 * @returns {void} 事件处理器绑定完成后直接返回。
 * @throws {Error} 页面关键控件缺失时可能抛出 DOM 访问异常。
 */
function bind() {
  $$('#tabs button[data-tab]').forEach(b => b.onclick = () => switchTab(b.dataset.tab));
  $$('#tabs button[data-anchor]').forEach(b => b.onclick = () => scrollToOverviewBlock(b.dataset.anchor));
  $$('[data-tab-link]').forEach(b => b.onclick = () => switchTab(b.dataset.tabLink));
  $$('[data-anchor-link]').forEach(b => b.onclick = () => scrollToOverviewBlock(b.dataset.anchorLink));
  $('main').addEventListener('click', handleModuleViewClick);
  // 点击产地控件外部时收起浮层，行为与 Alibaba 发品页的单选下拉一致。
  document.addEventListener('click', event => {
    if (!event.target.closest('.publish-origin-picker')) closePublishOriginPickers();
  });

  $('#sidebarToggle').onclick = () => {
    const layout = $('.app-layout');
    const collapsed = layout.classList.toggle('sidebar-collapsed');
    const button = $('#sidebarToggle');
    button.setAttribute('aria-expanded', String(!collapsed));
    button.setAttribute('aria-label', collapsed ? '展开菜单' : '收起菜单');
    button.querySelector('i').className = collapsed ? 'ri-arrow-right-double-line' : 'ri-arrow-left-double-line';
    button.querySelector('span').textContent = collapsed ? '展开菜单' : '收起菜单';
    setTimeout(() => {
      if ($('#tab-overview').classList.contains('on') && summaryRows.length) renderTrend();
    }, 220);
  };

  $('#quickRange').onchange = e => {
    if (!e.target.value) return;
    setRange(+e.target.value); reloadAll();
  };
  $('#btnReload').onclick = reloadAll;
  $('#btnClearCache').onclick = async () => {
    const r = await fetch('/api/cache/clear'); const j = await r.json();
    toast(`已清除 ${j.cleared} 条缓存`); reloadAll();
  };

  $('#prodApply').onclick = () => { pState.pageNo = 1; loadProduct(); };
  $('#prodPrev').onclick = () => { if (pState.pageNo > 1) { pState.pageNo--; loadProduct(); } };
  $('#prodNext').onclick = () => { pState.pageNo++; loadProduct(); };
  $('#prodSearch').onkeydown = e => { if (e.key === 'Enter') { pState.pageNo = 1; loadProduct(); } };

  // 右侧动态按钮只处理当前商品；顶部和底部按钮只处理左侧勾选商品。
  // 四个入口共用同一真实 WorkCTL 串行队列，但各自保留明确范围和二次确认。
  $('#publishImportFolder').onclick = () => $('#publishFolderInput').click();
  $('#publishReadyTop').onclick = () => openPublishConfirmation({ scope: 'batch', action: 'publish' });
  $('#publishStartQueue').onclick = () => openPublishConfirmation({ scope: 'batch', action: 'publish' });
  $('#publishSaveDraft').onclick = () => openPublishConfirmation({ scope: 'batch', action: 'draft' });
  $('#publishFileInput').onchange = event => {
    handlePublishProductImages(event.target.files || []);
    event.target.value = '';
  };
  $('#publishFolderInput').onchange = event => {
    handlePublishFolderFiles(event.target.files || []);
    event.target.value = '';
  };
  $('#publishSearch').oninput = event => {
    publishState.query = event.target.value.trim();
    renderPublishTable();
  };
  $('#publishStatusFilter').onchange = event => {
    publishState.statusFilter = event.target.value;
    renderPublishTable();
  };
  $('#publishCategoryFilter').onchange = event => {
    const product = publishState.products.find(item => item.id === publishState.activeId);
    const categoryId = Number(event.target.value);
    if (!product || !Number.isSafeInteger(categoryId) || categoryId <= 0 ||
        Number(product.categoryId) === categoryId) return;
    applyLivePublishCategory(product, categoryId);
  };
  $('#publishBatchTitle').onclick = () => {
    let changed = 0;
    publishState.products.forEach((product, index) => {
      if (product.selected && (!product.title.trim() || product.title === 'Untitled Product')) {
        product.title = `Smart Product ${String(index + 1).padStart(2, '0')}`;
        changed += 1;
      }
    });
    renderProductPublish();
    toast(changed ? `已补齐 ${changed} 个本地草稿标题` : '已选商品均已有标题');
  };
  $('#publishSelectAll').onchange = event => {
    const visibleIds = new Set(visiblePublishProducts().map(product => product.id));
    publishState.products.forEach(product => {
      if (visibleIds.has(product.id)) product.selected = event.target.checked;
    });
    renderProductPublish();
  };
  $('#publishEditor').oninput = handlePublishEditorInput;
  $('#publishEditor').onchange = handlePublishEditorInput;
  $('#publishQueueToggle').onclick = () => {
    publishState.queueCollapsed = !publishState.queueCollapsed;
    renderPublishQueue();
  };
  $('#publishOperationResult').onclick = () => {
    const operationId = resolveVisiblePublishOperationId();
    if (!operationId || !showPublishOperationResult(operationId)) toast('本次任务还没有全部结束');
  };

  $('#regionApply').onclick = loadRegion;
  $('#flowApply').onclick = loadFlow;
  $('#staffApply').onclick = loadStaff;

  $('#rfqSearchBtn').onclick = () => loadRfq();
  $('#rfqKeyword').onkeydown = event => { if (event.key === 'Enter') loadRfq(); };
  $('#rfqSource').onchange = event => {
    rfqState.source = event.target.value;
    $$('[data-rfq-source]').forEach(button => button.classList.toggle('on', button.dataset.rfqSource === rfqState.source));
    applyRfqFilters();
  };
  $('#rfqCountry').onchange = event => {
    rfqState.country = event.target.value;
    applyRfqFilters();
  };
  $$('[data-rfq-source]').forEach(button => {
    button.onclick = () => {
      rfqState.source = button.dataset.rfqSource;
      $('#rfqSource').value = rfqState.source;
      $$('[data-rfq-source]').forEach(item => item.classList.toggle('on', item === button));
      applyRfqFilters();
    };
  });

  $('#visApply').onclick = () => { vState.pageNO = 1; loadVisitor(); };
  $('#visPrev').onclick = () => { if (vState.pageNO > 1) { vState.pageNO--; loadVisitor(); } };
  $('#visNext').onclick = () => { vState.pageNO++; loadVisitor(); };
  $('#visCountry').onkeydown = e => { if (e.key === 'Enter') { vState.pageNO = 1; loadVisitor(); } };

  $('#cRun').onclick = runConsole;
  $('#modalX').onclick = () => $('#modal').classList.remove('on');
  $('#modal').onclick = e => { if (e.target.id === 'modal') $('#modal').classList.remove('on'); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#modal').classList.remove('on'); });

  let rt;
  addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      if ($('#tab-overview').classList.contains('on') && summaryRows.length) {
        renderJourney(); renderTrend();
      }
      if ($('#tab-flow').classList.contains('on') && flowRaw.length) renderFlow();
      if ($('#tab-flow').classList.contains('on') && regionRows.length) renderRegion(regionRows);
    }, 220);
  });
}

function reloadAll() {
  for (const k of Object.keys(LOADED)) delete LOADED[k];
  productAnalysisData = null;
  customerContextPromise = null;
  const cur = $('#tabs button[data-tab].on')?.dataset.tab || 'overview';
  LOADED[cur] = 1;
  LOADERS[cur] && LOADERS[cur]();
  buildFlags();
}

// ============================ 启动 ============================
(async function init() {
  setRange(30);
  bind();
  await initConsole();
  // 只接受已注册的标签页名称，方便最终交付链接直接打开“产品发布”，
  // 同时避免把任意查询字符串拼入 DOM 选择器或页面结构。
  const requestedTab = new URLSearchParams(location.search).get('tab');
  switchTab(requestedTab && Object.prototype.hasOwnProperty.call(LOADERS, requestedTab) ? requestedTab : 'overview');
  setInterval(refreshLog, 6000);
})();
