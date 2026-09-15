import React, { memo, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import parse from 'html-react-parser';
import template from '../public/index.html?raw';
import '../public/style.css';
import '../public/ai-advisor.css';
import 'remixicon/fonts/remixicon.css';
import './desktop.css';

// 本地可信模板仅负责静态结构；业务数据仍由已有模块校验、转义并填充。
// React 初始化全部工作区 DOM，业务区 memo 后不随导航状态重绘，避免覆盖表单编辑。
const body = template.match(/<body>([\s\S]*?)<script /)[1];
const sections = new DOMParser().parseFromString(body, 'text/html');
const navigation = [...sections.querySelector('.tabs-in').children].map(el => ({
  group: el.tagName === 'P', id: el.dataset.tab, label: el.textContent.trim(),
  icon: el.querySelector('i')?.className,
}));
const scripts = ['/publish-product-utils.js', '/time-policy.js', '/ai-advisor.js', '/app.js', '/advertising.js', '/risk-workspace.js', '/operations.js'];
let initialization;

/** 按依赖顺序加载旧业务模块一次。参数无；返回 Promise；加载失败时拒绝。 */
function initializeBusiness() {
  if (!initialization) initialization = scripts.reduce((ready, src) => ready.then(() => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src; script.onload = resolve; script.onerror = () => reject(new Error('业务模块加载失败，请重新打开工作台'));
    document.body.append(script);
  })), Promise.resolve());
  return initialization.then(() => window.initializeWorkbench());
}

/** React 管理业务导航及当前页状态；无参数，返回导航元素；无主动异常。 */
function Navigation() {
  const [active, setActive] = useState('overview');
  useEffect(() => {
    // 原业务模块需要立即读取当前导航，不能等待 WebView 后台调度再更新状态。
    const update = event => flushSync(() => setActive(event.detail));
    window.addEventListener('lsou:navigation', update);
    return () => window.removeEventListener('lsou:navigation', update);
  }, []);
  return <nav className="tabs" id="tabs" data-react-navigation="true"><div className="tabs-in">
    {navigation.map((item, index) => item.group
      ? <p className="nav-label" key={index}>{item.label}</p>
      : <button key={item.id} data-tab={item.id} className={active === item.id ? 'on' : ''}
          aria-current={active === item.id ? 'page' : undefined}
          onClick={() => window.switchTab?.(item.id)}><i className={item.icon} aria-hidden="true"/><span>{item.label}</span></button>)}
  </div></nav>;
}

/** 将现有可信页面转为 React 元素，替换导航组件；无参数，返回稳定工作区；模板无效时抛错。 */
const Workspace = memo(function Workspace() {
  return parse(body, { replace: node => node.attribs?.id === 'tabs' ? <Navigation/> : undefined });
});

/** React 应用入口，承接启动错误；无参数，返回完整工作台；异步错误以中文展示。 */
function App() {
  const [error, setError] = useState('');
  useEffect(() => { initializeBusiness().catch(reason => setError(reason.message)); }, []);
  return <>{error && <div role="alert" style={{ padding: 20, color: '#b42318' }}>{error}</div>}<Workspace/></>;
}

window.__LSOU_FRONTEND__ = { framework: 'React', version: React.version, delivery: 'Tauri', applicationVersion: '1.0.9' };
createRoot(document.getElementById('root')).render(<App/>);
