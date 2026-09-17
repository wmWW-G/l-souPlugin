'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
/** 在隔离环境检查展示适配，不调用模型或业务接口。返回内部纯渲染函数。 */
function renderer(){
 const context={window:{AdvisorUI:{esc:value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}},document:{addEventListener(){}}};
 const source=fs.readFileSync(require.resolve('../public/advisor-services.js'),'utf8').replace('window.AdvisorServices={open,attach,action,showData};','window.AdvisorServices={report,sections,presentationRule};');
 vm.runInNewContext(source,context);return context.window.AdvisorServices;
}
test('定位保持原型四维度，真实国家占比独立显示，不伪造缺失客群',()=>{
 const state={page:'position',topic:'市场与客群定位',records:[{source:'/api/q/customer-profile',scope:'nd=30d&dimensionType=country',data:[{country:[{country:'US',visitorRate:0.2029}]}]}],result:{summary:'需补资料',tasks:[]}};
 const html=renderer().report(state);
 assert.equal((html.match(/class="av-result-card"/g)||[]).length,4);
 for(const heading of ['目标市场分析','客群画像','痛点分析','决策链'])assert.ok(html.includes(heading));
 assert.ok(html.includes('20.3%'));assert.ok(html.includes('需补充买家类型'));assert.ok(!html.includes('分销商45%'));
});
test('旧诊断不得按顺序冒充固定维度，模型和来源文本转义',()=>{
 const state={page:'position',topic:'市场与客群定位',records:[],result:{summary:'<img src=x>',tasks:[{title:'随意诊断',basis:'<script>bad</script>',steps:[]}]}};
 const html=renderer().report(state);assert.ok(html.includes('整体判断与补充分析'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.equal((html.match(/待补资料<\/small>/g)||[]).length,4);
});
test('流程展示约定保留证据与缺项边界',()=>{
 const rule=renderer().presentationRule({page:'position',topic:'公司定位'});
 assert.ok(rule.includes('公司实力、定制优势、品质保障、服务能力'));assert.ok(rule.includes('真实evidence_ids'));assert.ok(rule.includes('needs_data'));assert.ok(rule.includes('不超过70字'));
});
test('选择业务只准备资料，用户主动开始才调用积分分析，重复点击不会并发扣费',async()=>{
 const calls=[];let finish;
 const context={window:{AdvisorUI:{esc:String},AdvisorLive:{range:()=>({startDate:'2026-08-01',endDate:'2026-08-31',mode:'month'}),ready:async()=>{},records:()=>[]}},document:{addEventListener(){}},fetch:async(path)=>{
  calls.push(path);
  if(path.endsWith('/analysis'))await new Promise(resolve=>{finish=resolve;});
  return {ok:true,json:async()=>path.endsWith('/config')?{ok:true,analysisConfigured:true}:path.endsWith('/context')?{ok:true,snapshot:{snapshot_id:'test',facts:[{id:'real'}]},result:null}:{ok:true,result:{summary:'已生成',tasks:[]}}};
 }};
 let source=fs.readFileSync(require.resolve('../public/advisor-services.js'),'utf8');
 // 本测试聚焦请求触发边界，替换DOM渲染以避免引入浏览器依赖。
 const start=source.indexOf('  function ensureDrawer(){'),end=source.indexOf('  /** 将分析入口',start);
 source=source.slice(0,start)+'  function ensureDrawer(){}\n'+source.slice(end);
 source=source.replace('function render(){','function unusedRender(){');
 source=source.replace('window.AdvisorServices={open,attach,action,showData};','function render(){} window.AdvisorServices={prepare:(page,index)=>{currentPage=page;return open(page,index);},generate};');
 vm.runInNewContext(source,context);
 const api=context.window.AdvisorServices;
 await api.prepare('position',0);await api.prepare('position',1);
 assert.equal(calls.filter(x=>x.endsWith('/analysis')).length,0);
 const running=api.generate();await api.generate();
 assert.equal(calls.filter(x=>x.endsWith('/analysis')).length,1);
 finish();await running;
});
