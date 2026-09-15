'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const html = fs.readFileSync('plugin/skills/lsou-launchpad/assets/launchpad.html', 'utf8');

/** 用隔离 DOM 替身执行正式页面脚本。bridge 是可选宿主函数；返回节点与计时回调，脚本错误直接抛出。 */
function page(bridge) {
  const elements = new Map();
  for (const id of ['launchpad', 'feedback', 'launch', 'check', 'help']) {
    elements.set(id, { textContent: '', disabled: false, classList: { add() {} }, addEventListener(event, callback) { this[event] = callback; } });
  }
  const timers = [];
  const window = { setTimeout(callback) { timers.push(callback); } };
  if (bridge) window.__widgetSendMessage = bridge;
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], { window, document: { getElementById: id => elements.get(id) } });
  return { get: id => elements.get(id), flush: () => timers.splice(0).forEach(callback => callback()) };
}

test('launchpad sends only deliberate fixed actions, suppresses double clicks, and never fabricates ready', () => {
  const messages = [];
  const p = page(text => messages.push(text));
  assert.deepEqual(messages, []);
  p.get('launch').click(); p.get('launch').click(); p.get('help').click();
  assert.deepEqual(messages, ['启动来搜工作台']);
  assert.match(p.get('feedback').textContent, /请求已发送/);
  assert.doesNotMatch(p.get('feedback').textContent, /已就绪|已成功|已连接/);
  p.flush(); p.get('check').click(); p.flush(); p.get('help').click();
  assert.deepEqual(messages, ['启动来搜工作台', '查看来搜工作台启动状态', '帮我排查来搜工作台启动问题']);
  assert.ok(messages.every(text => text.length <= 500));
});

test('standalone preview and a broken bridge show actionable errors without a success state', () => {
  const preview = page(); preview.get('launch').click();
  assert.match(preview.get('feedback').textContent, /请在 Accio Work/);
  assert.equal(preview.get('launch').disabled, false);
  const broken = page(() => { throw new Error('test bridge failure'); }); broken.get('launch').click();
  assert.match(broken.get('feedback').textContent, /请求未能发送/);
  broken.flush(); assert.equal(broken.get('launch').disabled, false);
});

test('MCP serves the exact widget template and stays idle when rendering it', async t => {
  const child = spawn(process.execPath, ['plugin/scripts/desktop-mcp.cjs'], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  let output = ''; child.stdout.on('data', data => { output += data; });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'lsou_desktop_launchpad', arguments: {} } }) + '\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'lsou_desktop_status', arguments: {} } }) + '\n');
  child.stdin.end(); await once(child, 'exit');
  const replies = output.trim().split('\n').map(JSON.parse);
  const fragment = html.match(/<style>[\s\S]*?<\/style>/)[0] + '\n' + html.match(/<body>([\s\S]*?)<\/body>/)[1].trim();
  assert.equal(replies[0].result.content[0].text, '```widget lsou_launchpad\n' + fragment + '\n```');
  assert.equal(JSON.parse(replies[1].result.content[0].text).state, 'stopped');
});
