'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

/**
 * 只替换外部 CLI 和等待，执行实际错误判定、白名单与重试代码。
 * @param {function} result 外部 CLI 的受控响应。
 * @returns {object} 独立 VM 与调用记录，不启动服务或执行真实写操作。
 * @throws {Error} 生产函数无法加载时抛错。
 */
function harness(result) {
  const calls = [];
  const context = vm.createContext({
    setTimeout: callback => queueMicrotask(callback), console: { log() {} }, pushLog() {},
    runWorkctl: async args => { calls.push(args); return result(calls.length); },
    runWorkctlWithJsonFile: async args => { calls.push(args); return result(calls.length); },
  });
  for (const name of ['publishText', 'findPublishResponseField', 'hasPublishFailureSignal', 'publishWorkctlOutcome', 'runPublishRuleRead']) {
    const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n}`));
    assert.ok(match, name); vm.runInContext(match[0], context);
  }
  return { context, calls };
}

test('规则权限拒绝及普通上游拒绝不自动重试', async () => {
  for (const message of ['权限不足，请重新登录；连接超时', 'MCP 调用失败 (reason: mcp_upstream_rejected)']) {
    const { context, calls } = harness(() => ({ ok: false, parsed: { success: false, error: { message } } }));
    await assert.rejects(context.runPublishRuleRead(['icbu', 'product', 'list-attribute'], { categoryId: 123 }), error =>
      error.retryable === false && error.statusCode === 502 && error.code === 'PUBLISH_RULE_READ_REJECTED');
    assert.equal(calls.length, 1);
  }
});

test('规则读取重试严格拒绝发布与上传命令', async () => {
  const { context, calls } = harness(() => ({ ok: true, parsed: { success: true } }));
  for (const command of [['publishflow', 'publish-from-json'], ['icbu', 'product', 'upload-file'], ['constructor']]) {
    await assert.rejects(context.runPublishRuleRead(command, {}), /只读查询/);
  }
  assert.equal(calls.length, 0);
});

test('属性选项超时仅重读该查询，成功返回真实选项', async () => {
  const { context, calls } = harness(attempt => attempt === 1
    ? { ok: false, stderr: '连接下游服务超时（已等待3133ms）' }
    : { ok: true, parsed: { success: true, data: [{ attrNameId: 2, options: [{ attrValueId: 22, attrValue: 'Unisex' }] }] } });
  const result = await context.runPublishRuleRead(['icbu', 'product', 'list-attribute-options'], { categoryId: 123, attrIdList: [2] });
  assert.equal(result.parsed.data[0].options[0].attrValueId, 22);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(args => args.join(' ') === 'icbu product list-attribute-options'));
});
