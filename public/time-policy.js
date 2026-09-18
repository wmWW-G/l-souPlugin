/* 页面与服务端共用的时间合同。只规定取数口径，不推断平台数据已产出。 */
(function (root) {
  'use strict';
  const DAY = 86400000;
  /** 获取北京时间的日期。@param {Date} now 时钟。@returns {string} YYYY-MM-DD。@throws 无。 */
  const today = (now = new Date()) => new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  /** 严格解析日历日期，拒绝 JS 自动滚到下个月。@param {string} value 日期。@returns {number} UTC日标。@throws 日期无效。 */
  function parse(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw new Error('日期须为 YYYY-MM-DD');
    const ms = Date.parse(value + 'T00:00:00Z');
    if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) throw new Error('日期不存在');
    return ms;
  }
  /** 按日历天偏移，避免本机时区/DST改变日期。@param {string} value 日期。@param {number} days 天数。@returns {string} 日期。@throws 日期无效。 */
  const shift = (value, days) => new Date(parse(value) + days * DAY).toISOString().slice(0, 10);
  /** 月份偏移时夹到目标月末，供窗口限制使用。@param {string} value 日期。@param {number} count 月数。@returns {string} 日期。@throws 日期无效。 */
  function addMonths(value, count) {
    const d = new Date(parse(value));
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + count + 1, 0)).getUTCDate();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + count, Math.min(d.getUTCDate(), last))).toISOString().slice(0, 10);
  }
  /** 校验完整区间，不裁切用户输入。@param {string} start 起始日。@param {string} end 结束日。@param {object} options 最大天/月数及最晚日。@returns {object} 起止日期。@throws 倒置、未来或超限。 */
  function range(start, end, options = {}) {
    const length = (parse(end) - parse(start)) / DAY + 1;
    if (length < 1) throw new Error('开始日期不能晚于结束日期');
    if (end > (options.latest || today())) throw new Error('结束日期超出可查询日期');
    if (options.days && length > options.days) throw new Error(`本次最多查询 ${options.days} 天，请缩短日期范围`);
    if (options.months && end >= addMonths(start, options.months)) throw new Error(`本次最多查询 ${options.months} 个月，请缩短日期范围`);
    return {startDate: start, endDate: end};
  }
  /** 将一个日/ISO周/自然月转换成完整区间；未结束周期不混进完整周期对比。@param {string} mode 粒度。@param {string} value 日期/周/月。@param {string} latest 最晚可查日。@returns {object} 区间。@throws 无效或尚未结束的周期。 */
  function period(mode, value, latest = shift(today(), -1)) {
    let start, end;
    if (mode === 'day') start = end = value;
    else if (mode === 'month') {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error('请选择有效月份');
      start = value + '-01'; end = shift(addMonths(start, 1), -1);
    } else if (mode === 'week') {
      const match = /^(\d{4})-W(\d{2})$/.exec(value);
      if (!match || +match[2] < 1 || +match[2] > 53) throw new Error('请选择有效周');
      const jan4 = `${match[1]}-01-04`, weekday = new Date(parse(jan4)).getUTCDay() || 7;
      start = shift(jan4, 1 - weekday + (+match[2] - 1) * 7); end = shift(start, 6);
      if (weekValue(start) !== value) throw new Error('该年份不存在此周');
    } else throw new Error('不支持的统计周期');
    return range(start, end, {latest});
  }
  /** 日期转ISO周，正确处理跨年周。@param {string} value 日。@returns {string} YYYY-Www。@throws 日期无效。 */
  function weekValue(value) {
    const weekday = new Date(parse(value)).getUTCDay() || 7;
    const thursday = shift(value, 4 - weekday), year = thursday.slice(0, 4);
    const week = Math.ceil(((parse(thursday) - parse(year + '-01-01')) / DAY + 1) / 7);
    return `${year}-W${String(week).padStart(2, '0')}`;
  }
  const enums = {
    'shop-summary': {statisticsType: ['day','7d','30d']},
    'shop-product': {statisticsType: ['day','week','month']},
    'shop-region': {statisticsType: ['day','week','month']},
    'shop-channel': {statisticsType: ['day','week','month']},
    'account-summary': {statisticsType: ['day','week','month']},
    'channel-trend': {statisticsType: ['day','week','month']},
    'customer-profile': {nd: ['7d','30d']},
    'industry-buyer-profile': {nd: ['7d','30d','90d']},
    'industry-buyer-channel': {nd: ['7d','30d','90d']},
    'market-opportunities': {statCycle: ['30d','90d']},
    'crowd-insight': {nd: ['30d','1m']},
    'rfq-internal-search': {openTime:['1h','3h','12h','24h','2i','3i','7i','7b']},
    'tm-account-diagnosis': {dateType: ['0','1']}, 'tm-shop-diagnosis': {dateType: ['0','1']},
  };
  const adEffects = ['ads-company-effect','ads-keyword-effect','ads-search-term-effect','ads-product-effect'];
  adEffects.forEach(key => {enums[key] = {granularity: ['day','all']};});
  /** 校验端点业务时间，不使用 Workctl 通用 --time 模板（它与商品合同不符）。@param {string} key 端点。@param {object} p 参数。@param {string[]} allowed 白名单，可选。@param {string} clock 当天，测试可注入。@returns {void}。@throws 不兼容或无效输入。 */
  function validate(key, p, allowed, clock = today()) {
    const present = k => p[k] !== undefined && p[k] !== '' && p[k] !== null;
    const temporal = /^(startDate|endDate|statDate|statisticsType|queryDate|dateType|nd|statCycle|granularity|startStatDate|endStatDate|createDateFrom|createDateTo|gmtOpen\w+|openTime|postTime\w+|expiredTime\w+|limitTimeStamp)$/;
    if (allowed) for (const k of Object.keys(p)) if (present(k) && temporal.test(k) && !allowed.includes(k)) throw new Error(`${key} 不支持时间参数 ${k}`);
    for (const [k, choices] of Object.entries(enums[key] || {})) if (present(k) && !choices.includes(String(p[k]))) throw new Error(`${k} 仅支持 ${choices.join(' / ')}`);
    if(adEffects.includes(key)) {
      const fields=key==='ads-product-effect'?['startDate','endDate']:['startStatDate','endStatDate'];
      if(fields.some(k=>!present(k)))throw new Error('广告效果查询须同时选择开始和结束日期');
    }
    if(key==='ads-achieve-rate' && !present('statDate'))throw new Error('广告达标率须选择统计日期');
    const compact = value => {
      if (!/^\d{8}$/.test(String(value))) throw new Error('广告日期须为 YYYYMMDD');
      return `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}`;
    };
    for (const [a,b] of [['startDate','endDate'],['startStatDate','endStatDate'],['createDateFrom','createDateTo'],['gmtOpenFrom','gmtOpenTo']]) {
      if (!present(a) && !present(b)) continue;
      if (!present(a) || !present(b)) throw new Error('请同时填写开始和结束日期');
      let start = String(p[a]), end = String(p[b]);
      if (a === 'startStatDate' || key === 'ads-product-effect') {start = compact(start); end = compact(end);}
      if (['createDateFrom','gmtOpenFrom'].includes(a)) {
        for (const value of [start,end]) if (!/^\d{4}-\d{2}-\d{2} ([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(value)) throw new Error('时间须为 YYYY-MM-DD HH:mm:ss');
        if (start > end) throw new Error('开始时间不能晚于结束时间');
        start = start.slice(0,10); end = end.slice(0,10);
      }
      range(start, end, {latest:clock, months:key === 'visitor-detail' ? 1 : key === 'shop-region' ? 3 : undefined, days:key === 'channel-trend' ? 30 : undefined});
    }
    if (key === 'visitor-detail' && (!present('startDate') || !present('endDate'))) throw new Error('访客查询必须选择日期范围');
    if (key === 'shop-product') {
      if (p.statisticsType === 'week' && present('statDate')) throw new Error('商品按周查询会忽略指定日期，请清空日期或改用日/月');
      if (present('statDate')) {
        parse(p.statDate);
        if (p.statDate > clock || p.statDate < shift(clock, -89)) throw new Error('商品统计日期必须在近90天内');
        if (!present('statisticsType')) throw new Error('商品指定日期时须同时选择日/月粒度');
        if (p.statisticsType === 'month' && !p.statDate.endsWith('-01')) throw new Error('商品按月查询须传自然月第一天');
      } else if (['day','month'].includes(p.statisticsType)) throw new Error('商品按日/月查询必须指定统计日期');
    }
    if (key.startsWith('tm-') && key !== 'tm-recent') {
      if (!present('queryDate')) throw new Error('请选择接待诊断日期');
      parse(p.queryDate);
      if (p.queryDate > shift(clock,-2)) throw new Error('接待离线数据延迟两天，请选择前天或更早日期');
      if (key !== 'tm-quality-check' && !present('dateType')) throw new Error('请选择接待诊断粒度');
    }
    if (['stars','crowd-insight'].includes(key) && present('statDate')) {
      range(p.statDate,p.statDate,{latest:clock});
      if(key==='crowd-insight' && p.nd==='1m' && !p.statDate.endsWith('-01'))throw new Error('行业画像自然月须传月初日期');
    }
    if (key === 'crowd-insight' && p.nd==='1m' && !present('statDate'))throw new Error('行业画像自然月须选择月份');
    if (key === 'ads-achieve-rate' && present('statDate')) range(compact(p.statDate),compact(p.statDate),{latest:clock});
    for (const [a,b] of [['gmtOpenStart','gmtOpenEnd'],['postTimeStart','postTimeEnd'],['expiredTimeStart','expiredTimeEnd']]) {
      if (!present(a) && !present(b)) continue;
      if (!present(a) || !present(b) || !Number.isSafeInteger(Number(p[a])) || !Number.isSafeInteger(Number(p[b])) || Number(p[a]) < 0 || Number(p[a]) > Number(p[b])) throw new Error('时间戳区间须成对填写，且开始不晚于结束');
    }
    if (key === 'rfq-internal-search') {
      const groups = [present('openTime'),present('gmtOpenFrom') || present('gmtOpenTo'),present('gmtOpenStart') || present('gmtOpenEnd')];
      if (groups.filter(Boolean).length > 1) throw new Error('RFQ 发布时间只选一种方式，避免参数覆盖');
    }
  }
  /** 分离平台越界/缺日期的合同，保留平台分页总数，绝不当作已确认区间总数。@param {object[]} rows 合同行。@param {object} params 已校验的起止北京时间。@returns {object} 合规行及核验计数。@throws 输入区间无效。 */
  function filterContracts(rows, params) {
    const start=Date.parse(params.createDateFrom.replace(' ','T')+'+08:00'),end=Date.parse(params.createDateTo.replace(' ','T')+'+08:00')+999;
    if(!Number.isFinite(start) || !Number.isFinite(end) || start>end)throw new Error('合同时间范围无效');
    const included=[];let outside=0,unknown=0;
    for(const row of rows) {
      const value=row.createDate;let ms=NaN;
      if(typeof value==='number' || /^\d{10,13}$/.test(String(value)))ms=Number(value)*(String(value).length===10?1000:1);
      else if(typeof value==='string') {
        const trimmed=value.trim().replace(' ','T');
        if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(trimmed))ms=Date.parse(trimmed+'+08:00');
        else if(/(?:Z|[+-]\d{2}:?\d{2})$/.test(trimmed))ms=Date.parse(trimmed);
      }
      if(!Number.isFinite(ms))unknown++;
      else if(ms<start || ms>end)outside++;
      else included.push(row);
    }
    return {rows:included,check:{start:params.createDateFrom,end:params.createDateTo,returned:rows.length,included:included.length,outside,unknown}};
  }
  /** 从来源数据选取最新同口径快照，重叠7/30天窗口不能相加。@param {object[]} rows 来源记录。@returns {object} 日期、粒度、记录。@throws 无。 */
  function latestFlow(rows) {
    const valid=rows.filter(row=>/^\d{4}-\d{2}-\d{2}$/.test(row?.statDate || ''));
    const date=valid.map(row=>row.statDate).sort().slice(-1)[0] || '';
    const type=valid.find(row=>row.statDate===date)?.statisticsType || '';
    return {date,type,rows:valid.filter(row=>row.statDate===date && (row.statisticsType || '')===type)};
  }
  const policy = {today,parse,shift,addMonths,range,period,weekValue,validate,enums,adEffects,filterContracts,latestFlow};
  if (typeof module === 'object' && module.exports) module.exports = policy;
  else root.TimePolicy = policy;
})(typeof globalThis === 'object' ? globalThis : this);
