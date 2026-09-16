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
async function api(ep, params = {}, options = {}) {
  try {TimePolicy.validate(ep,params,EPS.find(item=>item.key===ep)?.flags);} catch(error){toast(error.message,true);return null;}
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== '' && v !== null && v !== undefined && v !== false) qs.set(k, v);
  }
  busy(true);
  const advisorRead=window.LsouAdvisor?.beginRead('/api/q/'+ep,params);
  try {
    const r = await fetch(`/api/q/${ep}?${qs}`);
    const j = await r.json();
    window.LsouAdvisor?.finishRead(advisorRead,j,!j.ok);
    if (!j.ok) { if(!options.quiet)toast(ep==='shop-product'?'商品数据暂时读取失败，请稍后点击刷新。':`${ep} 读取失败，请稍后重试。`, true); return null; }
    return j;
  } catch (e) {
    window.LsouAdvisor?.finishRead(advisorRead,null,true);
    if(!options.quiet)toast('数据连接暂时失败，请稍后重试。', true); return null;
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
  const advisorRead=window.LsouAdvisor?.beginRead(path);
  try {
    const response = await fetch(path);
    const payload = await response.json();
    window.LsouAdvisor?.finishRead(advisorRead,payload,!payload.ok);
    if (!payload.ok) {
      toast(`经营分析失败: ${(payload.error || '').slice(0, 110)}`, true);
      return null;
    }
    return payload;
  } catch (error) {
    window.LsouAdvisor?.finishRead(advisorRead,null,true);
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
const timeStates = {};
const timePages = {
  overview: {modes:['month','week','day','range'], note:'经营与渠道按所选区间；商品榜独立按自然月；回复指标为平台近30天值'},
  product: {modes:['month','day'], note:'商品效果仅支持近90天内自然日／自然月；质量诊断为独立快照'},
  flow: {modes:['month','week','day','range'], note:'店铺与国家按所选区间；画像固定近30天，行业需求近90天'},
  visitor: {modes:['week','month','day','range'], note:'访客与经营数据按所选区间（最长1个月）；画像近30天，会话为实时记录'},
  staff: {modes:['month','week','day'], note:'日／月按所选周期；周报以平台返回的报告日期为准，不跨周相加'},
  ads: {modes:['month','week','day','range'], note:'广告效果按所选区间（最多100天）；关键词、行业基准、计划与余额各自独立口径'},
};
const timeNotes = {
  ads:'关键词为平台最新／历史快照；行业需求固定近90天，关键词指数按平台年度口径',
  market:'行业供需、竞争与选品参考；类目和统计周期在各区域独立选择',
  rfq:'当前商机池、报价历史与独立权益信息；本页不按经营日期筛选',
  orders:'合同按下方创建日期查询；物流为当前状态，关税为本次测算',
  risk:'风险诊断为当前快照；违规记录按下方日期查询',
  'product-publish':'当前商品资料与发布任务，不按经营日期筛选',
  storefront:'当前店铺资料与星等级快照，不按经营日期筛选',
  assets:'当前素材与创作任务，不按经营日期筛选',
  knowledge:'当前知识与商品资料，不按经营日期筛选',
  access:'当前账号与权限，不按经营日期筛选',
  console:'每个工具独立选择时间，按工具合同校验；不继承其他页面的日期',
};
/** 最新完整周期作为默认，避开尚未结束的自然周/月。@param {string} mode 粒度。@returns {string} 控件值。@throws 无。 */
function defaultTimeValue(mode) {
  const yesterday = TimePolicy.shift(TimePolicy.today(),-1);
  if(mode==='month') return TimePolicy.addMonths(TimePolicy.today().slice(0,7)+'-01',-1).slice(0,7);
  if(mode==='week') {
    const monday=TimePolicy.period('week',TimePolicy.weekValue(yesterday),'9999-12-31').startDate;
    return TimePolicy.weekValue(TimePolicy.shift(monday,-7));
  }
  // 商品平台默认日常有离线延迟；默认前天，但不把T+2强加给其他统计接口。
  return TimePolicy.shift(TimePolicy.today(),-2);
}
/** 返回当前已应用日期，编辑中的控件不会改变正在展示的口径。@returns {object} 日期对。@throws 无。 */
const dates = name => timeStates[name] ? {startDate:timeStates[name].startDate,endDate:timeStates[name].endDate} : ({startDate:$('#startDate').value,endDate:$('#endDate').value});
/** 访客日期严格校验，不再静默裁切为30天。@returns {object} 日期对。@throws 超过一个月。 */
function visitorRange() {const d=dates('visitor');return TimePolicy.range(d.startDate,d.endDate,{months:1});}
/** 生成页面默认时间状态。@param {string} name 页面。@returns {object} 已应用状态。@throws 无。 */
function defaultTimeState(name) {
  const mode=timePages[name]?.modes[0] || 'month', value=defaultTimeValue(mode);
  return {mode,value,...TimePolicy.period(mode,value)};
}
/** 切页恢复各页自己的日期，隐藏不生效的控件。@param {string} name 页面。@returns {void}。@throws DOM缺失。 */
function renderTimeControls(name) {
  const policy=timePages[name], state=timeStates[name] ||= defaultTimeState(name);
  $('#startDate').value=state.startDate;$('#endDate').value=state.endDate;
  $('#timeControls').hidden=!policy;
  $('#timeScope').textContent=policy ? `${state.startDate} — ${state.endDate} · ${policy.note}` : (timeNotes[name] || '当前记录');
  if(!policy)return;
  $('#quickRange').innerHTML=policy.modes.map(mode=>`<option value="${mode}">${({day:'按日',week:'按周',month:'按月',range:'自定义区间'})[mode]}</option>`).join('');
  $('#quickRange').value=state.mode;
  renderTimePicker(name,state.mode,state);
}
/** 只开放本页支持的输入形式；日期变更需点击应用，避免连续发请求。@param {string} name 页面。@param {string} mode 粒度。@param {object} state 可选已保存值。@returns {void}。@throws DOM缺失。 */
function renderTimePicker(name,mode,state={}) {
  const range=mode==='range', input=$('#timeValue');
  $('#timeValueLabel').hidden=range;$('#timeRangeLabel').hidden=!range;
  const latest=TimePolicy.shift(TimePolicy.today(),-1);
  input.type=range?'date':mode;input.value=state.mode===mode?state.value:defaultTimeValue(mode);
  input.max=mode==='month'?defaultTimeValue('month'):mode==='week'?TimePolicy.weekValue(TimePolicy.shift(TimePolicy.period('week',TimePolicy.weekValue(latest),'9999-12-31').endDate,-7)):latest;
  input.min='';
  if(name==='product') {
    const earliest=TimePolicy.shift(TimePolicy.today(),-89);
    input.min=mode==='month'?(earliest.endsWith('-01')?earliest.slice(0,7):TimePolicy.addMonths(earliest.slice(0,7)+'-01',1).slice(0,7)):earliest;
  }
  $('#timeValueText').textContent=mode==='week' && name==='staff'?'查询周 · 平台周报':({day:'统计日',week:'自然周 · 周一至周日',month:'自然月'})[mode] || '日期';
  $('#timeFrom').value=state.startDate || dates().startDate;
  $('#timeTo').value=state.endDate || dates().endDate;
  $('#timeFrom').max=latest;$('#timeTo').max=latest;
  $('#timeRangeHint').textContent=name==='visitor'?'最长1个月':name==='ads'?'最多100天':'最多90天';
}
/** 应用合法时间到查询参数并刷新；不合法时保留原图表。@returns {void}。@throws 错误转为页面提示。 */
function applyTimeSelection() {
  const name=$('#tabs button[data-tab].on')?.dataset.tab || 'overview', mode=$('#quickRange').value;
  try {
    if(!timePages[name]?.modes.includes(mode))throw new Error('此页面不支持该时间粒度');
    const selected=mode==='range'?TimePolicy.range($('#timeFrom').value,$('#timeTo').value,{latest:TimePolicy.shift(TimePolicy.today(),-1),days:name==='visitor'?undefined:name==='ads'?100:90,months:name==='visitor'?1:undefined}):TimePolicy.period(mode,$('#timeValue').value);
    if(name==='product')TimePolicy.validate('shop-product',{statDate:selected.startDate,statisticsType:mode});
    timeStates[name]={mode,value:mode==='range'?'':$('#timeValue').value,...selected};
    if(name==='visitor')vState.pageNO=1;
    if(name==='overview' && mode==='month')overviewRankingMonth=selected.startDate.slice(0,7);
    renderTimeControls(name);reloadAll();
  } catch(error) {toast(error.message,true);}
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
// 顶部指标独立配置：扩展展示不改变诊断生成器原有的六项输入契约。
// 商品数是最新库存快照，访客数是每日去重人数的累加，不能当作周期去重人数。
const OVERVIEW_KPIS = [
  { ...KPIS[3], n: '成交订单数', icon: 'ri-file-list-3-line', primary: true },
  { k: 'adSpend', n: '广告花费', icon: 'ri-wallet-3-line', primary: true, unavailable: true },
  { k: 'abCnt', n: '商机数', icon: 'ri-chat-check-line', primary: true, aggregate: 'sum', format: 'number', c: '#ff6200' },
  { ...KPIS[2], icon: 'ri-mail-line', primary: true },
  { ...KPIS[0], icon: 'ri-eye-line' },
  { ...KPIS[1], icon: 'ri-cursor-line' },
  { k: 'uvCnt', n: '店铺访客数', icon: 'ri-user-line', aggregate: 'sum', format: 'number', c: '#ff6200', scope: '每日去重人数累加' },
  { k: 'pvCnt', n: '店铺浏览量', icon: 'ri-pages-line', aggregate: 'sum', format: 'number', c: '#ff6200' },
  { k: 'validProdCnt', n: '有效商品数', icon: 'ri-box-3-line', aggregate: 'latest', format: 'number', c: '#ff6200', scope: '最新快照' },
  { k: 'goodProdCnt', n: '优爆品数', icon: 'ri-medal-line', aggregate: 'latest', format: 'number', c: '#ff6200', scope: '最新快照' },
  { ...KPIS[4], icon: 'ri-message-3-line', scope: '近30天滚动值' },
  { ...KPIS[5], icon: 'ri-time-line', scope: '近30天滚动值' },
];
let curKpi = 'totalImpsCnt';
let summaryRows = [];

// ============================ 经营大盘 ============================
async function loadOverview() {
  const timeRequest=JSON.stringify(timeStates['overview']);
  const j = await api('shop-summary', { ...dates('overview'), statisticsType: 'day' });
  if(timeRequest!==JSON.stringify(timeStates['overview']))return;
  overviewInsightPromise = loadOverviewInsights();
  if (!j) {
    summaryRows=[];
    ['#kpis','#journeyFlow','#trendChart'].forEach(id=>$(id).innerHTML='<div class="empty">此周期读取失败，请刷新重试</div>');
    renderActionItems(); generateOverviewTodo(false, true); return;
  }
  summaryRows = (Array.isArray(j.data) ? j.data : [])
    .filter(r => r && r.statDate)
    .sort((a, b) => a.statDate < b.statDate ? -1 : 1);
  if (!summaryRows.length) { ['#kpis','#journeyFlow','#trendChart'].forEach(id=>$(id).innerHTML='<div class="empty">该区间无数据</div>'); renderActionItems(); generateOverviewTodo(false, true); return; }
  renderKpis();
  renderJourney();
  renderTrend();
  renderActionItems();
  $('#dataFreshness').textContent = `已更新 · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  generateOverviewTodo();
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
 * 读取顶部指标值，严格区分真实零值和缺失值。
 * @param {object} meta 指标配置，包含 k 与 aggregate。
 * @param {string} suffix 同行字段后缀，默认读取本店。
 * @returns {number|null} 完整序列的合计或最新快照；空值或不完整序列返回 null。
 * @throws {Error} 不主动抛出异常。
 */
function overviewMetricValue(meta, suffix = '') {
  const rows = meta.aggregate === 'latest' ? summaryRows.slice(-1) : summaryRows;
  const key = meta.k + suffix;
  if (!rows.length || rows.some(row => row[key] == null || String(row[key]).trim() === '' || !Number.isFinite(Number(row[key])))) return null;
  return rows.reduce((total, row) => total + Number(row[key]), 0);
}

/**
 * 渲染两排各六项经营指标，使用真实同行对比，不把原型中的示意环比当事实。
 * 广告花费尚无完整店铺消耗来源：显示未接入，不用问鼎/顶展空记录替代全店花费。
 * @returns {void} 更新顶部指标及其趋势切换事件。
 * @throws {Error} 页面缺少 KPI 容器时可能抛出 DOM 访问异常。
 */
function renderKpis() {
  $('#kpis').innerHTML = OVERVIEW_KPIS.map(m => {
    const mine = m.unavailable ? null : overviewMetricValue(m);
    const rival = m.unavailable ? null : overviewMetricValue(m, 'RivalAvg');
    const comparison = mine == null || rival == null
      ? { className: 'neutral', text: m.unavailable ? '尚未接入完整花费' : '暂无同行参考' }
      : rival === 0
        ? { className: 'neutral', text: mine === 0 ? '与行业均值持平' : '行业均值为 0' }
        : metricComparison(m, mine, rival);
    // 对比对象必须直接可见，尤其避免百分点被误解为与上期比较。
    if (mine != null && rival != null && rival !== 0) comparison.text = comparison.text.replace('vs 同行', '较行业均值') + (m.format === 'percent' ? ' · 较均值' : '');
    const scope = m.unavailable ? '等待花费数据来源' : m.aggregate === 'latest'
      ? `${summaryRows.slice(-1)[0]?.statDate || ''} · ${m.scope}`
      : (m.scope || '所选周期累计');
    const tag = mine == null ? 'article' : 'button';
    return `<${tag} class="kpi${m.primary ? ' kpi-primary' : ''}${m.k === curKpi ? ' on' : ''}${mine == null ? ' kpi-unavailable' : ''}" data-k="${m.k}"${tag === 'button' ? ` type="button" aria-pressed="${m.k === curKpi}" title="查看${m.n}趋势"` : ''}>
      <span class="k"><i class="${m.icon}" aria-hidden="true"></i>${m.n}</span>
      <strong class="v">${mine == null ? (m.unavailable ? '未接入' : '—') : formatMetric(m, mine)}</strong>
      <span class="c ${comparison.className}">${esc(comparison.text)}</span>
      <span class="kpi-scope">${esc(scope)}</span></${tag}>`;
  }).join('');
  $$('#kpis button.kpi').forEach(e => e.onclick = () => {
    curKpi = e.dataset.k;
    $$('#kpis button.kpi').forEach(x => {
      x.classList.toggle('on', x.dataset.k === curKpi);
      x.setAttribute('aria-pressed', String(x.dataset.k === curKpi));
    });
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
  const meta = OVERVIEW_KPIS.find(m => m.k === curKpi);
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
 * 并列展示六项经营指标，均来自 shop-summary 的返回字段。
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
  // 各指标没有同一批访客的归因关系，只并列呈现，不计算跨口径转化率。
  $('#journeyFlow').innerHTML = stages.reverse().map(stage =>
    `<div class="journey-step"><span>${stage.name}</span><strong>${fmt(stage.value)}</strong><small>所选周期</small></div>`).join('');
}

/**
 * 当前页面的待办生成版本及请求状态，用于丢弃过期响应。
 *
 * @returns {void} 直接更新待办列表和待办数量。
 * @throws {Error} 页面缺少待办容器时可能抛出 DOM 访问异常。
 */
let overviewTodoRevision = 0;
let overviewTodoController = null;
let overviewInsightPromise = Promise.resolve();
let overviewTodoResult = null;
let overviewTodoSelected = -1;
// 默认展示已保存的优化诊断，指标对标由用户按需切换。
let overviewDiagnosisView = 'insights';

/** 展示待办初始状态并绑定重新生成。无参数、无返回值；不主动抛出异常。 */
function renderActionItems() {
  overviewTodoRevision++;
  overviewTodoController?.abort();
  $('#actionCount').textContent = '0';
  $('#actionList').innerHTML = '<div class="empty">正在读取已保存诊断…</div>';
  $('#generateOverviewTasks').onclick = () => generateOverviewTodo(true);
}

/**
 * 优先读取持久化待办，仅每日首次访问或手动更新时提交当前总览快照。
 * @param {boolean} force 用户是否点击更新。
 * @param {boolean} readOnly 总览缺数据时只恢复历史结果。
 * @returns {Promise<void>} 更新诊断卡片；网络及结构异常就地显示，不向外抛出。
 */
async function generateOverviewTodo(force = false, readOnly = false) {
  // 新六页顾问复用原诊断位置；由用户显式生成，避免旧入口同时重复调用模型。
  if(window.LsouAdvisor?.enabled){void window.LsouAdvisor.refresh('overview');return;}
  const revision = ++overviewTodoRevision;
  const requestPeriod = JSON.stringify(dates('overview'));
  overviewTodoController?.abort();
  const controller = new AbortController();
  overviewTodoController = controller;
  const button = $('#generateOverviewTasks');
  button.disabled = true;
  $('#actionCount').textContent = '0';
  $('#actionList').innerHTML = '<div class="empty" role="status">正在读取已保存诊断…</div>';
  try {
    const savedResponse = await fetch('/api/overview-tasks', {signal: controller.signal});
    const saved = await savedResponse.json();
    if (!savedResponse.ok || !saved.ok) throw new Error(saved.error || '读取诊断失败');
    if (revision !== overviewTodoRevision) return;
    renderSavedOverviewTodo(saved);
    if (readOnly || (!force && !saved.shouldGenerate && !saved.generating)) return;
    button.textContent = '更新中…';
    $('#overviewTodoMeta').textContent += ' · 正在更新';
    if (!saved.result) $('#actionList').innerHTML = '<div class="empty" role="status">正在依据经营数据生成运营诊断…</div>';
    await overviewInsightPromise;
    if (window.overviewStarsReady) await window.overviewStarsReady;
    if (revision !== overviewTodoRevision || requestPeriod !== JSON.stringify(dates('overview'))) return;
    const snapshot = {
      module: 'overview', as_of: new Date().toISOString(), period: dates('overview'),
      source: '当前工作台经营总览接口及页面展示',
      analysis_goal: '逐指标对比行业均值和行业优秀，解释已知差距与可能原因，指向标题、主图、详情、广告等具体优化内容。',
      metrics: KPIS.map(meta => ({key: meta.k, label: meta.n, value: summaryRows.some(row => row[meta.k] != null) ? formatMetric(meta, metricValue(meta)) : null, peer_average: summaryRows.some(row => row[meta.k+'RivalAvg'] != null) ? formatMetric(meta, metricValue(meta, 'RivalAvg')) : null, peer_excellent: summaryRows.some(row => row[meta.k+'RivalGood'] != null) ? formatMetric(meta, metricValue(meta, 'RivalGood')) : null, aggregation: meta.aggregate})),
      trend: summaryRows.map(row => Object.fromEntries(['statDate', ...KPIS.flatMap(meta => [meta.k, meta.k+'RivalAvg', meta.k+'RivalGood'])].filter(key => row[key] !== undefined).map(key => [key,row[key]]))),
      business_summary: $('#journeyFlow').innerText,
      traffic_channels: $('#overviewFlowList').innerText,
      country_ranking: $('#overviewRegionList').innerText,
      product_ranking: $('#overviewProductList').innerText,
      star_rating: $('#ops-stars')?.innerText || '星级数据未加载',
      limitations: ['经营指标独立，不能拼成转化漏斗。','流量来源口径独立，商机率为记录算术平均。','国家仅为TOP5内部占比。','商品排行为接口默认周期的搜索曝光，不与全店曝光合计。','星级为独立统计日期；未展示字段不代表零。'],
      existing_tasks: [],
    };
    const response = await fetch(`/api/overview-tasks${force ? '?refresh=1' : ''}`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(snapshot), signal:controller.signal});
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || '生成失败');
    if (revision !== overviewTodoRevision || requestPeriod !== JSON.stringify(dates('overview'))) return;
    renderSavedOverviewTodo(result);
  } catch (error) {
    if (revision !== overviewTodoRevision || requestPeriod !== JSON.stringify(dates('overview'))) return;
    // 生成失败仍恢复旧待办；读取接口不触发模型调用，也不自动重试付费请求。
    try {
      const response = await fetch('/api/overview-tasks', {signal: controller.signal});
      const saved = await response.json();
      if (revision !== overviewTodoRevision) return;
      if (response.ok && saved.ok) renderSavedOverviewTodo(saved);
    } catch { /* 本地服务暂时不可达时保留当前列表。 */ }
    if (revision !== overviewTodoRevision) return;
    $('#overviewTodoMeta').textContent = `${error.message} · 点击“更新诊断”重试`;
    if (!overviewTodoResult?.tasks.length) $('#actionList').innerHTML = '<div class="empty">暂时无法更新诊断。</div>';
  } finally { if (revision === overviewTodoRevision) {button.disabled = false;button.textContent='更新诊断';} }
}

/** 展示待办摘要与原始周期。@param {object} status 服务端保存状态。@returns {void} 更新 DOM。@throws DOM 缺失时抛出异常。 */
function renderSavedOverviewTodo(status) {
  const result = status.result;
  const changed = result?.generatedAt !== overviewTodoResult?.generatedAt;
  overviewTodoResult = result;
  if (changed) overviewTodoSelected = -1;
  const count = result?.tasks.length || 0;
  renderDiagnosisBenchmarks(result);
  renderDiagnosisView();
  $('#actionCount').textContent = String(count);
  $('#actionList').innerHTML = count ? result.tasks.map((task, index) => {
    const priority = {high:'优先', normal:'常规', low:'跟进'}[task.priority] || '常规';
    // 图标与颜色只表达优先级，不根据标题猜测业务归因；正文保留完整内容供详情阅读。
    const appearance = {high:['orange','ri-flashlight-line'], normal:['green','ri-task-line'], low:['purple','ri-search-eye-line']}[task.priority] || ['green','ri-task-line'];
    return `<button type="button" class="todo-brief ${index === overviewTodoSelected ? 'is-selected' : ''}" data-todo-index="${index}" aria-expanded="${index === overviewTodoSelected}" aria-controls="overviewTodoDetail" aria-haspopup="dialog">
      <span class="action-icon ${appearance[0]}" aria-hidden="true"><i class="${appearance[1]}"></i></span>
      <span class="todo-brief-copy"><span class="todo-title-line"><strong title="${esc(task.title)}">${esc(task.title)}</strong><span class="todo-priority ${task.priority === 'high' ? 'is-high' : ''}">${priority}</span></span>
        <span class="todo-summary">${esc(task.basis || '')}</span>
      </span><span class="todo-open">查看诊断 <i class="ri-arrow-right-s-line" aria-hidden="true"></i></span></button>`;
  }).join('') : `<div class="todo-empty"><i class="ri-checkbox-circle-line" aria-hidden="true"></i><strong>${result ? '暂无有证据支持的短板诊断' : '准备经营对标诊断'}</strong><p>${result ? '当前数据不足以支持进一步诊断，可补充数据后更新。' : '生成后会展示双基准差距、可能原因和定向优化建议，当天可反复查看。'}</p></div>`;
  $('#actionList').onclick = event => {
    const button = event.target.closest('[data-todo-index]');
    if (!button) return;
    overviewTodoSelected = Number(button.dataset.todoIndex);
    button.classList.add('is-selected');
    button.setAttribute('aria-expanded','true');
    renderOverviewTodoDetail();
  };
  renderOverviewTodoDetail();
  const generated = result ? new Date(result.generatedAt).toLocaleString('zh-CN', {timeZone:'Asia/Shanghai', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false}) : '';
  const period = result?.period;
  $('#overviewTodoMeta').textContent = [
    result ? `已保存 ${generated}` : '每天自动更新一次',
    period?.startDate && period?.endDate ? `依据 ${period.startDate} 至 ${period.endDate}` : '',
    period && (period.startDate!==dates('overview').startDate || period.endDate!==dates('overview').endDate) ? '与当前筛选不同，点击更新诊断可重算' : status.stale && result ? '上次结果' : '当天复用 · 按需更新',
    result && result.diagnosisVersion !== 2 ? '历史待办，点击更新诊断生成新版分析' : '',
    status.notice || '',
  ].filter(Boolean).join(' · ');
}

/** 以原生模态弹窗展示诊断，浏览器负责焦点限制与背景隔离。@returns {void}。@throws DOM 缺失或弹窗无法打开时抛出异常。 */
function renderOverviewTodoDetail() {
  const box = $('#overviewTodoDetail');
  const task = overviewTodoResult?.tasks[overviewTodoSelected];
  if (!task) {if (box.open) box.close();box.hidden = true;return;}
  box.hidden = false;
  // 标题已在上方诊断清单展示，详情不再重复；无障碍名称仍保留对应诊断主题。
  box.setAttribute('aria-label', task.title);
  box.innerHTML = `<div class="diagnosis-controls"><button type="button" class="todo-close" aria-label="关闭诊断详情"><i class="ri-close-line" aria-hidden="true"></i></button></div>
    <div class="todo-detail-grid"><aside class="todo-evidence"><h3>差距与原因分析</h3><p>${esc(task.basis)}</p><div class="todo-delivery"><h3>验证与复查</h3><ul>${task.acceptance_criteria.map(item=>`<li><i class="ri-check-line" aria-hidden="true"></i><span>${esc(item)}</span></li>`).join('')}</ul></div><small>原因假设需结合商品与投放证据验证</small></aside>
    <div class="todo-method"><h3>定向优化建议 <span>${task.steps.length} 个方向</span></h3><ol>${task.steps.map((step,index)=>`<li><span>${String(index+1).padStart(2,'0')}</span><p>${esc(step)}</p></li>`).join('')}</ol></div></div>`;
  // 关闭、Esc 与点击遮罩共用清理逻辑，恢复原位置的触发按钮焦点。
  box.onclose = () => {
    overviewTodoSelected = -1;
    box.hidden = true;
    document.documentElement.classList.remove('diagnosis-open');
    const selected = $('#actionList .is-selected');
    selected?.classList.remove('is-selected');
    selected?.setAttribute('aria-expanded','false');
    selected?.focus({preventScroll:true});
  };
  box.querySelector('.todo-close').onclick = () => box.close();
  box.oncancel = event => {event.preventDefault();box.close();};
  box.onclick = event => {
    if (event.target !== box) return;
    const rect = box.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) box.close();
  };
  if (!box.open) box.showModal();
  document.documentElement.classList.add('diagnosis-open');
}

/** 展示已保存诊断的六项对标，颜色按指标改善方向判断。@param {object|null} result 保存结果。@returns {void}。@throws DOM 缺失异常。 */
function renderDiagnosisBenchmarks(result) {
  const box = $('#diagnosisBenchmarks');
  const rows = result?.benchmarks || [];
  box.hidden = !rows.length;
  if (!rows.length) {box.innerHTML = '';return;}
  const behind = rows.filter(row => row.vs_average.state === 'behind').length;
  const chasing = rows.filter(row => ['better','equal'].includes(row.vs_average.state) && row.vs_excellent.state === 'behind').length;
  const leading = rows.filter(row => ['better','equal'].includes(row.vs_excellent.state)).length;
  const summary = [behind ? `${behind}项低于均值` : '', chasing ? `${chasing}项达到均值、未及优秀` : '', leading ? `${leading}项达到优秀` : ''].filter(Boolean).join(' · ') || '暂缺可比数据';
  box.innerHTML = `<p class="diagnosis-overview">${esc(summary)}</p><div class="diagnosis-table-wrap"><table><thead><tr><th>指标 / 本店</th><th>行业均值</th><th>行业优秀</th></tr></thead><tbody>${rows.map(row => `<tr><th>${esc(row.label)}<strong>${esc(row.display.current)}</strong></th>${['average','excellent'].map(key => `<td><span>${esc(row.display[key])}</span><small class="diagnosis-gap ${esc(row['vs_'+key].state)}">${esc(row['vs_'+key].text)}${row.direction === 'lower_better' ? ' · 越低越好' : ''}</small></td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="diagnosis-scope">平台同行参考 · 差距表示本店相对参考值 · 未返回具体类目范围</p>`;
}

/** 切换对标表与优化诊断清单，避免两块同时拉长总览。@returns {void}。@throws DOM 缺失异常。 */
function renderDiagnosisView() {
  const available = !!overviewTodoResult?.benchmarks?.length;
  $('#diagnosisViews').hidden = !available;
  $('#diagnosisBenchmarks').hidden = !available || overviewDiagnosisView !== 'benchmarks';
  $('#actionList').hidden = available && overviewDiagnosisView === 'benchmarks';
  $('#diagnosisCompareView').setAttribute('aria-pressed',String(overviewDiagnosisView === 'benchmarks'));
  $('#diagnosisInsightsView').setAttribute('aria-pressed',String(overviewDiagnosisView === 'insights'));
  $('#diagnosisInsightsView').textContent = `优化诊断 · ${overviewTodoResult?.tasks.length || 0}`;
  $('#diagnosisCompareView').onclick = () => {overviewDiagnosisView = 'benchmarks';renderDiagnosisView();};
  $('#diagnosisInsightsView').onclick = () => {overviewDiagnosisView = 'insights';renderDiagnosisView();};
}

/**
 * 并行读取渠道、国家和商品数据，为总览底部的一排四块榜单提供真实数据。
 * 单个接口失败不会阻断另外两块，错误提示由统一 api() 函数负责。
 *
 * @returns {Promise<void>} 所有诊断请求完成后结束，不返回业务值。
 * @throws {Error} 理论上不向外抛出，接口异常会被 api() 转成空结果。
 */
async function loadOverviewInsights() {
  const timeRequest=JSON.stringify(timeStates['overview']);
  const [flow, region] = await Promise.all([
    api('shop-channel', { ...dates('overview'), statisticsType:'day', terminalType: 'TOTAL' }),
    api('shop-region', { ...dates('overview'), statisticsType: 'day', dimensionType: 'shop_uv', terminalType: 'TOTAL' }),
    loadOverviewRankings(),
  ]);
  if(timeRequest!==JSON.stringify(timeStates['overview']))return;
  if (flow) renderOverviewFlow(flow);
  if (region) renderOverviewRegion(region);

}

/** 汇总每日渠道的访客和询盘，不累计shop-flow返回的滚动窗口。@param {object[]} blocks 按日分组记录。@param {object} range 查询范围。@returns {object[]} 前五个渠道。@throws 无。 */
function overviewChannelRanking(blocks, range) {
  const groups=new Map();
  for(const block of blocks)for(const [date,rows] of Object.entries(block || {})) {
    if(date<range.startDate || date>range.endDate || !Array.isArray(rows))continue;
    for(const row of rows) {
      if(!row.channelType || row.channelType==='TOTAL' || (row.statisticsType && row.statisticsType!=='day'))continue;
      const item=groups.get(row.channelType) || {name:row.channelType,value:null,inquiries:null};
      if(row.detailUv!=null && Number.isFinite(Number(row.detailUv)))item.value=(item.value??0)+Number(row.detailUv);
      if(row.fbUv!=null && Number.isFinite(Number(row.fbUv)))item.inquiries=(item.inquiries??0)+Number(row.fbUv);
      groups.set(row.channelType,item);
    }
  }
  return [...groups.values()].filter(row=>row.value!=null).sort((a,b)=>b.value-a.value).slice(0,5);
}
/** 渲染同一区间的渠道日累计；不同渠道/日期的人数不解释为周期去重人数。@param {object} response shop-channel响应。@returns {void}。@throws DOM缺失。 */
function renderOverviewFlow(response) {
  const rows=overviewChannelRanking(Array.isArray(response.data)?response.data:[],dates('overview'));
  renderMiniRows('#overviewFlowList',rows,row=>`${fmt(row.value)} 访客 · 询盘 ${row.inquiries==null?'—':fmt(row.inquiries)}`);
}

/**
 * 合并每日区块中的国家访客，并按访客数渲染前五名。
 *
 * @param {object} response - shop-region 接口完整响应。
 * @returns {void} 直接更新国家摘要列表。
 * @throws {Error} 不主动抛出异常，结构不完整时跳过对应记录。
 */
function renderOverviewRegion(response) {
  const groups = new Map();
  (Array.isArray(response.data) ? response.data : []).forEach(block => {
    Object.values(block || {}).forEach(list => (Array.isArray(list) ? list : []).forEach(row => {
      const name = businessCountry(row.countryName || row.regionName);
      groups.set(name, (groups.get(name) || 0) + num(row.countryUv ?? row.regionUv ?? row.value));
    }));
  });
  const rows = [...groups.entries()].map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value).slice(0, 5);
  const total = rows.reduce((acc, row) => acc + row.value, 0);
  renderMiniRows('#overviewRegionList', rows, row => `${fmt(row.value)} 访客 · TOP5 占比 ${total ? (row.value / total * 100).toFixed(1) : '0.0'}%`);
}

const overviewRankMetrics = {
  sumProdShowNum:['搜索曝光','次'],sumProdClickNum:['搜索点击','次'],sumProdClickRate:['点击率','%'],
  sumProdVisitorCnt:['访客','人'],sumProdFbNum:['询盘','次'],atmFbUv:['TM咨询','人'],crtOrd:['起草订单','单']
};
let overviewRankingRows = [], overviewRankingScope = '', overviewRankingVersion = 0;
let overviewRankingMonth = '';
/** 将月份转换为平台自然月查询参数，禁止日期缺失时静默退回单日。@param {string} month YYYY-MM。@returns {object} 日期与周期。@throws 月份无效。 */
function overviewProductPeriod(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('请选择有效的商品统计月份');
  return {statDate:`${month}-01`,statisticsType:'month'};
}
/** 从完整商品集合中排序，保留缺失，不把第一页重排当成全榜。@param {object[]} rows 商品行。@param {string} key 指标。@param {boolean} positiveOnly 仅保留正数。@returns {object[]} 前五行。@throws 无。 */
function rankedOverviewProducts(rows, key, positiveOnly = false) {
  const value = row => row[key] == null || row[key] === '' || !Number.isFinite(Number(row[key])) ? null : Number(row[key]);
  return rows.filter(row => value(row) != null && (!positiveOnly || value(row) > 0)).slice()
    .sort((a,b) => value(b)-value(a) || String(a.id ?? a.subject ?? '').localeCompare(String(b.id ?? b.subject ?? ''))).slice(0,5);
}
/** 分页读取商品样本，两个榜共用数据；排序只在本地进行，迟到响应不覆盖新一轮。@returns {Promise<void>} 更新榜单。@throws API错误转为局部提示。 */
async function loadOverviewRankings() {
  const version = ++overviewRankingVersion;
  const monthInput = $('#overviewRankingMonth');
  overviewRankingMonth = overviewRankingMonth || (timeStates.overview?.mode==='month'?dates('overview').startDate.slice(0,7):defaultTimeValue('month'));
  const earliest=TimePolicy.shift(TimePolicy.today(),-89);
  monthInput.min=earliest.endsWith('-01')?earliest.slice(0,7):TimePolicy.addMonths(earliest.slice(0,7)+'-01',1).slice(0,7);
  monthInput.max=defaultTimeValue('month');
  monthInput.value = overviewRankingMonth;
  monthInput.onchange = () => {try {TimePolicy.period('month',monthInput.value);TimePolicy.validate('shop-product',overviewProductPeriod(monthInput.value));overviewRankingMonth=monthInput.value;loadOverviewRankings();}catch(error){toast(error.message,true);monthInput.value=overviewRankingMonth;}};
  const month = overviewRankingMonth;
  $('#overviewInquiryPeriod').textContent = `${month} · 自然月 · TOP5`;
  const ids = ['#overviewProductList','#overviewInquiryList'];
  ids.forEach(id => $(id).innerHTML='<div class="empty">正在读取商品排行…</div>');
  $('#overviewProductSort').onchange = () => renderOverviewProducts();
  $('#overviewProductSort').disabled = true;
  overviewRankingRows = [];
  const params = {pageSize:20,orderBy:'views',orderModel:'DESC',...overviewProductPeriod(month)};
  const first = await api('shop-product',{...params,pageNo:1},{quiet:true});
  if(version!==overviewRankingVersion)return;
  if(!first){ids.forEach(id=>$(id).innerHTML='<div class="empty">商品数据读取失败，请刷新重试</div>');return;}
  const total = Number(first.data?.recordCount), pages = Number.isFinite(total) ? Math.max(1,Math.ceil(total/20)) : 1;
  const results = [first];
  for(let page=2;page<=pages;page+=2){
    const batch = await Promise.all(Array.from({length:Math.min(2,pages-page+1)},(_,i)=>api('shop-product',{...params,pageNo:page+i},{quiet:true})));
    if(version!==overviewRankingVersion)return;
    results.push(...batch);
  }
  // 仅按平台商品编号去重；缺编号的行保留，不用相似标题合并不同商品。
  const seen = new Set();
  overviewRankingRows = results.flatMap(r=>Array.isArray(r?.data?.data)?r.data.data:[]).filter(row=>{
    if(row.id==null)return true;
    const id=String(row.id);if(seen.has(id))return false;seen.add(id);return true;
  });
  if(results.some(r=>!r))toast('部分商品数据未读完，当前展示已读取的商品；可稍后刷新。',true);
  const complete=results.every(Boolean)&&Number.isFinite(total)&&overviewRankingRows.length===total;
  overviewRankingScope = `${month} 自然月 · ${complete?'':'已读取样本 '}${overviewRankingRows.length} 件商品`;
  $('#overviewProductSort').disabled = false;
  renderOverviewProducts();
}
/** 渲染可切换商品榜和固定询盘榜，未知值不补零。@returns {void} 更新两块榜单。@throws DOM缺失异常。 */
function renderOverviewProducts() {
  const key = $('#overviewProductSort').value;
  const draw = (selector,metric,positiveOnly) => {
    const rows = rankedOverviewProducts(overviewRankingRows,metric,positiveOnly), [label,unit] = overviewRankMetrics[metric];
    const box=$(selector), max=Math.max(1,...rows.map(row=>Number(row[metric])));
    if(!rows.length){
      const known=overviewRankingRows.filter(row=>row[metric]!=null&&row[metric]!==''&&Number.isFinite(Number(row[metric])));
      const allZero=known.length===overviewRankingRows.length&&known.length>0&&known.every(row=>Number(row[metric])===0);
      box.innerHTML=`<div class="ranking-empty"><i class="ri-chat-3-line" aria-hidden="true"></i><b>${positiveOnly?'暂无有询盘商品入榜':'暂无可排序数据'}</b><span>${allZero?'所选月份商品询盘数均为 0':'本次未返回可用的商品指标'}</span><small>${esc(overviewRankingScope)}</small></div>`;return;
    }
    box.innerHTML=rows.map((row,index)=>`<button class="product-mini ranking-product" type="button" title="${esc(row.subject||row.prodName||'未命名商品')}"><span class="mini-rank">${index+1}</span>${row.prodImage?`<img src="${esc(row.prodImage)}" alt="" loading="lazy">`:'<span class="product-placeholder"><i class="ri-image-line"></i></span>'}<span class="product-mini-copy"><b>${esc(row.subject||row.prodName||'未命名商品')}</b><small>${label} <strong>${metric==='sumProdClickRate'?(Number(row[metric])*100).toFixed(2):fmt(Number(row[metric]))}</strong> ${unit}${metric==='sumProdClickRate'?` · ${row.sumProdClickNum == null?'—':fmt(row.sumProdClickNum)}/${row.sumProdShowNum == null?'—':fmt(row.sumProdShowNum)} 点击/曝光`:''}</small><span class="mini-track"><i style="width:${Math.max(0,Number(row[metric])/max*100)}%"></i></span></span></button>`).join('')+`<p class="ranking-scope">${esc(overviewRankingScope)}</p>`;
    box.querySelectorAll('.product-mini').forEach(button=>button.onclick=()=>switchTab('product'));
  };
  draw('#overviewProductList',overviewRankMetrics[key]?key:'sumProdShowNum',false);
  draw('#overviewInquiryList','sumProdFbNum',true);
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
    bar.addEventListener('mousemove', ev => showTip(ev, `${s.n}: ${fmt(s.v)}\n所选周期独立指标`));
    bar.addEventListener('mouseleave', hideTip);
    svg.appendChild(bar);
    svg.appendChild(el('text', { x: L + iw + 9, y: y + 17, class: 'gt', fill: '#4c4e53' }, fmt(s.v)));

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
let productFocusPage = 1;

/**
 * 加载完整商品诊断，商品列表由当前四象限在前端分页。
 *
 * @returns {Promise<void>} 完整分析查询结束后完成。
 * @throws {Error} 单个接口失败由各自加载函数处理，不向外抛出。
 */
async function loadProductPage() {
  await loadProductAnalysis();
}

/**
 * 读取服务端基于完整商品集合计算的四象限、漏斗与质量诊断。
 *
 * @returns {Promise<void>} 渲染完成后结束。
 * @throws {Error} 接口异常由 dashboardApi 转为页面提示。
 */
async function loadProductAnalysis() {
  const timeRequest=JSON.stringify(timeStates['product']);
  const response = await dashboardApi('/api/dashboard/product-analysis?' + new URLSearchParams({statDate:timeStates.product.startDate,statisticsType:timeStates.product.mode}));
  if(timeRequest!==JSON.stringify(timeStates['product']))return;
  if (!response) return;
  productAnalysisData = response.data;
  productFocusPage = 1;
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
    `<button type="button" class="quadrant-card ${tone} ${productFocusMode === key ? 'on' : ''}" data-product-focus="${key}" aria-pressed="${productFocusMode === key}">
      <span>${esc(label)}</span><strong>${fmt(count)}</strong><small>${esc(action)}</small></button>`).join('');
  $$('[data-product-focus]').forEach(button => {
    button.onclick = () => {
      productFocusMode = button.dataset.productFocus;
      productFocusPage = 1;
      renderProductAnalysis();
    };
  });

  const diagnostics = [
    ['有点击但无询盘', d.clickedNoInquiry, '检查详情页说服力、证书、价格带与 MOQ', '高'],
    ['有商机但无起草单', d.inquiryNoDraft, '复盘报价速度、样品与跟进节奏', '中'],
    ['搜索曝光为 0', d.noSearchExposure, '补关键词、类目属性或降低无效供给', '中'],
    ['0–4 分质量审计命中', d.lowScoreQueryRows, '逐品查看质量分问题，不等同全店低质总数', '中'],
    ['零效果审计返回', d.zeroEffectRows, '尚未取得当前账号质量诊断，不推断为零', '常规'],
    ['P4P 商品', d.p4pProducts, '按本次商品效果记录识别投放商品', '观察'],
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
  const allRows = productAnalysisData.focusProducts?.[productFocusMode] || [];
  const pages = Math.max(1, Math.ceil(allRows.length / 20));
  productFocusPage = Math.min(productFocusPage, pages);
  const rows = allRows.slice((productFocusPage - 1) * 20, productFocusPage * 20);
  $('#productFocusPrev').disabled = productFocusPage <= 1;
  $('#productFocusNext').disabled = productFocusPage >= pages;
  $('#productFocusPage').textContent = `第 ${productFocusPage} / ${pages} 页 · 每页 20 件`;
  $('#productFocusPrev').onclick = () => { if (productFocusPage > 1) { productFocusPage--; renderProductFocus(); } };
  $('#productFocusNext').onclick = () => { if (productFocusPage < pages) { productFocusPage++; renderProductFocus(); } };
  $('#productFocusTitle').textContent = title;
  $('#productFocusHint').textContent = hint;
  $('#productFocusCount').textContent = `${fmt(allRows.length)} 件符合条件 · 点击商品修改`;
  if (!rows.length) {
    $('#productFocusTable').innerHTML = '<div class="empty">当前象限没有商品</div>';
    return;
  }
  $('#productFocusTable').innerHTML = `<table><thead><tr><th>商品</th><th>分层</th><th>曝光</th><th>点击</th><th>点击率</th><th>询盘</th><th>TM</th><th>建议</th></tr></thead><tbody>${rows.map(row =>
    `<tr><td><button type="button" class="product-cell product-edit-entry" data-ops-product-ref="${esc(row.productRef || '')}" data-ops-product-title="${esc(row.title)}" ${row.productRef ? '' : 'disabled'}>${row.image ? `<img src="${esc(row.image)}" alt="" loading="lazy">` : ''}<span class="pname" title="${esc(row.title)}">${esc(row.title || '未命名商品')}</span></button></td><td><span class="tag t-${esc(row.level)}">${esc(row.level)}</span></td><td>${fmt(row.exposure)}</td><td>${fmt(row.clicks)}</td><td>${pct(row.clickRate)}</td><td>${fmt(row.inquiries)}</td><td>${fmt(row.tmInquiries)}</td><td><button type="button" class="action-tag" data-ops-product-ref="${esc(row.productRef || '')}" data-ops-product-title="${esc(row.title)}" ${row.productRef ? '' : 'disabled'}>${esc(advice)}</button></td></tr>`).join('')}</tbody></table>`;
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
const PUBLISH_PRODUCT_IMAGES = [];

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
// 空态不代表任何行业；真实类目由当前账号的实时 Schema 注册。
const PUBLISH_CATEGORY_CONFIG = { unselected: { categoryId: null, label: '请选择类目', shortLabel: '未选择类目', fields: [] } };

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
    .find(([, config]) => Number(config.categoryId) === Number(categoryId) && config.source === 'workctl-live' && !config.needsRefresh);
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
  const requestId = ++publishState.categorySearchRequestId;
  const productId = publishState.activeId;
  publishState.categorySearchError = '';
  if (!normalized) {
    publishState.categoryMatches = [];
    publishState.categorySearchLoading = false;
    updatePublishCategoryResultSelect();
    return;
  }
  publishState.categorySearchLoading = true;
  updatePublishCategoryResultSelect();
  try {
    const response = await fetch(`/api/publish/categories?q=${encodeURIComponent(normalized)}&limit=40`);
    const payload = await response.json();
    if (requestId !== publishState.categorySearchRequestId || productId !== publishState.activeId) return;
    if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    publishState.categoryMatches = Array.isArray(payload.categories) ? payload.categories : [];
  } catch (error) {
    if (requestId !== publishState.categorySearchRequestId || productId !== publishState.activeId) return;
    publishState.categoryMatches = [];
    publishState.categorySearchError = `类目搜索失败：${error.message}`;
  } finally {
    if (requestId === publishState.categorySearchRequestId && productId === publishState.activeId) {
      publishState.categorySearchLoading = false;
      updatePublishCategoryResultSelect();
    }
  }
}

/**
 * 更新同一类目控件内的搜索结果，保留当前选择和搜索框焦点。
 *
 * @returns {void} 仅更新结果列表并绑定选择按钮，不重绘整个编辑器。
 * @throws {Error} 不主动抛出异常；编辑器尚未渲染时直接返回。
 */
function updatePublishCategoryResultSelect() {
  const list = $('#publishCategoryResults');
  const product = publishState.products.find(item => item.id === publishState.activeId);
  if (!list || !product) return;
  const matches = publishState.categoryMatches.filter(category => Number(category.id) !== Number(product.categoryId));
  const options = [{ id: product.categoryId, path: product.category }, ...matches];
  list.innerHTML = options.map(category => `<button type="button" role="option" aria-selected="${Number(category.id) === Number(product.categoryId)}" data-publish-category-option="${esc(category.id)}"><span>${esc(category.path || category.name)}</span>${Number(category.id) === Number(product.categoryId) ? '<i class="ri-check-line" aria-hidden="true"></i>' : ''}</button>`).join('');
  $('#publishCategorySearchStatus').textContent = publishState.categorySearchLoading ? '正在搜索…'
    : publishState.categorySearchError || ($('#publishCategorySearch')?.value && !matches.length ? '没有其他匹配类目，可保留当前选择' : '');
  $$('[data-publish-category-option]').forEach(button => {
    button.onclick = () => {
      const picker = $('.publish-category-picker');
      picker.open = false;
      const id = Number(button.dataset.publishCategoryOption);
      if (id !== Number(product.categoryId)) applyLivePublishCategory(product, id);
      else picker.querySelector('summary').focus();
    };
  });
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
 * @throws {Error} 类目键不存在时退回特定产品配置，不主动抛出异常。
 */
function defaultPublishAttributes(categoryKey) {
  const config = PUBLISH_CATEGORY_CONFIG[categoryKey] || PUBLISH_CATEGORY_CONFIG.unselected;
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
  const fields = (PUBLISH_CATEGORY_CONFIG[product.categoryKey] || PUBLISH_CATEGORY_CONFIG.unselected).fields
    .filter(isRequiredPublishField);
  const completed = fields.filter(field => {
    const value = product.attributes?.[field.key];
    return Array.isArray(value) ? value.length > 0 : Boolean(String(value || '').trim());
  }).length;
  return { completed, total: fields.length };
}

/**
 * 生成一条本地产品草稿。统一入口让从零创建和参考商品保持相同字段结构。
 *
 * @param {object} overrides - 需要覆盖的商品标题、图片、完整度、状态；blank=true 时不注入演示内容。
 * @returns {object} 可直接进入批量矩阵和右侧编辑器的本地草稿。
 * @throws {Error} 本函数只组合普通对象，不主动抛出异常。
 */
function createPublishProduct(overrides = {}) {
  const categoryKey = overrides.categoryKey || 'unselected';
  const categoryConfig = PUBLISH_CATEGORY_CONFIG[categoryKey] || PUBLISH_CATEGORY_CONFIG.unselected;
  const blank = overrides.blank === true;
  const emptyAttributes = Object.fromEntries(categoryConfig.fields.map(field => [
    field.key,
    field.control === 'multi' ? [] : '',
  ]));
  const attributes = {
    ...(blank ? emptyAttributes : defaultPublishAttributes(categoryKey)),
    ...(overrides.attributes || {}),
  };
  // 兼容文件夹导入的逐步补全逻辑；被清空的是该类目最后几个必填字段。
  if (Number.isInteger(overrides.requiredCompleted)) {
    categoryConfig.fields.slice(Math.max(0, overrides.requiredCompleted)).forEach(field => {
      attributes[field.key] = field.control === 'multi' ? [] : '';
    });
  }
  const base = {
    id: `publish-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: blank ? '' : 'Untitled Product',
    categoryKey,
    categoryId: categoryConfig.categoryId,
    category: categoryConfig.label,
    image: '',
    // 新建草稿绝不能继承开发账号的演示图。参考商品和文件夹导入必须显式提供图片，
    // 浏览器 blob: 预览仍会在真实提交前被图片上传校验拦截。
    gallery: [],
    imageCount: 0,
    requiredCompleted: categoryConfig.fields.length,
    requiredTotal: categoryConfig.fields.length,
    tradeReady: true,
    logisticsReady: true,
    status: 'ready',
    selected: true,
    schemaLoading: false,
    uploads: [],
    referenceImported: false,
    keywords: [],
    attributes,
    saleType: 'normal',
    batchNum: 1,
    moq: '',
    inventory: '',
    priceUnit: '件 / 个',
    priceUnitId: null,
    priceTiers: [{ minQuantity: '', unitPrice: '' }],
    skus: [window.LsouPublishUtils.createEmptyPublishSku()],
    leadTimeTiers: [{ maxQuantity: '', days: '' }],
    package: { length: '', width: '', height: '', weight: '' },
    logisticsProperty: [],
    shippingTemplate: '使用国际站默认运费设置',
    shippingTemplateId: null,
    sellingPoints: ['', '', '', '', ''],
    detail: window.LsouPublishUtils.createPublishDetail(),
  };
  const result = { ...base, ...overrides, categoryKey, categoryId: categoryConfig.categoryId, category: categoryConfig.label, attributes };
  const progress = publishAttributeProgress(result);
  result.requiredCompleted = progress.completed;
  result.requiredTotal = progress.total;
  return result;
}

const PUBLISH_IMAGE_LIMIT = window.LsouPublishUtils.MAX_PRODUCT_IMAGES;

const publishState = {
  removedProducts: [], // 仅本页保留删除历史，供用户撤销；不调用平台删除接口。
  removalNoticeTimer: null,
  // 工作区初始为空：当前账号已有商品只进入参考库，绝不能自动变成待发布任务。
  products: [],
  activeId: '',
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
  categorySearchRequestId: 0,
  categorySearchError: '',
  businessOptions: {
    priceUnits: [],
    shippingTemplates: [],
    defaultPriceUnit: null,
    defaultShippingTemplate: null,
    shippingFallbackLabel: '使用国际站默认运费设置',
  },
  businessOptionsLoaded: false,
  sourceRefreshing: false,
  sourceCache: null,
  sourceRefreshError: '',
  businessOptionsLoading: false,
  businessOptionsError: '',
  accountContextLoading: false,
  accountContextLoaded: false,
  accountContextError: '',
  accountCategories: [],
  accountProducts: [],
  imageLibrary: {
    status: 'idle',
    totalProducts: 0,
    processedProducts: 0,
    availableProducts: 0,
    failedProducts: 0,
    imageCount: 0,
    progress: 0,
  },
  imageLibraryPoller: null,
  defaultCategoryKey: '',
  creationOpen: false,
  creationMode: '',
  creationTitle: '',
  creationCategoryId: '',
  creationReferenceQuery: '',
  creationReferenceKey: '',
  creationReferenceImages: { primary: [], sku: [], detail: [] },
  creationReferenceImagesLoading: false,
  creationReferenceImagesError: '',
  creationSelectedImages: [],
  creationLoading: false,
  creationError: '',
  uploadCapability: { loaded: false, configured: false, maxBytes: 8 * 1024 * 1024 },
  referenceImportOpen: false,
  referenceImportLoading: false,
  referenceImportValue: '',
  referenceImportError: '',
  // 原生拖拽期间记录起始位置；drop 后立即清空，不写入商品或服务端。
  imageDragIndex: null,
  imageDragTargetIndex: null,
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
    Number.isSafeInteger(Number(product.priceUnitId)) && Number(product.priceUnitId) > 0 && priceTiersValid &&
    Array.isArray(product.skus) && product.skus.length > 0 && product.skus.every(sku =>
      sku.skuAttributes?.length > 0 && sku.skuAttributes.every(attr => attr.attrName?.trim() && attr.attrValue?.trim()) &&
      (sku.unitPrice === null || sku.unitPrice === '' || Number(sku.unitPrice) > 0) &&
      ((sku.stock === null || sku.stock === '') ? product.skus.length === 1 : Number.isInteger(Number(sku.stock)) && Number(sku.stock) >= 0));

  // 包装长宽高必须成组填写；交期必须是数量与天数组成的阶梯数组。物流模板
  // 本身不是底层发布素材的必填项：有店铺方案时服务端自动回填，没有时
  // 由国际站使用账号默认设置，因此不能再把内部模板 ID 当成用户完成度。
  const packageValues = ['length', 'width', 'height'].map(key => Number(product.package?.[key]));
  const packageValid = packageValues.every(value => Number.isFinite(value) && value > 0) && Number(product.package?.weight) > 0;
  const leadTimeValid = Array.isArray(product.leadTimeTiers) && product.leadTimeTiers.length > 0 &&
    product.leadTimeTiers.every(tier => Number.isInteger(tier.maxQuantity) && tier.maxQuantity >= 1 && Number.isInteger(tier.days) && tier.days >= 1);
  product.logisticsReady = leadTimeValid && packageValid;

  const complete = product.title.trim() && product.imageCount >= 5 && product.imageCount <= PUBLISH_IMAGE_LIMIT &&
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
  if (publishState.businessOptionsLoading || publishState.businessOptionsLoaded) return;
  publishState.businessOptionsLoading = true;
  publishState.businessOptionsError = '';
  renderProductPublish();
  try {
    const response = await fetch('/api/publish/business-options');
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    publishState.businessOptions = payload.options || publishState.businessOptions;
    publishState.businessOptionsLoaded = true;
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
 * 读取服务端是否已取得当前 Accio 图片上传会话。
 *
 * 浏览器只需要知道上传入口是否就绪和单图大小限制；网关地址与登录凭据
 * 永远不会进入前端。读取失败时禁止真实上传，避免把 blob: 误当远程图片。
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
      error: payload.error || '',
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
 * 中，否则清空等待用户选择。这样既能保住“产地”等通用字段，也不会把特定产品
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
 * 将服务端历史图库状态收敛为前端始终可渲染的数字结构。
 *
 * @param {*} value - `/api/publish/image-library/status` 返回的 library 字段。
 * @returns {object} 已补齐默认值的同步状态。
 * @throws {Error} 不主动抛出异常，未知字段会被忽略。
 */
function normalizePublishImageLibraryStatus(value) {
  const allowedStatuses = new Set(['idle', 'syncing', 'ready', 'partial', 'failed']);
  return {
    status: allowedStatuses.has(value?.status) ? value.status : 'idle',
    totalProducts: Math.max(0, Number(value?.totalProducts) || 0),
    processedProducts: Math.max(0, Number(value?.processedProducts) || 0),
    availableProducts: Math.max(0, Number(value?.availableProducts) || 0),
    refreshedProducts: Math.max(0, Number(value?.refreshedProducts) || 0),
    failedProducts: Math.max(0, Number(value?.failedProducts) || 0),
    imageCount: Math.max(0, Number(value?.imageCount) || 0),
    progress: Math.max(0, Math.min(100, Number(value?.progress) || 0)),
    loadedFromDisk: value?.loadedFromDisk === true,
    message: String(value?.message || ''),
  };
}

/**
 * 读取全店历史图库后台同步进度，并在同步期间自动轮询。
 *
 * 轮询只读取汇总数字，不传输图片列表；任务进入 ready、partial 或 failed 后立即停止，
 * 避免页面长期产生无意义请求。
 *
 * @returns {Promise<void>} 状态写入 publishState 后刷新创建面板。
 * @throws {Error} 网络错误被转换为 failed 状态，不继续向外抛出。
 */
async function refreshPublishImageLibraryStatus() {
  if (publishState.imageLibraryPoller) {
    clearTimeout(publishState.imageLibraryPoller);
    publishState.imageLibraryPoller = null;
  }
  try {
    const response = await fetch('/api/publish/image-library/status');
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    publishState.imageLibrary = normalizePublishImageLibraryStatus(payload.library);
  } catch (error) {
    publishState.imageLibrary = {
      ...publishState.imageLibrary,
      status: 'failed',
      message: String(error?.message || error || '历史图库状态读取失败'),
    };
  }
  renderPublishCreatePanel();
  if (['idle', 'syncing'].includes(publishState.imageLibrary.status)) {
    publishState.imageLibraryPoller = setTimeout(refreshPublishImageLibraryStatus, 1500);
  }
}

/**
 * 把单件历史商品的三类图片转成可选择的扁平数组，并保持主副图优先。
 *
 * @returns {{url:string,type:string,label:string}[]} 已按 URL 去重的图片候选。
 * @throws {Error} 不主动抛出异常。
 */
function publishReferenceImageCandidates() {
  const groups = [
    ['primary', '主副图'],
    ['sku', '规格图'],
    ['detail', '商详图'],
  ];
  const seen = new Set();
  const candidates = [];
  groups.forEach(([type, label]) => {
    const values = Array.isArray(publishState.creationReferenceImages?.[type])
      ? publishState.creationReferenceImages[type] : [];
    values.forEach(url => {
      if (!isRemotePublishImage(url) || seen.has(url)) return;
      seen.add(url);
      candidates.push({ url, type, label });
    });
  });
  return candidates;
}

/**
 * 用户选择店铺已有商品后，立即从服务端持久缓存读取其完整图库。
 *
 * 后台尚未同步到该商品时，服务端会优先补齐这一件；浏览器始终只提交随机
 * referenceKey，不接触商品 ID。
 *
 * @param {string} referenceKey - 当前账号商品对应的短期随机令牌。
 * @returns {Promise<void>} 图片载入后默认选中最多六张主副图并刷新创建面板。
 * @throws {Error} 网络或 WorkCTL 错误会显示在图片选择区域，不继续向外抛出。
 */
async function loadPublishReferenceImages(referenceKey) {
  publishState.creationReferenceImagesLoading = true;
  publishState.creationReferenceImagesError = '';
  publishState.creationReferenceImages = { primary: [], sku: [], detail: [] };
  publishState.creationSelectedImages = [];
  renderPublishCreatePanel();
  try {
    const response = await fetch('/api/publish/account-images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ referenceKey }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    // 用户可能在请求期间切换了参考商品；旧响应不能覆盖新选择。
    if (publishState.creationReferenceKey !== referenceKey) return;
    publishState.creationReferenceImages = {
      primary: [...new Set((payload.images?.primary || []).filter(isRemotePublishImage))],
      sku: [...new Set((payload.images?.sku || []).filter(isRemotePublishImage))],
      detail: [...new Set((payload.images?.detail || []).filter(isRemotePublishImage))],
    };
    const accountProduct = publishState.accountProducts.find(product => product.referenceKey === referenceKey);
    if (accountProduct) accountProduct.imageCount = Number(payload.images?.total) ||
      publishReferenceImageCandidates().length;
    publishState.creationSelectedImages = publishState.creationReferenceImages.primary.slice(0, PUBLISH_IMAGE_LIMIT);
  } catch (error) {
    if (publishState.creationReferenceKey === referenceKey) {
      publishState.creationReferenceImagesError = String(error?.message || error || '历史图片读取失败');
    }
  } finally {
    if (publishState.creationReferenceKey === referenceKey) {
      publishState.creationReferenceImagesLoading = false;
      renderPublishCreatePanel();
    }
  }
}

/**
 * 按“当前账号商品 -> categoryId -> 类目属性 -> 官方选项”的顺序初始化发品参考库。
 *
 * categoryId 始终只是系统内部关联键：页面不会要求运营人员查看或填写。账号已有
 * 商品仅供“从现有商品参考”时主动选择，不会在页面初始化时自动创建发布任务。
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
    await applyPublishSourceContext(payload.context);
  } catch (error) {
    publishState.accountContextError = String(error?.message || error || '自动匹配失败');
    toast(`当前账号类目暂未匹配：${publishState.accountContextError}`, true);
  } finally {
    publishState.accountContextLoading = false;
    renderProductPublish();
  }
}

/**
 * 将只读资料加载到参考库，不重新创建或覆盖待发布商品。
 * @param {object} context 当前账号商品、类目、缓存时间和图库状态。
 * @returns {Promise<void>} 默认类目可用后更新参考库。
 * @throws {Error} 缺少有效类目或读取规则失败时抛出，调用方显示错误。
 */
async function applyPublishSourceContext(context) {
  const defaultCategoryId = Number(context?.defaultCategory?.categoryId);
  if (!Number.isSafeInteger(defaultCategoryId) || defaultCategoryId <= 0) throw new Error('当前账号没有可用于自动匹配的商品类目');
  const defaultCategoryKey = await ensureLivePublishCategory(defaultCategoryId);
  publishState.accountCategories = Array.isArray(context.categories) ? context.categories : [];
  publishState.accountProducts = Array.isArray(context.products) ? context.products : [];
  publishState.imageLibrary = normalizePublishImageLibraryStatus(context.imageLibrary);
  publishState.sourceCache = context.cache || { fetchedAt: context.fetchedAt };
  publishState.defaultCategoryKey = defaultCategoryKey;
  if (!publishState.creationCategoryId) publishState.creationCategoryId = String(defaultCategoryId);
  publishState.accountContextLoaded = true;
  refreshPublishImageLibraryStatus();
}

/**
 * 用户主动更新发布参考资料；保留正在编辑的商品、价格、规格、选中项和队列。
 * @returns {Promise<void>} 更新缓存提示和参考库；失败仍展示已有页面资料。
 * @throws {Error} 网络/平台错误内部显示，不向外抛出。
 */
async function refreshPublishSourceData() {
  if (publishState.sourceRefreshing || publishState.accountContextLoading || publishState.businessOptionsLoading ||
      publishState.creationLoading || publishState.creationReferenceImagesLoading ||
      publishState.products.some(product => product.schemaLoading || isPublishProductBusy(product))) return;
  publishState.sourceRefreshing = true;
  publishState.sourceRefreshError = '';
  renderPublishCacheStatus();
  try {
    const response = await fetch('/api/publish/cache/refresh', { method: 'POST' });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    // 保留旧字段定义供按属性编码迁移已填值；新的选品会按需取得更新后的规则。
    Object.values(PUBLISH_CATEGORY_CONFIG).forEach(config => { config.needsRefresh = true; });
    await applyPublishSourceContext(payload.context);
    // 编辑中的其他类目也更新字段定义，避免提交时才发现页面仍显示旧选项。
    await Promise.all([...new Set(publishState.products.map(product => Number(product.categoryId)))]
      .filter(categoryId => Number.isSafeInteger(categoryId) && categoryId > 0)
      .map(categoryId => ensureLivePublishCategory(categoryId)));
    publishState.businessOptions = payload.options;
    publishState.businessOptionsLoaded = true;
    publishState.businessOptionsError = '';
    publishState.accountContextError = '';
    publishState.creationReferenceKey = '';
    publishState.creationReferenceImages = { primary: [], sku: [], detail: [] };
    publishState.creationSelectedImages = [];
    toast('店铺资料已更新，已填写的商品保留');
  } catch (error) {
    publishState.sourceRefreshError = String(error?.message || error || '更新失败');
    toast(`更新未完成：${publishState.sourceRefreshError}`, true);
  } finally {
    publishState.sourceRefreshing = false;
    renderProductPublish();
  }
}

/** 无参数；返回 void，仅在刷新或读取失败时显示状态，正常缓存时间放在操作栏提示中；缺少节点不抛错。 */
function renderPublishCacheStatus() {
  const label = $('#publishCacheStatus');
  if (!label) return;
  const cache = publishState.sourceCache;
  const time = cache?.fetchedAt ? new Date(cache.fetchedAt).toLocaleString('zh-CN', { hour12: false }) : '';
  label.textContent = publishState.sourceRefreshing ? '正在更新店铺资料，已填写的商品会保留…'
    : publishState.sourceRefreshError ? `更新未完成，仍可使用已加载资料：${publishState.sourceRefreshError}`
    : cache ? `${cache.savedLocally ? '店铺资料已本地缓存' : '店铺资料已加载'}${time ? ` · 更新于 ${time}` : ''}`
    : publishState.accountContextError ? '店铺资料暂不可用，可点击右上角“刷新数据”重试' : '首次读取后自动保存到本地';
  label.hidden = !publishState.sourceRefreshing && !publishState.sourceRefreshError && !publishState.accountContextError;
  $('.publish-top-bar')?.setAttribute('title', label.textContent);
}

/**
 * 初始化产品发布页面，读取参考资料、上传能力和已有发布任务。
 *
 * @returns {void} 首次进入页面时渲染全部本地草稿。
 * @throws {Error} 页面结构缺失时可能抛出 DOM 访问异常。
 */
function initProductPublish() {
  renderProductPublish();
  // 账号级计价单位与物流方案和类目 Schema 相互独立，可以并行加载。
  // 两者都只读，用户无需等待或手工填写平台内部编码。
  loadPublishBusinessOptions();
  loadPublishUploadCapability();
  // 先从当前账号商品读取类目，再使用内部 categoryId 加载字段和固定选项。
  // 这是发品编辑器的初始化主链路，不再以写死的特定产品类目作为真实依据。
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
 * @returns {void} 完成表格、编辑器、队列和底部操作栏的同步渲染。
 * @throws {Error} 页面关键容器缺失时可能抛出 DOM 访问异常。
 */
function renderProductPublish() {
  renderPublishCacheStatus();
  renderPublishCreatePanel();
  renderPublishTable();
  renderPublishEditor();
  renderPublishQueue();
  renderPublishOperationProgress();
  renderPublishBottomBar();
}

/**
 * 打开左侧“发布新产品”创建流程，并清空上一次未完成的临时选择。
 *
 * @param {'blank'|'reference'|''} [mode=''] - 可选的初始创建方式；空字符串表示先展示方式选择。
 * @returns {void} 更新创建状态并重绘产品发布工作区。
 * @throws {Error} 不主动抛出异常。
 */
function openPublishCreation(mode = '') {
  hidePublishRemovalNotice();
  publishState.creationOpen = true;
  publishState.creationMode = mode;
  publishState.creationTitle = '';
  publishState.creationReferenceQuery = '';
  publishState.creationReferenceKey = '';
  publishState.creationReferenceImages = { primary: [], sku: [], detail: [] };
  publishState.creationReferenceImagesLoading = false;
  publishState.creationReferenceImagesError = '';
  publishState.creationSelectedImages = [];
  publishState.creationError = '';
  const defaultCategoryId = publishState.accountCategories[0]?.categoryId;
  publishState.creationCategoryId = String(defaultCategoryId || publishState.creationCategoryId || '');
  renderProductPublish();
  $('#publishCreatePanel input:not([type="radio"])')?.focus();
}

/**
 * 关闭创建流程并返回待发布列表。已有草稿不会被修改或删除。
 *
 * @returns {void} 重置创建流程的瞬时状态并重绘页面。
 * @throws {Error} 不主动抛出异常。
 */
function closePublishCreation() {
  publishState.creationOpen = false;
  publishState.creationMode = '';
  publishState.creationLoading = false;
  publishState.creationError = '';
  publishState.creationReferenceImages = { primary: [], sku: [], detail: [] };
  publishState.creationReferenceImagesLoading = false;
  publishState.creationReferenceImagesError = '';
  publishState.creationSelectedImages = [];
  renderProductPublish();
}

/**
 * 返回参考库中符合当前搜索词的已有商品。搜索只匹配用户可见的标题与类目名称。
 *
 * @returns {object[]} 最多二十条脱敏参考商品，页面不会取得或展示商品 ID。
 * @throws {Error} 不主动抛出异常。
 */
function visiblePublishReferenceProducts() {
  const query = String(publishState.creationReferenceQuery || '').trim().toLowerCase();
  return publishState.accountProducts.filter(product => !query ||
    `${product.title || ''} ${product.categoryName || ''} ${product.categoryPath || ''}`
      .toLowerCase().includes(query)).slice(0, 20);
}

/**
 * 渲染左侧创建流程。空工作区先解释用途，再让用户明确选择从零创建或参考已有商品。
 *
 * @returns {void} 更新创建面板和待发布表格的显示状态，并绑定本轮动态控件。
 * @throws {Error} 页面关键容器缺失时可能抛出 DOM 访问异常。
 */
function renderPublishCreatePanel() {
  const panel = $('#publishCreatePanel');
  const header = $('#publishCreateHeader');
  const tableWorkspace = $('#publishTableWorkspace');
  if (!panel || !tableWorkspace) return;

  // 标题固定在左卡片顶部，参考商品与旧图共用下方滚动区域。
  header.hidden = !publishState.creationOpen;
  const scrollTop = panel.scrollTop;
  const showWelcome = !publishState.products.length && !publishState.creationOpen;
  if (!showWelcome && !publishState.creationOpen) {
    panel.hidden = true;
    tableWorkspace.hidden = false;
    return;
  }

  panel.hidden = false;
  tableWorkspace.hidden = true;
  if (showWelcome) {
    panel.innerHTML = `<div class="publish-empty-workspace">
      <span class="publish-empty-icon"><i class="ri-box-3-line" aria-hidden="true"></i></span>
      <div><small>待发布工作区</small><h2>还没有准备发布的商品</h2><p>这里仅显示你主动创建的商品。店铺已有商品不会自动加入，也不会产生发布操作。</p></div>
      <button type="button" class="primary" id="publishEmptyCreate"><i class="ri-add-line" aria-hidden="true"></i>发布新产品</button>
      <ol aria-label="产品发布步骤"><li><b>1</b><span>选择创建方式</span></li><li><b>2</b><span>填写并校对资料</span></li><li><b>3</b><span>排队保存或发布</span></li></ol>
    </div>`;
    $('#publishEmptyCreate').onclick = () => openPublishCreation();
    return;
  }

  const categoryOptions = publishState.accountCategories.map(category =>
    `<option value="${esc(category.categoryId)}" ${String(category.categoryId) === String(publishState.creationCategoryId) ? 'selected' : ''}>${esc(category.name)}${Number(category.productCount) > 0 ? ` · 店铺已有 ${esc(category.productCount)} 件` : ''}</option>`).join('');
  const referenceProducts = visiblePublishReferenceProducts();
  const referenceImageCandidates = publishReferenceImageCandidates();
  const selectedReferenceImages = new Set(publishState.creationSelectedImages);
  const referenceImagePicker = publishState.creationReferenceKey
    ? `<section class="publish-reference-image-picker">
        <div class="publish-reference-image-head"><span><b>选择这次要复用的旧图</b><small>最多选择 ${PUBLISH_IMAGE_LIMIT} 张，第一张将作为封面</small></span><em>${esc(selectedReferenceImages.size)}/${PUBLISH_IMAGE_LIMIT}</em></div>
        ${publishState.creationReferenceImagesLoading
          ? '<div class="publish-reference-image-empty"><i class="ri-loader-4-line" aria-hidden="true"></i>正在读取这件商品的完整图库…</div>'
          : publishState.creationReferenceImagesError
            ? `<div class="publish-reference-image-empty is-error"><i class="ri-error-warning-line" aria-hidden="true"></i>${esc(publishState.creationReferenceImagesError)}</div>`
            : referenceImageCandidates.length
              ? `<div class="publish-reference-image-grid">${referenceImageCandidates.map((item, index) => {
                  const selected = selectedReferenceImages.has(item.url);
                  return `<button type="button" class="${selected ? 'selected' : ''}" data-publish-reference-image="${index}" aria-pressed="${selected}" aria-label="${selected ? '取消选择' : '选择'}${esc(item.label)}"><img src="${esc(item.url)}" alt="" referrerpolicy="no-referrer"><span>${esc(item.label)}</span><i class="${selected ? 'ri-checkbox-circle-fill' : 'ri-add-circle-line'}" aria-hidden="true"></i></button>`;
                }).join('')}</div>`
              : '<div class="publish-reference-image-empty"><i class="ri-image-line" aria-hidden="true"></i>这件商品没有返回可复用的历史图片</div>'}
        <div class="publish-create-actions"><button type="button" class="primary" id="publishCreateReferenceConfirm" ${publishState.creationLoading || publishState.creationReferenceImagesLoading ? 'disabled' : ''}>${publishState.creationLoading ? '正在读取参考商品…' : '使用所选商品创建'}</button></div>
      </section>`
    : '';
  const accountStatus = publishState.accountContextLoading
    ? '<p class="publish-create-status"><i class="ri-loader-4-line" aria-hidden="true"></i>正在读取当前店铺的类目与商品…</p>'
    : publishState.accountContextError
      ? `<p class="publish-create-status is-error"><i class="ri-error-warning-line" aria-hidden="true"></i>${esc(publishState.accountContextError)}</p>`
      : '';
  const modeBody = publishState.creationMode === 'blank'
    ? `<div class="publish-create-form">
        <label><span>商品标题 <small>可以先留空，进入右侧后继续填写</small></span><input id="publishCreateTitle" type="text" maxlength="128" value="${esc(publishState.creationTitle)}" placeholder="输入当前产品名称"></label>
        <label><span>商品类目 <small>只显示业务名称，系统自动处理类目编号</small></span><select id="publishCreateCategory" ${publishState.accountContextLoaded ? '' : 'disabled'}>${categoryOptions || '<option>正在读取店铺类目…</option>'}</select></label>
        <div class="publish-create-actions"><button type="button" id="publishCreateBack">返回选择方式</button><button type="button" class="primary" id="publishCreateBlankConfirm" ${publishState.accountContextLoaded && !publishState.creationLoading ? '' : 'disabled'}>${publishState.creationLoading ? '正在创建…' : '创建并填写资料'}</button></div>
      </div>`
    : publishState.creationMode === 'reference'
      ? `<div class="publish-reference-library">
          <label class="publish-reference-search"><i class="ri-search-line" aria-hidden="true"></i><input id="publishReferenceSearch" type="search" value="${esc(publishState.creationReferenceQuery)}" placeholder="搜索店铺已有商品标题或类目" aria-label="搜索店铺已有商品"></label>
          <div class="publish-reference-results" role="group" aria-label="店铺已有商品">
            ${referenceProducts.length ? referenceProducts.map(product => {
              const selected = product.referenceKey === publishState.creationReferenceKey;
              return `<button type="button" class="publish-reference-row ${selected ? 'selected' : ''}" data-publish-reference-key="${esc(product.referenceKey || '')}" aria-pressed="${selected}" ${product.referenceKey ? '' : 'disabled'}>
                ${product.image ? `<img src="${esc(product.image)}" alt="" referrerpolicy="no-referrer">` : '<span class="publish-reference-placeholder"><i class="ri-image-line" aria-hidden="true"></i></span>'}
                <span><b>${esc(product.title || '店铺已有商品')}</b><small>${esc(product.categoryPath || product.categoryName || '店铺类目')}${Number(product.imageCount) > 1 ? ` · ${esc(product.imageCount)} 张历史图` : ''}</small></span>
                <i class="${selected ? 'ri-checkbox-circle-fill' : 'ri-arrow-right-s-line'}" aria-hidden="true"></i>
              </button>${selected ? referenceImagePicker : ''}`;
            }).join('') : `<div class="publish-reference-empty">${publishState.accountContextLoading ? '正在读取店铺商品…' : '没有找到匹配的店铺商品'}</div>`}
          </div>
          <p class="publish-reference-note"><i class="ri-information-line" aria-hidden="true"></i>选择后会带入标题、所选旧图、类目、参数、价格与履约资料；过期选项会按当前店铺的最新规则过滤。</p>
          <div class="publish-create-actions"><button type="button" id="publishCreateBack">返回选择方式</button></div>
        </div>`
      : `<div class="publish-create-mode-list">
          <button type="button" class="is-recommended" data-publish-create-mode="reference" ${publishState.accountContextLoaded ? '' : 'disabled'}><span class="publish-create-mode-badge">推荐</span><span class="publish-create-mode-icon"><i class="ri-file-copy-2-line" aria-hidden="true"></i></span><span class="publish-create-mode-copy"><b>参考店铺已有商品</b><small>自动带入标题、图片、类目、参数、价格与履约资料，再按店铺最新规则校对。</small><em>填写更快 · 不会修改原商品</em></span><i class="ri-arrow-right-line" aria-hidden="true"></i></button>
          <button type="button" data-publish-create-mode="blank"><span class="publish-create-mode-icon"><i class="ri-file-add-line" aria-hidden="true"></i></span><span class="publish-create-mode-copy"><b>从零创建</b><small>选择类目后，从标题、图片、属性和交易信息开始完整填写。</small><em>适合店铺里没有相似商品时使用</em></span><i class="ri-arrow-right-line" aria-hidden="true"></i></button>
        </div>`;
  header.innerHTML = `<div><small>发布新产品</small><h2>${publishState.creationMode === 'blank' ? '从零创建商品' : publishState.creationMode === 'reference' ? '选择一个参考商品' : '这次准备怎么开始？'}</h2><p>${publishState.creationMode ? '创建完成后，商品才会进入待发布列表。' : '先选择来源，系统再生成对应类目的填写表单。'}</p></div>${publishState.products.length ? '<button type="button" id="publishCreateClose"><i class="ri-close-line" aria-hidden="true"></i>返回待发布列表</button>' : ''}`;
  panel.innerHTML = `<div class="publish-create-shell">
    ${accountStatus}
    ${modeBody}
    ${publishState.creationError ? `<p class="publish-create-error" role="alert">${esc(publishState.creationError)}</p>` : ''}
  </div>`;

  if ($('#publishCreateClose')) $('#publishCreateClose').onclick = closePublishCreation;
  $$('[data-publish-create-mode]').forEach(button => {
    button.onclick = () => {
      publishState.creationMode = button.dataset.publishCreateMode;
      publishState.creationError = '';
      renderPublishCreatePanel();
      $('#publishCreatePanel input')?.focus();
    };
  });
  if ($('#publishCreateBack')) $('#publishCreateBack').onclick = () => {
    publishState.creationMode = '';
    publishState.creationError = '';
    renderPublishCreatePanel();
  };
  if ($('#publishCreateTitle')) $('#publishCreateTitle').oninput = event => {
    publishState.creationTitle = event.target.value;
  };
  if ($('#publishCreateCategory')) $('#publishCreateCategory').onchange = event => {
    publishState.creationCategoryId = event.target.value;
  };
  if ($('#publishCreateBlankConfirm')) $('#publishCreateBlankConfirm').onclick = createBlankPublishDraft;
  if ($('#publishReferenceSearch')) $('#publishReferenceSearch').oninput = event => {
    publishState.creationReferenceQuery = event.target.value;
    publishState.creationReferenceKey = '';
    publishState.creationReferenceImages = { primary: [], sku: [], detail: [] };
    publishState.creationReferenceImagesError = '';
    publishState.creationReferenceImagesLoading = false;
    publishState.creationSelectedImages = [];
    renderPublishCreatePanel();
    const input = $('#publishReferenceSearch');
    input?.focus();
    if (input) input.setSelectionRange(input.value.length, input.value.length);
  };
  $$('[data-publish-reference-key]').forEach(button => {
    button.onclick = () => {
      publishState.creationReferenceKey = button.dataset.publishReferenceKey;
      publishState.creationError = '';
      renderPublishCreatePanel();
      loadPublishReferenceImages(publishState.creationReferenceKey);
      const selectedRow = $('.publish-reference-row.selected');
      if (selectedRow) panel.scrollTop += selectedRow.getBoundingClientRect().top - panel.getBoundingClientRect().top - 8;
    };
  });
  $$('[data-publish-reference-image]').forEach(button => {
    button.onclick = () => {
      const candidate = publishReferenceImageCandidates()[Number(button.dataset.publishReferenceImage)];
      if (!candidate) return;
      const selected = publishState.creationSelectedImages.includes(candidate.url);
      if (selected) {
        publishState.creationSelectedImages = publishState.creationSelectedImages.filter(url => url !== candidate.url);
      } else if (publishState.creationSelectedImages.length >= PUBLISH_IMAGE_LIMIT) {
        toast(`商品主图最多选择 ${PUBLISH_IMAGE_LIMIT} 张`, true);
        return;
      } else {
        publishState.creationSelectedImages.push(candidate.url);
      }
      renderPublishCreatePanel();
    };
  });
  if ($('#publishCreateReferenceConfirm')) $('#publishCreateReferenceConfirm').onclick = createReferencedPublishDraft;
  panel.scrollTop = scrollTop;
}

/**
 * 把新商品加入待发布工作区，并应用账号级计价单位与物流方案。
 *
 * @param {object} product - 已按实时类目 Schema 创建的本地商品草稿。
 * @param {string} successMessage - 创建完成后展示给用户的简短结果。
 * @returns {void} 新商品成为当前选中项，创建面板关闭并显示批量列表。
 * @throws {Error} 不主动抛出异常。
 */
function addPublishDraftToWorkspace(product, successMessage) {
  publishState.products.unshift(product);
  publishState.activeId = product.id;
  applyPublishBusinessOptionsToProducts(publishState.businessOptions);
  publishState.creationOpen = false;
  publishState.creationMode = '';
  publishState.creationLoading = false;
  publishState.creationError = '';
  renderProductPublish();
  toast(successMessage);
}

/**
 * 使用用户选择的业务类目创建一条真正空白的待发布商品。
 *
 * @returns {Promise<void>} 类目 Schema 加载完成后把空白草稿加入工作区。
 * @throws {Error} 网络或 Schema 错误会转成创建面板内的可恢复提示。
 */
async function createBlankPublishDraft() {
  const categoryId = Number(publishState.creationCategoryId);
  if (!Number.isSafeInteger(categoryId) || categoryId <= 0) {
    publishState.creationError = '请先选择商品类目，系统才能生成对应的填写参数。';
    renderPublishCreatePanel();
    return;
  }
  publishState.creationLoading = true;
  publishState.creationError = '';
  renderPublishCreatePanel();
  try {
    const categoryKey = await ensureLivePublishCategory(categoryId);
    const product = createPublishProduct({
      blank: true,
      categoryKey,
      title: String(publishState.creationTitle || '').trim().slice(0, 128),
      status: 'needs_attention',
      selected: true,
      categoryMatchSource: 'manual-selection',
    });
    addPublishDraftToWorkspace(product, '新商品已加入待发布列表，请在右侧继续填写资料');
  } catch (error) {
    publishState.creationLoading = false;
    publishState.creationError = `暂时无法生成这个类目的填写参数：${String(error?.message || error)}`;
    renderPublishCreatePanel();
  }
}

/**
 * 从当前账号参考库读取一件已有商品，并创建独立的新发布草稿。
 *
 * 浏览器只提交随机 referenceKey；真实商品 ID 仅在服务端短期映射中使用。这样普通
 * 用户只需按标题和图片选商品，不需要理解、复制或填写平台内部编号。
 *
 * @returns {Promise<void>} 参考内容与实时类目 Schema 都加载完成后加入待发布列表。
 * @throws {Error} 参考商品失效或 WorkCTL 查询失败会显示在创建面板内。
 */
async function createReferencedPublishDraft() {
  const referenceKey = String(publishState.creationReferenceKey || '');
  const accountProduct = publishState.accountProducts.find(product => product.referenceKey === referenceKey);
  if (!referenceKey || !accountProduct) {
    publishState.creationError = '请先选择一个店铺已有商品作为参考。';
    renderPublishCreatePanel();
    return;
  }
  publishState.creationLoading = true;
  publishState.creationError = '';
  renderPublishCreatePanel();
  try {
    const response = await fetch('/api/publish/account-reference', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ referenceKey }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    const template = payload.reference || {};
    const categoryId = Number(template.categoryId || accountProduct.categoryId);
    const categoryKey = await ensureLivePublishCategory(categoryId);
    const categoryConfig = PUBLISH_CATEGORY_CONFIG[categoryKey];
    // 参考商品不是“空白创建”：标题、图片、平台属性、价格和履约信息都来自同一件
    // 现有商品。固定选项仍由辅助函数对照当前实时 Schema 过滤，避免复制过期枚举。
    const referenceFields = window.LsouPublishUtils.mapReferenceProductToDraft(template, categoryConfig, {
      fallbackTitle: accountProduct.title,
      fallbackImage: accountProduct.image,
      selectedImages: publishState.creationSelectedImages,
    });
    const product = createPublishProduct({
      blank: true,
      categoryKey,
      ...referenceFields,
      status: 'needs_attention',
      selected: true,
      referenceImported: true,
      categoryMatchSource: 'reference-product',
    });
    addPublishDraftToWorkspace(product, '参考商品已带入，原商品不会被修改');
  } catch (error) {
    publishState.creationLoading = false;
    publishState.creationError = `参考商品读取失败：${String(error?.message || error)}`;
    renderPublishCreatePanel();
  }
}

/**
 * 复制待发布列表中的一件商品，生成参数完全独立的新草稿。
 *
 * @param {string} productId - 当前页面本地商品 ID，不是国际站商品号。
 * @returns {void} 新草稿加入列表并成为右侧当前编辑商品。
 * @throws {Error} 深拷贝异常会被捕获并转换为页面提示。
 */
function duplicatePublishProduct(productId) {
  const source = publishState.products.find(product => product.id === productId);
  if (!source) {
    toast('没有找到需要复制的商品', true);
    return;
  }
  const blockedReason = window.LsouPublishUtils.publishCopyBlockedReason(source);
  if (blockedReason) {
    toast(blockedReason, true);
    return;
  }
  try {
    const newId = `publish-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const clone = window.LsouPublishUtils.clonePublishProductDraft(source, newId);
    addPublishDraftToWorkspace(clone, '同类商品已复制，请修改标题、图片或参数后再发布');
  } catch (error) {
    toast(`复制同类失败：${String(error?.message || error)}`, true);
  }
}

/**
 * 判断本地商品是否仍有在途操作，避免移除后让用户误以为发布已取消。
 * @param {object} product - 待发布商品。
 * @returns {boolean} 正在排队、提交或上传图片时为 true。
 * @throws {Error} 不主动抛出异常。
 */
function isPublishProductBusy(product) {
  return publishState.queue.some(job => job.localId === product.id && ['queued', 'running'].includes(job.status)) ||
    (product.uploads || []).some(upload => ['reading', 'uploading'].includes(upload.status));
}

/**
 * 从本地待发布列表移除商品，并保留原对象和位置用于撤销。
 * 不撤销发布队列、不删除店铺商品，也不释放可能由副本共享的图片预览。
 * @param {string} productId - 页面中的本地商品标识。
 * @returns {void} 同步列表、编辑器与已选数量；在途商品只显示提示。
 * @throws {Error} 不主动抛出异常。
 */
function removePublishProduct(productId) {
  const index = publishState.products.findIndex(product => product.id === productId);
  if (index < 0) return;
  const product = publishState.products[index];
  if (isPublishProductBusy(product)) {
    toast('该商品正在上传或提交，请处理完成后再删除', true);
    return;
  }
  publishState.removedProducts.push({ product, index });
  publishState.products.splice(index, 1);
  if (publishState.activeId === productId) {
    const visible = visiblePublishProducts();
    publishState.activeId = visible[Math.min(index, visible.length - 1)]?.id || '';
  }
  // 提示只属于刚刚发生的删除操作；保留撤销栈，但不让提示永久占据工作区。
  hidePublishRemovalNotice();
  publishState.removalNoticeTimer = setTimeout(hidePublishRemovalNotice, 8000);
  renderProductPublish();
  $('#publishUndoRemove').focus();
}

/**
 * 收起临时删除提示，不清除本页的撤销数据。
 * @returns {void} 取消计时器并隐藏提示条。
 * @throws {Error} 不主动抛出异常。
 */
function hidePublishRemovalNotice() {
  clearTimeout(publishState.removalNoticeTimer);
  publishState.removalNoticeTimer = null;
  const notice = $('#publishRemovalNotice');
  if (notice) notice.hidden = true;
}

/**
 * 恢复最近一次删除的本地商品，包括规格、图片、已选状态与编辑内容。
 * @returns {void} 恢复原位置并清除筛选，使恢复的商品可见。
 * @throws {Error} 不主动抛出异常。
 */
function undoRemovePublishProduct() {
  const removed = publishState.removedProducts.pop();
  if (!removed) return;
  if (!publishState.removedProducts.length) hidePublishRemovalNotice();
  publishState.products.splice(Math.min(removed.index, publishState.products.length), 0, removed.product);
  publishState.activeId = removed.product.id;
  publishState.creationOpen = false;
  publishState.query = ''; publishState.statusFilter = 'all';
  $('#publishSearch').value = ''; $('#publishStatusFilter').value = 'all';
  renderProductPublish();
}

/**
 * 渲染批量商品矩阵。文本始终转义，用户上传文件名不会作为 HTML 执行。
 *
 * @returns {void} 更新表格行、选择计数和全选状态。
 * @throws {Error} 不主动抛出异常。
 */
function renderPublishTable() {
  const rows = visiblePublishProducts();
  const removedCount = publishState.removedProducts.length;
  $('#publishRemovalNotice').hidden = removedCount === 0 || !publishState.removalNoticeTimer;
  $('#publishRemovedCount').textContent = `已从待发布列表删除 ${removedCount} 件商品`;
  $('#publishUndoRemove').onclick = undoRemovePublishProduct;
  const statusLabel = { ready: '可发布', needs_attention: '待补全', recognizing: '识别中' };
  $('#publishProductRows').innerHTML = rows.length ? rows.map(product => {
    publishProductStatus(product);
    const tradeClass = product.tradeReady ? 'publish-cell-ok' : 'publish-cell-warn';
    const logisticsClass = product.logisticsReady ? 'publish-cell-ok' : 'publish-cell-warn';
    const displayTitle = String(product.title || '').trim() || '未填写商品标题';
    const copyBlockedReason = window.LsouPublishUtils.publishCopyBlockedReason(product);
    return `<tr data-publish-id="${esc(product.id)}" class="${product.id === publishState.activeId ? 'active' : ''}">
      <td><input type="checkbox" data-publish-select="${esc(product.id)}" ${product.selected ? 'checked' : ''} aria-label="选择 ${esc(displayTitle)}"></td>
      <td>${product.image ? `<img class="publish-product-image" src="${esc(product.image)}" alt="${esc(displayTitle)}" loading="lazy" referrerpolicy="no-referrer">` : '<span class="publish-product-image-placeholder"><i class="ri-image-add-line" aria-hidden="true"></i></span>'}</td>
      <td><b class="publish-product-title ${product.title ? '' : 'is-empty'}">${esc(displayTitle)}</b><span class="publish-product-category">${esc(product.category)}</span></td>
      <td class="${product.imageCount >= 5 && product.imageCount <= PUBLISH_IMAGE_LIMIT ? 'publish-cell-ok' : 'publish-cell-warn'}">${product.imageCount}/${PUBLISH_IMAGE_LIMIT}</td>
      <td class="${product.requiredCompleted >= product.requiredTotal ? 'publish-cell-ok' : 'publish-cell-warn'}">${product.requiredCompleted}/${product.requiredTotal}</td>
      <td class="${tradeClass}">${product.tradeReady ? '已填写' : '待填写'}</td>
      <td class="${logisticsClass}">${product.logisticsReady ? '已填写' : '待填写'}</td>
      <td><span class="publish-row-status ${product.status}">${statusLabel[product.status]}</span></td>
      <td><div class="publish-row-actions"><button type="button" class="publish-copy-similar" data-publish-duplicate="${esc(product.id)}" title="${esc(copyBlockedReason || '复制商品资料，复用已上传图片')}" ${copyBlockedReason ? 'disabled' : ''}><i class="ri-file-copy-2-line" aria-hidden="true"></i>复制同类</button><button type="button" class="publish-remove-product" data-publish-remove="${esc(product.id)}" aria-label="删除 ${esc(displayTitle)}" title="${isPublishProductBusy(product) ? '上传或提交完成后可以删除' : '从待发布列表删除，可撤销'}" ${isPublishProductBusy(product) ? 'disabled' : ''}><i class="ri-delete-bin-line" aria-hidden="true"></i>删除</button></div></td>
    </tr>`;
  }).join('') : '<tr><td colspan="9"><div class="empty">没有符合筛选条件的商品</div></td></tr>';
  const selected = publishState.products.filter(product => product.selected).length;
  $('#publishSelectionSummary').textContent = `已选择 ${selected} 项`;
  $('#publishSelectAll').checked = rows.length > 0 && rows.every(product => product.selected);

  $$('#publishProductRows tr[data-publish-id]').forEach(row => {
    row.onclick = event => {
      if (event.target.matches('input[type="checkbox"]') || event.target.closest('[data-publish-duplicate], [data-publish-remove]')) return;
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
  $$('[data-publish-duplicate]').forEach(button => {
    button.onclick = event => {
      event.stopPropagation();
      duplicatePublishProduct(button.dataset.publishDuplicate);
    };
  });
  $$('[data-publish-remove]').forEach(button => {
    button.onclick = event => {
      event.stopPropagation();
      removePublishProduct(button.dataset.publishRemove);
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

// 仅保存当前页面的展开状态，按规格对象隔离；不写入商品 JSON，复制商品也不会共享状态。
const publishSkuEditorStates = new WeakMap();

/**
 * 判断规格字段是否实际有值；0 是有效库存，不能用真假值判断为空。
 * @param {*} value - 接口或用户输入的字段值。
 * @returns {boolean} 非 null/undefined/空白文本时为 true。
 * @throws {Error} 不主动抛出异常。
 */
function hasPublishSkuValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

/**
 * 取得规格的显示状态，已显示或用户编辑过的输入框不会因清空而突然消失。
 * @param {object} sku - 当前草稿中的规格对象。
 * @returns {{visible:Set<string>,open:boolean}} 仅用于界面的状态。
 * @throws {Error} 不主动抛出异常。
 */
function publishSkuEditorState(sku) {
  if (!publishSkuEditorStates.has(sku)) publishSkuEditorStates.set(sku, { visible: new Set(), open: false });
  const state = publishSkuEditorStates.get(sku);
  ['skuCode', 'unitPrice', 'stock'].forEach(key => { if (hasPublishSkuValue(sku[key])) state.visible.add(key); });
  return state;
}

/**
 * 渲染一项规格补充输入；隐藏只影响展示，原值和序列化逻辑保持不变。
 * @param {object} sku - 规格资料。
 * @param {number} index - 当前规格下标。
 * @param {'skuCode'|'unitPrice'|'stock'} key - 允许编辑的补充字段。
 * @param {number} count - 规格总数，用于解释单规格库存继承。
 * @returns {string} 转义后的输入框 HTML。
 * @throws {Error} 不主动抛出异常。
 */
function renderPublishSkuExtraField(sku, index, key, count) {
  const fields = {
    skuCode: ['商家规格编码', '选填', '编码', 'maxlength="120"'],
    unitPrice: ['规格单价', '留空沿用首档价格', '单价', 'type="number" min="0.01" step="any"'],
    stock: ['规格库存', count === 1 ? '留空沿用可售库存' : '正式发布前需填写', '库存', 'type="number" min="0" step="1"'],
  };
  const [label, hint, aria, attributes] = fields[key];
  return `<label class="publish-field"><span><b>${label}</b><small>${hint}</small></span><input ${attributes} data-publish-sku="${index}" data-publish-sku-field="${key}" value="${esc(sku[key] ?? '')}" aria-label="规格 ${index + 1} ${aria}"></label>`;
}

/**
 * 渲染规格；有值的输入直接显示，空的编码/价格/库存通过原生折叠区按需补充。
 * @param {object} product - 当前本地商品草稿。
 * @returns {string} 已转义的规格编辑区域 HTML。
 * @throws {Error} 不主动抛出异常。
 */
function renderPublishSkus(product) {
  const skus = Array.isArray(product.skus) ? product.skus : [];
  return `<div class="publish-structured-field publish-sku-group"><div class="publish-structure-head"><div><b><em>*</em> 商品规格</b><span>已读取的信息直接显示；空项可在“补充规格信息”中填写。</span></div><button type="button" id="publishAddSku" ${skus.length >= 100 ? 'disabled' : ''}>添加规格</button></div>
    ${!skus.length ? '<p class="publish-group-note">尚无规格资料。请添加规格，或重新读取参考商品。</p>' : ''}
    ${skus.map((sku, index) => {
      const state = publishSkuEditorState(sku);
      const keys = ['skuCode', 'unitPrice', 'stock'];
      const shown = keys.filter(key => state.visible.has(key));
      const hidden = keys.filter(key => !state.visible.has(key));
      const needsStock = !hasPublishSkuValue(sku.stock) && (skus.length > 1 || !hasPublishSkuValue(product.inventory));
      return `<div class="publish-structured-field publish-sku-card"><div class="publish-structure-head"><b>规格 ${index + 1}</b><button type="button" data-publish-sku-remove="${index}">删除规格</button></div>
      ${(sku.skuAttributes || []).map((attr, attrIndex) => `<div class="publish-form-grid publish-sku-attribute-row">
        <label class="publish-field"><span><b>规格名称</b></span><input data-publish-sku="${index}" data-publish-sku-attribute="${attrIndex}" data-publish-sku-field="attrName" value="${esc(attr.attrName)}" maxlength="120" placeholder="例如：颜色" aria-label="规格 ${index + 1} 属性 ${attrIndex + 1} 名称"></label>
        <label class="publish-field"><span><b>规格值</b></span><input data-publish-sku="${index}" data-publish-sku-attribute="${attrIndex}" data-publish-sku-field="attrValue" value="${esc(attr.attrValue)}" maxlength="160" placeholder="填写真实规格" aria-label="规格 ${index + 1} 属性 ${attrIndex + 1} 值"></label>
        <button type="button" data-sku-index="${index}" data-publish-sku-attribute-remove="${attrIndex}" ${sku.skuAttributes.length === 1 ? 'disabled' : ''} aria-label="删除规格 ${index + 1} 的属性 ${attrIndex + 1}" title="删除属性 ${attrIndex + 1}"><i class="ri-delete-bin-line" aria-hidden="true"></i></button>
      </div>`).join('')}
      <button type="button" data-publish-sku-attribute-add="${index}" ${sku.skuAttributes?.length >= 20 ? 'disabled' : ''}>添加规格属性</button>
      ${shown.length ? `<div class="publish-form-grid publish-sku-extra-fields">${shown.map(key => renderPublishSkuExtraField(sku, index, key, skus.length)).join('')}</div>` : ''}
      ${hidden.length ? `<details class="publish-sku-more" data-publish-sku-more="${index}" ${state.open ? 'open' : ''}><summary>补充规格信息${needsStock && hidden.includes('stock') ? '<small>正式发布前需填写库存</small>' : ''}</summary><div class="publish-form-grid">${hidden.map(key => renderPublishSkuExtraField(sku, index, key, skus.length)).join('')}</div></details>` : ''}
    </div>`; }).join('')}</div>`;
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
    sellingPoints: '卖点和详情', sku: '商品规格',
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
      <div><b>${job.action === 'draft' ? '这次没有保存成功' : '这次没有发布成功'}</b><p>${esc(guidance)}</p><small>${esc(window.LsouPublishUtils.publishResultDetail(job))}</small></div>
      <button type="button" id="publishFixAndRetry">修改后重新检查</button>
    </section>`;
  }
  return `<p class="publish-outcome-status">${job.status === 'saved_draft' ? '草稿已经保存' : '商品已经提交发布'}</p>${renderPublishQualityCard(job)}`;
}

/**
 * 在完成弹窗、历史明细与编辑器中统一突出显示平台质量分和完整中文扣分项。
 * @param {object} job 平台任务回执，分数缺失时显示横线，原始原因可展开核对。
 * @returns {string} 已转义的质量分卡片 HTML；不改变发布成功/失败状态。
 * @throws {Error} 不主动抛出异常。
 */
function renderPublishQualityCard(job) {
  const quality = window.LsouPublishUtils.publishQualitySummary(job);
  const originals = quality.reasons.filter(reason => reason.raw !== reason.text).map(reason => reason.raw);
  const chineseMessage = /[\u3400-\u9fff]/.test(quality.message) ? quality.message : '';
  if (quality.message && !chineseMessage) originals.push(quality.message);
  return `<section class="publish-quality-card is-${quality.tone}" aria-label="产品质量分">
    <div class="publish-quality-score"><span>产品质量分</span><div><strong>${quality.score === null ? '—' : esc(quality.score)}</strong>${quality.score === null ? '' : '<small>分</small>'}</div><b class="publish-quality-label">${esc(quality.label)}</b></div>
    <div class="publish-quality-reasons"><b>扣分原因</b>${quality.reasons.length ? `<ul>${quality.reasons.map(reason => `<li>${esc(reason.text)}</li>`).join('')}</ul>` : `<p>${esc(quality.emptyReason)}</p>`}
    ${chineseMessage ? `<p class="publish-quality-message">平台说明：${esc(chineseMessage)}</p>` : ''}
    ${originals.length ? `<details class="publish-quality-original"><summary>查看平台原始原因</summary><ul>${originals.map(raw => `<li>${esc(raw)}</li>`).join('')}</ul></details>` : ''}</div>
  </section>`;
}

/**
 * 收到新回执后只更新结果区域，保留正在输入的标题、价格和其他未保存内容。
 * @returns {void} 更新当前商品的结果卡片及失败后的补全入口。
 * @throws {Error} 不主动抛出异常；未显示编辑器时直接返回。
 */
function updatePublishOutcomeInsight() {
  const panel = $('#publishOutcomeInsight');
  const product = publishState.products.find(item => item.id === publishState.activeId);
  if (!panel || !product) return;
  const markup = renderPublishOutcomeInsight(product);
  // 相同回执不重建节点，避免轮询反复收起原始原因或打断键盘焦点。
  if (panel._publishOutcomeMarkup === markup) return;
  panel._publishOutcomeMarkup = markup;
  panel.innerHTML = markup;
  const retry = $('#publishFixAndRetry');
  if (retry) retry.onclick = () => {
    const failedJob = latestPublishOutcome(product.id);
    openPublishConfirmation({ scope: 'single', action: failedJob?.action || 'publish' });
  };
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
    return '<p class="publish-image-helper"><i class="ri-cloud-line" aria-hidden="true"></i>新选择的图片会通过 Accio 自动上传，成功后即可用于发布。</p>';
  }
  if (!publishState.uploadCapability.loaded) {
    return '<p class="publish-image-helper"><i class="ri-loader-4-line" aria-hidden="true"></i>正在检查图片上传服务…</p>';
  }
  if (!publishState.uploadCapability.configured && !uploads.length) {
    return `<p class="publish-image-helper"><i class="ri-information-line" aria-hidden="true"></i>${esc(publishState.uploadCapability.error || '图片上传尚未连接 Accio Work，请登录后重新打开工作台')}；当前参考图片可以直接使用。</p>`;
  }
  return `<div class="publish-upload-summary">
    ${active.map(item => `<span class="is-uploading"><i class="ri-loader-4-line" aria-hidden="true"></i>${esc(item.filename)} ${Math.max(1, Number(item.progress || 0))}%</span>`).join('')}
    ${uploaded.length ? `<span class="is-success"><i class="ri-checkbox-circle-line" aria-hidden="true"></i>${uploaded.length} 张已上传</span>` : ''}
    ${failed.map(item => `<span class="is-error" title="${esc(item.error || '图片上传失败')}"><i class="ri-error-warning-line" aria-hidden="true"></i>${esc(item.filename)}<button type="button" data-publish-upload-retry="${esc(item.id)}">重新上传</button></span>`).join('')}
  </div>`;
}

/**
 * 按平台图集渲染图片；取消勾选只暂停本次提交，保留原图方便恢复。
 * @param {object} product 当前本地商品。@param {string} key 商详或公司图片字段。@param {string} label 区域名称。
 * @returns {string} 已转义的图集选择器及图片区域。@throws {Error} 非法本地图集结构由共用校验报告。
 */
function renderPublishImageGroups(product, key, label) {
  const detail = product.detail, utils = window.LsouPublishUtils;
  const options = utils.publishImageSetOptions(detail, key);
  const selected = new Set(utils.selectedPublishImageSets(detail, key));
  const count = utils.selectedPublishDetailImages(detail, key).length;
  return `<div class="publish-detail-subhead"><b>${label} <small>${count} 张已选</small></b></div>
    <div class="publish-image-set-options" role="group" aria-label="${label}图集">${options.map(option => {
      const size = detail[key].filter(row => (row.imageSetId || '') === option.id).length;
      return `<label><input type="checkbox" data-publish-image-set="${key}" value="${esc(option.id)}" ${selected.has(option.id) ? 'checked' : ''}><span>${esc(option.label)}</span>${size ? `<small>${size}</small>` : ''}</label>`;
    }).join('')}</div><p class="publish-image-set-hint">勾选本次使用的图集；取消勾选会保留图片，但不随本次发布提交。</p>
    ${options.filter(option => selected.has(option.id)).map(option => {
      const rows = detail[key].map((image, index) => ({ image, index })).filter(({ image }) => (image.imageSetId || '') === option.id);
      return `<div class="publish-image-group" data-image-group="${esc(option.id)}"><div class="publish-image-group-head"><b>${esc(option.label)} <small>${rows.length} 张</small></b><button type="button" class="ghost sm" data-publish-detail-add="${key}"><i class="ri-upload-2-line" aria-hidden="true"></i>上传图片</button><input type="file" data-publish-detail-file="${key}" data-image-set="${esc(option.id)}" accept="image/jpeg,image/png,image/webp" multiple hidden></div>
      <div class="publish-detail-grid" data-publish-detail-grid="${key}" data-image-set="${esc(option.id)}" aria-label="${label} · ${esc(option.label)}排序">${rows.map(({ image, index }, position) => {
        const upload = (product.uploads || []).find(record => record.previewUrl === image.url || record.remoteUrl === image.url);
        const status = upload?.status === 'failed' ? '上传失败' : upload && upload.status !== 'uploaded' ? `上传中 ${upload.progress || 0}%` : '';
        return `<div class="publish-detail-tile" draggable="true" data-detail-index="${position}" data-source-index="${index}"><div class="publish-detail-thumb"><img src="${esc(image.url)}" alt="${label} ${index + 1}" draggable="false" loading="lazy" referrerpolicy="no-referrer"><span class="publish-detail-number">${position + 1}</span><button type="button" class="publish-detail-handle" aria-label="拖动${label} ${index + 1}" title="拖动排序"><i class="ri-drag-move-2-line" aria-hidden="true"></i></button>${status ? `<span class="publish-detail-upload ${upload.status === 'failed' ? 'is-error' : ''}">${esc(status)}</span>` : ''}</div>
        <div class="publish-detail-controls"><button type="button" data-detail-move="-1" data-index="${position}" ${position === 0 ? 'disabled' : ''} aria-label="${label} ${index + 1} 向前移动">←</button><button type="button" data-detail-move="1" data-index="${position}" ${position === rows.length - 1 ? 'disabled' : ''} aria-label="${label} ${index + 1} 向后移动">→</button><button type="button" data-detail-remove="${index}" aria-label="移除${label} ${index + 1}">删除</button></div>
        <select data-publish-image-group-move="${key}" data-index="${index}" aria-label="${label} ${index + 1} 所属图集">${options.map(target => `<option value="${esc(target.id)}" ${target.id === option.id ? 'selected' : ''}>${esc(target.label)}</option>`).join('')}</select>
        <input data-publish-detail-text="${key}" data-index="${index}" value="${esc(image.text || '')}" placeholder="图片说明（选填）" aria-label="${label} ${index + 1} 说明">${upload?.status === 'failed' ? `<button type="button" class="publish-detail-retry" data-detail-retry="${esc(upload.id)}">重试上传</button><small class="publish-detail-error">${esc(upload.error)}</small>` : ''}</div>`;
      }).join('')}<i class="publish-detail-insertion" aria-hidden="true" hidden></i></div>${rows.length ? '' : '<p class="publish-detail-empty">暂无图片，可上传或将其他图集中的图片移入。</p>'}</div>`;
    }).join('') || '<p class="publish-detail-empty">先勾选图集，再添加图片。</p>'}`;
}

/**
 * 渲染独立详情编辑区；文本统一转义，来源内容不会作为 HTML 执行。
 * @param {object} product 当前本地商品。
 * @returns {string} 商详图、图注、公司资料、问答和预览入口的 HTML。
 * @throws {Error} 不主动抛错，旧工作区缺少详情时补空结构。
 */
function renderPublishDetailEditor(product) {
  product.detail ||= window.LsouPublishUtils.createPublishDetail();
  const detail = product.detail;
  return `<section class="publish-form-section publish-detail-editor" aria-label="商品详情">
    <div class="publish-detail-heading"><div><h3>商品详情</h3><p>详情图按顺序展示，可拖动、删除和修改说明。</p></div><button type="button" class="ghost sm" id="publishDetailPreviewButton"><i class="ri-eye-line" aria-hidden="true"></i>预览详情</button></div>
    ${renderPublishImageGroups(product, 'detailImage', '商详图')}
    <label class="publish-field publish-company-description"><span><b>公司介绍</b><small>可修改</small></span><textarea data-publish-company-desc rows="5" placeholder="填写公司介绍" aria-label="公司介绍">${esc(detail.companyDesc)}</textarea></label>
    ${renderPublishImageGroups(product, 'companyImage', '公司图片')}
    <div class="publish-detail-subhead publish-faq-heading"><b>常见问答 <small>${detail.faqs.length} 条</small></b><button type="button" class="ghost sm" id="publishAddFaq" ${detail.faqs.length >= window.LsouPublishUtils.MAX_DETAIL_ITEMS ? 'disabled' : ''}><i class="ri-add-line" aria-hidden="true"></i>添加问答</button></div>
    <div class="publish-detail-faqs">${detail.faqs.map((faq, index) => `<div class="publish-detail-faq"><div class="publish-faq-head"><b>问答 ${index + 1}</b><button type="button" data-publish-faq-remove="${index}" aria-label="删除问答 ${index + 1}" title="删除问答 ${index + 1}"><i class="ri-delete-bin-line" aria-hidden="true"></i>删除</button></div><label class="publish-field"><span>问题</span><textarea data-publish-faq-field="question" data-index="${index}" rows="2" placeholder="填写买家关心的问题" aria-label="问题 ${index + 1}">${esc(faq.question)}</textarea></label><label class="publish-field"><span>回答</span><textarea data-publish-faq-field="answer" data-index="${index}" rows="3" placeholder="填写清晰、准确的回答" aria-label="回答 ${index + 1}">${esc(faq.answer)}</textarea></label></div>`).join('') || '<p class="publish-detail-empty">暂无常见问答，可按需添加。</p>'}</div>
  </section>`;
}

/**
 * 绑定详情区上传、删除、排序和问答；每个闭包固定商品及分组，避免切换后串改。
 * @param {object} product 当前商品。
 * @returns {void} 注册本次渲染节点的事件。
 * @throws {Error} 上传失败由原上传处理器转为可重试状态。
 */
function bindPublishDetailEditor(product) {
  $('#publishDetailPreviewButton').onclick = () => openPublishDetailPreview(product);
  $('#publishAddFaq').onclick = () => {
    product.detail.faqs.push({ question: '', answer: '' });
    renderProductPublish();
    // 新问题可能位于长列表下方；添加后直接定位，避免用户寻找空白条目。
    $(`[data-publish-faq-field="question"][data-index="${product.detail.faqs.length - 1}"]`)?.focus();
  };
  $$('[data-publish-faq-remove]').forEach(button => { button.onclick = () => {
    product.detail.faqs.splice(Number(button.dataset.publishFaqRemove), 1); renderProductPublish();
  }; });
  $$('[data-publish-image-set]').forEach(input => { input.onchange = () => {
    const key = input.dataset.publishImageSet;
    const ids = new Set(window.LsouPublishUtils.selectedPublishImageSets(product.detail, key));
    if (input.checked) ids.add(input.value); else ids.delete(input.value);
    product.detail.imageGroupSelection ||= {};
    product.detail.imageGroupSelection[key] = [...ids];
    renderProductPublish();
  }; });
  $$('[data-publish-image-group-move]').forEach(input => { input.onchange = () => {
    const key = input.dataset.publishImageGroupMove;
    const image = product.detail[key][Number(input.dataset.index)];
    if (!image) return;
    const ids = new Set(window.LsouPublishUtils.selectedPublishImageSets(product.detail, key));
    ids.add(input.value);
    if (input.value) image.imageSetId = input.value; else delete image.imageSetId;
    product.detail.imageGroupSelection ||= {};
    product.detail.imageGroupSelection[key] = [...ids];
    renderProductPublish();
  }; });
  $$('[data-publish-detail-add]').forEach(button => { button.onclick = () => {
    button.closest('.publish-image-group').querySelector('[data-publish-detail-file]').click();
  }; });
  $$('[data-publish-detail-file]').forEach(input => { input.onchange = () => {
    const files = [...input.files]; input.value = '';
    handlePublishProductImages(files, product, input.dataset.publishDetailFile, input.dataset.imageSet);
  }; });
  $$('[data-publish-detail-grid]').forEach(grid => {
    const key = grid.dataset.publishDetailGrid;
    // 拖动使用图集内下标；回填只替换该图集占据的位置，不打乱其他图集。
    const indices = [...grid.querySelectorAll('[data-source-index]')].map(tile => Number(tile.dataset.sourceIndex));
    /** @param {number} from 源下标。@param {number} to 目标下标。@returns {void} 同步图片与图注排序。@throws 无。 */
    const move = (from, to) => {
      const rows = product.detail[key];
      if (to < 0 || to >= indices.length || from === to || !rows[indices[from]]) return;
      const group = indices.map(index => rows[index]);
      group.splice(to, 0, group.splice(from, 1)[0]);
      indices.forEach((index, position) => { rows[index] = group[position]; });
      renderProductPublish();
    };
    grid.querySelectorAll('[data-detail-move]').forEach(button => { button.onclick = () => move(Number(button.dataset.index), Number(button.dataset.index) + Number(button.dataset.detailMove)); });
    grid.querySelectorAll('[data-detail-remove]').forEach(button => { button.onclick = () => {
      const [removed] = product.detail[key].splice(Number(button.dataset.detailRemove), 1);
      if (!removed) return;
      product.uploads = (product.uploads || []).filter(record => {
        const matches = record.section === key && (record.previewUrl === removed.url || record.remoteUrl === removed.url);
        if (matches && record.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(record.previewUrl);
        return !matches;
      });
      renderProductPublish();
    }; });
    grid.querySelectorAll('[data-detail-retry]').forEach(button => { button.onclick = () => retryPublishImageUpload(product, button.dataset.detailRetry); });
    let from = null, slot = null;
    const marker = grid.querySelector('.publish-detail-insertion');
    /** 无参数；返回 void；清除插入线与拖拽状态，不抛异常。 */
    const reset = () => { from = null; slot = null; marker.hidden = true; grid.querySelectorAll('.is-dragging').forEach(tile => tile.classList.remove('is-dragging')); };
    /** @param {MouseEvent|DragEvent} event 指针位置。@returns {void} 显示离指针最近的插入边界；移出时隐藏。@throws 无。 */
    const mark = event => {
      const rect = grid.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) { slot = null; marker.hidden = true; return; }
      const tiles = [...grid.querySelectorAll('[data-detail-index]')].map(tile => ({ tile, rect: tile.getBoundingClientRect() }));
      const nearest = tiles.sort((a, b) => {
        const distance = item => Math.max(item.rect.top - event.clientY, 0, event.clientY - item.rect.bottom) * 1000 + Math.abs((item.rect.left + item.rect.right) / 2 - event.clientX);
        return distance(a) - distance(b);
      })[0];
      if (!nearest) return;
      const after = event.clientX > (nearest.rect.left + nearest.rect.right) / 2;
      slot = Number(nearest.tile.dataset.detailIndex) + (after ? 1 : 0);
      marker.hidden = slot === from || slot === from + 1;
      marker.style.left = `${(after ? nearest.rect.right : nearest.rect.left) - rect.left + (after ? 3 : -5)}px`;
      marker.style.top = `${nearest.rect.top - rect.top}px`; marker.style.height = `${nearest.rect.height}px`;
    };
    /** @param {Event} event 松手。@returns {void} 应用插入位置；不抛异常。 */
    const finish = event => { event.preventDefault(); const start = from, end = slot; reset(); if (Number.isInteger(start) && Number.isInteger(end)) move(start, end > start ? end - 1 : end); };
    grid.querySelectorAll('[data-detail-index]').forEach(tile => {
      tile.ondragstart = event => {
        if (event.target.closest('input,textarea,select,button')) { event.preventDefault(); return; }
        from = Number(tile.dataset.detailIndex); tile.classList.add('is-dragging');
        event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(from));
      };
      tile.ondragend = reset;
      tile.querySelector('.publish-detail-handle').onpointerdown = event => {
        if (event.button !== 0) return;
        event.preventDefault(); from = Number(tile.dataset.detailIndex); tile.classList.add('is-dragging');
        const handle = event.currentTarget; handle.setPointerCapture(event.pointerId);
        handle.onpointermove = mark;
        handle.onpointerup = event => { mark(event); finish(event); handle.onpointermove = null; };
        handle.onpointercancel = reset;
      };
    });
    grid.ondragover = event => { if (from === null) return; event.preventDefault(); mark(event); };
    grid.ondragleave = event => { if (!grid.contains(event.relatedTarget)) { slot = null; marker.hidden = true; } };
    grid.ondrop = finish;
  });
}

/**
 * 预览本次将提交的结构化详情，不执行来源 HTML；平台最终装修样式由国际站决定。
 * @param {object} product 当前商品，读取尚未保存的修改。
 * @returns {void} 打开可独立滚动的原生模态预览。
 * @throws {Error} 不主动抛错。
 */
function openPublishDetailPreview(product) {
  let dialog = $('#publishDetailPreview');
  if (!dialog) { dialog = document.createElement('dialog'); dialog.id = 'publishDetailPreview'; document.body.append(dialog); }
  const detail = { ...product.detail,
    detailImage: window.LsouPublishUtils.selectedPublishDetailImages(product.detail, 'detailImage'),
    companyImage: window.LsouPublishUtils.selectedPublishDetailImages(product.detail, 'companyImage') };
  /** @param {object[]} rows 勾选图片。@param {string} key 图片字段。@returns {string} 与编辑器同组展示的安全预览。@throws 无。 */
  const pictures = (rows, key) => window.LsouPublishUtils.publishImageSetOptions(product.detail, key).map(option => {
    const group = rows.filter(row => (row.imageSetId || '') === option.id);
    return group.length ? `<h4>${esc(option.label)}</h4>${group.map(row => `<figure><img src="${esc(row.url)}" alt="${esc(row.text || '详情图片')}" referrerpolicy="no-referrer" loading="lazy">${row.text ? `<figcaption>${esc(row.text)}</figcaption>` : ''}</figure>`).join('')}` : '';
  }).join('');
  dialog.innerHTML = `<header><div><h2>商品详情预览</h2><p>预览当前图文内容，最终排版以国际站展示为准。</p></div><button type="button" aria-label="关闭详情预览">×</button></header><div class="publish-detail-preview-body"><h3>${esc(product.title)}</h3>${product.sellingPoints?.some(Boolean) ? `<ul>${product.sellingPoints.filter(Boolean).map(point => `<li>${esc(point)}</li>`).join('')}</ul>` : ''}${pictures(detail.detailImage, 'detailImage')}${detail.companyDesc || detail.companyImage.length ? `<h3>公司介绍</h3><p>${esc(detail.companyDesc)}</p>${pictures(detail.companyImage, 'companyImage')}` : ''}${detail.faqs.some(faq => faq.question || faq.answer) ? `<h3>常见问答</h3>${detail.faqs.map(faq => `<article><h4>${esc(faq.question)}</h4><p>${esc(faq.answer)}</p></article>`).join('')}` : ''}${!detail.detailImage.length && !detail.companyDesc && !detail.companyImage.length && !detail.faqs.length ? '<p class="publish-detail-empty">还没有添加详情内容。</p>' : ''}</div>`;
  dialog.querySelector('header button').onclick = () => dialog.close();
  dialog.showModal();
}

/**
 * 渲染当前商品快速编辑器，字段来自真实 WorkCTL 发品 Schema 和特定产品类目属性。
 *
 * @returns {void} 直接更新编辑器内容与图片入口。
 * @throws {Error} 不主动抛出异常。
 */
function renderPublishEditor() {
  // 重绘会替换整个类目控件，取消旧输入的防抖与请求，避免响应落到另一件商品。
  clearTimeout(publishState.categorySearchTimer);
  publishState.categorySearchRequestId += 1;
  publishState.categorySearchLoading = false;
  publishState.categorySearchError = '';
  publishState.categoryMatches = [];
  const product = publishState.products.find(item => item.id === publishState.activeId) || publishState.products[0];
  if (!product) {
    $('#publishEditor').innerHTML = `<div class="publish-editor-empty">
      <span><i class="ri-edit-box-line" aria-hidden="true"></i></span>
      <h2>商品资料会显示在这里</h2>
      <p>先点击“发布新产品”，选择从零创建或参考店铺已有商品。创建后再填写图片、属性、价格和卖点。</p>
    </div>`;
    return;
  }
  publishState.activeId = product.id;
  // 账号类目上下文未完成前不渲染任何演示类目字段，避免网络较慢时让用户误以为
  // 特定产品参数适用于自己的商品。失败状态也停在这里，保存与发布按钮不会出现。
  if (!publishState.accountContextLoaded) {
    const failed = Boolean(publishState.accountContextError);
    $('#publishEditor').innerHTML = `<div class="publish-context-gate ${failed ? 'is-error' : ''}">
      <i class="${failed ? 'ri-error-warning-line' : 'ri-loader-4-line'}" aria-hidden="true"></i>
      <b>${failed ? '暂时无法读取当前账号商品类目' : '正在读取当前账号商品类目'}</b>
      <span>${failed ? '已停止套用演示参数，请点击顶部“刷新数据”后重试。' : '系统会自动生成对应类目参数，无需填写任何编号。'}</span>
    </div>`;
    return;
  }
  const categoryConfig = PUBLISH_CATEGORY_CONFIG[product.categoryKey] || PUBLISH_CATEGORY_CONFIG.unselected;
  const requiredAttributeCount = categoryConfig.fields.filter(isRequiredPublishField).length;
  const gallery = [...new Set([product.image, ...(product.gallery || [])].filter(Boolean))];
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
    <p class="publish-image-limit ${gallery.length > PUBLISH_IMAGE_LIMIT ? 'is-error' : ''}" role="status">商品主图 ${gallery.length}/${PUBLISH_IMAGE_LIMIT}${gallery.length > PUBLISH_IMAGE_LIMIT ? ` · 请移除 ${gallery.length - PUBLISH_IMAGE_LIMIT} 张后再保存或发布` : ' · 第一张为封面'}</p>
    <div class="publish-image-strip" aria-label="商品图片，可拖拽调整顺序">${gallery.map((image, index) => {
      const upload = uploads.find(item => item.previewUrl === image || item.remoteUrl === image);
      const status = upload?.status || '';
      const statusLabel = status === 'uploaded' ? '已上传' : status === 'failed' ? '失败' : status ? `${Math.max(1, Number(upload.progress || 0))}%` : '';
      return `<div class="publish-image-thumb ${index === 0 ? 'active' : ''} ${status ? `is-${status}` : ''}" draggable="true" data-publish-image-tile="${index}" title="拖拽调整图片顺序">
        <button type="button" class="publish-image-preview" data-publish-cover="${index}" aria-label="将商品图 ${index + 1} 设为封面"><img src="${esc(image)}" alt="商品图 ${index + 1}" draggable="false" referrerpolicy="no-referrer">${statusLabel ? `<span class="publish-image-status">${esc(statusLabel)}</span>` : ''}</button>
        <i class="ri-drag-move-2-line publish-image-drag-handle" draggable="false" aria-hidden="true"></i>
        <div class="publish-image-controls" aria-label="商品图 ${index + 1} 排序操作">
          <button type="button" data-publish-image-move="${index}" data-publish-image-delta="-1" aria-label="商品图 ${index + 1} 向前移动" ${index === 0 ? 'disabled' : ''}><i class="ri-arrow-left-s-line" aria-hidden="true"></i></button>
          <button type="button" data-publish-image-move="${index}" data-publish-image-delta="1" aria-label="商品图 ${index + 1} 向后移动" ${index === gallery.length - 1 ? 'disabled' : ''}><i class="ri-arrow-right-s-line" aria-hidden="true"></i></button>
          <button type="button" class="is-remove" data-publish-image-remove="${index}" aria-label="移除商品图 ${index + 1}"><i class="ri-delete-bin-line" aria-hidden="true"></i></button>
        </div>
      </div>`;
    }).join('')}<button type="button" class="publish-add-image" id="publishAddImages" aria-label="继续添加图片" ${gallery.length >= PUBLISH_IMAGE_LIMIT ? 'hidden' : ''} ${gallery.length >= PUBLISH_IMAGE_LIMIT || (publishState.uploadCapability.loaded && !publishState.uploadCapability.configured) ? 'disabled' : ''}><i class="ri-add-line" aria-hidden="true"></i><span>${gallery.length >= PUBLISH_IMAGE_LIMIT ? '已达上限' : '上传'}</span></button><i class="publish-image-insertion" aria-hidden="true" hidden></i></div>
    ${gallery.length ? '<p class="publish-image-order-help"><i class="ri-drag-move-2-line" aria-hidden="true"></i>拖动图片或左上角手柄，橙色竖线表示插入位置；第一张自动作为封面。</p>' : ''}
    ${renderPublishUploadSummary(product)}
    <div id="publishOutcomeInsight" aria-live="polite"></div>
    <section class="publish-form-section"><h3>基础信息</h3>
      <label class="publish-field"><span><b><em>*</em> 标题</b><small>${product.title.length}/128</small></span><input data-publish-field="title" value="${esc(product.title)}" maxlength="128"></label>
      <div class="publish-field"><span><b>关键词</b><small>${product.keywords.length}/5 · 可直接修改</small></span><div class="publish-chip-list">${product.keywords.map((keyword, index) => `<span class="publish-keyword-chip"><input data-publish-keyword="${index}" value="${esc(keyword)}" maxlength="40" size="${Math.max(6, Math.min(18, keyword.length))}" aria-label="关键词 ${index + 1}"><button type="button" data-publish-keyword-remove="${index}" aria-label="删除关键词 ${esc(keyword)}"><i class="ri-close-line" aria-hidden="true"></i></button></span>`).join('')}${product.keywords.length < 5 ? `<span class="publish-keyword-add"><input id="publishKeywordAdd" maxlength="40" placeholder="输入关键词" aria-label="新增关键词"><button id="publishKeywordAddButton" type="button">添加</button></span>` : ''}</div>${product.keywordSource === 'reference-attribute' && product.keywords.length ? '<small class="publish-schema-note publish-keyword-source">已从参考商品的关键词属性带入，可修改</small>' : product.keywordSource === 'reference' && product.referenceKeywordsEmpty && !product.keywords.length ? '<small class="publish-schema-note publish-keyword-source">参考商品未返回关键词，可在此补充</small>' : ''}</div>
      <div class="publish-field"><span><b><em>*</em> 叶子类目</b><small class="publish-control-tag">系统自动匹配</small></span><details class="publish-category-picker"><summary aria-label="选择商品类目" ${product.schemaLoading || !publishState.accountContextLoaded ? 'aria-disabled="true"' : ''}><span>${esc(product.category)}</span><i class="ri-arrow-down-s-line" aria-hidden="true"></i></summary><div class="publish-category-popover"><label class="publish-category-search"><i class="ri-search-line" aria-hidden="true"></i><input id="publishCategorySearch" type="search" placeholder="搜索并选择类目" aria-label="搜索类目" autocomplete="off"></label><div id="publishCategorySearchStatus" role="status"></div><div id="publishCategoryResults" role="listbox" aria-label="类目搜索结果"></div></div></details><small class="publish-schema-note">已自动带入类目；需要更换时点击上方搜索选择</small></div>
    </section>
    <section class="publish-form-section"><h3>类目属性 <small>${requiredAttributeCount} 项必填 · 共 ${categoryConfig.fields.length} 项</small></h3><div class="publish-form-grid">${categoryConfig.fields.map(field => `<div class="publish-field"><span><b>${isRequiredPublishField(field) ? '<em>*</em> ' : ''}${esc(field.label)}</b><small class="publish-control-tag">${field.control === 'multi' ? '平台多选' : field.control === 'region' ? '平台国家' : field.control === 'text' ? '允许输入' : field.control === 'combo' ? '平台选项 / 可自定义' : '平台单选'}</small></span>${renderPublishAttributeControl(field, product.attributes[field.key])}<small class="publish-schema-note">${esc(field.schemaName)}${field.control === 'region' ? ' · Alibaba 发品页选项' : field.optionSource === 'workctl-live' ? ' · 平台数据选项' : ''}</small></div>`).join('')}</div></section>
    <section class="publish-form-section"><div class="publish-section-heading"><h3>交易信息</h3><span>填写销售方式、起订量、库存与价格</span></div><div class="publish-form-grid">
      <label class="publish-field"><span><b><em>*</em> 销售方式</b><small class="publish-control-tag">平台选项</small></span><select data-publish-field="saleType"><option value="normal" ${product.saleType === 'normal' ? 'selected' : ''}>按件售卖</option><option value="batch" ${product.saleType === 'batch' ? 'selected' : ''}>按批售卖</option></select></label>
      ${product.saleType === 'batch' ? `<label class="publish-field"><span><b><em>*</em> 每批数量</b><small>整数 ≥ 1</small></span><input type="number" min="1" step="1" inputmode="numeric" data-publish-field="batchNum" value="${esc(product.batchNum)}"></label>` : ''}
      <label class="publish-field"><span><b><em>*</em> 最小起订量 (MOQ)</b><small>整数</small></span><input type="number" min="1" step="1" inputmode="numeric" data-publish-field="moq" value="${esc(product.moq)}"></label>
      <label class="publish-field"><span><b><em>*</em> 可售库存</b><small>整数</small></span><input type="number" min="0" step="1" inputmode="numeric" data-publish-field="inventory" value="${esc(product.inventory)}"></label>
      <label class="publish-field"><span><b><em>*</em> 计价单位</b><small class="publish-control-tag">系统自动匹配</small></span>${priceUnitControl}<small class="publish-schema-note">来自当前店铺与国际站官方单位，提交时自动携带平台编码</small></label>
    </div>
      <div class="publish-structured-field"><div class="publish-structure-head"><div><b><em>*</em> 阶梯价格</b><span>Schema 只接受 ladderPrices 数组，不接受“US$ 8.90–12.50”文本</span></div><button type="button" id="publishAddPriceTier"><i class="ri-add-line" aria-hidden="true"></i>添加阶梯</button></div><div class="publish-tier-list">${renderPublishPriceTiers(product)}</div></div>
      ${renderPublishSkus(product)}
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
    ${renderPublishDetailEditor(product)}
    <section class="publish-item-action-bar" aria-label="当前商品操作">
      <div><b>当前商品操作</b><span>只处理右侧这 1 个商品，仍会进入串行队列</span></div>
      <button type="button" id="publishSaveCurrent" ${publishActionIssues(product, 'draft').length ? 'disabled' : ''}><i class="ri-draft-line" aria-hidden="true"></i>保存当前草稿</button>
      <button type="button" class="primary" id="publishCurrent" ${publishActionIssues(product, 'publish').length ? 'disabled' : ''}><i class="ri-send-plane-2-line" aria-hidden="true"></i>发布当前商品</button>
    </section>
  </div>`;
  updatePublishCategoryResultSelect();
  $$('[data-publish-sku-more]').forEach(details => { details.ontoggle = () => {
    // 重绘后旧节点的迟到 toggle 不得覆盖新界面的展开状态。
    if (details.isConnected) publishSkuEditorState(product.skus[Number(details.dataset.publishSkuMore)]).open = details.open;
  }; });
  $('#publishAddSku').onclick = () => {
    product.skus = [...(product.skus || []), window.LsouPublishUtils.createEmptyPublishSku()];
    renderProductPublish();
  };
  $$('[data-publish-sku-remove]').forEach(button => { button.onclick = () => {
    product.skus.splice(Number(button.dataset.publishSkuRemove), 1);
    renderProductPublish();
  }; });
  $$('[data-publish-sku-attribute-add]').forEach(button => { button.onclick = () => {
    product.skus[Number(button.dataset.publishSkuAttributeAdd)].skuAttributes.push(window.LsouPublishUtils.createEmptyPublishSku().skuAttributes[0]);
    renderProductPublish();
  }; });
  $$('[data-publish-sku-attribute-remove]').forEach(button => { button.onclick = () => {
    product.skus[Number(button.dataset.skuIndex)].skuAttributes.splice(Number(button.dataset.publishSkuAttributeRemove), 1);
    renderProductPublish();
  }; });
  const categorySearch = $('#publishCategorySearch');
  const categoryPicker = $('.publish-category-picker');
  categoryPicker.querySelector('summary').onclick = event => {
    if (product.schemaLoading || !publishState.accountContextLoaded) event.preventDefault();
  };
  categoryPicker.ontoggle = () => {
    if (!categoryPicker.isConnected) return;
    if (categoryPicker.open) {
      updatePublishCategoryResultSelect();
      categorySearch.focus();
    }
    else {
      clearTimeout(publishState.categorySearchTimer);
      publishState.categorySearchRequestId += 1;
      publishState.categorySearchLoading = false;
    }
  };
  categorySearch.oninput = () => {
    clearTimeout(publishState.categorySearchTimer);
    // 输入一变就使旧响应失效，避免慢搜索覆盖新搜索。
    publishState.categorySearchRequestId += 1;
    publishState.categorySearchTimer = setTimeout(() => searchPublishCategories(categorySearch.value), 260);
  };
  categoryPicker.onkeydown = event => {
    const options = $$('[data-publish-category-option]');
    if (event.key === 'Escape') {
      event.preventDefault(); categoryPicker.open = false; categoryPicker.querySelector('summary').focus();
    } else if (categoryPicker.open && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      const index = options.indexOf(document.activeElement);
      const next = index < 0 ? (event.key === 'ArrowDown' ? 0 : options.length - 1)
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      options[next]?.focus();
    } else if (event.key === 'Enter' && event.target === categorySearch) {
      event.preventDefault(); clearTimeout(publishState.categorySearchTimer); searchPublishCategories(categorySearch.value);
    }
  };
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
      applyPublishProductGallery(product, [selectedImage, ...gallery.filter(image => image !== selectedImage)]);
      renderProductPublish();
    };
  });
  $$('[data-publish-image-move]').forEach(button => {
    button.onclick = event => {
      // 排序按钮覆盖在图片上，阻止事件继续冒泡到“设为封面”按钮。
      event.stopPropagation();
      const fromIndex = Number(button.dataset.publishImageMove);
      const toIndex = fromIndex + Number(button.dataset.publishImageDelta);
      if (movePublishProductImage(product, fromIndex, toIndex)) renderProductPublish();
    };
  });
  $$('[data-publish-image-remove]').forEach(button => {
    button.onclick = event => {
      event.stopPropagation();
      const removed = removePublishProductImage(product, Number(button.dataset.publishImageRemove));
      if (!removed) return;
      renderProductPublish();
      toast('图片已移除，剩余图片顺序已保存');
    };
  });
  bindPublishImageSorting(product);
  bindPublishDetailEditor(product);
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
  updatePublishOutcomeInsight();
}

/**
 * 读取参考商品的精简模板，并重新套用当前账号对应类目的实时字段规则。
 *
 * 参考商品提供类目、标题、文本和结构化详情。固定选项不会跨商品硬复制；切换类目后仍由
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
    if (template.detail) {
      // 明确导入新参考商品时一起替换详情；移除旧上传记录，迟到上传不能影响新详情。
      product.uploads = (product.uploads || []).filter(record => {
        if (!record.section) return true;
        if (record.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(record.previewUrl);
        return false;
      });
      product.detail = JSON.parse(JSON.stringify(template.detail));
    }
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
  const categoryConfig = PUBLISH_CATEGORY_CONFIG[product.categoryKey] || PUBLISH_CATEGORY_CONFIG.unselected;
  const images = [...new Set([product.image, ...(product.gallery || [])])].filter(isRemotePublishImage);
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
      // 单选携带官方ID；多选保持数组交给后端，逐个匹配官方ID并展开为独立属性记录。
      // -1只是页面多选/自定义值的占位，不会把整组选项拼成一个字符串。
      attrValueId: field.multiSelect
        ? -1
        : Number.isSafeInteger(Number(field.choiceIds?.[String(product.attributes?.[field.key] || '')]))
          ? Number(field.choiceIds[String(product.attributes?.[field.key] || '')])
          : -1,
    })),
    sellingPoints: product.sellingPoints,
    detail: JSON.parse(JSON.stringify(product.detail || window.LsouPublishUtils.createPublishDetail())),
    trade: {
      saleType: product.saleType,
      batchNum: product.batchNum,
      moq: product.moq,
      inventory: product.inventory,
      priceUnitId: product.priceUnitId,
      priceUnitLabel: product.priceUnit,
      ladderPrices: product.priceTiers,
      sku: product.skus || [],
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
  const imageIssue = window.LsouPublishUtils.publishCopyBlockedReason(product);
  if (imageIssue) issues.push(imageIssue.replace('再复制', '再保存或发布'));
  try { window.LsouPublishUtils.normalizePublishDetail(product.detail); } catch (error) { issues.push(error.message); }
  const gallery = [...new Set([product.image, ...(product.gallery || [])].filter(Boolean))];
  const remoteImages = gallery.filter(isRemotePublishImage);
  if (gallery.length > PUBLISH_IMAGE_LIMIT) issues.push(`商品主图最多 ${PUBLISH_IMAGE_LIMIT} 张，当前 ${gallery.length} 张，请先移除多余图片`);
  if (!String(product.title || '').trim()) issues.push('标题不能为空');
  if (!remoteImages.length) issues.push('本地图片尚未上传到可供 WorkCTL 读取的远程地址');
  if (!Array.isArray(product.skus) || !product.skus.length) issues.push('请添加商品规格，或重新读取参考商品的规格资料');
  (product.skus || []).forEach((sku, index) => {
    if (!sku.skuAttributes?.length || sku.skuAttributes.some(attr => !attr.attrName?.trim() || !attr.attrValue?.trim())) {
      issues.push(`第 ${index + 1} 个规格需要填写规格名称和值`);
    }
    if (action === 'publish') {
      const stock = hasPublishSkuValue(sku.stock) ? sku.stock : product.skus.length === 1 ? product.inventory : null;
      const price = hasPublishSkuValue(sku.unitPrice) ? sku.unitPrice : product.priceTiers?.[0]?.unitPrice;
      if (!hasPublishSkuValue(stock) || !Number.isInteger(Number(stock)) || Number(stock) < 0) {
        issues.push(`第 ${index + 1} 个规格库存待填写，请展开“补充规格信息”`);
      }
      if (!(Number(price) > 0)) issues.push(`第 ${index + 1} 个规格需要填写单价或首档价格`);
    }
  });
  const categoryConfig = PUBLISH_CATEGORY_CONFIG[product.categoryKey] || PUBLISH_CATEGORY_CONFIG.unselected;
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
  // 一个批次尚未结束时保留该批次的全部行；全部结束后只在发布历史中查看。
  const activeOperations = new Set(publishState.queue
    .filter(job => ['queued', 'running'].includes(job.status)).map(publishOperationId));
  const jobs = publishState.queue.filter(job => activeOperations.has(publishOperationId(job)));
  panel.hidden = jobs.length === 0;
  const historyCount = completedPublishOperations().length;
  $('#publishHistory').textContent = historyCount ? `发布历史（${historyCount}）` : '发布历史';
  panel.classList.toggle('collapsed', publishState.queueCollapsed);
  $('#publishQueueToggle').setAttribute('aria-expanded', String(!publishState.queueCollapsed));
  $('#publishQueueToggle').innerHTML = `${publishState.queueCollapsed ? '展开' : '收起'} <i class="ri-arrow-${publishState.queueCollapsed ? 'up' : 'down'}-s-line" aria-hidden="true"></i>`;
  $('#publishQueueCount').textContent = `${jobs.length} 个任务`;
  if (!jobs.length) {
    $('#publishQueueList').innerHTML = '';
    return;
  }
  const stateLabel = { queued: '等待中', running: '执行中', saved_draft: '草稿已保存', submitted: '已提交发布', failed: '失败' };
  $('#publishQueueList').innerHTML = jobs.map(job => {
    const failureLabels = publishFailureFieldLabels(job.failureFields);
    const resultDetail = window.LsouPublishUtils.publishResultDetail(job, failureLabels);
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
 * 按批次归集已结束的发布记录，保持服务端的新到旧顺序。
 * @returns {{id:string,jobs:object[]}[]} 成功和失败都已取得最终结果的历史批次。
 * @throws {Error} 不主动抛出异常。
 */
function completedPublishOperations() {
  return [...new Set(publishState.queue.map(publishOperationId))]
    .map(id => ({ id, jobs: publishOperationJobs(id) }))
    .filter(operation => operation.jobs.every(job => PUBLISH_TERMINAL_STATES.has(job.status)));
}

/**
 * 打开发布历史，按保存草稿/正式发布批次查看时间、成功失败数量和完整明细。
 * @returns {void} 渲染历史弹窗；仅读取已取得的队列快照，不再次提交任何商品。
 * @throws {Error} 不主动抛出异常。
 */
function showPublishHistory() {
  const operations = completedPublishOperations();
  $('#modalBody').innerHTML = `<section class="publish-history">
    <h2>发布历史</h2><p>查看已完成的草稿保存与发布任务。</p>
    <div class="publish-history-list">${operations.length ? operations.map(({ id, jobs }) => {
      const first = jobs[0];
      const failed = jobs.filter(job => job.status === 'failed').length;
      const timestamp = new Date(first.createdAt);
      const time = Number.isFinite(timestamp.getTime()) ? timestamp.toLocaleString('zh-CN', { hour12: false }) : '时间未记录';
      return `<article><div><b>${first.action === 'draft' ? '保存草稿' : '提交发布'} · ${jobs.length} 件商品</b><time>${esc(time)}</time><span>${jobs.length - failed} 个成功 · <em class="${failed ? 'has-failure' : ''}">${failed} 个失败</em></span></div><button type="button" data-publish-history-operation="${esc(id)}">查看明细</button></article>`;
    }).join('') : '<div class="publish-queue-empty">还没有已完成的发布任务</div>'}</div>
    <div class="publish-result-actions"><button id="publishHistoryClose" type="button">关闭</button></div>
  </section>`;
  $('#modal').classList.add('on');
  $('#publishHistoryClose').onclick = () => $('#modal').classList.remove('on');
  $$('[data-publish-history-operation]').forEach(button => {
    button.onclick = () => showPublishOperationResult(button.dataset.publishHistoryOperation, false, true);
  });
}

/**
 * 决定页面顶部应该展示哪一次操作。
 *
 * 优先显示用户刚发起且尚未结束的操作，否则寻找其他正在执行的批次。
 * 完成记录不会回退到顶部；activeOperationId 仍保留供完成通知使用。
 *
 * @returns {string} 当前可见操作标识；没有任务时返回空字符串。
 * @throws {Error} 不主动抛出异常。
 */
function resolveVisiblePublishOperationId() {
  if (publishState.activeOperationId && publishOperationJobs(publishState.activeOperationId)
    .some(job => ['queued', 'running'].includes(job.status))) {
    return publishState.activeOperationId;
  }
  const activeJob = publishState.queue.find(job => ['queued', 'running'].includes(job.status));
  return publishOperationId(activeJob);
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
 * 文案不会把它误写成“已审核上线”。列表完整展示并在弹窗内滚动。
 *
 * @param {string} operationId - 需要展示结果的操作标识。
 * @param {boolean} [automatic=false] - 是否由轮询完成后自动弹出。
 * @param {boolean} [fromHistory=false] - 是否提供返回发布历史入口。
 * @returns {boolean} 已成功打开弹窗返回 true；任务未结束或弹窗被占用时返回 false。
 * @throws {Error} 不主动抛出异常。
 */
function showPublishOperationResult(operationId, automatic = false, fromHistory = false) {
  const jobs = publishOperationJobs(operationId);
  if (!jobs.length || !jobs.every(job => PUBLISH_TERMINAL_STATES.has(job.status))) return false;
  if (automatic && $('#modal').classList.contains('on')) return false;

  const succeeded = jobs.filter(job => ['saved_draft', 'submitted'].includes(job.status));
  const failed = jobs.filter(job => job.status === 'failed');
  const lowScoreCount = jobs.filter(job => job.lowScore === true).length;
  const first = jobs[0];
  const total = jobs.length;
  const allSucceeded = failed.length === 0;
  let title = failed.length ? `处理完成，${failed.length} 个失败` : '操作完成';
  if (allSucceeded && first.action === 'draft') title = total === 1 ? '草稿保存成功' : `${total} 个草稿保存完成`;
  if (allSucceeded && first.action === 'publish') title = total === 1 ? '商品已提交发布' : `${total} 个商品已提交发布`;

  const visibleJobs = jobs;
  $('#modalBody').innerHTML = `<section class="publish-result ${allSucceeded ? 'success' : 'failure'}">
    <div class="publish-result-hero"><i class="${allSucceeded ? 'ri-checkbox-circle-fill' : 'ri-error-warning-fill'}" aria-hidden="true"></i><div><span>本次任务 ${total}/${total}</span><h2>${esc(title)}</h2><p>${failed.length ? '失败原因见下方明细，请修改资料后重新提交。' : first.action === 'publish' ? '已提交的商品仍需以国际站平台审核状态为准。' : '商品已保存到国际站草稿箱。'}</p></div></div>
    <div class="publish-result-metrics"><article><span>处理总数</span><strong>${total}</strong></article><article><span>成功</span><strong>${succeeded.length}</strong></article><article><span>失败</span><strong>${failed.length}</strong></article></div>
    ${lowScoreCount ? `<p class="publish-result-quality-alert"><i class="ri-error-warning-line" aria-hidden="true"></i>${lowScoreCount} 件商品被平台标记为低分，请查看下方扣分原因。</p>` : ''}
    <div class="publish-result-list">${visibleJobs.map((job, index) => {
      const failureLabels = publishFailureFieldLabels(job.failureFields);
      const detail = window.LsouPublishUtils.publishResultDetail(job, failureLabels);
      return `<article><b>${Number(job.position || index + 1)}</b><img src="${esc(job.image)}" alt="" referrerpolicy="no-referrer"><div class="publish-result-product">${['saved_draft', 'submitted'].includes(job.status) && job.productId ? `<button type="button" class="publish-result-open" data-publish-edit-job="${esc(job.id)}"><strong>${esc(job.title)}</strong><small>继续编辑</small></button><span class="publish-history-edit-error" data-publish-edit-error role="alert"></span>` : `<strong>${esc(job.title)}</strong>`}${job.status === 'failed' ? `<span>${esc(detail)}</span>` : ''}</div><em class="${esc(job.status)}">${job.status === 'saved_draft' ? '草稿已保存' : job.status === 'submitted' ? '已提交' : '失败'}</em>${job.status !== 'failed' || window.LsouPublishUtils.finiteNumberOrNull(job.finalScore) !== null ? renderPublishQualityCard(job) : ''}</article>`;
    }).join('')}</div>
    <div class="publish-result-actions">${fromHistory ? '<button id="publishResultHistory" type="button">返回发布历史</button>' : ''}<button id="publishResultClose" class="primary" type="button">完成</button></div>
  </section>`;
  $('#modal').classList.add('on');
  $('#publishResultClose').onclick = () => $('#modal').classList.remove('on');
  if ($('#publishResultHistory')) $('#publishResultHistory').onclick = showPublishHistory;
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
  $('#publishSaveDraft').disabled = selected.length === 0;
  $('#publishStartQueue').disabled = selected.length === 0 || blocked > 0;
  const publishHint = blocked ? `已选商品中有 ${blocked} 个未通过发布前检查` : '所选商品将逐条进入真实 WorkCTL 队列';
  $('#publishStartQueue').title = publishHint;
}

/**
 * 把右侧编辑器的字段修改同步回当前产品，并重新计算完整度和状态。
 *
 * @param {Event} event - 输入框或下拉框触发的 input/change 事件。
 * @returns {void} 状态更新后重绘表格和底部操作栏。
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
  if (event.target.hasAttribute('data-publish-company-desc')) product.detail.companyDesc = event.target.value;
  const detailGroup = event.target.dataset.publishDetailText;
  if (['detailImage', 'companyImage'].includes(detailGroup)) {
    product.detail[detailGroup][Number(event.target.dataset.index)].text = event.target.value;
  }
  const faqField = event.target.dataset.publishFaqField;
  if (['question', 'answer'].includes(faqField)) product.detail.faqs[Number(event.target.dataset.index)][faqField] = event.target.value;
  const skuIndex = event.target.dataset.publishSku;
  if (skuIndex !== undefined) {
    const sku = product.skus?.[Number(skuIndex)];
    if (!sku) return;
    const attrIndex = event.target.dataset.publishSkuAttribute;
    const skuField = event.target.dataset.publishSkuField;
    if (attrIndex !== undefined && ['attrName', 'attrValue'].includes(skuField)) {
      const attr = sku.skuAttributes[Number(attrIndex)];
      attr[skuField] = event.target.value;
      // 修改文字后旧平台枚举 ID/图片不再对应新值，交给平台按自定义属性处理。
      attr.attrNameId = null; attr.attrValueId = null; attr.imageUrl = null;
    } else if (['stock', 'unitPrice'].includes(skuField)) {
      sku[skuField] = event.target.value === '' ? null : Number(event.target.value);
    } else if (skuField === 'skuCode') sku.skuCode = event.target.value;
    if (['skuCode', 'unitPrice', 'stock'].includes(skuField)) publishSkuEditorState(sku).visible.add(skuField);
  }

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
 * 将商品图库统一写回为有序、去重的数组；旧超量草稿保留全部图片供用户删除。
 *
 * `product.gallery[0]` 与 `product.image` 始终指向同一张封面图。拖拽排序、点击设为
 * 封面和移除图片都必须经过这个入口，才能保证页面顺序与最终发品 payload 一致。
 *
 * @param {object} product - 当前商品草稿。
 * @param {string[]} images - 期望保存的新图片顺序。
 * @returns {string[]} 实际写回的图片数组。
 * @throws {Error} 不主动抛出异常，空值和重复地址会被忽略。
 */
function applyPublishProductGallery(product, images) {
  const normalized = [...new Set((Array.isArray(images) ? images : []).filter(Boolean))];
  product.gallery = normalized;
  product.image = normalized[0] || '';
  syncPublishRemoteImageCount(product);
  return normalized;
}

/**
 * 把一张商品图移动到指定位置；移动到第一个位置时会自然成为封面。
 *
 * @param {object} product - 当前商品草稿。
 * @param {number} fromIndex - 图片移动前的零基下标。
 * @param {number} toIndex - 图片移动后的零基下标。
 * @returns {boolean} 顺序发生变化时返回 true。
 * @throws {Error} 不主动抛出异常，无效或相同下标返回 false。
 */
function movePublishProductImage(product, fromIndex, toIndex) {
  const gallery = [...new Set([product.image, ...(product.gallery || [])].filter(Boolean))];
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) ||
      fromIndex < 0 || fromIndex >= gallery.length || toIndex < 0 || toIndex >= gallery.length ||
      fromIndex === toIndex) return false;
  const [image] = gallery.splice(fromIndex, 1);
  gallery.splice(toIndex, 0, image);
  applyPublishProductGallery(product, gallery);
  return true;
}

/**
 * 从商品草稿中移除一张图片，并同步清理对应的本地上传状态。
 *
 * 已在后台上传中的任务可能仍会结束，但因为上传记录和预览地址已经从商品中移除，
 * 完成回调不会把图片重新插回图库。若删除的是封面，下一张图片自动接替。
 *
 * @param {object} product - 当前商品草稿。
 * @param {number} index - 要移除图片的零基下标。
 * @returns {string} 成功时返回被移除的地址；下标无效时返回空字符串。
 * @throws {Error} 不主动抛出异常。
 */
function removePublishProductImage(product, index) {
  const gallery = [...new Set([product.image, ...(product.gallery || [])].filter(Boolean))];
  if (!Number.isInteger(index) || index < 0 || index >= gallery.length) return '';
  const [removedUrl] = gallery.splice(index, 1);
  const removedUploads = (product.uploads || []).filter(record =>
    record.previewUrl === removedUrl || record.remoteUrl === removedUrl);
  product.uploads = (product.uploads || []).filter(record => !removedUploads.includes(record));
  removedUploads.forEach(record => {
    if (String(record.previewUrl || '').startsWith('blob:')) URL.revokeObjectURL(record.previewUrl);
  });
  applyPublishProductGallery(product, gallery);
  return removedUrl;
}

/**
 * 清除一次拖拽过程留下的视觉状态。
 *
 * @returns {void} 仅修改当前编辑器中的 CSS class。
 * @throws {Error} 不主动抛出异常。
 */
function clearPublishImageDragStyles() {
  const marker = $('.publish-image-insertion');
  if (marker) marker.hidden = true;
  $$('[data-publish-image-tile]').forEach(tile => {
    tile.classList.remove('is-dragging', 'is-drop-target');
  });
}

/**
 * 按指针所在图片的左/右半区确定插入缝隙，并绘制同位置的橙色竖线。
 * @param {number} clientX 视口横坐标。
 * @param {number} clientY 视口纵坐标。
 * @returns {number|null} 删除源图之前的插入边界（0至图片数）；图库外返回null。
 * @throws {Error} 不主动抛出异常。
 */
function updatePublishImageInsertion(clientX, clientY) {
  const strip = $('.publish-image-strip');
  const marker = $('.publish-image-insertion');
  const tiles = $$('[data-publish-image-tile]');
  if (!strip || !marker || !tiles.length || !Number.isInteger(publishState.imageDragIndex)) return null;
  const bounds = strip.getBoundingClientRect();
  if (clientX < bounds.left - 8 || clientX > bounds.right + 8 || clientY < bounds.top - 8 || clientY > bounds.bottom + 8) {
    marker.hidden = true;
    publishState.imageDragTargetIndex = null;
    return null;
  }
  // 多行图库先选距离指针最近的一行，再选该行最近的图片；缝隙也有明确目标。
  const positions = tiles.map(tile => ({ tile, rect: tile.getBoundingClientRect() }));
  const distanceY = rect => Math.max(rect.top - clientY, clientY - rect.bottom, 0);
  const nearestY = Math.min(...positions.map(({ rect }) => distanceY(rect)));
  const row = positions.filter(({ rect }) => distanceY(rect) === nearestY);
  const target = row.reduce((best, item) => Math.abs(clientX - (item.rect.left + item.rect.width / 2)) <
    Math.abs(clientX - (best.rect.left + best.rect.width / 2)) ? item : best);
  const after = clientX >= target.rect.left + target.rect.width / 2;
  const slot = Number(target.tile.dataset.publishImageTile) + (after ? 1 : 0);
  publishState.imageDragTargetIndex = slot;
  // 源图紧邻的两个边界都不改变顺序，不显示误导性的插入提示。
  marker.hidden = slot === publishState.imageDragIndex || slot === publishState.imageDragIndex + 1;
  const gap = Number.parseFloat(getComputedStyle(strip).columnGap) || 6;
  marker.style.left = `${(after ? target.rect.right + gap / 2 : target.rect.left - gap / 2) - bounds.left - 1.5}px`;
  marker.style.top = `${target.rect.top - bounds.top}px`;
  marker.style.height = `${target.rect.height}px`;
  return slot;
}

/**
 * 绑定原生拖拽、鼠标手柄和触屏手柄；三种方式共用同一插入位置算法。
 * @param {object} product 当前正在编辑的商品，排序只修改本地图片顺序。
 * @returns {void} 完成绑定，松手后同步封面；取消或移出图库不改变顺序。
 * @throws {Error} 不主动抛出异常。
 */
function bindPublishImageSorting(product) {
  const strip = $('.publish-image-strip');
  if (!strip) return;
  /** @param {HTMLElement} tile 源图。@returns {void} 初始化排序。@throws {Error} 不主动抛错。 */
  const start = tile => {
    clearPublishImageDragStyles();
    publishState.imageDragIndex = Number(tile.dataset.publishImageTile);
    publishState.imageDragTargetIndex = null;
    tile.classList.add('is-dragging');
  };
  /** @returns {void} 清除拖拽状态。@throws {Error} 不主动抛错。 */
  const reset = () => {
    publishState.imageDragIndex = null;
    publishState.imageDragTargetIndex = null;
    clearPublishImageDragStyles();
  };
  /** @param {Event} event 松手事件。@param {boolean} cancelled 是否取消。@returns {void} 应用插入。@throws {Error} 不主动抛错。 */
  const finish = (event, cancelled = false) => {
    event.preventDefault(); event.stopPropagation();
    if (!cancelled) updatePublishImageInsertion(event.clientX, event.clientY);
    const from = publishState.imageDragIndex;
    const slot = publishState.imageDragTargetIndex;
    reset();
    // 插入边界按原数组计数；先移除源图后，右侧边界要左移一位。
    if (!cancelled && Number.isInteger(from) && Number.isInteger(slot) &&
      movePublishProductImage(product, from, slot > from ? slot - 1 : slot)) renderProductPublish();
  };
  $$('[data-publish-image-tile]').forEach(tile => {
    tile.ondragstart = event => {
      start(tile);
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(publishState.imageDragIndex));
      }
    };
    tile.ondragend = reset;
  });
  strip.ondragover = event => {
    if (!Number.isInteger(publishState.imageDragIndex)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    updatePublishImageInsertion(event.clientX, event.clientY);
  };
  strip.ondragleave = event => {
    if (!strip.contains(event.relatedTarget)) {
      publishState.imageDragTargetIndex = null;
      const marker = $('.publish-image-insertion');
      if (marker) marker.hidden = true;
    }
  };
  strip.ondrop = event => {
    if (Number.isInteger(publishState.imageDragIndex)) finish(event);
  };
  $$('.publish-image-drag-handle').forEach(handle => {
    handle.onpointerdown = event => {
      if (event.pointerType === 'mouse') return;
      event.preventDefault(); event.stopPropagation();
      start(handle.closest('[data-publish-image-tile]'));
      handle.setPointerCapture?.(event.pointerId);
    };
    handle.onpointermove = event => {
      if (!Number.isInteger(publishState.imageDragIndex)) return;
      event.preventDefault();
      updatePublishImageInsertion(event.clientX, event.clientY);
    };
    handle.onpointerup = event => {
      if (event.pointerType !== 'mouse') finish(event);
    };
    handle.onpointercancel = event => finish(event, true);
    handle.onmousedown = event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      start(handle.closest('[data-publish-image-tile]'));
      const move = event => { event.preventDefault(); updatePublishImageInsertion(event.clientX, event.clientY); };
      // 每次松手/取消都移除文档监听，避免重绘编辑器后旧拖拽继续生效。
      const cleanup = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        document.removeEventListener('keydown', cancel);
        window.removeEventListener('blur', blur);
      };
      const up = event => { cleanup(); finish(event); };
      const cancel = event => { if (event.key === 'Escape') { cleanup(); finish(event, true); } };
      const blur = () => { cleanup(); reset(); };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
      document.addEventListener('keydown', cancel);
      window.addEventListener('blur', blur);
    };
  });
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
  if (!record?.file || !product.uploads.includes(record)) return false;
  if (!publishState.uploadCapability.configured) {
    record.status = 'failed';
    record.progress = 0;
    record.error = publishState.uploadCapability.error || '图片上传尚未连接 Accio Work，请登录后重新打开工作台';
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
    if (record.section) {
      // 用预览地址定位当前图片，排序不影响回填；已删除的图片不会因迟到响应重新出现。
      for (const image of product.detail[record.section]) if (image.url === record.previewUrl) image.url = record.remoteUrl;
    } else {
      product.gallery = (product.gallery || []).map(url => url === record.previewUrl ? record.remoteUrl : url);
      if (product.image === record.previewUrl) product.image = record.remoteUrl;
    }
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
 * @param {object} [targetProduct] 文件选择时固定的所属商品，避免切换商品后串图。
 * @param {'detailImage'|'companyImage'|null} [section=null] 详情分组；null 表示原主图库。
 * @param {string} [imageSetId=''] 当前选定的平台图集，空值沿用未分组。
 * @returns {Promise<void>} 全部图片依次处理完成后给出汇总反馈。
 * @throws {Error} 浏览器 Object URL 异常会被调用环境报告。
 */
async function handlePublishProductImages(files, targetProduct, section = null, imageSetId = '') {
  const product = targetProduct || publishState.products.find(item => item.id === publishState.activeId);
  if (!product) return;
  if (section !== null && !['detailImage', 'companyImage'].includes(section)) return;
  const gallery = [...new Set([product.image, ...(product.gallery || [])].filter(Boolean))];
  const capacity = Math.max(0, section ? window.LsouPublishUtils.MAX_DETAIL_ITEMS - product.detail[section].length : PUBLISH_IMAGE_LIMIT - gallery.length);
  const images = [...files].filter(file => ['image/jpeg', 'image/png', 'image/webp'].includes(file.type));
  // 一次选超剩余名额时整批不上传，让用户自行选择，不悄悄丢弃后面的文件。
  if (images.length > capacity) {
    toast(`${section ? '当前详情图片分组' : '商品主图'}还可添加 ${capacity} 张；本次选择 ${images.length} 张，请重新选择`, true);
    return;
  }
  if (!images.length) {
    if (files.length) toast('图片格式仅支持 JPG、PNG 或 WEBP', true);
    return;
  }
  const records = images.map(file => ({
    id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    file,
    section,
    filename: file.name,
    previewUrl: URL.createObjectURL(file),
    remoteUrl: '',
    status: 'waiting',
    progress: 0,
    error: '',
  }));
  product.uploads = [...(product.uploads || []), ...records];
  if (section) product.detail[section].push(...records.map(record => ({ url: record.previewUrl, text: '', ...(imageSetId ? { imageSetId } : {}) })));
  else {
    product.gallery = [...records.map(record => record.previewUrl), ...gallery];
    product.image = product.gallery[0];
  }
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
      const detail = window.LsouPublishUtils.normalizePublishDetail(product.detail);
      return `<article><img src="${esc(product.image)}" alt="" referrerpolicy="no-referrer"><div><b>${esc(product.title)}</b><span>${esc(product.category)} · 主图 ${imageCount} 张 · 属性 ${progress.completed}/${progress.total}</span><span>商详图 ${detail.detailImage.length} 张 · 公司图片 ${detail.companyImage.length} 张 · 问答 ${detail.faqs.filter(faq => faq.question || faq.answer).length} 条${detail.companyDesc ? ' · 含公司介绍' : ''}</span></div></article>`;
    }).join('')}</div>
    <div class="publish-confirm-warning"><i class="${action === 'draft' ? 'ri-draft-line' : 'ri-error-warning-line'}" aria-hidden="true"></i><div><b>即将调用真实 WorkCTL 发布流水线</b><p>${action === 'draft' ? '每个商品会经过发布前校验，并保存到国际站草稿箱。' : '每个商品会经过发布前校验后提交平台；提交成功不等于审核通过或已经在线。'} 单条失败不会阻塞后续商品，成功后会返回质量分。</p></div></div>
    <p id="publishPreflightError" class="publish-create-error" role="alert" hidden></p>
    <label class="publish-confirm-check"><input type="checkbox" id="publishConfirmAcknowledge"><span>我已核对商品信息、价格和目标操作，并确认执行真实写入</span></label>
    <div class="publish-confirm-actions"><button type="button" id="publishConfirmCancel">返回修改</button><button type="button" class="primary" id="publishConfirmStart" disabled>确认${scope === 'batch' ? '批量' : ''}${action === 'draft' ? '保存草稿' : '加入发布队列'}</button></div></section>`;
  $('#modal').classList.add('on');
  $('#publishConfirmCancel').onclick = () => $('#modal').classList.remove('on');
  $('#publishConfirmAcknowledge').onchange = event => {
    $('#publishConfirmStart').disabled = !event.target.checked;
  };
  $('#publishConfirmStart').onclick = async event => {
    // currentTarget 会在事件回调让出后清空，先保存节点才能在请求失败后恢复按钮。
    const button = event.currentTarget;
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = '正在校验并提交…';
    const queued = await startPublishQueue(products, action, scope);
    if (queued) $('#modal').classList.remove('on');
    else {
      button.textContent = originalLabel;
      button.disabled = !$('#publishConfirmAcknowledge')?.checked;
    }
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
  const errorPanel = $('#publishPreflightError');
  if (errorPanel) { errorPanel.hidden = true; errorPanel.textContent = ''; }
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
      const message = String(payload.error || response.status).slice(0, 600);
      if (errorPanel) { errorPanel.textContent = message; errorPanel.hidden = false; }
      toast(`加入真实队列失败：${message.slice(0, 180)}`, true);
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
    renderPublishQueue();
    renderPublishOperationProgress();
    renderPublishBottomBar();
    startPublishQueuePolling();
    setTimeout(() => refreshPublishQueue({ silent: true }), 250);
    toast(`${products.length} 个商品已加入真实 WorkCTL ${action === 'draft' ? '草稿' : '发布'}队列`);
    return true;
  } catch (error) {
    if (errorPanel) { errorPanel.textContent = `连接中断，尚未取得提交结果：${error.message}`; errorPanel.hidden = false; }
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
    updatePublishOutcomeInsight();
    renderPublishTable();
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
  const timeRequest=JSON.stringify(timeStates['flow']);
  const j = await api('shop-region', {
    ...dates('flow'), statisticsType: 'day',
    dimensionType: $('#regionDim').value, terminalType: $('#regionTerm').value });
  if(timeRequest!==JSON.stringify(timeStates['flow']))return;
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
  const W = Math.max(box.clientWidth - 10, 340), rowH = 25, H = rows.length * rowH + 12;
  const L = 100, iw = W - L - 132, max = Math.max(...rows.map(r => r.v), 1);
  const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, style: 'max-width:100%;height:auto' });
  rows.forEach((r, i) => {
    const y = i * rowH + 5, w = Math.max(r.v / max * iw, 2);
    svg.appendChild(el('text', { x: L - 9, y: y + 14, class: 'gt', 'text-anchor': 'end' },
      businessCountry(r.n)));
    const b = el('rect', { x: L, y, width: w, height: 17, rx: 3,
      fill: `hsl(${24 + i * 1.2},84%,${58 - Math.min(i * .65, 13)}%)`, class: 'bar' });
    b.addEventListener('mousemove', ev => showTip(ev,
      `${r.n}\n数值: ${fmt(r.v)}\n所示国家占比: ${(r.v / total * 100).toFixed(2)}%\n\n点击 → 下钻该国访客明细`));
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
// 仅保存当前图表视图和下钻来源；切换视图复用已返回数据，不重复请求接口。
let flowInsightView = 'rates';
let flowSelectedSource = '';

/**
 * 读取流量来源、国家、买家画像、搜索词和行业市场机会，并在一个页面汇总。
 *
 * @returns {Promise<void>} 所有只读查询结束并完成渲染后返回。
 * @throws {Error} 单个接口失败由 api() 隔离，其余数据仍可展示。
 */
async function loadFlow() {
  const timeRequest=JSON.stringify(timeStates['flow']);
  installFlowInsights();
  // 本店与行业同时呈现；行业独立加载，不阻塞本店查询和渲染。
  void loadFlowMarket();
  // 页面统一查询全端；国家图仍使用自身的终端选择。
  const terminalType = 'TOTAL';
  const [flow, channel, region, summary, identity, keyword, source] = await Promise.all([
    api('shop-flow', { ...dates('flow'), terminalType }),
    api('shop-channel', { ...dates('flow'), statisticsType: 'day', terminalType }),
    api('shop-region', { ...dates('flow'), statisticsType: 'day', dimensionType: $('#regionDim').value, terminalType: $('#regionTerm').value }),
    api('shop-summary', { ...dates('flow'), statisticsType: 'day' }),
    api('customer-profile', { nd: '30d', dimensionType: 'byr_identity', terminalType }),
    api('customer-profile', { nd: '30d', dimensionType: 'shop_keyword', terminalType }),
    api('customer-profile', { nd: '30d', dimensionType: 'source', terminalType }),
  ]);
  if(timeRequest!==JSON.stringify(timeStates['flow']))return;
  const flowSnapshot=TimePolicy.latestFlow(Array.isArray(flow?.data)?flow.data:[]);
  flowRaw=flowSnapshot.rows;
  $('#flowSnapshotScope').textContent=flowSnapshot.date?`${flowSnapshot.type==='30d'?'近30天':flowSnapshot.type==='7d'?'近7天':flowSnapshot.type || '周期未返回'} · 截至 ${flowSnapshot.date} · 全端`:'平台未返回来源统计';
  renderFlow();
  regionRows = extractRegionRows(region);
  renderRegion(regionRows);
  renderTrafficMetrics(summary);
  renderRankList('#trafficIdentity', profileRows(identity, 'byr_identity').map(row => ({
    name: buyerIdentityName(row.byrIdentity), value: num(row.visitorRate), detail: pct(row.visitorRate), ratio: num(row.visitorRate),
  })));
  const keywords = profileRows(keyword, 'shop_keyword').sort((a, b) => num(b.shopUv) - num(a.shopUv));
  $('#trafficKeywords').innerHTML = keywords.length ? `<table><thead><tr><th>搜索词</th><th>本店访客</th><th>平台热度</th><th>热度变化</th></tr></thead><tbody>${keywords.map(row => `<tr><td>${esc(row.query || row.queryRaw || '未知搜索词')}</td><td>${row.shopUv == null ? '—' : fmt(row.shopUv)}</td><td>${row.pv == null ? '—' : fmt(row.pv)}</td><td>${row.pvCrc == null ? '—' : pct(row.pvCrc)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">当前没有搜索词记录</div>';
  renderChannelProfile(channel, source);

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
  // 明确使用原字段，禁止用UV/访问量相互兜底；缺失与零值分别显示。
  const display = key => rows.some(row => row?.[key] != null) ? fmt(total(key)) : '—';
  const metrics = [
    ['店铺访问量', display('pvCnt'), '经营汇总 · 每日访问量累加'],
    ['询盘数', display('fbCnt'), '经营汇总 · 每日询盘数累加'],
    ['TM 咨询', display('fbTmUv'), '经营汇总 · 每日人数累加，跨日不去重'],
    ['全站点击', display('totalClkCnt'), `全站曝光 ${display('totalImpsCnt')}`],
  ];
  $('#flowScope').textContent = `经营汇总：${dates('flow').startDate} 至 ${dates('flow').endDate} · 全端。渠道与国家：同日期 · 全端；国家访客为每日人数累加。画像：近30天；行业需求：近90天。`;
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
let flowChannelData = [];
let flowSelectedChannel = '';
/** 聚合渠道日记录并安装排序与趋势联动。@param {object|null} channelResponse 渠道响应。@param {object|null} sourceResponse 画像响应，保留调用兼容。@returns {void}。@throws DOM缺失时抛错。 */
function renderChannelProfile(channelResponse, sourceResponse) {
  flowChannelData = [];
  (Array.isArray(channelResponse?.data) ? channelResponse.data : []).forEach(block => {
    Object.entries(block || {}).forEach(([date, list]) => (Array.isArray(list) ? list : []).forEach(row => {
      if (!row.channelType || row.channelType === 'TOTAL') return;
      flowChannelData.push({date, name: row.channelType, uv: row.detailUv, tm: row.tmUv, inquiry: row.fbUv});
    }));
  });
  $('#flowChannelSort').onchange = renderChannelTable;
  $('#flowTrendMetric').onchange = renderLinkedFlowTrend;
  renderChannelTable();
}
/** 按所选字段排序渠道，保留缺失值与有效零值。@returns {void} 更新渠道表。@throws DOM缺失时抛错。 */
function renderChannelTable() {
  const groups = new Map();
  flowChannelData.forEach(row => {
    const item = groups.get(row.name) || {name: row.name, uv: null, inquiry: null, tm: null};
    ['uv', 'inquiry', 'tm'].forEach(key => { if (row[key] != null) item[key] = (item[key] ?? 0) + num(row[key]); });
    groups.set(row.name, item);
  });
  const key = $('#flowChannelSort').value;
  const rows = [...groups.values()].sort((a,b) => (b[key] ?? -1) - (a[key] ?? -1));
  if (!rows.some(row => row.name === flowSelectedChannel)) flowSelectedChannel = rows[0]?.name || '';
  const total = rows.reduce((value,row) => value + (row.uv || 0), 0);
  $('#trafficSourceProfile').innerHTML = rows.length ? `<table><thead><tr><th>渠道</th><th>访客累计</th><th>渠道累计占比</th><th>询盘</th><th>TM</th></tr></thead><tbody>${rows.map(row => `<tr class="${row.name === flowSelectedChannel ? 'flow-selected' : ''}"><td><button type="button" class="flow-channel-button" data-flow-channel="${esc(row.name)}" aria-pressed="${row.name === flowSelectedChannel}">${esc(row.name)}</button></td><td>${row.uv == null ? '—' : fmt(row.uv)}</td><td>${row.uv == null || !total ? '—' : pct(row.uv / total)}</td><td>${row.inquiry == null ? '—' : fmt(row.inquiry)}</td><td>${row.tm == null ? '—' : fmt(row.tm)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">当前周期无渠道记录；可调整日期后重新查询</div>';
  $$('[data-flow-channel]').forEach(button => { button.onclick = () => {flowSelectedChannel = button.dataset.flowChannel; renderChannelTable(); setFlowInsightView('trend');}; });
  renderLinkedFlowTrend();
}
/** 绘制已选渠道的日趋势；缺失日期不补零，图表悬停显示日期与数值。@returns {void}。@throws DOM缺失时抛错。 */
function renderLinkedFlowTrend() {
  const key = $('#flowTrendMetric').value;
  const label = $('#flowTrendMetric').selectedOptions[0].textContent;
  $('#flowTrendTitle').textContent = flowSelectedChannel ? `${flowSelectedChannel} · ${label}趋势` : '渠道每日变化';
  const period = dates('flow');
  $('#flowTrendScope').textContent = `${period.startDate} — ${period.endDate} · 按日统计，与左表一致`;
  const days = new Map();
  flowChannelData.filter(row => row.name === flowSelectedChannel).forEach(row => { if (row[key] != null) days.set(row.date, (days.get(row.date) || 0) + num(row[key])); });
  const rows = [...days].sort(([a],[b]) => a.localeCompare(b));
  const box = $('#flowLinkedTrend');
  if (!rows.length) {box.innerHTML = '<div class="empty">该渠道暂无此指标的日记录</div>'; return;}
  const max = Math.max(...rows.map(([,v]) => v), 1);
  const points = rows.map(([date,value], index) => ({date,value,x:48 + index * 420 / Math.max(rows.length-1,1),y:180-value/max*140}));
  box.innerHTML = `<svg viewBox="0 0 500 220" role="img" aria-label="${esc(flowSelectedChannel)}${esc(label)}每日趋势"><line x1="48" y1="180" x2="475" y2="180" stroke="#dce1e8"/><text x="8" y="44">${esc(fmt(max))}</text><text x="24" y="184">0</text><polyline points="${points.map(p => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="#e77b32" stroke-width="3"/>${points.map(p => `<circle cx="${p.x}" cy="${p.y}" r="3" fill="#e77b32"><title>${esc(p.date)}：${esc(fmt(p.value))}</title></circle>`).join('')}<text x="48" y="207">${esc(rows[0][0])}</text><text x="475" y="207" text-anchor="end">${esc(rows[rows.length-1][0])}</text></svg><p class="flow-scope">${rows.length} 个有记录的日期 · 仅连接已返回记录，缺失日期不视为零</p>`;
}
let flowMarketLoading = false;
/** 独立读取行业市场，避免行业接口拖慢本店流量。@returns {Promise<void>}。@throws 错误由api提示，finally恢复查询状态。 */
async function loadFlowMarket() {
  if (flowMarketLoading) return;
  flowMarketLoading = true;
  ['#trafficMarketCountry', '#trafficMarketCategory', '#trafficMarketScenes'].forEach(selector => {$(selector).innerHTML = '<div class="empty">正在读取行业数据…</div>';});
  try {
    let categoryRow = summaryRows.find(row => row.cateId);
    if (!categoryRow) {
      const summary = await api('shop-summary', { ...dates(), statisticsType: 'day' });
      categoryRow = (Array.isArray(summary?.data) ? summary.data : []).find(row => row.cateId);
    }
    const cateId = categoryRow?.cateId;
    if (!cateId) {
      ['#trafficMarketCountry', '#trafficMarketCategory', '#trafficMarketScenes'].forEach(selector => { $(selector).innerHTML = '<div class="empty">未取得当前店铺类目，暂不查询行业数据。</div>'; });
      return;
    }
    const results = await Promise.all([
      api('market-country', {cateId, rankType: 'blueOcean', orderBy: 'supplyDemandRate', orderModel: 'ASC'}),
      api('market-categories', {cateId, rankType: 'opportunity', orderBy: 'abCnt', orderModel: 'DESC'}),
      api('market-opportunities', {cateId, currentPage: 1, pageSize: 10, statCycle: '90d', terminalType: 'TOTAL'}),
    ]);
    renderMarketOpportunity(...results);
  } finally {flowMarketLoading = false;}
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
    `<tr><td>${esc(businessCountry(row.countryId))}</td><td>${fmt(row.abCnt)}</td><td class="${num(row.abCntYoy) >= 0 ? 'positive' : 'negative'}">${num(row.abCntYoy) >= 0 ? '+' : ''}${pct(row.abCntYoy)}</td><td>${pct(row.dAbRate)}</td><td>${num(row.supplyDemandRate).toFixed(2)}</td></tr>`));
  $('#trafficMarketCategory').innerHTML = table(['细分类目', '商机', '同比', '供需比'], categoryRows.map(row =>
    `<tr><td>${esc(row.cateCnName || row.cateName || row.cateId)}</td><td>${fmt(row.abCnt)}</td><td class="${num(row.abCntYoy) >= 0 ? 'positive' : 'negative'}">${num(row.abCntYoy) >= 0 ? '+' : ''}${pct(row.abCntYoy)}</td><td>${num(row.supplyDemandRate).toFixed(2)}</td></tr>`));
  $('#trafficMarketScenes').innerHTML = table(['需求场景', '需求指数', '环比', '店铺商品占比'], sceneRows.map(row =>
    `<tr><td><b>${esc(row.sceneNameCn || row.sceneName)}</b><small>${esc(String(row.top3HotKw || '').split('|').join(' · '))}</small></td><td>${num(row.needsIndex).toFixed(1)}</td><td class="${num(row.needsIndexQoq) >= 0 ? 'positive' : 'negative'}">${num(row.needsIndexQoq) >= 0 ? '+' : ''}${pct(row.needsIndexQoq)}</td><td>${pct(row.busProdRate)}</td></tr>`));
}

/**
 * 安装渠道洞察交互；三个视图和来源下钻都复用当前数据，不发起查询。
 * @returns {void} 更新按钮处理器和面板可见状态。
 * @throws {Error} 模板缺少对应容器时抛出 DOM 异常。
 */
function installFlowInsights() {
  $('#flowInsightTabs').onclick = event => {
    const button = event.target.closest('[data-flow-view]');
    if (button) setFlowInsightView(button.dataset.flowView);
  };
  $('#flowChart').onclick = event => {
    const button = event.target.closest('[data-flow-source]');
    if (!button) return;
    flowSelectedSource = button.dataset.flowSource;
    renderFlow();
    // 原来的来源按钮被替换后，键盘焦点交给同卡片内的返回入口。
    $('#flowSourceBack').focus({preventScroll:true});
  };
  $('#flowSourceBack').onclick = () => {
    const previousSource = flowSelectedSource;
    flowSelectedSource = '';
    renderFlow();
    [...$$('#flowChart [data-flow-source]')].find(button => button.dataset.flowSource === previousSource)?.focus({preventScroll:true});
  };
  setFlowInsightView(flowInsightView);
}

/**
 * 切换日趋势、来源访客规模或来源商机率；左侧选渠道时也进入日趋势。
 * @param {'trend'|'visitors'|'rates'} view - 目标视图，不接受其他值。
 * @returns {void} 同步按钮状态和可见图表。
 * @throws {Error} 视图值不合法时直接忽略；DOM 缺失时抛错。
 */
function setFlowInsightView(view) {
  if (!['trend','visitors','rates'].includes(view)) return;
  flowInsightView = view;
  $$('#flowInsightTabs [data-flow-view]').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.flowView === view)));
  $('#flowTrendPanel').hidden = view !== 'trend';
  $('#flowSourcePanel').hidden = view === 'trend';
  if (view !== 'trend') renderFlow();
}

/**
 * 解析来源图数值；缺失值、非数值和越界比例不伪装成真实零。
 * @param {unknown} value - 平台数值或数字字符串。
 * @param {number} maximum - 上限；商机率传 1，访客默认无限制。
 * @returns {number|null} 有效非负数，否则 null。
 * @throws {Error} 无主动异常。
 */
function flowChartNumber(value, maximum = Infinity) {
  if (!['number','string'].includes(typeof value) || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= maximum ? number : null;
}

/**
 * 从同日期、同周期的来源快照提取总类或具体入口，保留平台返回的访客与商机率。
 * @param {object[]} records - 已经由 TimePolicy.latestFlow 筛选的唯一周期快照。
 * @param {string} source - 空字符串取大类；指定名称取该类的具体入口。
 * @returns {Array<{name:string,uv:number|null,rate:number|null,topRate:number|null,entries:string[]}>} 按访客排序的独立行。
 * @throws {Error} 无主动异常；不累加可能重叠的访客，不平均不同记录的商机率。
 */
function flowSourceRows(records, source = '') {
  const groups = new Map();
  for (const record of records) {
    if (!record || typeof record.sourceType !== 'string' || typeof record.subSourceType !== 'string') continue;
    const include = source ? record.sourceType === source && record.subSourceType !== 'TOTAL'
      : record.sourceType !== 'TOTAL' && record.subSourceType === 'TOTAL';
    if (!include) continue;
    const name = source ? record.subSourceType : record.sourceType;
    const next = {name,uv:flowChartNumber(record.uv),rate:flowChartNumber(record.abRate,1),topRate:flowChartNumber(record.cateTopAbRate,1),entries:[]};
    const existing = groups.get(name);
    if (existing) {
      // 正常快照每个入口只有一行。重复且相互矛盾时显示缺项，避免把它们求和或挑成更好看的数。
      ['uv','rate','topRate'].forEach(key => {if (existing[key] !== next[key]) existing[key] = null;});
    } else groups.set(name,next);
  }
  if (!source) groups.forEach(row => {
    row.entries = [...new Set(records.filter(record => record?.sourceType === row.name && typeof record.subSourceType === 'string' && record.subSourceType !== 'TOTAL').map(record => record.subSourceType))];
  });
  return [...groups.values()].sort((a,b) => (b.uv ?? -1) - (a.uv ?? -1));
}

/**
 * 生成同一图内共用刻度的一条横向数据条，数值同时用文字呈现。
 * @param {number|null} value - 已校验的访客数或商机率；null 不画数据条。
 * @param {number} scale - 当前整张图的正数上限，不为每行单独缩放。
 * @param {boolean} rate - 是否按百分比显示。
 * @param {boolean} peer - 是否为类目 TOP 参考条。
 * @returns {string} 安全文本与有限宽度组成的 HTML。
 * @throws {Error} 无主动异常。
 */
function flowSourceBar(value, scale, rate, peer = false) {
  const text = value === null ? '—' : rate ? pct(value) : fmt(value);
  const width = value === null ? 0 : Math.min(value / scale * 100,100);
  return `<div class="flow-source-track${peer?' is-peer':''}${rate?'':' is-visitors'}">${rate?`<span>${peer?'TOP':'本店'}</span>`:''}<div class="flow-source-rail"><i style="width:${width.toFixed(3)}%"></i></div><b${value===null?' aria-label="未返回"':''}>${esc(text)}</b></div>`;
}

/**
 * 将当前来源快照绘成可下钻横条图：访客看规模，商机率与类目 TOP 共用刻度比较。
 * @returns {void} 替换来源图，保持日趋势数据与周期独立。
 * @throws {Error} DOM 缺失时抛错。
 */
function renderFlow() {
  const totals = flowSourceRows(flowRaw);
  if (!totals.some(row => row.name === flowSelectedSource)) flowSelectedSource = '';
  const rows = flowSelectedSource ? flowSourceRows(flowRaw,flowSelectedSource) : totals;
  const rate = flowInsightView !== 'visitors';
  $('#flowSourceTitle').textContent = `${flowSelectedSource || '流量来源'} · ${rate?'商机率对比':'访客规模'}`;
  $('#flowSourceBack').hidden = !flowSelectedSource;
  $('#flowSourceNote').textContent = rows.length ? '来源图按平台周期统计，日趋势按所选日期统计；访客可能跨入口重叠。' : '';
  const box = $('#flowChart');
  if (!rows.length) {box.innerHTML = '<div class="empty">当前没有来源记录，可切换每日趋势或调整日期。</div>';return;}

  // 各行共用从零开始的刻度。比例和人数不能用饼图解释为互斥份额。
  const values = rows.flatMap(row => rate ? [row.rate,row.topRate] : [row.uv]).filter(value => value !== null);
  const peak = Math.max(...values,rate ? 0.01 : 1);
  const step = 10 ** Math.floor(Math.log10(peak));
  const scale = Math.ceil(peak / step) * step;
  const tick = value => rate ? `${Number((value*100).toFixed(2))}%` : fmt(value);
  box.classList.toggle('is-rate',rate);
  box.innerHTML = `<div class="flow-source-legend">${rate?'<span><i></i>本店商机率</span><span><i class="is-peer"></i>类目 TOP 商机率</span>':'<span><i></i>本店访客</span>'}<small>${flowSelectedSource?'具体入口':'点击来源，查看具体入口'}</small></div>
    <div class="flow-source-axis" aria-hidden="true"><span>${esc(tick(0))}</span><span>${esc(tick(scale/2))}</span><span>${esc(tick(scale))}</span></div>
    <div class="flow-source-rows">${rows.map(row => {
      const drill = !flowSelectedSource && row.entries.length > 0;
      const delta = row.rate === null || row.topRate === null ? null : Math.round((row.rate-row.topRate)*10000)/100;
      const gap = delta === null ? '' : delta === 0 ? '与 TOP 持平' : `${delta<0?'低于':'高于'} TOP ${Math.abs(delta).toFixed(2)} 个百分点`;
      const heading = drill ? `<button type="button" data-flow-source="${esc(row.name)}" aria-label="查看${esc(row.name)}的具体入口">${esc(row.name)}<i class="ri-arrow-right-s-line" aria-hidden="true"></i></button>` : `<b>${esc(row.name)}</b>`;
      return `<article class="flow-source-row"><div class="flow-source-meta"><div class="flow-source-row-head">${heading}</div>
        ${!flowSelectedSource?`<p class="flow-source-entries">${row.entries.length?row.entries.map(entry=>`<span>${esc(entry)}</span>`).join(' · '):'平台未提供入口拆解'}</p>`:''}</div>
        <div class="flow-source-measures"><div class="flow-source-bars">${flowSourceBar(rate?row.rate:row.uv,scale,rate)}${rate?flowSourceBar(row.topRate,scale,true,true):''}</div>
        ${rate&&gap?`<span class="flow-source-gap${delta>0?' is-ahead':delta===0?' is-equal':''}">${esc(gap)}</span>`:''}</div></article>`;
    }).join('')}</div>`;
}

// ============================ 访客明细 ============================
const vState = { pageNO: 1, pageSize: 10, total: 0 };
let customerContextPromise = null;

/**
 * 读取客户页需要的服务质量、100 位访客样本与三类画像；实时会话由运营扩展独立加载。
 *
 * @returns {Promise<object>} 多数据源响应集合；单个接口失败时对应字段为 null。
 * @throws {Error} 单个接口错误由 api() 处理，不向外抛出。
 */
async function loadCustomerContext() {
  const range = visitorRange();
  const [summary, visitors, identity, countries, keywords] = await Promise.all([
    api('shop-summary', { ...dates('visitor'), statisticsType: 'day' }),
    api('visitor-detail', { ...range, pageNO: 1, pageSize: 100 }),
    api('customer-profile', { nd: '30d', dimensionType: 'byr_identity' }),
    api('customer-profile', { nd: '30d', dimensionType: 'country' }),
    api('customer-profile', { nd: '30d', dimensionType: 'shop_keyword' }),
  ]);
  return { summary, visitors, identity, countries, keywords };
}

async function loadVisitor() {
  const timeRequest=JSON.stringify(timeStates['visitor']);
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
  if(timeRequest!==JSON.stringify(timeStates['visitor']))return;
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
  const latestRow = summaryRowsLocal.slice().sort((a, b) => String(a.statDate).localeCompare(String(b.statDate))).slice(-1)[0] || {};
  const visitorData = context?.visitors?.data?.data || {};
  const visitorRows = Array.isArray(visitorData.data) ? visitorData.data : [];
  const metrics = [
    ['近 30 天访客', fmt(visitorData.total || vState.total), '访客明细完整计数'],
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
    return `<article class="priority-row"><span class="priority-score">${item.score.toFixed(1)}</span><div><div><b>${esc(masked)} · ${esc(businessCountry(row.buyerCountryId))}</b><span>${esc(row.levelTag || '未分层')}</span></div><p>${esc(row.searchKeyword || '直接访问')} · 本次 ${fmt(row.visitPv)} 页 / ${fmt(row.staySecond)} 秒</p><div class="behavior-tags">${behaviors.map(text => `<em>${esc(text)}</em>`).join('') || '<em>暂无可识别行为</em>'}</div></div></article>`;
  }).join('') : '<div class="empty">100 位访客样本中没有高意向行为</div>';


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

// 对照按源分别更新：慢画像不会挡住年度指数与行业场景。
let keywordCompareState = { profile: null, profileKind: 'loading', profileDate: '', keywords: null, industry: null, category: '', loading: false, search: '', sort: 'click', channel: 'APP', selected: '' };

/** 归一化词文本用于精确匹配，不合并同义词、单复数或不同语言。@param {*} value 原始词。@returns {string} 标准键。@throws 不主动抛错。 */
function normalizeCompareKeyword(value) { return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase(); }

/** 读取有效指数，保留真实0和未知。@param {*} value 原始指数。@returns {number|null} 0–1000指数或null。@throws 不主动抛错。 */
function keywordIndex(value) { return value == null || String(value).trim() === '' || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1000 ? null : Number(value); }

/**
 * 合并店铺核心信号、推荐词指数与行业场景热门词，保留渠道及来源边界。
 * @param {object|null} profile 店铺画像。
 * @param {object[]} resources 推荐池原始词，指数仅来自这些记录。
 * @param {object[]} scenes 行业场景；只使用全地区all，避免区域重复造成假热度。
 * @returns {object[]} 同词同渠道的对照行，未知渠道只做词级匹配。
 * @throws {Error} 不主动抛出异常。
 */
function buildKeywordComparison(profile, resources, scenes) {
  const shop = new Map();
  [['高询盘', 'highInquiryWords'], ['高引流', 'highTrafficWords'], ['高P4P', 'highP4pWords']].forEach(([label, field]) => {
    (Array.isArray(profile?.[field]) ? profile[field] : []).forEach(word => {
      const key = normalizeCompareKeyword(word.keyword);
      if (!key) return;
      const entries = shop.get(key) || [];
      entries.push({ signal: label, channel: String(word.channel || '未知').toUpperCase() });
      shop.set(key, entries);
    });
  });
  const hot = new Map();
  scenes.filter(scene => scene.countryId === 'all').forEach(scene => {
    String(scene.top3HotKw || '').split('|').forEach(word => {
      const key = normalizeCompareKeyword(word);
      if (!key) return;
      const labels = hot.get(key) || new Set();
      labels.add(scene.sceneNameCn || scene.sceneName || '行业场景');
      hot.set(key, labels);
    });
  });
  const rows = new Map();
  resources.forEach(raw => {
    const keyword = normalizeCompareKeyword(raw['关键词'] || raw.keyword);
    if (!keyword) return;
    const channel = String(raw['关键词渠道'] || raw.channel || '未知').toUpperCase();
    const key = `${keyword}|${channel}`;
    if (rows.has(key)) return; // 同一来源重复记录不累加指数。
    const labels = String(raw['关键词标签列表'] || '').split(/[,，|]/).map(x => x.trim()).filter(Boolean);
    rows.set(key, { keyword, channel, labels, exposure: keywordIndex(raw['全站搜索曝光指数']), click: keywordIndex(raw['全站搜索点击指数']), ctr: raw['全站搜索点击率'] ?? null, conversion: raw['全站商机转化率'] ?? null, products: raw['关联优爆品数量'] ?? null, resource: true, hot: labels.includes('行业热词') || hot.has(keyword) });
  });
  // 没有年度指数的行业词也保留，不能拿场景需求指数冒充词指数。
  hot.forEach((_, keyword) => {
    if (![...rows.values()].some(row => row.keyword === keyword)) rows.set(`${keyword}|未知`, { keyword, channel: '未知', labels: [], exposure: null, click: null, resource: false, hot: true });
  });
  // 店铺特定渠道信号未匹配到推荐行时，另保留该渠道，不借用另一渠道指数。
  shop.forEach((entries, keyword) => entries.forEach(entry => {
    const unknown = !['APP', 'PC'].includes(entry.channel);
    if (![...rows.values()].some(row => row.keyword === keyword && (unknown || row.channel === entry.channel))) {
      rows.set(`${keyword}|${entry.channel}`, { keyword, channel: entry.channel, labels: [], exposure: null, click: null, resource: false, hot: hot.has(keyword) });
    }
  }));
  return [...rows.values()].map(row => {
    const entries = (shop.get(row.keyword) || []).filter(entry => entry.channel === row.channel || !['APP', 'PC'].includes(entry.channel) || !['APP', 'PC'].includes(row.channel));
    const signals = [...new Set(entries.map(entry => entry.signal))];
    return { ...row, signals, wordMatch: entries.length > 0 && entries.some(entry => entry.channel !== row.channel || !['APP', 'PC'].includes(entry.channel)), scenes: [...(hot.get(row.keyword) || [])], overlap: row.hot && signals.length > 0, opportunity: row.hot && signals.length === 0, advantage: !row.hot && signals.some(signal => signal === '高询盘' || signal === '高引流') };
  });
}

/** 按筛选、搜索和指数排序展示，不对缺失指数补零。@param {object[]} rows 对照行。@param {object} state 筛选状态。@returns {object[]} 新数组。@throws 不主动抛错。 */
function filterKeywordComparison(rows, state) {
  const search = normalizeCompareKeyword(state.search);
  return rows.filter(row => (state.filter === 'all' || row[state.filter]) && row.keyword.includes(search)).sort((a, b) => state.sort === 'keyword' ? a.keyword.localeCompare(b.keyword) : (b[state.sort] ?? -1) - (a[state.sort] ?? -1) || a.keyword.localeCompare(b.keyword));
}

/**
 * 合并同词的展示信息，同时保留各渠道原始指数，供双端图与词群计数使用。
 * @param {object[]} rows 已规范化的渠道记录。@returns {object[]} 去重词及APP/PC记录。
 * @throws 不主动抛错。未知渠道仅合并标签，不移植指数；两端标签并集只表示词级入选。
 */
function groupKeywordVisualRows(rows) {
  const groups = new Map();
  rows.forEach(row => {
    const item = groups.get(row.keyword) || { keyword: row.keyword, signals: [], hot: false, channels: {} };
    item.signals = [...new Set([...item.signals, ...row.signals])];
    item.hot ||= row.hot;
    if (['APP', 'PC'].includes(row.channel)) item.channels[row.channel] = row;
    groups.set(row.keyword, item);
  });
  return [...groups.values()].filter(item => item.hot || item.signals.length).map(item => ({ ...item, overlap: item.hot && item.signals.length > 0, opportunity: item.hot && !item.signals.length, advantage: !item.hot && item.signals.some(signal => signal === '高询盘' || signal === '高引流') }));
}

/**
 * 将画像列表标签映射成有证据的店铺表现；无标签不等于无效果，P4P消耗不算正向贡献。
 * @param {string[]} signals 店铺词标签。@returns {object} 定性引流、询盘及投放信号。
 * @throws 不主动抛错。不会从行业曝光/点击指数推算店铺收益或增量。
 */
function keywordShopEvidence(signals) {
  return { traffic: signals.includes('高引流'), inquiry: signals.includes('高询盘'), paid: signals.includes('高P4P'), positive: signals.includes('高引流') || signals.includes('高询盘') };
}

/** 只读读取一个关键词来源；错误交给页内源状态展示。@param {string} ep 白名单端点。@param {object} params 查询参数。@returns {Promise<object>} 成功或失败响应。@throws 网络异常转换为失败对象。 */
async function readKeywordSource(ep, params = {}) {
  const advisorRead=window.LsouAdvisor?.beginRead('/api/q/'+ep,params);
  try {
    const response = await fetch(`/api/q/${ep}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(45000) });
    const result=await response.json();
    window.LsouAdvisor?.finishRead(advisorRead,result,!response.ok||!result.ok);
    return result;
  } catch { window.LsouAdvisor?.finishRead(advisorRead,null,true);return { ok: false, error: '查询超时或网络异常' }; }
}

/**
 * 并行读取三个只读来源，各自完成即刷新。实时空画像覆盖历史样本；失败保留带日期参考。
 * @param {boolean} force true时绕过5分钟查询缓存；默认使用缓存。
 * @returns {Promise<void>} 本轮来源读取完成。
 * @throws {Error} 外部读取失败转换为页内状态，不触发模型或广告写操作。
 */
async function loadAds(force = false) {
  if (keywordCompareState.loading) return;
  const state = keywordCompareState;
  state.loading = true;
  $('#adsCompareRefresh').onclick = () => loadAds(true);
  $('#keywordCompareSearch').oninput = event => { state.search = event.target.value; renderAdsDashboard(); };
  renderAdsDashboard();
  try {
    // 只读取当前账号；查询失败不使用开发账号的历史样本。
    const fresh = force ? { __nocache: '1' } : {};
    const profileTask = readKeywordSource('ads-shop-profile', fresh).then(result => {
      if (result.ok && result.data?.profileComplete) {
        state.profile = result.data; state.profileKind = result.stale ? 'saved' : 'live'; state.profileDate = result.fetchedAt; state.profileError = result.refreshError || '';
      } else { state.profileError = '实时画像暂不可用'; if (!state.profile) state.profileKind = 'error'; }
      renderAdsDashboard();
    });
    // 两侧共享同一次当前类目读取，年度词池也传类目限制；不跨类目推断机会。
    const categoryTask = (async () => {
      let categoryRow = summaryRows.find(row => row.cateId);
      if (!categoryRow) {
        const summary = await readKeywordSource('shop-summary', { ...dates(), statisticsType: 'day' });
        categoryRow = (Array.isArray(summary.data) ? summary.data : []).find(row => row.cateId);
      }
      state.category = categoryRow?.zhDisplay || '';
      return categoryRow;
    })();
    const wordsTask = (async () => {
      const categoryRow = await categoryTask;
      state.keywords = categoryRow ? await readKeywordSource('ads-keywords', { productId: ADS_PRODUCT_IDS[0], cateIdList: JSON.stringify([Number(categoryRow.cateId)]), requestPage: JSON.stringify({ pageIndex: 1, pageSize: 100 }), requestOrderProperty: JSON.stringify({ orderProperty: 'yearImps', orderDirection: 'desc' }), ...fresh }) : { ok: false, error: '未获取到当前店铺类目' };
      renderAdsDashboard();
    })();
    const industryTask = (async () => {
      const categoryRow = await categoryTask;
      state.industry = categoryRow ? await readKeywordSource('market-opportunities', { cateId: categoryRow.cateId, currentPage: 1, pageSize: 100, statCycle: '90d', terminalType: 'TOTAL', ...fresh }) : { ok: false, error: '未获取到当前店铺类目' };
      renderAdsDashboard();
    })();
    await Promise.allSettled([profileTask, wordsTask, industryTask]);
  } finally { state.loading = false; renderAdsDashboard(); }
}

/** 将读取时间显示为本地日期时间，历史日期原样保留。@param {string} value 日期。@returns {string} 可读文本。@throws 不主动抛错。 */
function keywordReadDate(value) { if (/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return value; return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '日期未提供'; }

/**
 * 绘制左右词图和选词详情。店铺标签使用矩阵，避免把定性信号虚构成流量；行业指数保持统一刻度。
 * @param {object[]} rows 完整词/渠道记录，用于点击后的来源核对。
 * @param {object[]} shown 已筛选记录，仅控制两栏词集合。
 * @param {object} state 渠道、指标及选词状态。
 * @param {string} profileLabel 店铺数据真实性标记。
 * @returns {void} 更新两栏并绑定原生按钮交互。
 * @throws {Error} 缺少页面容器时抛出DOM错误。
 */
function renderKeywordVisuals(rows, shown, state, profileLabel) {
  const allowed = new Set(shown.map(row => row.keyword));
  const wordGroups = groupKeywordVisualRows(rows);
  const shop = new Map();
  rows.filter(row => row.signals.length && allowed.has(row.keyword)).forEach(row => {
    const item = shop.get(row.keyword) || { keyword: row.keyword, signals: new Set(), overlap: false };
    row.signals.forEach(signal => item.signals.add(signal));
    shop.set(row.keyword, item);
  });
  const shopWords = [...shop.values()].sort((a, b) => b.signals.size - a.signals.size || a.keyword.localeCompare(b.keyword));
  // 同词双端并排，排序依据所选终端；缺少该终端仍保留词和缺项标记。
  const industryWords = wordGroups.filter(word => word.hot && allowed.has(word.keyword)).sort((a,b) => (b.channels[state.channel]?.[state.sort] ?? -1) - (a.channels[state.channel]?.[state.sort] ?? -1) || a.keyword.localeCompare(b.keyword));
  const visible = new Set([...shopWords, ...industryWords].map(row => row.keyword));
  if (!visible.has(state.selected)) state.selected = '';
  const selected = word => state.selected === word;
  const empty = text => `<div class="keyword-chart-empty"><i class="ri-search-line" aria-hidden="true"></i><span>${text}</span></div>`;
  $('#adsCoreWords').innerHTML = `<section class="keyword-pane keyword-shop" aria-label="店铺核心词信号图">
    <header><div class="keyword-pane-title"><i class="ri-store-2-line" aria-hidden="true"></i><h3>店铺核心词</h3><span>${shopWords.length}</span></div><p>${esc(profileLabel)} · ${esc(String(state.profileDate || '').slice(0,10) || '日期待获取')}</p></header>
    <div class="keyword-matrix-head"><span>关键词</span><span>高询盘</span><span>高引流</span><span>高P4P</span></div>
    <div class="keyword-chart-list">${shopWords.length ? shopWords.map(word => `<button type="button" class="keyword-shop-row ${selected(word.keyword) ? 'is-selected' : ''}" data-word="${esc(word.keyword)}" aria-pressed="${selected(word.keyword)}" aria-label="店铺词 ${esc(word.keyword)}：${esc([...word.signals].join('、'))}"><span class="keyword-word">${esc(word.keyword)}</span>${['高询盘','高引流','高P4P'].map((signal,index) => `<span class="keyword-signal-cell"><i class="keyword-dot signal-${index} ${word.signals.has(signal) ? 'is-on' : ''}" aria-hidden="true"></i></span>`).join('')}</button>`).join('') : empty(state.loading ? '店铺词读取中…' : '当前筛选未匹配到店铺词')}</div>
    <footer><span class="keyword-dot is-on signal-0"></span> 已进入相应词列表 <span class="keyword-dot"></span> 未见该信号</footer>
  </section>
  <section class="keyword-pane keyword-market" aria-label="行业热门词指数图">
    <header><div class="keyword-pane-title"><i class="ri-bar-chart-horizontal-line" aria-hidden="true"></i><h3>行业热门词</h3><span>${industryWords.length}</span><div class="keyword-terminal" role="group" aria-label="排序与详情终端">${['APP','PC'].map(channel => `<button type="button" data-channel="${channel}" aria-pressed="${state.channel === channel}">${channel}</button>`).join('')}</div></div><p>推荐池 / 场景热词 · 需核查类目相关性 · 终端切换用于排序与详情</p></header>
    <div class="keyword-chart-axis"><select id="keywordCompareSort" aria-label="行业指数指标"><option value="exposure" ${state.sort === 'exposure' ? 'selected' : ''}>搜索曝光指数</option><option value="click" ${state.sort === 'click' ? 'selected' : ''}>搜索点击指数</option></select><span>近一年 · 0–1000</span></div>
    <div class="keyword-chart-list">${industryWords.length ? industryWords.map(word => `<button type="button" class="keyword-market-row ${selected(word.keyword) ? 'is-selected' : ''}" data-word="${esc(word.keyword)}" aria-pressed="${selected(word.keyword)}" aria-label="行业词 ${esc(word.keyword)}：APP ${word.channels.APP?.[state.sort] ?? '未提供'}，PC ${word.channels.PC?.[state.sort] ?? '未提供'}"><span class="keyword-word">${esc(word.keyword)}</span><span class="keyword-paired-bars">${['APP','PC'].map(channel => { const value = word.channels[channel]?.[state.sort]; return `<span class="keyword-paired-line ${channel.toLowerCase()}"><small>${channel}</small><span class="keyword-paired-track">${value == null ? '<em>未提供</em>' : `<i style="width:${value/10}%"></i>`}</span><b>${value ?? '—'}</b></span>`; }).join('')}</span></button>`).join('') : empty(state.loading ? '行业词读取中…' : '当前筛选下暂无行业热词')}</div>
    <footer><span class="keyword-key app"></span> APP <span class="keyword-key pc"></span> PC <span>同刻度 · 指数非实际搜索量</span></footer>
  </section>`;
  const selectedRows = rows.filter(row => row.keyword === state.selected);
  const shopSignals = [...new Set(selectedRows.flatMap(row => row.signals))];
  const market = selectedRows.find(row => row.channel === state.channel && row.resource);
  const evidence = keywordShopEvidence(shopSignals);
  $('#keywordSelection').innerHTML = state.selected ? `<div class="keyword-selected-title"><i class="ri-focus-3-line" aria-hidden="true"></i><strong>${esc(state.selected)}</strong><span>${state.profileKind === 'sample' ? '历史样本信号' : esc(profileLabel)}</span></div><div class="keyword-impact-grid"><div><span>店铺曝光</span><b class="unknown">逐词数据未接入</b></div><div><span>店铺点击</span><b class="unknown">逐词数据未接入</b></div><div class="${evidence.traffic ? 'positive' : ''}"><span>店铺引流</span><b>${evidence.traffic ? '✓ 高引流词' : '未见高引流标签'}</b></div><div class="${evidence.inquiry ? 'positive' : ''}"><span>店铺询盘</span><b>${evidence.inquiry ? '✓ 高询盘词' : '未见高询盘标签'}</b></div></div><small>标签来自店铺画像，尚不能量化带来的次数或增量。${evidence.paid ? '另有高P4P消耗信号，不代表投放有效。' : ''}${selectedRows.some(row => row.wordMatch) ? '渠道未核实。' : ''}</small><details class="keyword-market-reference"><summary>行业参考 · ${state.channel} · 非店铺表现</summary><span>曝光指数 <b>${market?.exposure ?? '—'}</b></span><span>点击指数 <b>${market?.click ?? '—'}</b></span><span>全站点击率 <b>${esc(market?.ctr ?? '—')}</b></span><span>全站商机转化率 <b>${esc(market?.conversion ?? '—')}</b></span></details>` : '<div class="keyword-selection-hint"><i class="ri-cursor-line" aria-hidden="true"></i> 点击任一词，查看它在店铺的引流、询盘信号，以及曝光、点击数据是否齐全</div>';
  $$('#adsCoreWords [data-word]').forEach(button => button.onclick = () => {
    // 只替换可视区，保持搜索焦点；保留滚动位置，避免长列表选词后跳回顶端。
    const positions = $$('#adsCoreWords .keyword-chart-list').map(list => list.scrollTop);
    state.selected = button.dataset.word;
    renderKeywordVisuals(rows, shown, state, profileLabel);
    $$('#adsCoreWords .keyword-chart-list').forEach((list,index) => { list.scrollTop = positions[index]; });
    const origin = button.closest('.keyword-pane').classList.contains('keyword-shop') ? '.keyword-shop' : '.keyword-market';
    const focusButton = [...document.querySelectorAll(`${origin} [data-word]`)].find(item => item.dataset.word === state.selected);
    focusButton?.focus({ preventScroll: true });
    const peer = document.querySelector(`${origin === '.keyword-shop' ? '.keyword-market' : '.keyword-shop'} .is-selected`);
    if (peer) { const list = peer.closest('.keyword-chart-list'); list.scrollTop = peer.offsetTop - list.offsetTop - list.clientHeight / 2 + peer.clientHeight / 2; }
  });
  $$('#adsCoreWords [data-channel]').forEach(button => button.onclick = () => { state.channel = button.dataset.channel; renderAdsDashboard(); document.querySelector(`[data-channel="${state.channel}"]`)?.focus({ preventScroll: true }); });
  $('#keywordCompareSort').onchange = event => { state.sort = event.target.value; renderAdsDashboard(); $('#keywordCompareSort').focus({ preventScroll: true }); };
}

/**
 * 展示行业需求场景、指数和热门词，保持中性色，不推断店铺是否使用这些词。
 * @param {object[]} scenes 行业场景。@param {object} state 页面搜索和选词状态。
 * @returns {void} 更新场景卡并绑定选词联动。@throws 缺少DOM容器时抛错。
 */
function renderKeywordScenes(scenes, state) {
  const chip = keyword => `<button type="button" class="keyword-scene-chip" data-scene-word="${esc(keyword)}" title="查看 ${esc(keyword)} 的数据">${esc(keyword)}</button>`;
  const sceneRows = scenes.map(scene => ({ ...scene, value: scene.needsIndex == null || String(scene.needsIndex).trim() === '' ? null : Number(scene.needsIndex) })).sort((a,b) => (b.value ?? -1)-(a.value ?? -1));
  const ceiling = Math.max(1,...sceneRows.map(scene => Number.isFinite(scene.value) ? scene.value : 0));
  $('#keywordSceneSpotlight').innerHTML = `<header><h3>行业需求场景与热门词</h3><span>近90天 · 全地区 · ${esc([...new Set(scenes.map(scene=>scene.statDate).filter(Boolean))].join(' / ') || '日期待获取')}</span></header><div class="keyword-scene-grid">${sceneRows.length ? sceneRows.map(scene => `<section><div class="keyword-scene-title"><h4>${esc(scene.sceneNameCn || scene.sceneName)}</h4><strong>${Number.isFinite(scene.value) ? scene.value.toLocaleString('zh-CN',{maximumFractionDigits:0}) : '—'}</strong></div><div class="keyword-scene-bar"><i style="width:${Number.isFinite(scene.value) && scene.value >= 0 ? scene.value/ceiling*100 : 0}%"></i></div><div class="keyword-scene-meta"><span>需求指数</span><span>环比 ${scene.needsIndexQoq == null ? '—' : (Number(scene.needsIndexQoq)>=0 ? '+' : '')+(Number(scene.needsIndexQoq)*100).toFixed(1)+'%'}</span></div><div class="keyword-scene-words">${String(scene.top3HotKw || '').split('|').filter(Boolean).map(keyword => chip(normalizeCompareKeyword(keyword))).join('')}</div></section>`).join('') : '<div class="keyword-mini-empty">行业场景读取中或暂不可用</div>'}</div>`;
  $$('[data-scene-word]').forEach(button => button.onclick = () => {
    state.selected = button.dataset.sceneWord; state.search = '';
    $('#keywordCompareSearch').value = '';
    renderAdsDashboard();
    [...document.querySelectorAll('[data-scene-word]')].find(item => item.dataset.sceneWord === state.selected)?.focus({preventScroll:true});
    $('#keywordSelection').scrollIntoView({ behavior: 'auto', block: 'nearest' });
  });
}

/**
 * 渲染词级对照及分源日期。所有匹配是确定性计算；不会生成AI诊断或花费token。
 * @returns {void} 更新对照表、筛选数及来源状态。
 * @throws {Error} 页面容器缺失时抛出DOM错误。
 */
function renderAdsDashboard() {
  const state = keywordCompareState;
  const resources = state.keywords?.ok ? pagedRows(state.keywords).rows : [];
  const scenes = state.industry?.ok && Array.isArray(state.industry.data) ? state.industry.data.filter(row => row.countryId === 'all') : [];
  const rows = buildKeywordComparison(state.profile, resources, scenes);
  const groups = groupKeywordVisualRows(rows);
  $('#adsCompareRefresh').disabled = state.loading;
  $('#adsCompareRefresh').textContent = state.loading ? '正在更新…' : '更新词数据';
  const allowedWords = new Set(groups.filter(word => word.keyword.includes(normalizeCompareKeyword(state.search))).map(word => word.keyword));
  const shown = rows.filter(row => allowedWords.has(row.keyword));
  const profileLabel = state.profileKind === 'live' ? '本账号画像' : state.profileKind === 'saved' ? '本账号保存快照' : state.profileKind === 'sample' ? '历史样本 · 非当前账号核验' : '店铺画像';
  const sceneDates = [...new Set(scenes.map(row => row.statDate).filter(Boolean))].join(' / ');
  $('#adsDataDate').textContent = state.loading ? '分来源更新中' : state.profileKind === 'sample' ? '历史样本对照' : '来源日期分别标注';
  $('#adsDataDate').className = 'data-state';
  $('#keywordSourceStatus').innerHTML = `<div><b>${profileLabel}</b><span>${state.profile ? esc(keywordReadDate(state.profileDate)) : '暂无数据'}${state.profileError ? ' · '+esc(state.profileError) : ''}</span><small>高询盘 / 高引流 / 高P4P 信号；各词统计周期以平台为准</small></div><div><b>年度词指数 · 问鼎推荐池</b><span>${state.keywords?.ok ? '读取于 '+esc(keywordReadDate(state.keywords.fetchedAt)) : state.keywords ? '读取失败，可重试' : '读取中…'}</span><small>已传入当前类目；推荐结果可能跨类目，需核实相关性</small></div><div><b>行业需求 · 近90天</b><span>${state.industry?.ok ? '平台日期 '+esc(sceneDates || '未提供') : state.industry ? '读取失败或未获取类目' : '读取中…'}</span><small>${esc(state.category || '等待当前店铺类目')}</small></div>`;
  renderKeywordScenes(scenes, state);
  renderKeywordVisuals(rows, shown, state, profileLabel);
  $('#keywordCompareCount').textContent = `点击关键词查看数据 · 各来源最多取首批100条`;

}

// ============================ RFQ 商机 ============================
let rfqState = {
  compareIds: new Set(), quoteIds: new Set(), history: [], compareVersion: 0, quoteVersion: 0,
  items: [],
  filtered: [],
  selected: null,
  source: 'all',
  country: 'all',
  keyword: '',
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
 * 按用户输入读取站内、站外 RFQ 与当前账号报价历史。
 *
 * 权益接口在当前账号会长时间阻塞，因此首屏不会实时调用它；这能保证商机列表
 * 快速可用，同时在权益卡中明确标注快照日期和实时接口状态。
 *
 * @param {string} [keyword] - 英文产品搜索词，默认沿用当前输入框。
 * @returns {Promise<void>} 数据读取、筛选和页面渲染完成后返回。
 * @throws {Error} 单个接口失败会显示局部空状态，不会让整页失效。
 */
async function loadRfq(keyword = $('#rfqKeyword')?.value.trim() || '') {
  rfqState.keyword = String(keyword || '').trim();
  rfqState.compareIds.clear();rfqState.quoteIds.clear();rfqState.compareVersion++;rfqState.quoteVersion++;
  $('#rfqComparisonResult').hidden=true;$('#rfqQuoteDetailResult').hidden=true;
  $('#rfqOpportunityList').innerHTML = '<div class="empty"><span class="spin"></span> 正在读取商机…</div>';
  const [internal, external, history] = await Promise.all([
    rfqState.keyword ? api('rfq-internal-search', { pageNum: 1, pageSize: 10, searchText: rfqState.keyword }) : Promise.resolve(null),
    rfqState.keyword ? api('rfq-external-search', { keywords: JSON.stringify([rfqState.keyword]), pageNum: 1, pageSize: 10 }) : Promise.resolve(null),
    api('rfq-quote-history', { pageSize: 20, currentPage: 1 }),
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
  renderRfqKpis(null);
  renderRfqHistory(history?.data?.items || []);
  renderRfqRights(null);
  // 权益未实时核验，不填入任何商家的历史数字。
  applyRfqFilters();
  if (!rfqState.keyword) $('#rfqOpportunityList').innerHTML = '<div class="empty">请输入当前产品的英文关键词，再搜索商机。</div>';
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
 * @param {object|null} rights - 当前账号实时核验的权益结果。
 * @returns {void} 直接更新 #rfqKpis。
 * @throws {Error} 不主动抛异常。
 */
function renderRfqKpis(rights) {
  const rightsValue = rights && Number.isFinite(Number(rights.availableQuote)) ? fmt(rights.availableQuote) : '—';
  $('#rfqKpis').innerHTML = [
    ['站内 RFQ', rfqState.keyword ? fmt(rfqState.totals.internal) : '—', `${rfqState.keyword} · 平台数据`],
    ['站外 RFQ', rfqState.keyword ? fmt(rfqState.totals.external) : '—', `MIC / Tradewheel · 平台数据`],
    ['报价历史', fmt(rfqState.totals.quotes), '平台历史记录 · 平台数据'],
    ['剩余普通权益', rightsValue, rights?.auditedAt ? `审计快照 · ${rights.auditedAt}` : '尚未查询当前账号权益'],
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
  updateRfqSelections();
  $('#rfqPoolCount').textContent = rfqState.keyword ? `当前展示 ${rfqState.filtered.length} 条 · 总量 ${fmt(rfqState.totals.internal + rfqState.totals.external)}` : '尚未搜索';
  if (!rfqState.filtered.length) {
    $('#rfqOpportunityList').innerHTML = '<div class="designed-empty"><i class="ri-inbox-2-line" aria-hidden="true"></i><b>没有符合筛选的 RFQ</b><span>调整来源、国家或搜索词后再试。</span></div>';
    return;
  }
  $('#rfqOpportunityList').innerHTML = rfqState.filtered.map((item, index) => {
    const selected = rfqState.selected?.id === item.id;
    const quantity = item.quantity ? `${fmt(item.quantity)} ${esc(item.quantityUnit || '')}` : '数量待确认';
    const signals = [item.country, item.category, item.createdText].filter(Boolean).slice(0, 3);
    return `<div class="rfq-selectable-row">${item.sourceType==='internal'?`<label class="rfq-select-toggle"><input type="checkbox" data-rfq-compare="${index}" aria-label="选择商机 ${esc(item.title)}" ${rfqState.compareIds.has(item.id)?'checked':''}><span>对比</span></label>`:'<span class="rfq-select-toggle hint">站外</span>'}<button class="rfq-opportunity-card ${selected ? 'on' : ''}" type="button" data-rfq-index="${index}" aria-pressed="${selected}">
      <span class="rfq-thumb ${item.image ? 'has-image' : ''}">${item.image ? `<img src="${esc(item.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<i class="${item.sourceType === 'internal' ? 'ri-file-search-line' : 'ri-global-line'}" aria-hidden="true"></i>`}</span>
      <span class="rfq-card-copy"><span class="rfq-card-top"><em>${esc(item.sourceType === 'internal' ? '站内 RFQ' : item.source || '站外 RFQ')}</em><b>运营优先级 ${item.priority}</b></span><strong>${esc(item.title || '未命名采购需求')}</strong><small>${signals.map(esc).join(' · ') || '采购信息待补充'}</small><span class="rfq-card-bottom"><span>${quantity}</span><span>${fmt(item.quotedCount)} 家已报价 · 剩 ${fmt(item.remainingQuota)} 席</span></span></span>
    </button></div>`;
  }).join('');
  $$('[data-rfq-compare]').forEach(box=>box.onchange=()=>{const item=rfqState.filtered[Number(box.dataset.rfqCompare)];if(box.checked&&rfqState.compareIds.size>=20){box.checked=false;return;}box.checked?rfqState.compareIds.add(item.id):rfqState.compareIds.delete(item.id);updateRfqSelections();});
  updateRfqSelections();
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
/** 更新勾选数量和操作状态；使用当前可见记录，返回void。 */
function updateRfqSelections() {
  const available=new Set(rfqState.filtered.filter(r=>r.sourceType==='internal').map(r=>r.id));
  rfqState.compareIds=new Set([...rfqState.compareIds].filter(id=>available.has(id)));
  $('#rfqCompareCount').textContent=`已选 ${rfqState.compareIds.size} 条站内商机`;
  $('#rfqCompareBtn').disabled=rfqState.compareIds.size===0;
  $('#rfqQuoteCompareCount').textContent=`已选 ${rfqState.quoteIds.size} 条报价`;
  $('#rfqQuoteCompareBtn').disabled=rfqState.quoteIds.size===0;
}
/** 请求所选商机/报价的详情；逐条渲染成功、无返回和失败，网络失败不补零。 */
async function queryRfqSelection(action,ids,button) {
  const host=$(action==='opportunities'?'#rfqComparisonResult':'#rfqQuoteDetailResult');
  const sequence=(action==='opportunities'?++rfqState.compareVersion:++rfqState.quoteVersion);
  const keyword=rfqState.keyword;
  host.hidden=false;host.innerHTML='<p class="hint">正在读取所选记录，请稍候…</p>';button.disabled=true;
  try {
    const response=await fetch('/api/capabilities/rfq',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,ids,keyword})});
    const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'读取失败');
    if(sequence!==(action==='opportunities'?rfqState.compareVersion:rfqState.quoteVersion))return;
    const items=result.data.items||[];
    const fields=action==='opportunities'?[['采购需求','description'],['国家','country'],['采购数量','quantity'],['数量单位','quantityUnit'],['类目','category'],['已报价商家','quotedCount'],['剩余报价席位','remainingQuota']]:[['报价商品','productTitle'],['单价','unitPrice'],['币种','currency'],['数量','quantity'],['付款方式','paymentMethod'],['贸易条款','shippingTerms'],['港口','port'],['报价时间','quotationTime'],['报价有效期','validPeriod']];
    host.innerHTML=`<header class="rfq-result-header"><div><h3>${action==='opportunities'?'采购需求对比':action==='quote'?'报价详情':'报价对比'}</h3><p>${items.filter(r=>r.status==='succeeded').length} / ${items.length} 条读取成功 · ${esc(rfqTimeLabel(result.data.fetchedAt))}</p></div><button class="ghost sm rfq-close-results" type="button">收起结果</button></header>${action==='opportunities'?'':'<p class="hint">仅查看已提交报价；币种未返回时不推断币种，也不跨币种比较价格。</p>'}<div class="rfq-comparison-scroll"><table class="rfq-comparison-table"><thead><tr><th>对比项目</th>${items.map(r=>`<th>${esc(r.title)}</th>`).join('')}</tr></thead><tbody><tr><th>读取状态</th>${items.map(r=>`<td>${r.status==='succeeded'?'已读取':esc(r.error||'未返回详情')}</td>`).join('')}</tr>${fields.map(([label,key])=>`<tr><th>${label}</th>${items.map(r=>`<td>${r.status==='succeeded'?esc(r.detail?.[key]??'未返回'):'—'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    host.querySelector('.rfq-close-results').onclick=()=>{host.hidden=true;};host.scrollIntoView({behavior:'smooth',block:'nearest'});
  }catch(error){if(sequence===(action==='opportunities'?rfqState.compareVersion:rfqState.quoteVersion))host.textContent='读取未完成：'+error.message;}
  finally{button.disabled=false;updateRfqSelections();}
}

function renderRfqHistory(rows) {
  const safeRows=Array.isArray(rows)?rows:[];rfqState.history=safeRows;rfqState.quoteIds.clear();
  $('#rfqHistoryCount').textContent=`${safeRows.length} 条 · 平台数据`;
  $('#rfqHistoryBody').innerHTML=safeRows.length?safeRows.map((row,index)=>`<tr><td><input type="checkbox" data-quote-select="${index}" aria-label="选择报价 ${esc(row.title)}"></td><td><b>${esc(row.title||'未命名RFQ')}</b><small>${esc(rfqTimeLabel(row.rfqTime))} 发布</small></td><td>${esc(row.country||'—')}<small>${esc(row.buyerLevel||'等级未返回')}</small></td><td>${esc(rfqTimeLabel(row.quoteTime))}</td><td><span class="action-tag">${esc(row.status||'已报价')}</span></td><td><button type="button" class="ghost sm" data-quote-detail="${index}">查看详情</button></td></tr>`).join(''):'<tr><td colspan="6"><div class="empty">本次没有返回报价历史</div></td></tr>';
  $$('[data-quote-select]').forEach(box=>box.onchange=()=>{const row=safeRows[Number(box.dataset.quoteSelect)];if(box.checked&&rfqState.quoteIds.size>=10){box.checked=false;$('#rfqQuoteCompareCount').textContent='每次最多选择10条报价';return;}box.checked?rfqState.quoteIds.add(row.id):rfqState.quoteIds.delete(row.id);updateRfqSelections();});
  $$('[data-quote-detail]').forEach(button=>button.onclick=()=>queryRfqSelection('quote',[safeRows[Number(button.dataset.quoteDetail)].id],button));
  updateRfqSelections();
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
    $('#rfqRightsState').textContent = '尚未查询当前账号权益';
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

/** 将两位国家代码转为中文；普通名称保留。@param {*} value 平台国家值。@returns {string} 中文名称或原值。@throws 无，非法代码回退。 */
function businessCountry(value) {
  const text = String(value || '国家未返回');
  try {
    const chinese = new Intl.DisplayNames(['zh-CN'], {type: 'region'});
    if (/^[A-Za-z]{2}$/.test(text)) return chinese.of(text.toUpperCase());
    // 用浏览器自带地区名称表匹配英文，不改接口参数或原始数据。
    if (!businessCountry.names) {
      businessCountry.names = new Map();
      const english = new Intl.DisplayNames(['en'], {type: 'region'});
      for (let first = 65; first <= 90; first++) for (let second = 65; second <= 90; second++) {
        const code = String.fromCharCode(first, second);
        const name = english.of(code);
        if (name !== code) businessCountry.names.set(name.toLowerCase(), chinese.of(code));
      }
      businessCountry.names.set("cote d'ivoire", '科特迪瓦');
    }
    return businessCountry.names.get(text.toLowerCase()) || text;
  } catch { return text; }
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
  const timeRequest=JSON.stringify(timeStates['staff']);
  const j = await api('account-summary', { ...dates('staff'), statisticsType: timeStates.staff.mode });
  if(timeRequest!==JSON.stringify(timeStates['staff']))return;
  if (!j) return;
  const rows = [];
  (Array.isArray(j.data) ? j.data : []).forEach(blk =>
    Object.entries(blk || {}).forEach(([period, list]) =>
      (list || []).forEach(r => rows.push({ ...r, __period: period }))));
  renderStaff(rows);
}

/** 读取绩效数值，保留缺失；回复时长兼容成员与总计的不同字段。@param {object} row 周期记录。@param {string} key 指标。@returns {number|null} 有限数值。@throws 无。 */
function staffMetric(row, key) {
  const value = key === 'avgReplyTime' ? row.avgReplyTime ?? row.replyAvgTime : row[key];
  return value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
}
/** 三类绩效同屏展示。每次只展示一个真实周期，总计与成员分开，不平均百分比或跨币种加总。
 * @param {object[]} rows 全部周期记录。@param {string} period 所选周期，默认最新。
 * @returns {void} 更新图表及成员明细。@throws DOM缺失时抛错。
 */
function renderStaff(rows, period) {
  const box = $('#staffTable');
  if (!rows.length) { box.innerHTML = '<div class="empty">无员工数据</div>'; return; }
  const periods = [...new Set(rows.map(row=>row.__period))].sort().reverse();
  period = periods.includes(period) ? period : periods[0];
  const current = rows.filter(row=>row.__period===period);
  const total = current.find(row=>row.fullName==='全部账号');
  const members = current.filter(row=>row.fullName!=='全部账号').sort((a,b)=>(staffMetric(b,'clicks')??-1)-(staffMetric(a,'clicks')??-1));
  const configs = [
    ['成交结果','result',[['drawupMordCnt','起草订单','单'],['prepayMordCnt','已付款订单','单'],['rcvdAmt','实收金额','币种未返回']]],
    ['客户响应','response',[['fbUv','询盘人数','人'],['fbPv','询盘数','次'],['uvFbAtm','TM访客','人'],['replyRate','回复率','%'],['fst5minReplyRate30d','5分钟回复率','%'],['avgReplyTime','平均回复时长','小时']]],
    ['商品操作','execution',[['impression','曝光','次'],['clicks','点击','次'],['newProductCount','新增商品','件'],['alterProductCount','编辑商品','件'],['totalProductCount','在架商品','件'],['reviewedRfq','RFQ','条']]]
  ];
  const display = (row,key,unit) => {const n=staffMetric(row,key);return n==null?'—':unit==='%'?(n*100).toFixed(1)+'%':n.toLocaleString('zh-CN',{maximumFractionDigits:2});};
  box.innerHTML = `<div class="staff-dashboard-toolbar"><span>点击成员，查看完整绩效</span><label>平台报告日期 <select id="staffPeriod" aria-label="绩效展示周期">${periods.map(value=>`<option ${value===period?'selected':''}>${esc(value)}</option>`).join('')}</select></label></div><div class="staff-dashboard">${configs.map(([title,kind,metrics])=>`<section class="staff-chart-section ${kind}"><header class="staff-section-heading"><h3><i class="${({result:'ri-bar-chart-box-line',response:'ri-customer-service-2-line',execution:'ri-box-3-line'})[kind]}" aria-hidden="true"></i>${title}</h3><span>${members.length} 位成员 · ${metrics.length} 项指标</span></header><div class="staff-section-body"><div class="staff-member-rail"><div class="staff-rail-heading"><span>团队成员</span><small>点击查看详情</small></div>${members.map((row,index)=>`<button type="button" class="staff-member-label" data-staff-member="${index}" aria-label="查看 ${esc(row.fullName)} 的完整绩效"><i aria-hidden="true">${esc(String(row.fullName||'?').split(/\s+/).map(n=>n[0]).slice(0,2).join('').toUpperCase())}</i><span>${esc(row.fullName)}</span></button>`).join('')}</div><div class="staff-metrics-grid">${metrics.map(([key,label,unit])=>{
    const max=unit==='%'?1:Math.max(1,...members.map(row=>staffMetric(row,key)??0));
    const unavailable = members.every(row=>staffMetric(row,key)==null);
    const allZero = members.length > 0 && members.every(row=>staffMetric(row,key)===0);
    return `<div class="staff-metric-chart ${unavailable || allZero ? 'no-series' : ''} ${key==='rcvdAmt'?'money-series':''}"><div class="staff-metric-summary"><h4>${label}</h4><strong>${total ? display(total,key,unit):'—'}</strong><small>${unit==='%'?'平台总计':unit+' · 平台总计'}</small></div>${unavailable ? '<div class="staff-no-series"><i class="ri-bar-chart-line" aria-hidden="true"></i><span>暂无成员分项</span><small>可查看上方总计</small></div>' : allZero ? `<div class="staff-no-series"><b>0</b> ${members.length} 位成员该项均为 0</div>` : members.map((row,index)=>{const value=staffMetric(row,key);return `<button type="button" data-staff-member="${index}" class="staff-bar-row ${value===0?'is-zero':''}" aria-label="${esc(row.fullName)} ${label} ${display(row,key,unit)}"><span>${esc(row.fullName)}</span><i>${value==null?'<em>未返回</em>':key==='rcvdAmt'?'<em>原值</em>':`<b style="width:${Math.max(0,Math.min(100,value/max*100))}%"></b>`}</i><strong>${display(row,key,unit)}</strong></button>`;}).join('')}</div>`;
  }).join('')}</div></div></section>`).join('')}</div><p class="staff-scope">总计直接使用平台“全部账号”行；成员图不重复加入总计。回复率不做简单平均，在架商品不跨期累加；金额币种未返回，数值仅供逐账号核对。</p>`;
  // 同一成员在本条区域内同步高亮，帮助横向对照；只改变样式，不重新请求数据。
  box.querySelectorAll('.staff-chart-section').forEach(section => {
    const highlight = event => {
      const selected = event.target.closest('[data-staff-member]')?.dataset.staffMember;
      section.querySelectorAll('[data-staff-member]').forEach(el => el.classList.toggle('member-highlight', selected !== undefined && el.dataset.staffMember === selected));
    };
    section.addEventListener('pointerover', highlight);
    section.addEventListener('focusin', highlight);
    const clear = () => section.querySelectorAll('.member-highlight').forEach(el => el.classList.remove('member-highlight'));
    section.addEventListener('pointerleave', clear);
    section.addEventListener('focusout', clear);
  });
  $('#staffPeriod').onchange=event=>renderStaff(rows,event.target.value);
  box.querySelectorAll('[data-staff-member]').forEach(button=>button.onclick=()=>{
    const row=members[Number(button.dataset.staffMember)];
    $('#modalBody').innerHTML=`<h2>${esc(row.fullName)} · ${esc(period)}</h2>${configs.map(([title,,metrics])=>`<h3 class="staff-detail-title">${title}</h3><div class="kvgrid">${metrics.map(([key,label,unit])=>`<div class="kv"><div class="k">${label}</div><div class="v">${display(row,key,unit)} ${unit==='%'?'':unit}</div></div>`).join('')}</div>`).join('')}`;
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

/** 根据各工具时间合同生成日期/枚举控件，不再统一使用自由文本。@returns {void}。@throws DOM缺失。 */
function buildFlags() {
  const ep=EPS.find(e=>e.key===$('#cEndpoint').value);if(!ep)return;
  const d=TimePolicy.period('month',defaultTimeValue('month'));
  $('#cFlags').innerHTML=ep.flags.map(f=>{
    const choices=TimePolicy.enums[ep.key]?.[f];
    if(choices) return `<label>--${f}<select data-f="${f}">${f==='openTime'?'<option value="">不限发布时间</option>':''}${choices.map(value=>`<option value="${value}">${f==='dateType' ? (value==='0'?'按日':ep.key==='tm-account-diagnosis'?'按月':'按周') : value}</option>`).join('')}</select></label>`;
    let type='text',def='',attrs='';
    if(['startDate','endDate','startStatDate','endStatDate','statDate','queryDate'].includes(f)) {
      type='date';def=f==='queryDate'?TimePolicy.shift(TimePolicy.today(),-2):f==='statDate'?TimePolicy.shift(TimePolicy.today(),-2):f.startsWith('end')?d.endDate:d.startDate;
      attrs=`max="${f==='queryDate'?TimePolicy.shift(TimePolicy.today(),-2):TimePolicy.today()}"`;
      if(ep.key==='shop-product')attrs+=` min="${TimePolicy.shift(TimePolicy.today(),-89)}"`;
    }
    if(['gmtOpenFrom','gmtOpenTo'].includes(f)){type='datetime-local';attrs='step="1"';}
    if(/^(gmtOpen(Start|End)|postTime(Start|End)|expiredTime(Start|End)|limitTimeStamp)$/.test(f)){type='number';attrs='min="0" step="1"';}
    return `<label>--${f}<input type="${type}" data-f="${f}" value="${def}" ${attrs} placeholder="留空则不传"></label>`;
  }).join('');
  const granularity=$('#cFlags [data-f="statisticsType"]'),stat=$('#cFlags [data-f="statDate"]');
  if(ep.key==='shop-product' && granularity && stat)granularity.onchange=()=>{
    stat.disabled=granularity.value==='week';stat.type=granularity.value==='month'?'month':'date';
    stat.value=granularity.value==='week'?'':defaultTimeValue(granularity.value);
    const earliest=TimePolicy.shift(TimePolicy.today(),-89);
    stat.min=granularity.value==='month'?TimePolicy.addMonths(earliest.slice(0,7)+'-01',earliest.endsWith('-01')?0:1).slice(0,7):earliest;
    stat.max=granularity.value==='month'?defaultTimeValue('month'):TimePolicy.today();previewCmd();
  };
  $$('#cFlags input, #cFlags select').forEach(i=>i.addEventListener('input',previewCmd));
  previewCmd();
}
/** 将日期控件转换成工具要求的紧凑日/北京时间，分页游标保持数值。@returns {object} 显式参数。@throws 无。 */
function consoleParams() {
  const p={},key=$('#cEndpoint').value;
  $$('#cFlags input, #cFlags select').forEach(i=>{
    if(i.disabled || !i.value.trim())return;
    let value=i.value.trim();
    if(i.type==='month')value+='-01';
    if(i.type==='datetime-local') {value=value.replace('T',' ');if(value.length===16)value+=':00';}
    if((TimePolicy.adEffects.includes(key) || key==='ads-achieve-rate') && /Date$/.test(i.dataset.f))value=value.replaceAll('-','');
    p[i.dataset.f]=value;
  });
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
 * 这里描述页面结构、字段和 WorkCTL 数据来源；下面的 实时接口结果
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


/**
 * 把状态分布渲染成可比较的横向刻度，而不是把每个数字拆成孤立卡片。
 *
 * @param {Array<[string, number]>} distribution - 状态名称与对应数量。
 * @param {string} tone - CSS 色彩语义，支持 order、logistics 或 risk。
 * @returns {string} 已转义的状态分布 HTML。
 * @throws {Error} 不主动抛出异常；空数组会返回空字符串。
 */
function renderOnePageDistribution(distribution = [], tone = 'order') {
  const max = Math.max(1, ...distribution.map(([, count]) => Number(count) || 0));
  return distribution.map(([label, count]) => {
    const safeCount = Math.max(0, Number(count) || 0);
    const width = Math.max(4, Math.round((safeCount / max) * 100));
    return `<div class="one-page-distribution-row">
      <span>${esc(label)}</span>
      <i aria-hidden="true"><b class="is-${esc(tone)}" style="width:${width}%"></b></i>
      <strong>${safeCount}</strong>
    </div>`;
  }).join('');
}

/**
 * 渲染订单与物流的一页式经营工作台。
 *
 * 页面只使用已经保存的脱敏审计汇总，不读取或展示买家、合同号、物流单号等
 * 私密标识，也不会执行发货、退款、取消或状态修改。页面中的优先级是对现有
 * 状态数量的运营编排，不代表平台新增了风险结论。
 *
 * @returns {void} 用连续页面替换原来的三个内部子页签。
 * @throws {Error} DOM 容器缺失时安全返回，正常渲染不主动抛出异常。
 */
function renderOrdersOnePage() {
  const root = $('#blueprint-orders');
  if (root) root.innerHTML = liveWorkspaceState('实时数据', '正在等待当前账号查询；不展示历史样本。');
}

/**
 * 渲染风险合规的一页式核对工作台。
 *
 * 当前快照与历史记录必须同时展示：当前风险商品为 0 只描述当天/当前层，不能
 * 抹去累计处罚分和历史违规记录。专项能力也明确区分“真实为空”“需要业务对象”
 * 和“尚未执行写命令”，避免把未执行误写成安全结论。
 *
 * @returns {void} 用连续页面替换原来的三个风险子页签。
 * @throws {Error} DOM 容器缺失时安全返回，正常渲染不主动抛出异常。
 */
function renderRiskOnePage() {
  const root = $('#blueprint-risk');
  if (root) root.innerHTML = liveWorkspaceState('实时数据', '正在等待当前账号查询；不展示历史样本。');
}

/**
 * 从某个审计模块的 metrics 中按名称读取展示值。
 *
 * @param {object} section - 实时接口结果 中的一个子模块。
 * @param {string} label - 指标中文名称，例如“成员账号”。
 * @param {string} [fallback='—'] - 找不到指标时显示的安全占位符。
 * @returns {string} 指标的脱敏展示值。
 * @throws {Error} 不主动抛出异常；缺少 metrics 时返回 fallback。
 */
function moduleMetricValue(section, label, fallback = '—') {
  const metric = Array.isArray(section?.metrics)
    ? section.metrics.find(([metricLabel]) => metricLabel === label)
    : null;
  return String(metric?.[2] ?? fallback);
}

/**
 * 读取内部工作台的当前账号实时数据。
 *
 * @param {'storefront'|'assets'|'knowledge'|'access'|'access-contacts'} name - 要读取的单页模块。
 * @returns {Promise<object|null>} 成功时返回真实业务 data；失败时显示错误并返回 null。
 * @throws {Error} 网络与 JSON 异常会在函数内部转换成页面提示，不向调用方抛出。
 */
async function workspaceApi(name) {
  busy(true);
  try {
    const response = await fetch(`/api/workspaces/${name}`);
    const payload = await response.json();
    if (!payload.ok) {
      toast(`${payload.error || '实时数据读取失败'}`.slice(0, 130), true);
      return null;
    }
    return payload.data;
  } catch (error) {
    toast(`实时数据网络错误：${error.message}`, true);
    return null;
  } finally {
    busy(false);
    refreshLog();
  }
}

/**
 * 在实时数据到达前或失败后渲染统一状态。
 *
 * @param {string} moduleName - 页面中文名称。
 * @param {string} message - 当前状态说明。
 * @returns {string} 可直接写入页面容器的安全 HTML。
 * @throws {Error} 不主动抛出异常。
 */
function liveWorkspaceState(moduleName, message) {
  return `<section class="module-loading"><i class="ri-loader-4-line" aria-hidden="true"></i><div><b>${esc(moduleName)}</b><p>${esc(message)}</p></div></section>`;
}

/**
 * 将未知公司资料对象压平成适合页面展示的真实字段列表。
 *
 * @param {*} value - 公司资料 JSON 的任意节点。
 * @param {string} [prefix=''] - 当前字段路径。
 * @param {Array<{label:string,value:string}>} [rows=[]] - 递归累积结果。
 * @param {number} [depth=0] - 递归深度保护。
 * @returns {Array<{label:string,value:string}>} 最多 40 条非空业务字段。
 * @throws {Error} 不主动抛出异常，循环或超深对象会被忽略。
 */
function flattenLiveFields(value, prefix = '', rows = [], depth = 0) {
  if (rows.length >= 40 || depth > 6 || value === null || value === undefined || value === '') return rows;
  if (Array.isArray(value)) {
    value.slice(0, 12).forEach((item, index) => flattenLiveFields(item, `${prefix}[${index + 1}]`, rows, depth + 1));
    return rows;
  }
  if (typeof value === 'object') {
    Object.entries(value).forEach(([key, child]) => {
      if (rows.length < 40) flattenLiveFields(child, prefix ? `${prefix}.${key}` : key, rows, depth + 1);
    });
    return rows;
  }
  rows.push({ label: prefix || '字段', value: String(value) });
  return rows;
}

/**
 * 从不同接口命名中取得第一个非空值，保留平台返回的原始业务内容。
 *
 * @param {object} record - 当前记录。
 * @param {string[]} keys - 可接受的字段名。
 * @param {string} [fallback='—'] - 全部为空时的显示值。
 * @returns {string} 第一个非空字段的字符串形式。
 * @throws {Error} 不主动抛出异常。
 */
function liveField(record, keys, fallback = '—') {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== undefined && value !== null && value !== '') return String(value);
  }
  return fallback;
}

/**
 * 渲染店铺装修的一页式资产与发布准备工作台。
 *
 * 页面把“公司资料可读”和“页面资产为空”同时说清楚。创建预览、生成网站与发布
 * 都属于外部写操作，因此只展示所处阶段和所缺前置，不提供会误导用户的可点击按钮。
 *
 * @returns {void} 将页面资产、生成前置与发布边界连续写入店铺装修容器。
 * @throws {Error} DOM 容器缺失时安全返回。
 */


/**
 * 渲染素材工坊的一页式能力与资产工作台。
 *
 * 公共素材、平台能力、自有资产和异步任务是四种不同事实。页面用一条生产线表达
 * 它们的先后关系，并把真实空任务状态保留为可理解的起点，而不是显示“未接入”。
 *
 * @returns {void} 将图片、视频、3D 和任务中心合并为连续单页。
 * @throws {Error} DOM 容器缺失时安全返回。
 */


/**
 * 渲染知识库与接待的一页式“知识到服务”闭环。
 *
 * 页面区分平台公共知识、商家自定义知识、接待策略与服务诊断。知识检索可用并不
 * 代表可以在页面批量上传或维护知识库，策略的新增、更新、删除也保持未执行。
 *
 * @returns {void} 将知识、策略和质量诊断连续写入同一页面。
 * @throws {Error} DOM 容器缺失时安全返回。
 */


/**
 * 渲染账号与权限的一页式只读治理工作台。
 *
 * 平台账号目录、联系人访问、本地权限模型和操作审计属于不同层。页面只展示已经
 * 核验的账号事实与能力缺口，不伪造角色数量，也不提供没有后端合同的保存权限按钮。
 *
 * @returns {void} 将账号目录、权限事实和审计边界连续写入同一页面。
 * @throws {Error} DOM 容器缺失时安全返回。
 */


/**
 * 用当前账号的真实公司资料和页面版本渲染店铺装修页。
 *
 * @param {object} data - `/api/workspaces/storefront` 返回的实时数据。
 * @returns {void} 更新店铺装修容器。
 * @throws {Error} DOM 容器缺失时安全返回。
 */
function renderStorefrontOnePage(data) {
  const root = $('#blueprint-storefront');
  if (!root) return;
  const pages = Array.isArray(data?.pages) ? data.pages : [];
  const profileRows = flattenLiveFields(data?.companyProfile || data?.companyInfo);
  const errors = Array.isArray(data?.errors) ? data.errors : [];
  root.innerHTML = `
    <section class="one-page-hero storefront-one-page-hero"><div><span class="section-kicker">店铺装修 · 当前账号</span><h2>公司资料和店铺页面，按平台实时返回展示</h2><p>页面不再用演示文案代替店铺内容；公司号、企业字段和已建页面都来自当前登录账号。</p></div><div class="one-page-snapshot" role="status"><i class="ri-store-2-line"></i><span><b>公司号 ${esc(data?.companyId || '未返回')}</b><small>${profileRows.length} 个资料字段 · ${pages.length} 个页面版本</small></span></div></section>
    ${errors.length ? `<section class="live-error-strip">${errors.map(error => `<p>${esc(error)}</p>`).join('')}</section>` : ''}
    <section class="module-table-panel live-data-panel"><div class="one-page-section-heading"><div><span class="section-kicker">公司资料</span><h3>当前店铺的完整可读字段</h3><p>字段名按平台返回的原始结构展开，不改写内容。</p></div><span class="data-state is-live">平台数据</span></div><div class="module-table-wrap"><table><thead><tr><th>字段</th><th>当前值</th></tr></thead><tbody>${profileRows.length ? profileRows.map(row => `<tr><td><code>${esc(row.label)}</code></td><td>${esc(row.value)}</td></tr>`).join('') : '<tr><td colspan="2"><div class="designed-empty"><b>公司资料未返回</b><span>这是当前真实结果，请检查页面上方的读取错误。</span></div></td></tr>'}</tbody></table></div></section>
    <section class="module-table-panel live-data-panel"><div class="one-page-section-heading"><div><span class="section-kicker">页面版本</span><h3>Accio Work 已创建页面</h3><p>返回 0 条就表示当前账号确实还没有创建页面。</p></div><span class="data-state ${pages.length ? 'is-live' : ''}">${pages.length} 条</span></div><div class="live-card-grid">${pages.length ? pages.map((page, index) => `<article><span>${String(index + 1).padStart(2, '0')}</span><h4>${esc(liveField(page, ['pageName', 'title', 'name'], '未命名页面'))}</h4><p>页面 ID：${esc(liveField(page, ['pageId', 'id']))}</p><small>页面类型：${esc(liveField(page, ['pageType', 'type']))}</small></article>`).join('') : '<div class="designed-empty"><i class="ri-layout-line"></i><b>当前没有页面版本</b><span>这不是空白占位，而是平台对该公司号返回的真实结果。</span></div>'}</div></section>
    <footer class="one-page-evidence-footer"><div><span class="section-kicker">数据时间</span><p>${esc(data?.fetchedAt || '刚刚')} · ${data?.cached ? '五分钟内的当前账号缓存' : '本次实时读取'}</p></div><div class="one-page-boundary"><i class="ri-shield-keyhole-line"></i><p><b>仅保留密钥边界</b> 公司业务资料原样展示；登录令牌和运行密钥不会进入浏览器。</p></div></footer>`;
}

/** 读取并渲染店铺装修实时页。 @returns {Promise<void>} 加载完成。 */
async function loadStorefrontOnePage() {
  const root = $('#blueprint-storefront');
  if (root) root.innerHTML = liveWorkspaceState('店铺装修', '正在读取公司资料和页面版本…');
  const data = await workspaceApi('storefront');
  if (data) renderStorefrontOnePage(data);
  else if (root) root.innerHTML = liveWorkspaceState('店铺装修', '真实数据读取失败，没有使用演示数据填充。');
}

/**
 * 用当前账号真实商品和 3D 资产渲染素材工坊。
 * @param {object} data - 素材工坊实时数据。
 * @returns {void} 更新页面。
 */
function renderAssetsOnePage(data) {
  const root = $('#blueprint-assets');
  if (!root) return;
  const products = Array.isArray(data?.products) ? data.products : [];
  const models = Array.isArray(data?.ownModels) ? data.ownModels : [];
  const gallery = Array.isArray(data?.gallery) ? data.gallery : [];
  root.innerHTML = `
    <section class="one-page-hero assets-one-page-hero"><div><span class="section-kicker">素材工坊 · 当前账号</span><h2>店铺商品、自有 3D 和平台素材库</h2><p>这里先展示平台真正返回的素材资产；没有生成历史就明确显示 0。</p></div><div class="one-page-snapshot"><i class="ri-gallery-line"></i><span><b>${Number(data?.productTotal || products.length)} 件店铺商品</b><small>${Number(data?.ownModelTotal || models.length)} 个自有 3D · ${Number(data?.galleryTotal || gallery.length)} 个公共 3D</small></span></div></section>
    <section class="asset-inventory-band"><article class="is-ready"><span>店铺商品</span><strong>${Number(data?.productTotal || products.length)}</strong><small>当前账号可见</small></article><article><span>自有 3D 模型</span><strong>${Number(data?.ownModelTotal || models.length)}</strong><small>真实资产数</small></article><article class="is-ready"><span>公共 3D 素材</span><strong>${Number(data?.galleryTotal || gallery.length)}</strong><small>平台素材库</small></article></section>
    <section class="module-table-panel live-data-panel"><div class="one-page-section-heading"><div><span class="section-kicker">店铺商品</span><h3>可用作素材来源的真实商品</h3></div><span class="data-state is-live">展示 ${products.length} 件</span></div><div class="live-product-grid">${products.map(product => `<article>${product.image ? `<img src="${esc(product.image)}" alt="">` : '<i class="ri-image-line"></i>'}<div><b>${esc(product.title || '未命名商品')}</b><p>商品 ID：${esc(product.productId || '未返回')}</p><small>${esc(product.categoryName || '未返回类目')} · 曝光 ${num(product.views)} · 点击 ${num(product.clicks)}</small></div></article>`).join('') || '<div class="designed-empty"><b>没有返回店铺商品</b></div>'}</div></section>
    <section class="module-table-panel live-data-panel"><div class="one-page-section-heading"><div><span class="section-kicker">自有 3D 资产</span><h3>当前账号已生成模型</h3></div><span class="data-state">${models.length} 条</span></div><div class="live-card-grid">${models.length ? models.map(model => `<article><h4>${esc(liveField(model, ['name', 'modelName', 'title'], '3D 模型'))}</h4><p>模型 ID：${esc(liveField(model, ['modelId', 'id']))}</p><small>${esc(liveField(model, ['gmtCreate', 'createTime', 'status']))}</small></article>`).join('') : '<div class="designed-empty"><i class="ri-shape-2-line"></i><b>自有 3D 模型为 0</b><span>这是当前账号的真实返回。</span></div>'}</div></section>
    <section class="module-table-panel live-data-panel"><div class="one-page-section-heading"><div><span class="section-kicker">公共 3D 库</span><h3>平台可见素材</h3></div><span class="data-state is-live">共 ${Number(data?.galleryTotal || gallery.length)} 条</span></div><div class="live-product-grid">${gallery.map(model => `<article>${liveField(model, ['coverUrl', 'imageUrl'], '') ? `<img src="${esc(liveField(model, ['coverUrl', 'imageUrl'], ''))}" alt="">` : '<i class="ri-shape-line"></i>'}<div><b>${esc(liveField(model, ['name', 'modelName', 'title'], '3D 素材'))}</b><p>模型 ID：${esc(liveField(model, ['modelId', 'id']))}</p><small>${esc(liveField(model, ['gmtCreate', 'createTime'], '平台公共素材'))}</small></div></article>`).join('')}</div></section>`;
}

/** 读取并渲染素材工坊实时页。 @returns {Promise<void>} 加载完成。 */
async function loadAssetsOnePage() {
  const root = $('#blueprint-assets');
  if (root) root.innerHTML = liveWorkspaceState('素材工坊', '正在读取店铺商品和 3D 资产…');
  const data = await workspaceApi('assets');
  if (data) renderAssetsOnePage(data);
  else if (root) root.innerHTML = liveWorkspaceState('素材工坊', '真实数据读取失败，没有使用演示数据填充。');
}

/**
 * 知识阅读器的本地交互状态。
 *
 * 数据本身始终来自 `/api/workspaces/knowledge`；这里只保存筛选条件、当前选中
 * 条目和移动端是否进入阅读态，避免用户每次点击都重新请求平台接口。
 *
 * @type {{data: object|null, filter: string, query: string, selectedId: string, mobileReading: boolean}}
 */
const knowledgeLibraryState = {
  data: null,
  filter: 'all',
  query: '',
  selectedId: '',
  mobileReading: false,
};

/**
 * 把平台返回的一整段商家知识拆成可单独阅读的问题与答案。
 *
 * 平台当前用 `Question / [knowledge_id] / Answer` 连续返回多条知识。这里仅做
 * 结构解析，不改写问题、答案或知识 ID；如果未来返回格式变化，则保留整段原文
 * 作为一个条目，保证真实内容不会因为解析失败而消失。
 *
 * @param {unknown} value - sellerKnowledge 原始返回值，通常为字符串。
 * @returns {Array<object>} 可供目录和阅读器使用的商家知识条目。
 * @throws {Error} 正常输入下不会抛出异常；非字符串对象会安全转为文本。
 */
function parseSellerKnowledgeEntries(value) {
  const text = typeof value === 'string'
    ? value
    : liveField(value || {}, ['knowledge', 'answer', 'content'], value ? JSON.stringify(value) : '');
  const records = [];
  const pattern = /Question:\s*([\s\S]*?)\s*\[knowledge_id:\s*([^\]]+)\]\s*Answer:\s*([\s\S]*?)(?=\n\s*Question:|$)/gi;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    const question = String(match[1] || '').trim();
    const knowledgeId = String(match[2] || '').trim();
    const answer = String(match[3] || '').trim();
    records.push({
      id: `seller-${knowledgeId || records.length + 1}`,
      type: 'seller',
      typeLabel: '商家知识',
      title: question || `商家知识 ${records.length + 1}`,
      question,
      content: answer,
      source: '当前账号商家知识',
      recordId: knowledgeId,
    });
  }

  if (!records.length && text.trim()) {
    records.push({
      id: 'seller-raw-response',
      type: 'seller',
      typeLabel: '商家知识',
      title: '商家知识查询原文',
      question: '',
      content: text.trim(),
      source: '当前账号商家知识',
      recordId: '',
    });
  }
  return records;
}

/**
 * 汇总商家知识、公共 FAQ 与两类接待策略，形成统一的阅读目录。
 *
 * @param {object} data - 知识接口的真实响应。
 * @returns {Array<object>} 保留完整正文和平台元数据的统一条目列表。
 * @throws {Error} 正常输入下不会抛出异常；缺失集合按空数组处理。
 */
function buildKnowledgeLibraryRecords(data) {
  const faq = Array.isArray(data?.faq) ? data.faq : [];
  const chat = Array.isArray(data?.chatStrategies) ? data.chatStrategies : [];
  const auto = Array.isArray(data?.autoStrategies) ? data.autoStrategies : [];
  const seller = parseSellerKnowledgeEntries(data?.sellerKnowledge);

  const faqRecords = faq.map((item, index) => ({
    id: `faq-${liveField(item, ['kCode', 'id'], index + 1)}`,
    type: 'faq',
    typeLabel: '公共 FAQ',
    title: liveField(item, ['title', 'question', 'name'], `FAQ ${index + 1}`),
    question: liveField(item, ['title', 'question', 'name'], ''),
    content: liveField(item, ['content', 'answer', 'text'], ''),
    source: '平台公共 FAQ',
    recordId: liveField(item, ['kCode', 'id'], ''),
    score: liveField(item, ['score', 'similarity'], ''),
    language: liveField(item, ['language'], ''),
    countries: Array.isArray(item?.countries) ? item.countries.join('、') : liveField(item, ['countries'], ''),
    modifiedAt: liveField(item, ['gmtModified', 'modifiedTime', 'updateTime'], ''),
    creatorId: liveField(item, ['creatorId'], ''),
  }));

  const strategyRecords = [
    ...chat.map(item => ({ item, type: 'chat', typeLabel: '辅助接待' })),
    ...auto.map(item => ({ item, type: 'auto', typeLabel: '自动接待' })),
  ].map(({ item, type, typeLabel }, index) => ({
    id: `strategy-${liveField(item, ['strategyId', 'id'], `${type}-${index + 1}`)}`,
    type,
    typeLabel,
    title: liveField(item, ['topic', 'title', 'name'], `接待策略 ${index + 1}`),
    question: '',
    description: liveField(item, ['description'], ''),
    content: liveField(item, ['content', 'strategyContent', 'prompt'], ''),
    source: liveField(item, ['source'], '当前账号接待策略'),
    recordId: liveField(item, ['strategyId', 'id'], ''),
    modifiedAt: liveField(item, ['gmtModified', 'modifiedTime', 'updateTime'], ''),
    createdAt: liveField(item, ['gmtCreate', 'createTime'], ''),
  }));

  return [...seller, ...faqRecords, ...strategyRecords];
}

/**
 * 生成目录中的正文摘要，只影响目录预览，不改动右侧完整正文。
 *
 * @param {unknown} value - 需要生成摘要的正文。
 * @param {number} [limit=88] - 目录允许显示的最大字符数。
 * @returns {string} 合并空白后的短摘要。
 * @throws {Error} 不会抛出异常。
 */
function knowledgePreview(value, limit = 88) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized;
}

/**
 * 渲染当前账号真实知识内容，并提供“目录 → 完整正文”的单页阅读交互。
 *
 * @param {object} data - 知识与接待实时数据。
 * @returns {void} 更新页面，并绑定搜索、分类筛选、打开条目与移动端返回事件。
 * @throws {Error} 正常接口数据不会抛出异常；缺失字段会按空值安全展示。
 */
function renderKnowledgeOnePage(data) {
  const root = $('#blueprint-knowledge');
  if (!root) return;
  knowledgeLibraryState.data = data;

  const records = buildKnowledgeLibraryRecords(data);
  const normalizedQuery = knowledgeLibraryState.query.trim().toLocaleLowerCase();
  const visibleRecords = records.filter(record => {
    const matchesType = knowledgeLibraryState.filter === 'all' || record.type === knowledgeLibraryState.filter;
    const searchableText = [record.typeLabel, record.title, record.question, record.description, record.content, record.recordId]
      .join(' ')
      .toLocaleLowerCase();
    return matchesType && (!normalizedQuery || searchableText.includes(normalizedQuery));
  });
  let selected = visibleRecords.find(record => record.id === knowledgeLibraryState.selectedId) || visibleRecords[0] || null;
  if (selected) knowledgeLibraryState.selectedId = selected.id;

  const typeCounts = records.reduce((counts, record) => {
    counts[record.type] = (counts[record.type] || 0) + 1;
    return counts;
  }, {});
  const filters = [
    ['all', '全部', records.length],
    ['seller', '商家知识', typeCounts.seller || 0],
    ['faq', '公共 FAQ', typeCounts.faq || 0],
    ['chat', '辅助接待', typeCounts.chat || 0],
    ['auto', '自动接待', typeCounts.auto || 0],
  ];
  const metadata = selected ? [
    ['内容 ID', selected.recordId],
    ['来源', selected.source],
    ['语言', selected.language],
    ['适用国家', selected.countries],
    ['匹配度', selected.score],
    ['创建时间', selected.createdAt],
    ['修改时间', selected.modifiedAt],
    ['创建人 ID', selected.creatorId],
  ].filter(([, value]) => value !== '' && value !== null && value !== undefined) : [];

  root.innerHTML = `
    <section class="one-page-hero knowledge-one-page-hero">
      <div><span class="section-kicker">知识库与接待 · 当前账号</span><h2>完整知识内容目录</h2><p>当前接口返回的每条商家知识、公共 FAQ 和接待策略都在目录里；点击标题即可阅读完整原文与真实元数据。</p></div>
      <div class="one-page-snapshot"><i class="ri-book-open-line"></i><span><b>${records.length} 条可阅读内容</b><small>${typeCounts.seller || 0} 条商家知识 · ${typeCounts.faq || 0} 条 FAQ · ${(typeCounts.chat || 0) + (typeCounts.auto || 0)} 条策略</small></span></div>
    </section>
    <section class="knowledge-library-shell ${knowledgeLibraryState.mobileReading ? 'is-reading' : ''}">
      <aside class="knowledge-library-index" aria-label="知识内容目录">
        <div class="knowledge-library-index-head">
          <div><span class="section-kicker">内容目录</span><h3>逐条查看真实原文</h3></div>
          <label class="knowledge-library-search"><i class="ri-search-line" aria-hidden="true"></i><input id="knowledgeLibrarySearch" type="search" value="${esc(knowledgeLibraryState.query)}" placeholder="搜索标题、正文或 ID" aria-label="搜索知识内容"></label>
        </div>
        <div class="knowledge-library-filters" role="group" aria-label="知识内容分类">
          ${filters.map(([value, label, count]) => `<button type="button" class="${knowledgeLibraryState.filter === value ? 'on' : ''}" data-knowledge-filter="${value}" aria-pressed="${knowledgeLibraryState.filter === value}"><span>${label}</span><b>${count}</b></button>`).join('')}
        </div>
        <div class="knowledge-library-result-note"><span>当前显示 ${visibleRecords.length} 条</span><small>正文保持原值，不截断</small></div>
        <div class="knowledge-library-list">
          ${visibleRecords.map((record, index) => `<button type="button" class="knowledge-record-button ${record.id === selected?.id ? 'on' : ''}" data-knowledge-record="${esc(record.id)}" aria-current="${record.id === selected?.id ? 'true' : 'false'}"><span class="knowledge-record-number">${String(index + 1).padStart(2, '0')}</span><span class="knowledge-record-copy"><small>${esc(record.typeLabel)}${record.recordId ? ` · ${esc(record.recordId)}` : ''}</small><b>${esc(record.title)}</b><em>${esc(knowledgePreview(record.description || record.content || record.question))}</em></span><i class="ri-arrow-right-s-line" aria-hidden="true"></i></button>`).join('') || '<div class="knowledge-library-empty"><i class="ri-file-search-line"></i><b>没有匹配内容</b><span>可以清空搜索词或切换分类。</span></div>'}
        </div>
      </aside>
      <article class="knowledge-library-reader" aria-live="polite">
        ${selected ? `<button type="button" class="knowledge-reader-back" data-knowledge-back><i class="ri-arrow-left-line"></i> 返回目录</button><header class="knowledge-reader-head"><div><span class="knowledge-reader-type">${esc(selected.typeLabel)}</span><h3>${esc(selected.title)}</h3>${selected.question && selected.question !== selected.title ? `<p>${esc(selected.question)}</p>` : ''}</div><i class="ri-file-text-line" aria-hidden="true"></i></header>${metadata.length ? `<dl class="knowledge-reader-meta">${metadata.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>` : ''}${selected.description ? `<div class="knowledge-reader-lead"><span>策略说明</span><p>${esc(selected.description)}</p></div>` : ''}<section class="knowledge-reader-content"><span class="section-kicker">完整正文</span><pre>${esc(selected.content || '该条记录没有返回正文')}</pre></section>` : '<div class="knowledge-reader-empty"><i class="ri-book-2-line"></i><b>请选择一条内容</b><span>目录中的记录会在这里完整展开。</span></div>'}
      </article>
    </section>`;

  const search = $('#knowledgeLibrarySearch');
  if (search) {
    search.addEventListener('input', event => {
      const cursor = event.target.selectionStart;
      knowledgeLibraryState.query = event.target.value;
      knowledgeLibraryState.mobileReading = false;
      renderKnowledgeOnePage(knowledgeLibraryState.data);
      const nextSearch = $('#knowledgeLibrarySearch');
      if (nextSearch) {
        nextSearch.focus();
        nextSearch.setSelectionRange(cursor, cursor);
      }
    });
  }
  $$('[data-knowledge-filter]').forEach(button => button.addEventListener('click', () => {
    knowledgeLibraryState.filter = button.dataset.knowledgeFilter || 'all';
    knowledgeLibraryState.mobileReading = false;
    renderKnowledgeOnePage(knowledgeLibraryState.data);
  }));
  $$('[data-knowledge-record]').forEach(button => button.addEventListener('click', () => {
    knowledgeLibraryState.selectedId = button.dataset.knowledgeRecord || '';
    knowledgeLibraryState.mobileReading = true;
    renderKnowledgeOnePage(knowledgeLibraryState.data);
  }));
  $('[data-knowledge-back]')?.addEventListener('click', () => {
    knowledgeLibraryState.mobileReading = false;
    renderKnowledgeOnePage(knowledgeLibraryState.data);
  });
}

/** 读取并渲染知识库与接待实时页。 @returns {Promise<void>} 加载完成。 */
async function loadKnowledgeOnePage() {
  const root = $('#blueprint-knowledge');
  if (root) root.innerHTML = liveWorkspaceState('知识库与接待', '正在读取商家知识、FAQ 和接待策略…');
  const data = await workspaceApi('knowledge');
  if (data) renderKnowledgeOnePage(data);
  else if (root) root.innerHTML = liveWorkspaceState('知识库与接待', '真实数据读取失败，没有使用演示数据填充。');
}

/**
 * 渲染真实成员姓名、Ali ID 和联系人目录。
 * @param {object} data - 账号与联系人实时数据。
 * @returns {void} 更新页面。
 */
function renderAccessOnePage(data) {
  const root = $('#blueprint-access');
  if (!root) return;
  const members = Array.isArray(data?.members) ? data.members : [];
  const contacts = Array.isArray(data?.contacts) ? data.contacts : [];
  const contactsLoading = data?.contactsDeferred === true && !Array.isArray(data?.contacts);
  const contactsError = String(data?.contactsError || '');
  root.innerHTML = `
    <section class="one-page-hero access-one-page-hero"><div><span class="section-kicker">账号与权限 · 内部真实目录</span><h2>当前账号成员与联系人</h2><p>成员姓名和经营账号字段按平台返回原样展示；没有返回的 Ali ID、管理员或当前登录状态不会由页面猜测。</p></div><div class="one-page-snapshot"><i class="ri-team-line"></i><span><b>${members.length} 个成员</b><small>${contactsError ? '联系人本轮读取失败' : `${contacts.length} 个联系人`}</small></span></div></section>
    <section class="access-directory"><div class="one-page-section-heading"><div><span class="section-kicker">团队成员</span><h3>真实姓名与账号标识</h3><p>姓名来自当前账号的经营账号目录；平台没有返回的字段明确写“未返回”。</p></div><span class="data-state is-live">${members.length} 条</span></div><div class="access-directory-head"><span>姓名</span><span>Ali ID</span><span>管理员</span><span>当前登录</span><span>数据来源</span></div>${members.map((member, index) => `<article><span><i>${String(index + 1).padStart(2, '0')}</i><b>${esc(`${liveField(member, ['firstName'], '')} ${liveField(member, ['lastName'], '')}`.trim() || liveField(member, ['nickName', 'name']))}</b></span><em class="is-ready">${esc(liveField(member, ['aliId', 'memberId'], '未返回'))}</em><em>${member.admin === null || member.admin === undefined ? '未返回' : (member.admin ? '是' : '否')}</em><em>${member.self === null || member.self === undefined ? '未返回' : (member.self ? '是' : '否')}</em><em>经营账号</em></article>`).join('') || '<div class="designed-empty"><b>没有返回成员</b></div>'}</section>
    <section class="module-table-panel live-data-panel"><div class="one-page-section-heading"><div><span class="section-kicker">联系人目录</span><h3>query-contact 实时返回</h3><p>不再调用无权限的旧 list-contact；本轮失败也不会伪装成真实 0 条。</p></div><span class="data-state ${contactsLoading || contactsError ? '' : 'is-live'}">${contactsLoading ? '读取中' : (contactsError ? '读取失败' : `${contacts.length} 条`)}</span></div><div class="module-table-wrap"><table><thead><tr><th>联系人</th><th>成员 ID</th><th>类型</th><th>创建时间</th></tr></thead><tbody>${contacts.map(contact => `<tr><td>${esc(liveField(contact, ['nickName', 'nickname', 'name', 'displayName']))}</td><td>${esc(liveField(contact, ['memberId', 'aliId', 'id']))}</td><td>${esc(liveField(contact, ['memberType', 'type', 'contactType']))}</td><td>${esc(liveField(contact, ['createTime', 'gmtCreate', 'createdAt']))}</td></tr>`).join('') || `<tr><td colspan="4"><div class="designed-empty"><b>${contactsLoading ? '正在单独读取联系人，不影响成员目录' : (contactsError || '当前真实返回 0 个联系人')}</b></div></td></tr>`}</tbody></table></div></section>
    <footer class="one-page-evidence-footer"><div><span class="section-kicker">真实权限边界</span><p>当前稳定返回的是经营账号姓名和业绩字段，没有可编辑的细分角色矩阵，所以页面不再伪造四种角色。</p></div><div class="one-page-boundary"><i class="ri-shield-keyhole-line"></i><p><b>密钥不展示</b> 业务账号数据保留原值，但登录令牌和系统密钥仍不会下发到页面。</p></div></footer>`;
}

/** 读取并渲染账号与权限实时页。 @returns {Promise<void>} 加载完成。 */
async function loadAccessOnePage() {
  const root = $('#blueprint-access');
  if (root) root.innerHTML = liveWorkspaceState('账号与权限', '正在读取当前账号成员和联系人…');
  const data = await workspaceApi('access');
  if (data) {
    renderAccessOnePage(data);
    const contactData = await workspaceApi('access-contacts');
    if (contactData) renderAccessOnePage({ ...data, ...contactData, contactsDeferred: false });
    else renderAccessOnePage({ ...data, contacts: [], contactsDeferred: false, contactsError: 'query-contact 本轮读取失败或超时' });
  } else if (root) root.innerHTML = liveWorkspaceState('账号与权限', '真实数据读取失败，没有使用匿名成员填充。');
}

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
  const live = {};
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
        <span><b>等待查询</b><small>等待当前账号数据</small></span>
      </div>
    </section>
    <div class="module-view-tabs" role="tablist" aria-label="${esc(module.title)}子页面">
      ${module.views.map(item => `<button type="button" role="tab" aria-selected="${item.id === view.id}"
        class="${item.id === view.id ? 'on' : ''}" data-module-key="${esc(moduleKey)}" data-module-view="${esc(item.id)}">
        ${esc(item.label)}</button>`).join('')}
    </div>
    <section class="module-intro">
      <div><span class="section-kicker">当前界面</span><h3>${esc(view.title)}</h3><p>${esc(view.description)}</p></div>
      <button type="button" class="ghost sm blueprint-disabled" disabled title="当前尚未取得数据">等待查询</button>
    </section>
    <div class="module-metrics">
      ${metrics.map(([label, note, value]) => `<article><span>${esc(label)}</span><strong class="metric-live">${esc(value)}</strong><small>${esc(note)}</small></article>`).join('')}
    </div>
    <div class="module-workspace">
      <div class="module-main-column">
        <section class="module-process" aria-label="${esc(view.title)}业务流程">
          <div class="module-section-head"><div><span class="section-kicker">业务工作区</span><h3>${esc(view.title)}</h3></div><span class="data-state is-live">${esc(live.state || '未查询')}</span></div>
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
                  flow: loadFlow, market: loadMarketInsights, visitor: loadVisitor, staff: loadStaff, console: refreshLog,
                  ads: loadAds, rfq: loadRfq,
                  orders: renderOrdersOnePage, risk: renderRiskOnePage,
                  storefront: loadStorefrontOnePage, assets: loadAssetsOnePage,
                  knowledge: loadKnowledgeOnePage, access: loadAccessOnePage };

/**
 * 切换左侧业务导航对应的内容区，并同步右侧工作区标题和无障碍状态。
 *
 * @param {string} name - 导航按钮 `data-tab` 中声明的页面名称。
 * @returns {void} 本函数只更新页面状态；首次进入页面时异步加载器自行执行。
 * @throws {Error} 正常 DOM 结构下不会抛错；若导航按钮缺失，标题保持原值。
 */
function switchTab(name) {
  renderTimeControls(name);
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
  window.LsouAdvisor?.navigate(name,!LOADED[name]);
  // 扩展收到导航后会立即读取数据，必须先固定AI归属页，避免把新页面数据记到上一页。
  window.dispatchEvent(new CustomEvent('lsou:navigation', { detail: name }));
  if (!LOADED[name]) { LOADED[name] = 1; LOADERS[name] && LOADERS[name](); }
  // 每次从侧栏打开客户页都先展示分析，已加载的会话上下文仍然保留。
  if (name === 'visitor') document.querySelector('[data-customer-view=analysis]')?.click();
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
  // React 交付入口自己绑定导航；本地原生入口继续使用原有事件。
  if (!document.querySelector('[data-react-navigation]')) $$('#tabs button[data-tab]').forEach(b => b.onclick = () => switchTab(b.dataset.tab));
  $$('#tabs button[data-anchor]').forEach(b => b.onclick = () => scrollToOverviewBlock(b.dataset.anchor));
  $$('[data-tab-link]').forEach(b => b.onclick = () => switchTab(b.dataset.tabLink));
  $$('[data-anchor-link]').forEach(b => b.onclick = () => scrollToOverviewBlock(b.dataset.anchorLink));
  $('main').addEventListener('click', handleModuleViewClick);
  // 点击产地控件外部时收起浮层，行为与 Alibaba 发品页的单选下拉一致。
  document.addEventListener('click', event => {
    if (!event.target.closest('.publish-origin-picker')) closePublishOriginPickers();
    if (!event.target.closest('.publish-category-picker')) {
      const picker = $('.publish-category-picker[open]');
      if (picker) picker.open = false;
    }
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

  $('#quickRange').onchange = e => renderTimePicker($('#tabs button[data-tab].on')?.dataset.tab || 'overview',e.target.value);
  $('#timeApply').onclick=applyTimeSelection;
  $('#btnReload').onclick = async () => {
    const button = $('#btnReload');
    button.disabled = true;
    try {
      // 发布页只刷新参考资料，保留当前编辑；所有刷新共用此入口并防止重复点击。
      if ($('#tab-product-publish').classList.contains('on')) {
        await refreshPublishSourceData();
        return;
      }
      const response = await fetch('/api/cache/refresh', { method: 'POST' });
      const payload = await response.json();
      if (!payload.ok) throw new Error('刷新请求失败');
      await reloadAll();
    } catch (_) {
      toast('刷新未能启动，请稍后重试。', true);
    } finally {
      button.disabled = false;
    }
  };
  $('#btnClearCache').onclick = async () => {
    const r = await fetch('/api/cache/clear'); const j = await r.json();
    publishState.accountContextLoaded = false;
    publishState.businessOptionsLoaded = false;
    publishState.sourceCache = null;
    Object.values(PUBLISH_CATEGORY_CONFIG).forEach(config => { config.needsRefresh = true; });
    toast(`已清除 ${j.cleared} 条缓存`); reloadAll();
  };


  // 右侧动态按钮只处理当前商品；底部批量按钮只处理左侧勾选商品。
  // 四个入口共用同一真实 WorkCTL 串行队列，但各自保留明确范围和二次确认。
  $('#publishCreateFromList').onclick = () => openPublishCreation();
  $('#publishStartQueue').onclick = () => openPublishConfirmation({ scope: 'batch', action: 'publish' });
  $('#publishSaveDraft').onclick = () => openPublishConfirmation({ scope: 'batch', action: 'draft' });
  $('#publishFileInput').onchange = event => {
    handlePublishProductImages(event.target.files || []);
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
  $('#publishHistory').onclick = showPublishHistory;
  $('#publishOperationResult').onclick = () => {
    const operationId = resolveVisiblePublishOperationId();
    if (!operationId || !showPublishOperationResult(operationId)) toast('本次任务还没有全部结束');
  };

  $('#regionApply').onclick = loadRegion;


  $('#rfqCompareBtn').onclick=event=>queryRfqSelection('opportunities',[...rfqState.compareIds],event.currentTarget);
  $('#rfqQuoteCompareBtn').onclick=event=>queryRfqSelection('quotes',[...rfqState.quoteIds],event.currentTarget);
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
  window.LsouAdvisor?.navigate(cur,true);
  LOADED[cur] = 1;
  const loading=LOADERS[cur] && LOADERS[cur]();
  buildFlags();
  return loading;
}

// ============================ 启动 ============================
/** 初始化已挂载工作区；无参数，返回 Promise<void>；依赖加载错误由入口捕获。 */
async function initializeWorkbench() {
  const initialTime=defaultTimeState('overview');
  $('#startDate').value=initialTime.startDate;$('#endDate').value=initialTime.endDate;
  bind();
  await initConsole();
  // 只接受已注册的标签页名称，方便最终交付链接直接打开“产品发布”，
  // 同时避免把任意查询字符串拼入 DOM 选择器或页面结构。
  const requestedTab = new URLSearchParams(location.search).get('tab');
  switchTab(requestedTab && Object.prototype.hasOwnProperty.call(LOADERS, requestedTab) ? requestedTab : 'overview');
  setInterval(refreshLog, 6000);
}
// React 在全部业务扩展加载后显式初始化，避免扩展与首屏请求的竞态。
if (!window.__LSOU_FRONTEND__) initializeWorkbench();

/** 加载市场洞察的选品区；无参数；返回Promise<void>；查询错误由区域内处理。 */
async function loadMarketInsights() {
  if(flowDiscoveryState.mounted)await queryFlowDiscovery();
  else await initFlowDiscovery();
}

const flowDiscoveryState={mounted:false,version:0,kind:'products'};
/**
 * 向AI提供程序已计算的当前页面状态，保持日期、象限、选中对象与图表一致。
 * @param {string} module 六页标识。@param {object} selection 用户当前选择。
 * @returns {object} 有界结构化记录、周期与限制，不执行查询或修改。
 * @throws 无；尚未加载的数据保持缺失。
 */
function getAdvisorPageContext(module,selection={}) {
  const period=timePages[module]?{...dates(module),grain:timeStates[module]?.mode||'range'}:{label:timeNotes[module]||'各来源独立周期',grain:'snapshot'};
  const records=[],limitations=[];
  // 只有改变分析对象的业务筛选进入缓存索引；指标值、读取时间、图表高亮不进入。
  const cache_scope=({
    product:()=>({quadrant:productFocusMode,page:productFocusPage}),
    visitor:()=>({page:vState.pageNO,country:$('#visCountry')?.value.trim()||'',tm:$('#visAtm')?.checked||false,inquiry:$('#visMc')?.checked||false}),
    flow:()=>({channel:flowSelectedChannel||'',metric:$('#regionDim')?.value||'',terminal:$('#regionTerm')?.value||''}),
    market:()=>({kind:flowDiscoveryState.kind,category:$('#flowDiscoveryCategory')?.selectedOptions[0]?.textContent||'',period:$('#flowDiscoveryPeriod')?.value||'',sort:$('#flowDiscoverySort')?.value||'',researchProduct:$('#ops-market .market-object-heading h3')?.textContent||'',researchCategory:$('#ops-market .market-object-heading strong')?.textContent||''}),
    ads:()=>({profile:keywordCompareState.profileKind,profileDate:keywordCompareState.profileDate,category:keywordCompareState.category,channel:keywordCompareState.channel,search:keywordCompareState.search}),
  })[module]?.()||{};
  const add=(label,data,scope,contextOnly=false)=>records.push({source:'工作台程序计算/'+module,label,data,scope,contextOnly,observed_at:new Date().toISOString()});
  let object;
  if(module==='overview'&&summaryRows.length&&summaryRows.every(row=>row.statDate>=period.startDate&&row.statDate<=period.endDate)){
    add('经营指标与同行对标',{metrics:OVERVIEW_KPIS.filter(meta=>!meta.unavailable).map(meta=>({key:meta.k,label:meta.n,aggregation:meta.aggregate,unit:meta.format,scope:meta.scope||'所选周期累计',mine:overviewMetricValue(meta),rivalAverage:overviewMetricValue(meta,'RivalAvg'),rivalGood:overviewMetricValue(meta,'RivalGood')})),selectedMetric:curKpi},'程序按本店与同行同批序列计算；回复指标取最新平台近30天值，不拼漏斗');
    add('经营趋势原始序列',summaryRows,'与经营汇总同批返回；截断样本不能重新累计成整月值');
  }
  if(module==='product'&&productAnalysisData){
    const data=productAnalysisData,rows=data.focusProducts?.[productFocusMode]||[];
    add('当前商品四象限与重点商品',{population:data.population,recordCount:data.recordCount,thresholds:data.thresholds,quadrantCounts:data.quadrantCounts,diagnostics:data.diagnostics,totals:data.totals,selectedQuadrant:productFocusMode,focusCount:rows.length,focusProducts:rows.slice((productFocusPage-1)*20,productFocusPage*20)},'本店曝光P75与加权CTR；重点商品为当前象限当前页样本');
    if(data.population<data.recordCount)limitations.push(`平台记录${data.recordCount}件，实际分析${data.population}件，存在未读完的数据。`);
    if(selection.entity_ref){const row=Object.values(data.focusProducts||{}).flat().find(r=>r.productRef===selection.entity_ref);if(row)object={ref:row.productRef,cache_ref:row.analysisRef,label:row.title||'当前商品',data:row};}
  }
  if(module==='flow')add('当前渠道与国家筛选',{selectedChannel:flowSelectedChannel,channelData:flowChannelData,region:regionRows,regionMetric:$('#regionDim')?.value,terminal:$('#regionTerm')?.value},'渠道与国家记录独立；画像近30天，行业需求近90天，不按行比较国家',!Object.keys(flowChannelData||{}).length&&!regionRows?.length);
  if(module==='visitor')add('当前客户分析范围',{page:vState.pageNO,total:vState.total,country:$('#visCountry')?.value},'仅当前读取的访客样本，客户评分为本地规则，不是成交概率；会话必须有明确关联',true);
  if(module==='market')add('当前行业筛选',{kind:flowDiscoveryState.kind,category:$('#flowDiscoveryCategory')?.selectedOptions[0]?.textContent,period:$('#flowDiscoveryPeriod')?.selectedOptions[0]?.textContent,sort:$('#flowDiscoverySort')?.selectedOptions[0]?.textContent},'当前选品榜单筛选；其他市场区块的类目和日期独立',true);
  if(module==='ads'){
    add('关键词当前来源与选择',{profileKind:keywordCompareState.profileKind,profileDate:keywordCompareState.profileDate,category:keywordCompareState.category,channel:keywordCompareState.channel,selected:keywordCompareState.selected,search:keywordCompareState.search},'店铺词库、行业指数与广告效果独立口径',true);
    if(keywordCompareState.profileKind==='sample')limitations.push('当前店铺词库为历史样本，不能据此判断本店投放表现。');
    if(keywordCompareState.profileKind==='saved')limitations.push('店铺词库来自本账号保存快照，使用前须核对来源日期。');
  }
  return {period,cache_scope,records,limitations,object};
}
window.getAdvisorPageContext=getAdvisorPageContext;
/** 调用流量页固定查询；payload为筛选对象；返回业务数据；网络与业务失败抛错供页面显示。 */
async function flowDiscoveryRequest(payload) {
  const advisorRead=window.LsouAdvisor?.beginRead('/api/capabilities/flow',payload);
  const response=await fetch('/api/capabilities/flow',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const result=await response.json();window.LsouAdvisor?.finishRead(advisorRead,result,!response.ok||!result.ok);if(!response.ok||!result.ok)throw new Error(result.error||'行业数据读取失败');return result.data;
}
/** 初始化页内行业选品区，无参数；返回Promise<void>；异常在结果区展示，允许再次查询。 */
async function initFlowDiscovery() {
  if(flowDiscoveryState.mounted)return;
  flowDiscoveryState.mounted=true;
  $('#flowDiscoveryForm').addEventListener('submit',event=>{event.preventDefault();void queryFlowDiscovery();});
  $('#flowDiscoveryTabs').addEventListener('click',event=>{const button=event.target.closest('[data-kind]');if(!button)return;setFlowDiscoveryKind(button.dataset.kind);void queryFlowDiscovery();});
  $('#flowDiscoveryForm').addEventListener('change',()=>{
    flowDiscoveryState.version++;$('#flowDiscoveryQuery').disabled=false;
    $('#flowDiscoveryResult').innerHTML='<div class="empty">筛选已变更，请点击查询更新结果。</div>';
  });
  $('#flowDiscoveryResult').addEventListener('click',event=>{
    const button=event.target.closest('[data-supplier-url]');if(!button)return;
    $('#flowSupplierUrl').value=button.dataset.supplierUrl;setFlowDiscoveryKind('suppliers');void queryFlowDiscovery();
  });
  await queryFlowDiscovery();
}
/** 切换商品/供应商视图；kind为固定页签名；返回void；不抛出业务异常。 */
function setFlowDiscoveryKind(kind) {
  flowDiscoveryState.kind=kind;
  $('#flowDiscoveryTabs').querySelectorAll('button').forEach(button=>{const on=button.dataset.kind===kind;button.classList.toggle('on',on);button.setAttribute('aria-pressed',String(on));});
  $('#flowSupplierUrlLabel').hidden=kind!=='suppliers';
}
/** 查询当前筛选并只渲染最后一次请求；无参数；返回Promise<void>；错误就地显示，保留重试按钮。 */
async function queryFlowDiscovery() {
  const version=++flowDiscoveryState.version,kind=flowDiscoveryState.kind,host=$('#flowDiscoveryResult');
  $('#flowDiscoveryQuery').disabled=true;host.innerHTML='<div class="empty">正在读取'+(kind==='products'?'热门商品':'供应商')+'…</div>';
  try {
    if(!$('#flowDiscoveryCategory').value){
      const context=await flowDiscoveryRequest({action:'categories'});if(version!==flowDiscoveryState.version)return;
      $('#flowDiscoveryCategory').innerHTML=context.categories.map(c=>`<option value="${esc(c.ref)}">${esc(c.label)}</option>`).join('')||'<option value="">当前目录没有类目</option>';
    }
    const period=$('#flowDiscoveryPeriod').value,sort=$('#flowDiscoverySort').value,shopUrl=kind==='suppliers'?$('#flowSupplierUrl').value.trim():'';
    if(!shopUrl&&!$('#flowDiscoveryCategory').value)throw new Error('当前商品目录未返回类目，供应商也可输入店铺网址查询。');
    const categoryLabel=$('#flowDiscoveryCategory').selectedOptions[0]?.textContent||'';
    const data=await flowDiscoveryRequest({action:kind,category:$('#flowDiscoveryCategory').value,period,sort,shopUrl});
    if(version!==flowDiscoveryState.version)return;
    renderFlowDiscovery(data,kind,sort,`${shopUrl?'指定供应商全店 · 不按类目筛选':categoryLabel+' · 行业样本'} · ${$('#flowDiscoveryPeriod').selectedOptions[0].textContent}`);
  } catch(error){if(version===flowDiscoveryState.version)host.innerHTML=`<div class="empty">${esc(error.message)}<br>请调整条件或点击查询重试。</div>`;}
  finally {if(version===flowDiscoveryState.version)$('#flowDiscoveryQuery').disabled=false;}
}
/** 仅允许外部HTTP(S)链接；value为平台字符串；返回安全URL或空串；无异常。 */
function flowDiscoveryUrl(value) {try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:'';}catch{return '';}}
/** 按真实字段展示行业列表，指数保留每日日期；data为返回值，kind/sort为查询快照，scope为口径；返回void；无主动异常。 */
function renderFlowDiscovery(data,kind,sort,scope) {
  const host=$('#flowDiscoveryResult'),items=data.items||[],product=kind==='products';
  const metric={ab_cnt:['abCntIndex','询盘指数'],prepay_ord_cnt:['prepayOrdCntIndex','挂账订单指数'],rec_ord_amt:['recOrdAmtIndex','实收GMV指数'],uv_detail:['uvDetailIndex','详情访客指数']}[sort];
  const shown=value=>esc(value===null||value===undefined||value===''?'未返回':value);
  const link=(url,label)=>flowDiscoveryUrl(url)?`<a href="${esc(flowDiscoveryUrl(url))}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`:'';
  host.innerHTML=`<div class="flow-discovery-status">${esc(scope)} · 返回 ${items.length} 条 · 读取于 ${esc(new Date(data.fetchedAt).toLocaleTimeString('zh-CN'))}</div>`;
  if(!items.length){host.innerHTML+=`<div class="empty">平台未返回符合当前条件的${product?'热门商品':'供应商'}。${product?'可切换类目或周期重试。':'可输入店铺网址，或从热门商品点击“查看供应商”。'}</div>`;return;}
  host.innerHTML+=`<div class="flow-discovery-list">${items.map(row=>{
    const series=row.trends?.[metric[0]]||[],last=series.slice(-1)[0],image=flowDiscoveryUrl(row.prodImage),url=product?row.detailUrl:row.minisiteUrl;
    const shop=flowDiscoveryUrl(row.shopUrl);
    return `<article class="flow-discovery-row"><div class="flow-discovery-identity">${product&&image?`<img src="${esc(image)}" alt="" loading="lazy">`:''}<div><h3>${shown(product?row.prodName:row.compCnName)}</h3><p>${shown(product?row.supplierCnName:row.mainProdSlr)}</p><div class="flow-discovery-links">${link(url,product?'查看商品':'访问店铺')}${product&&shop?`<button type="button" class="ghost sm" data-supplier-url="${esc(shop)}">查看供应商</button>`:''}</div></div></div><dl class="flow-discovery-facts">${(product?[['价格（币种未返回）',row.price],['最小起订量',row.minOrdQty],['评分 / 评价数',`${row.rating??'—'} / ${row.commentCnt??'—'}`]]:[['商家评分',row.compScore],['评价数',row.compReviewCnt],['经营类型',row.compBizTypeDesc]]).map(([label,value])=>`<div><dt>${label}</dt><dd>${shown(value)}</dd></div>`).join('')}</dl><details class="flow-discovery-trend"><summary>${metric[1]} <strong>${shown(last?.value)}</strong><small>${last?esc(last.date.replace(/(\d{4})(\d{2})(\d{2})/,'$1-$2-$3')):'日期未返回'} · 查看每日趋势</small></summary>${series.length?`<div class="flow-series">${series.map(p=>`<span><time>${esc(p.date.slice(4,6)+'/'+p.date.slice(6))}</time><b>${shown(p.value)}</b></span>`).join('')}</div>`:'<p>平台未返回趋势</p>'}</details></article>`;
  }).join('')}</div>`;
}
