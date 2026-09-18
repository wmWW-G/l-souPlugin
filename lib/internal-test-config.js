'use strict';
const fs = require('node:fs');
const path = require('node:path');

/** 读取仅内部测试包可选携带的后端默认配置。
 * root 为服务根目录；返回白名单内的两个APP密钥及可选API地址，普通包缺文件时返回空对象。
 * 文件只位于public之外；错误不带文件正文，不能把密钥写进日志或前端响应。
 */
function internalTestConfig(root) {
  let data;
  try {
    const file = path.join(root, 'internal-test-dify.json');
    if (fs.statSync(file).size > 16384) throw new Error('内部测试配置过大');
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error('内部测试AI配置读取失败');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('内部测试AI配置格式错误');
  return Object.fromEntries(['DIFY_ANALYSIS_API_KEY', 'DIFY_CHATFLOW_API_KEY', 'DIFY_API_BASE_URL']
    .filter(key => typeof data[key] === 'string' && data[key].trim())
    .map(key => [key, data[key].trim()]));
}
module.exports = { internalTestConfig };
