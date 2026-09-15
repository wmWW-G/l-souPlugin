'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PublishReadCache } = require('../lib/publish-read-cache');

/** @param {object} t 测试上下文。@returns {Promise<object>} 隔离缓存配置，测试结束清理。@throws {Error} 临时目录创建失败抛错。 */
async function options(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lsou-publish-cache-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { directory, scope: 'account-a' };
}

test('重建缓存实例直接读磁盘，账号隔离，编辑返回值不污染快照', async t => {
  const config = await options(t);
  const first = new PublishReadCache(config);
  const result = await first.read('catalog', async () => ({ rows: [{ title: 'Original' }] }));
  result.rows[0].title = 'Edited';
  const restarted = new PublishReadCache(config);
  const restored = await restarted.read('catalog', async () => { throw new Error('不应重读'); });
  assert.equal(restored.rows[0].title, 'Original');
  assert.equal(restarted.status('catalog').savedLocally, true);
  assert.equal((await fs.stat(first.file)).mode & 0o777, 0o600);
  const other = new PublishReadCache({ ...config, scope: 'account-b' });
  assert.deepEqual(await other.read('catalog', async () => []), []);
  assert.notEqual(first.file, other.file);
  const unknown = new PublishReadCache({ ...config, scope: '' });
  await unknown.read('catalog', async () => []);
  assert.equal(unknown.file, null);
});

test('普通读取无自动过期，写前 maxAge 重新核对，失败不覆盖旧记录', async t => {
  const cache = new PublishReadCache(await options(t));
  await cache.read('schema:1', async () => ({ version: 1 }));
  cache.entries.get('schema:1').at = Date.now() - 48 * 60 * 60 * 1000;
  assert.equal((await cache.read('schema:1', async () => { throw new Error('不应重读'); })).version, 1);
  await assert.rejects(cache.read('schema:1', async () => { throw new Error('平台不可用'); }, { maxAge: 30 * 60 * 1000 }), /平台不可用/);
  assert.equal(cache.entries.get('schema:1').value.version, 1);
  assert.equal((await cache.read('schema:1', async () => ({ version: 2 }), { maxAge: 30 * 60 * 1000 })).version, 2);
});

test('同资料并发只读取一次，主动失效隔离迟到请求并持久化', async t => {
  const config = await options(t);
  const cache = new PublishReadCache(config);
  let calls = 0;
  const reads = await Promise.all(Array.from({ length: 5 }, () => cache.read('catalog', async () => { calls++; return { v: 1 }; })));
  assert.equal(calls, 1); assert.equal(reads.length, 5);
  await cache.invalidate();
  let finish;
  const stale = cache.read('catalog', () => new Promise(resolve => { finish = resolve; }));
  // initialize/read 的微任务完成后即可看到受控的在途查询，不依赖固定等待时长。
  while (!finish) await Promise.resolve();
  await cache.invalidate();
  await cache.read('catalog', async () => ({ v: 2 }));
  finish({ v: 0 });
  await assert.rejects(stale, /正在更新/);
  const restarted = new PublishReadCache(config);
  assert.equal((await restarted.read('catalog', async () => ({ v: 3 }))).v, 2);
  await cache.invalidate(true);
  assert.equal((await new PublishReadCache(config).read('catalog', async () => ({ v: 4 }))).v, 4);
});

test('损坏文件和不可写目录降级，不把保存失败标为本地已缓存', async t => {
  const config = await options(t);
  const cache = new PublishReadCache(config);
  await fs.writeFile(cache.file, '{broken');
  assert.equal(await cache.read('categories', async () => 1), 1);
  const invalidDirectory = path.join(config.directory, 'file');
  await fs.writeFile(invalidDirectory, 'not-a-directory');
  const memoryOnly = new PublishReadCache({ ...config, directory: invalidDirectory });
  assert.equal(await memoryOnly.read('categories', async () => 2), 2);
  assert.equal(memoryOnly.status('categories').savedLocally, false);
});
