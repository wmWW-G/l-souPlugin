'use strict';
const TimePolicy=require('../public/time-policy');
/** 校验用户明确选择的完整周期；period为起止日与mode，返回规范字段，无效日期或粒度抛错。 */
function normalizePeriod(period){
 if(!period||!['day','week','month'].includes(period.mode))throw new Error('请选择有效的日、周或月周期');
 const {mode,startDate,endDate}=period;TimePolicy.range(startDate,endDate,{latest:'9999-12-31'});
 const value=mode==='month'?startDate.slice(0,7):mode==='week'?TimePolicy.weekValue(startDate):startDate;
 const expected=TimePolicy.period(mode,value,'9999-12-31');
 if(startDate!==expected.startDate||endDate!==expected.endDate)throw new Error('起止日期与所选周期不一致');
 return {mode,startDate,endDate};
}
const metricDictionary={
 pv:{scope:'关键词/市场搜索数据',meaning:'搜索热度指数',unit:'指数',restriction:'不是本店浏览量、曝光量、访客数或实际搜索人数；其他来源同名字段须核对来源定义'},
 shopUv:{scope:'店铺买家搜索词画像',meaning:'该搜索词带来的本店访客数',unit:'访客',restriction:'与pv的来源、范围和单位不同，不能相除或直接比较来断定获客缺口、承接不足或原因'},
 interpretation:'保留各记录source和scope的原周期，零值不等于缺失。指数、人数和比率不可混用；对标差距只能形成待核查假设，原因需同对象同周期曝光、点击、询盘、成交及内容证据验证。'
};
module.exports={normalizePeriod,metricDictionary};
