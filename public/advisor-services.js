/* 现有业务按钮与持久HTML报告入口的轻量适配；不再调用旧Dify侧栏。 */
(()=>{'use strict';
 let currentPage='';
 /** 导航后挂载报告目录；page为业务页标识，返回void，不生成分析。 */
 function attach(page){currentPage=page;window.AdvisorReports?.attach(page);}
 /** 切换主题只更新资料与报告归属；page/index来自当前业务按钮，无生成副作用。 */
 function open(page,index){if(page===currentPage)window.AdvisorReports?.select(index,false);}
 /** 原页面切换资料的兼容入口；报告归属由对应主题按钮更新，无返回值。 */
 function showData(){}
 /** 用户明确点击定位分析后交接；index为定位主题，Promise由报告模块管理错误。 */
 function startPosition(index){return window.AdvisorReports?.start('position',index);}
 /** 为旧卡片返回安全的固定按钮结构；不展示内部工具信息。 */
 function action(page,index){return `<button type="button" class="av-inline-trigger" data-service-page="${page}" data-service-index="${Number(index)}">选择分析主题</button>`;}
 document.addEventListener('click',event=>{const b=event.target.closest('button');if(!b)return;if(b.hasAttribute('data-position-analyze'))void startPosition(Number(b.dataset.positionAnalyze));else if(b.dataset.servicePage)open(b.dataset.servicePage,Number(b.dataset.serviceIndex));else if(b.dataset.wfService!=null)open('position',Number(b.dataset.wfService));});
 window.AdvisorServices={attach,open,showData,action};
})();
